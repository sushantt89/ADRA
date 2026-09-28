import Dexie, { type Table } from 'dexie'
import type {
  AppConfig,
  AuditEntry,
  Client,
  Conflict,
  Household,
  Meta,
  ReportRun,
  ReportSchedule,
  SavedSearch,
  Service,
  ServicePreset,
  SyncBase,
  User,
  VisitTemplate,
} from './types'
import { DEFAULT_CONFIG, DEFAULT_PRESETS, DEFAULT_TEMPLATES } from './options'

// The on-device database (IndexedDB). Everything staff enter is written
// here first, so the app keeps working with no internet connection.
class PortalDB extends Dexie {
  clients!: Table<Client, string>
  households!: Table<Household, string>
  services!: Table<Service, string>
  audit!: Table<AuditEntry, string>
  presets!: Table<ServicePreset, string>
  users!: Table<User, string>
  config!: Table<AppConfig, string>
  templates!: Table<VisitTemplate, string>
  savedSearches!: Table<SavedSearch, string>
  conflicts!: Table<Conflict, string>
  bases!: Table<SyncBase, string>
  meta!: Table<Meta, string>
  schedules!: Table<ReportSchedule, string>
  reportRuns!: Table<ReportRun, string>

  constructor() {
    super('adra-client-portal')
    this.version(1).stores({
      clients: 'id, clientNo, lastName, firstName, dob, phone, householdId, syncStatus, updatedAt',
      households: 'id, suburb, postcode, syncStatus',
      services: 'id, clientId, householdId, date, type, syncStatus, batchId',
      audit: 'id, entityId, at, syncStatus',
      presets: 'id',
    })
    this.version(2)
      .stores({
        users: 'id, name',
        config: 'id',
        templates: 'id',
        savedSearches: 'id',
        conflicts: 'id, entityId, resolved',
        bases: 'key',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Bring stage-1 prototype records up to the new shape
        await tx
          .table('clients')
          .toCollection()
          .modify((c: Partial<Client>) => {
            c.crn ??= ''
            c.medicareNo ??= ''
            c.licenceNo ??= ''
            c.consentMethod ??= c.consentGiven ? 'Verbal' : ''
            c.consentSignature ??= ''
            c.extra ??= {}
          })
        await tx.table('config').put(DEFAULT_CONFIG)
        await tx.table('templates').bulkPut(DEFAULT_TEMPLATES)
        const order = new Map(DEFAULT_PRESETS.map((p) => [p.id, p.order]))
        await tx
          .table('presets')
          .toCollection()
          .modify((p: ServicePreset) => {
            p.order ??= order.get(p.id) ?? 50
          })
      })
    this.version(3).stores({
      schedules: 'id',
      reportRuns: 'id, scheduleId, createdAt',
    })
    this.on('populate', (tx) => {
      tx.table('presets').bulkAdd(DEFAULT_PRESETS)
      tx.table('config').add(DEFAULT_CONFIG)
      tx.table('templates').bulkAdd(DEFAULT_TEMPLATES)
    })
  }
}

export const db = new PortalDB()

export async function getConfig(): Promise<AppConfig> {
  const stored = await db.config.get('main')
  if (stored?.orgName === 'Client Support Portal') stored.orgName = DEFAULT_CONFIG.orgName // renamed to ADRA
  // Fill in settings added in newer versions of the app
  return stored ? { ...DEFAULT_CONFIG, ...stored, docket: { ...DEFAULT_CONFIG.docket, ...(stored.docket ?? {}) } } : DEFAULT_CONFIG
}

/** Service buttons in display order. */
export async function getPresets() {
  return (await db.presets.toArray()).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label))
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const m = await db.meta.get(key)
  return (m?.value as T) ?? fallback
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}
