import Dexie, { type Table } from 'dexie'
import type { AuditEntry, Client, Household, SyncEntity } from '../db/types'

// ============================================================================
// MOCK CLOUD SERVER — prototype only.
// Stands in for the real cloud database (PostgreSQL on Supabase + PowerSync)
// so the sync logic, conflict handling and cross-site duplicates can be
// tested today. It lives in a separate IndexedDB database in the same browser.
// Replace it with a real adapter that implements `SyncServer`.
// ============================================================================

export interface PushChange {
  entity: SyncEntity
  id: string
  baseVersion: number // server version the device started editing from
  base?: Record<string, unknown> // record as it was at that version
  data: Record<string, unknown>
}

export interface FieldConflict {
  field: string
  localValue: unknown
  serverValue: unknown
  serverUpdatedBy: string
}

export interface PushResult {
  entity: SyncEntity
  id: string
  version: number
  data: Record<string, unknown>
  conflicts: FieldConflict[]
}

export interface PulledRecord {
  entity: SyncEntity
  id: string
  version: number
  data: Record<string, unknown>
}

export interface SyncServer {
  push(changes: PushChange[]): Promise<PushResult[]>
  pushAudit(entries: AuditEntry[]): Promise<void>
  pull(sinceSeq: number): Promise<{ records: PulledRecord[]; seq: number }>
}

interface ServerRecord {
  key: string
  entity: SyncEntity
  id: string
  version: number
  seq: number
  data: Record<string, unknown>
}

class ServerDB extends Dexie {
  records!: Table<ServerRecord, string>
  audit!: Table<AuditEntry, string>
  meta!: Table<{ key: string; value: number }, string>
  constructor() {
    super('adra-mock-server')
    this.version(1).stores({ records: 'key, entity, seq', audit: 'id', meta: 'key' })
  }
}

const sdb = new ServerDB()

// Fields that never count as a conflict
const META_FIELDS = new Set(['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'syncStatus', 'version', 'site'])

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function assertOnline() {
  if (!navigator.onLine) throw new Error('No internet connection')
}

async function nextSeq(): Promise<number> {
  const cur = (await sdb.meta.get('seq'))?.value ?? 0
  await sdb.meta.put({ key: 'seq', value: cur + 1 })
  return cur + 1
}

export const mockServer: SyncServer = {
  async push(changes) {
    assertOnline()
    await delay(250)
    const results: PushResult[] = []
    await sdb.transaction('rw', sdb.records, sdb.meta, async () => {
      for (const ch of changes) {
        const key = `${ch.entity}:${ch.id}`
        const existing = await sdb.records.get(key)
        const conflicts: FieldConflict[] = []
        let merged: Record<string, unknown>

        if (!existing || existing.version === ch.baseVersion) {
          merged = ch.data // new, or nobody else changed it: simple write
        } else {
          // Someone else changed this record since the device last synced.
          // Merge field by field; only fields BOTH sides changed differently conflict.
          const base = ch.base ?? {}
          merged = { ...existing.data }
          for (const [field, localValue] of Object.entries(ch.data)) {
            if (META_FIELDS.has(field)) continue
            const localChanged = !same(localValue, base[field])
            const serverChanged = !same(existing.data[field], base[field])
            if (localChanged && serverChanged && !same(localValue, existing.data[field])) {
              conflicts.push({ field, localValue, serverValue: existing.data[field], serverUpdatedBy: String(existing.data.updatedBy ?? '') })
            } else if (localChanged) {
              merged[field] = localValue
            }
          }
          merged.updatedAt = ch.data.updatedAt
          merged.updatedBy = ch.data.updatedBy
        }

        const version = (existing?.version ?? 0) + 1
        merged = { ...merged, version, syncStatus: 'synced' }
        await sdb.records.put({ key, entity: ch.entity, id: ch.id, version, seq: await nextSeq(), data: merged })
        results.push({ entity: ch.entity, id: ch.id, version, data: merged, conflicts })
      }
    })
    return results
  },

  async pushAudit(entries) {
    assertOnline()
    await sdb.audit.bulkPut(entries.map((e) => ({ ...e, syncStatus: 'synced' as const })))
  },

  async pull(sinceSeq) {
    assertOnline()
    await delay(150)
    const rows = await sdb.records.where('seq').above(sinceSeq).toArray()
    const seq = rows.reduce((m, r) => Math.max(m, r.seq), sinceSeq)
    return { records: rows.map((r) => ({ entity: r.entity, id: r.id, version: r.version, data: r.data })), seq }
  },
}

// ---------- demo helpers ----------

export async function serverStats() {
  const [records, audit] = await Promise.all([sdb.records.toArray(), sdb.audit.count()])
  const count = (e: SyncEntity) => records.filter((r) => r.entity === e).length
  return { clients: count('client'), households: count('household'), services: count('service'), audit }
}

export async function resetServer() {
  await Promise.all([sdb.records.clear(), sdb.audit.clear(), sdb.meta.clear()])
}

/**
 * Pretends a worker at another site edited records on the server:
 *  1. changes the phone number of an existing client (causes a conflict if
 *     you also changed that client's phone on this device), and
 *  2. registers a near-duplicate of an existing client at another site.
 */
export async function simulateOtherSite(preferClientId?: string): Promise<string[]> {
  assertOnline()
  const notes: string[] = []
  const t = new Date().toISOString()
  const who = 'R. Jones (Salisbury)'
  await sdb.transaction('rw', sdb.records, sdb.meta, async () => {
    const clients = await sdb.records.where('entity').equals('client').toArray()
    const live = clients.filter((c) => !c.data.deleted)
    if (!live.length) throw new Error('The server has no clients yet. Load demo data and sync first.')

    const target = live.find((c) => c.id === preferClientId) ?? live[Math.floor(Math.random() * live.length)]
    const phone = `04${Math.floor(10 + Math.random() * 89)} ${Math.floor(100 + Math.random() * 899)} ${Math.floor(100 + Math.random() * 899)}`
    const d = target.data as unknown as Client
    target.version += 1
    target.seq = await nextSeq()
    target.data = { ...target.data, phone, updatedAt: t, updatedBy: who, version: target.version }
    await sdb.records.put(target)
    notes.push(`Salisbury changed ${d.firstName} ${d.lastName}'s phone to ${phone}`)

    // Near-duplicate registered at another site (typo in the first name, same DOB)
    const src = live.find((c) => (c.data as unknown as Client).relationship === 'Primary' && c.id !== target.id) ?? target
    const sc = src.data as unknown as Client
    const hhId = crypto.randomUUID()
    const household: Household = {
      id: hhId, name: `${sc.lastName} household`, address: '', suburb: 'Salisbury', postcode: '5108', housingSituation: '', notes: '',
      createdAt: t, updatedAt: t, createdBy: who, updatedBy: who, site: 'Salisbury', syncStatus: 'synced', version: 1,
    }
    const typo = sc.firstName.length > 3 ? sc.firstName.slice(0, -1) + (sc.firstName.endsWith('a') ? 'ah' : 'e') : sc.firstName + 'e'
    const dup: Client = {
      ...sc, id: crypto.randomUUID(), clientNo: `C-SAL${Math.floor(100 + Math.random() * 899)}`, firstName: typo, householdId: hhId, relationship: 'Primary',
      phone: '', createdAt: t, updatedAt: t, createdBy: who, updatedBy: who, site: 'Salisbury', syncStatus: 'synced', version: 1,
    }
    await sdb.records.put({ key: `household:${hhId}`, entity: 'household', id: hhId, version: 1, seq: await nextSeq(), data: household as unknown as Record<string, unknown> })
    await sdb.records.put({ key: `client:${dup.id}`, entity: 'client', id: dup.id, version: 1, seq: await nextSeq(), data: dup as unknown as Record<string, unknown> })
    notes.push(`Salisbury registered "${dup.firstName} ${dup.lastName}" (DOB ${dup.dob}), a likely duplicate of ${sc.firstName} ${sc.lastName}`)
  })
  return notes
}
