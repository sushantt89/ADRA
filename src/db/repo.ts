import { db } from './db'
import type { AuditEntry, BaseRecord, Client, Household, SearchFilters, Service, Session, VisitTemplate } from './types'
import { digitsOnly, nameScore, normalise } from '../lib/fuzzy'

// ---------- helpers ----------

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const now = () => new Date().toISOString()
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function newClientNo(): string {
  // Short, readable, collision-resistant without a server (no 0/O/1/I).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `C-${s}`
}

function stamp<T extends object>(data: T, s: Session): T & BaseRecord {
  const t = now()
  return {
    ...data,
    id: uuid(),
    createdAt: t,
    updatedAt: t,
    createdBy: s.userName,
    updatedBy: s.userName,
    site: s.site,
    syncStatus: 'pending',
  }
}

const IGNORED_DIFF_KEYS = new Set(['updatedAt', 'updatedBy', 'syncStatus', 'version', 'consentSignature'])
const MASKED_KEYS = new Set(['crn', 'medicareNo', 'licenceNo'])

function diff(before: object | undefined, after: object): AuditEntry['changes'] {
  const changes: AuditEntry['changes'] = {}
  const b = (before ?? {}) as Record<string, unknown>
  const a = after as Record<string, unknown>
  for (const key of Object.keys(a)) {
    if (IGNORED_DIFF_KEYS.has(key)) continue
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      // Never write full ID numbers into the audit log
      const m = (v: unknown) => (MASKED_KEYS.has(key) && typeof v === 'string' && v ? `…${v.replace(/\s/g, '').slice(-3)}` : v)
      changes[key] = { from: m(b[key]) ?? null, to: m(a[key]) }
    }
  }
  return changes
}

function audit(
  s: Session,
  entity: AuditEntry['entity'],
  entityId: string,
  action: AuditEntry['action'],
  changes: AuditEntry['changes'],
): AuditEntry {
  return { id: uuid(), at: now(), user: s.userName, site: s.site, entity, entityId, action, changes, syncStatus: 'pending' }
}

// ---------- households ----------

export type HouseholdInput = Omit<Household, keyof BaseRecord>

export async function createHousehold(data: HouseholdInput, s: Session): Promise<Household> {
  const h = stamp(data, s)
  await db.transaction('rw', db.households, db.audit, async () => {
    await db.households.add(h)
    await db.audit.add(audit(s, 'household', h.id, 'create', diff(undefined, data)))
  })
  return h
}

export async function updateHousehold(id: string, data: Partial<HouseholdInput>, s: Session) {
  await db.transaction('rw', db.households, db.audit, async () => {
    const before = await db.households.get(id)
    if (!before) throw new Error('Household not found')
    const changes = diff(before, { ...before, ...data })
    if (!Object.keys(changes).length) return
    await db.households.update(id, { ...data, updatedAt: now(), updatedBy: s.userName, syncStatus: 'pending' })
    await db.audit.add(audit(s, 'household', id, 'update', changes))
  })
}

// ---------- clients ----------

export type ClientInput = Omit<Client, keyof BaseRecord | 'clientNo'>

export async function createClient(data: ClientInput, s: Session): Promise<Client> {
  const c: Client = { ...stamp(data, s), clientNo: newClientNo() }
  await db.transaction('rw', db.clients, db.audit, async () => {
    await db.clients.add(c)
    await db.audit.add(audit(s, 'client', c.id, 'create', diff(undefined, data)))
  })
  return c
}

export async function updateClient(id: string, data: Partial<ClientInput>, s: Session) {
  await db.transaction('rw', db.clients, db.audit, async () => {
    const before = await db.clients.get(id)
    if (!before) throw new Error('Client not found')
    const changes = diff(before, { ...before, ...data })
    if (!Object.keys(changes).length) return
    await db.clients.update(id, { ...data, updatedAt: now(), updatedBy: s.userName, syncStatus: 'pending' })
    await db.audit.add(audit(s, 'client', id, 'update', changes))
  })
}

// ---------- services ----------

export interface ServiceInput {
  date: string
  type: string
  supportMethod: string
  value: number
  quantity: number
  notes: string
}

/** Records one service for each client given. Several clients = household-level entry. */
export async function recordServices(input: ServiceInput, clients: Client[], s: Session): Promise<Service[]> {
  const batchId = clients.length > 1 ? uuid() : undefined
  // For a household-level entry the dollar value is counted once (on the first row), not per person
  const rows: Service[] = clients.map((c, i) =>
    stamp({ ...input, value: i === 0 ? input.value : 0, clientId: c.id, householdId: c.householdId, batchId }, s),
  )
  await db.transaction('rw', db.services, db.audit, async () => {
    await db.services.bulkAdd(rows)
    await db.audit.bulkAdd(rows.map((r) => audit(s, 'service', r.id, 'create', diff(undefined, input))))
  })
  return rows
}

/** Records every item of a visit template in one go (e.g. food parcel + transport). */
export async function recordTemplate(t: VisitTemplate, date: string, clients: Client[], s: Session): Promise<Service[]> {
  const all: Service[] = []
  for (const item of t.items) all.push(...(await recordServices({ ...item, date, notes: `Template: ${t.label}` }, clients, s)))
  return all
}

export async function voidService(id: string, reason: string, s: Session) {
  await db.transaction('rw', db.services, db.audit, async () => {
    await db.services.update(id, { deleted: true, notes: reason, updatedAt: now(), updatedBy: s.userName, syncStatus: 'pending' })
    await db.audit.add(audit(s, 'service', id, 'delete', { deleted: { from: false, to: true }, reason: { from: null, to: reason } }))
  })
}

// ---------- search & duplicates ----------

export interface SearchHit {
  client: Client
  household?: Household
  score: number
  reason: string
}

function parseDob(q: string): string | null {
  const iso = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const au = q.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (au) return `${au[3]}-${au[2].padStart(2, '0')}-${au[1].padStart(2, '0')}`
  return null
}

function daysAgoIso(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** True when a client passes the filter chips on the search screen. */
export function matchesFilters(c: Client, h: Household | undefined, f: SearchFilters, lastVisit?: string): boolean {
  if (f.alert && !c.riskFlag) return false
  if (f.interpreter && !c.interpreterNeeded) return false
  if (f.disability && !c.hasDisability) return false
  if (f.suburb && normalise(h?.suburb ?? '') !== normalise(f.suburb)) return false
  if (f.incomeSource && c.incomeSource !== f.incomeSource) return false
  if (f.culturalBackground && normalise(c.culturalBackground) !== normalise(f.culturalBackground)) return false
  if (f.visitedDays && (!lastVisit || lastVisit < daysAgoIso(f.visitedDays))) return false
  return true
}

export function hasFilters(f: SearchFilters) {
  return Object.values(f).some((v) => v !== undefined && v !== '' && v !== false)
}

export function searchClients(
  query: string,
  clients: Client[],
  households: Map<string, Household>,
  filters: SearchFilters = {},
  lastVisits?: Map<string, string>,
): SearchHit[] {
  const q = query.trim()
  const filtered = hasFilters(filters)
  if (!q && !filtered) return []
  const pass = (c: Client) => matchesFilters(c, households.get(c.householdId), filters, lastVisits?.get(c.id))

  // Filters only: list everyone who matches, alphabetically
  if (!q) {
    return clients
      .filter((c) => !c.deleted && pass(c))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
      .slice(0, 200)
      .map((c) => ({ client: c, household: households.get(c.householdId), score: 0.5, reason: '' }))
  }

  const hits: SearchHit[] = []
  const dob = parseDob(q)
  const digits = digitsOnly(q)
  const compact = q.replace(/[\s()+-]/g, '')
  const isNumberLike = !dob && digits.length >= 4 && digits.length === compact.length
  const idLike = compact.toLowerCase()
  const tokens = normalise(q).split(' ').filter(Boolean)
  const qNorm = normalise(q)

  for (const c of clients) {
    if (c.deleted) continue
    const h = households.get(c.householdId)
    let score = 0
    let reason = ''
    const idMatch = (v: string) => !!v && idLike.length >= 5 && v.replace(/\s/g, '').toLowerCase() === idLike

    if (c.clientNo.toLowerCase() === q.toLowerCase() || c.clientNo.toLowerCase() === `c-${q.toLowerCase()}`) {
      score = 1
      reason = 'Client ID'
    } else if (idMatch(c.crn)) {
      score = 1
      reason = 'Centrelink CRN'
    } else if (idMatch(c.medicareNo)) {
      score = 1
      reason = 'Medicare no.'
    } else if (idMatch(c.licenceNo)) {
      score = 1
      reason = 'Licence no.'
    } else if (dob) {
      if (c.dob === dob) {
        score = 0.95
        reason = 'Date of birth'
      }
    } else if (isNumberLike) {
      if (digitsOnly(c.phone).includes(digits)) {
        score = 0.9
        reason = 'Phone'
      } else if (h && h.postcode === digits) {
        score = 0.6
        reason = 'Postcode'
      }
    } else {
      // Name: every search word must loosely match one of the client's names
      const names = [c.firstName, c.lastName, c.preferredName].filter(Boolean)
      let total = 0
      let allMatched = true
      for (const t of tokens) {
        const best = Math.max(0, ...names.map((n) => nameScore(t, n)))
        if (best < 0.6) allMatched = false
        total += best
      }
      if (allMatched && tokens.length) {
        score = (total / tokens.length) * 0.9
        reason = score > 0.85 ? 'Name' : 'Similar name'
      }
      // Address / suburb
      if (h && score < 0.5) {
        const addr = normalise(`${h.address} ${h.suburb} ${h.postcode}`)
        if (qNorm.length >= 3 && addr.includes(qNorm)) {
          score = 0.7
          reason = 'Address'
        }
      }
      // Cultural background / nationality / language tags
      if (score < 0.5 && qNorm.length >= 3) {
        const tags = normalise(`${c.culturalBackground} ${c.countryOfBirth} ${c.languages}`)
        if (tags.split(' ').some((w) => w.startsWith(qNorm))) {
          score = 0.55
          reason = 'Background / language'
        }
      }
    }
    if (score > 0 && pass(c)) hits.push({ client: c, household: h, score, reason })
  }

  // Also surface other members of matched households (search by family connection)
  const matchedIds = new Set(hits.map((x) => x.client.id))
  const matchedHouseholds = new Set(hits.filter((x) => x.score >= 0.8).map((x) => x.client.householdId))
  for (const c of clients) {
    if (c.deleted || matchedIds.has(c.id) || !matchedHouseholds.has(c.householdId) || !pass(c)) continue
    hits.push({ client: c, household: households.get(c.householdId), score: 0.3, reason: 'Same household' })
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 100)
}

export interface DuplicateCandidate {
  client: Client
  score: number
  reasons: string[]
}

/** Scores how likely two people are the same person (0..1) and why. */
export function duplicateScore(
  p: { firstName: string; lastName: string; dob: string; phone: string; preferredName?: string },
  c: Client,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const phone = digitsOnly(p.phone)
  const first = Math.max(nameScore(p.firstName, c.firstName), nameScore(p.firstName, c.preferredName))
  const last = nameScore(p.lastName, c.lastName)
  // Catch first/last entered the wrong way round
  const swapped = (nameScore(p.firstName, c.lastName) + nameScore(p.lastName, c.firstName)) / 2
  const nameSim = Math.max((first + last) / 2, swapped * 0.95)
  let score = 0
  if (p.firstName && p.lastName && nameSim >= 0.7) {
    score += nameSim * 0.6
    reasons.push(nameSim > 0.97 ? 'Same name' : swapped * 0.95 > (first + last) / 2 ? 'Name reversed' : 'Similar name')
  }
  if (p.dob && c.dob === p.dob) {
    score += 0.35
    reasons.push('Same date of birth')
  }
  if (phone.length >= 8 && digitsOnly(c.phone) === phone) {
    score += 0.35
    reasons.push('Same phone')
  }
  return { score: Math.min(1, score), reasons }
}

/** Likely duplicates of a person being registered or edited. */
export function findDuplicates(
  p: { firstName: string; lastName: string; dob: string; phone: string },
  clients: Client[],
  excludeId?: string,
): DuplicateCandidate[] {
  if (!p.firstName.trim() && !p.lastName.trim() && !p.phone.trim()) return []
  const out: DuplicateCandidate[] = []
  for (const c of clients) {
    if (c.deleted || c.id === excludeId) continue
    const { score, reasons } = duplicateScore(p, c)
    if (score >= 0.5) out.push({ client: c, score, reasons })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}

export interface DuplicatePair {
  a: Client
  b: Client
  score: number
  reasons: string[]
}

/**
 * Whole-database duplicate scan (e.g. after sync brings in other sites' records).
 * Only compares people who share a DOB, phone or name initials, so it stays fast.
 */
export function scanDuplicates(clients: Client[], minScore = 0.6): DuplicatePair[] {
  const live = clients.filter((c) => !c.deleted)
  const blocks = new Map<string, Client[]>()
  const add = (k: string, c: Client) => {
    const arr = blocks.get(k) ?? []
    arr.push(c)
    blocks.set(k, arr)
  }
  for (const c of live) {
    if (c.dob) add(`dob:${c.dob}`, c)
    const ph = digitsOnly(c.phone)
    if (ph.length >= 8) add(`ph:${ph}`, c)
    add(`ln:${normalise(c.lastName).slice(0, 1)}${normalise(c.firstName).slice(0, 1)}`, c)
  }
  const seen = new Set<string>()
  const out: DuplicatePair[] = []
  for (const group of blocks.values()) {
    if (group.length < 2 || group.length > 400) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]]
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const { score, reasons } = duplicateScore(a, b)
        if (score < minScore) continue
        // Family members often share phone and surname; require name or DOB evidence
        if (!reasons.includes('Same date of birth') && !reasons.some((r) => r.includes('name'))) continue
        if (a.householdId === b.householdId && !reasons.includes('Same date of birth')) continue
        const [x, y] = a.id < b.id ? [a, b] : [b, a]
        out.push({ a: x, b: y, score, reasons })
      }
    }
  }
  return out.sort((x, y) => y.score - x.score)
}

/** Merge a duplicate into the record being kept. Services move across; the duplicate is archived. */
export async function mergeClients(keepId: string, removeId: string, s: Session) {
  await db.transaction('rw', db.clients, db.services, db.audit, async () => {
    const keep = await db.clients.get(keepId)
    const remove = await db.clients.get(removeId)
    if (!keep || !remove) throw new Error('Client not found')
    const services = await db.services.where('clientId').equals(removeId).toArray()
    for (const sv of services) {
      await db.services.update(sv.id, { clientId: keepId, householdId: keep.householdId, updatedAt: now(), updatedBy: s.userName, syncStatus: 'pending' })
    }
    await db.clients.update(removeId, {
      deleted: true,
      notes: `${remove.notes ? remove.notes + '\n' : ''}Merged into ${keep.clientNo} on ${today()} by ${s.userName}`,
      updatedAt: now(),
      updatedBy: s.userName,
      syncStatus: 'pending',
    })
    await db.audit.add(audit(s, 'client', keepId, 'merge', { mergedFrom: { from: remove.clientNo, to: keep.clientNo }, servicesMoved: { from: 0, to: services.length } }))
    await db.audit.add(audit(s, 'client', removeId, 'merge', { mergedInto: { from: remove.clientNo, to: keep.clientNo } }))
  })
}

// ---------- counts ----------

export async function pendingCount(): Promise<number> {
  const [c, h, s] = await Promise.all([
    db.clients.where('syncStatus').equals('pending').count(),
    db.households.where('syncStatus').equals('pending').count(),
    db.services.where('syncStatus').equals('pending').count(),
  ])
  return c + h + s
}

// ---------- backup / reset ----------

export async function exportAll() {
  const [clients, households, services, audit] = await Promise.all([
    db.clients.toArray(),
    db.households.toArray(),
    db.services.toArray(),
    db.audit.toArray(),
  ])
  return { exportedAt: now(), clients, households, services, audit }
}

/** Clears client data from this device (keeps users and settings). */
export async function wipeAll() {
  await db.transaction('rw', [db.clients, db.households, db.services, db.audit, db.conflicts, db.bases, db.meta], async () => {
    await Promise.all([db.clients.clear(), db.households.clear(), db.services.clear(), db.audit.clear(), db.conflicts.clear(), db.bases.clear(), db.meta.clear()])
  })
}
