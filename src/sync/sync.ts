import type { Table } from 'dexie'
import { db, getMeta, setMeta } from '../db/db'
import { now, uuid } from '../db/repo'
import type { BaseRecord, Session, SyncEntity } from '../db/types'
import { mockServer, type PushChange, type SyncServer } from './mockServer'

// ============================================================================
// Sync engine: sends records saved offline to the server, then downloads
// changes made at other sites. Swap `server` for a real adapter (Supabase /
// PowerSync) without touching the rest of the app.
// ============================================================================

const server: SyncServer = mockServer

const TABLES: { entity: SyncEntity; table: () => Table<BaseRecord, string> }[] = [
  // Order matters: households before the clients that point to them, clients before services
  { entity: 'household', table: () => db.households as unknown as Table<BaseRecord, string> },
  { entity: 'client', table: () => db.clients as unknown as Table<BaseRecord, string> },
  { entity: 'service', table: () => db.services as unknown as Table<BaseRecord, string> },
]
const tableFor = (e: SyncEntity) => TABLES.find((t) => t.entity === e)!.table()

export interface SyncResult {
  pushed: number
  pulled: number
  conflicts: number
}

let running: Promise<SyncResult> | null = null

/** Runs one sync. Safe to call repeatedly; concurrent calls share the same run. */
export function runSync(s: Session): Promise<SyncResult> {
  running ??= doSync(s).finally(() => {
    running = null
  })
  return running
}

async function doSync(s: Session): Promise<SyncResult> {
  if (!navigator.onLine) throw new Error('No internet connection')
  let conflictsFound = 0

  // ---- 1. PUSH local changes ----
  const changes: PushChange[] = []
  const sent = new Map<string, string>() // key -> updatedAt we sent
  for (const { entity, table } of TABLES) {
    const pending = await table().where('syncStatus').equals('pending').toArray()
    for (const rec of pending) {
      const key = `${entity}:${rec.id}`
      const base = await db.bases.get(key)
      changes.push({ entity, id: rec.id, baseVersion: rec.version ?? 0, base: base?.data, data: rec as unknown as Record<string, unknown> })
      sent.set(key, rec.updatedAt)
    }
  }

  if (changes.length) {
    const results = await server.push(changes)
    for (const r of results) {
      const key = `${r.entity}:${r.id}`
      const t = tableFor(r.entity)
      await db.transaction('rw', [t, db.bases, db.conflicts, db.audit], async () => {
        const local = await t.get(r.id)
        if (local && local.updatedAt !== sent.get(key)) {
          // Edited again while syncing: keep the newer local edit queued, but note the new server version
          await t.update(r.id, { version: r.version })
        } else {
          await t.put({ ...(r.data as unknown as BaseRecord), syncStatus: 'synced', version: r.version })
        }
        await db.bases.put({ key, data: r.data })
        for (const c of r.conflicts) {
          conflictsFound++
          await db.conflicts.add({
            id: uuid(), entity: r.entity, entityId: r.id, field: c.field, localValue: c.localValue, serverValue: c.serverValue,
            serverUpdatedBy: c.serverUpdatedBy, at: now(), resolved: false,
          })
          await db.audit.add({
            id: uuid(), at: now(), user: s.userName, site: s.site, entity: r.entity, entityId: r.id, action: 'conflict',
            changes: { [c.field]: { from: c.localValue, to: c.serverValue } }, syncStatus: 'pending',
          })
        }
      })
    }
  }

  // The audit trail is append-only, so it never conflicts
  const audit = await db.audit.where('syncStatus').equals('pending').toArray()
  if (audit.length) {
    await server.pushAudit(audit)
    await db.audit.bulkPut(audit.map((a) => ({ ...a, syncStatus: 'synced' as const })))
  }

  // ---- 2. PULL other sites' changes ----
  const since = await getMeta<number>('lastSeq', 0)
  const { records, seq } = await server.pull(since)
  let pulled = 0
  for (const r of records) {
    const t = tableFor(r.entity)
    const key = `${r.entity}:${r.id}`
    const local = await t.get(r.id)
    if (local?.syncStatus === 'pending') continue // a newer local edit; it is merged on the next push
    if (local && (local.version ?? 0) >= r.version) continue // already have it
    await t.put({ ...(r.data as unknown as BaseRecord), syncStatus: 'synced', version: r.version })
    await db.bases.put({ key, data: r.data })
    pulled++
  }
  await setMeta('lastSeq', seq)
  await setMeta('lastSyncAt', now())
  return { pushed: changes.length, pulled, conflicts: conflictsFound }
}
