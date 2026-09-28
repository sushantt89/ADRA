// Data model. Each interface maps 1:1 to a PostgreSQL table in docs/schema.sql,
// so the offline app can sync to Supabase / PowerSync or Azure later without
// redesigning the data.

export type SyncStatus = 'pending' | 'synced'

export interface BaseRecord {
  id: string // UUID generated on the device, so offline records never clash
  createdAt: string // ISO timestamp
  updatedAt: string
  createdBy: string
  updatedBy: string
  site: string
  syncStatus: SyncStatus
  version?: number // server version this device last saw (0/undefined = never synced)
  deleted?: boolean // soft delete, keeps the audit trail intact
}

export interface Household extends BaseRecord {
  name: string // e.g. "Nguyen household"
  address: string
  suburb: string
  postcode: string
  housingSituation: string
  notes: string
}

export type Relationship = 'Primary' | 'Partner' | 'Child' | 'Dependent' | 'Parent' | 'Other relative' | 'Other'

export type ConsentMethod = 'Signed on screen' | 'Verbal' | 'Paper form'

export type ExtraValue = string | number | boolean

export interface Client extends BaseRecord {
  clientNo: string // short human-readable ID printed on dockets
  firstName: string
  lastName: string
  preferredName: string
  dob: string // YYYY-MM-DD
  gender: string
  phone: string
  email: string
  householdId: string
  relationship: Relationship

  // Identity & culture
  countryOfBirth: string
  culturalBackground: string
  languages: string
  interpreterNeeded: boolean
  indigenousStatus: string

  // Circumstances
  incomeSource: string
  concessionCard: string
  hasDisability: boolean
  disabilityNotes: string // RESTRICTED

  // Identity documents (RESTRICTED: masked for volunteers)
  crn: string // Centrelink Customer Reference Number
  medicareNo: string
  licenceNo: string

  // Compliance
  consentGiven: boolean
  consentDate: string
  consentMethod: ConsentMethod | ''
  consentSignature: string // PNG data URL when signed on screen
  privacyAcknowledged: boolean
  riskFlag: boolean
  riskNotes: string // RESTRICTED
  notes: string

  // Admin-defined custom fields, keyed by CustomField.key
  extra: Record<string, ExtraValue>
}

export interface Service extends BaseRecord {
  clientId: string
  householdId: string
  date: string // YYYY-MM-DD
  type: string
  supportMethod: string
  value: number // dollar value, 0 if not applicable
  quantity: number
  notes: string
  batchId?: string // shared by services recorded together for a household
}

export interface AuditEntry {
  id: string
  at: string
  user: string
  site: string
  entity: 'client' | 'household' | 'service' | 'user' | 'config' | 'session'
  entityId: string
  action: 'create' | 'update' | 'delete' | 'merge' | 'login' | 'logout' | 'export' | 'conflict'
  changes: Record<string, { from: unknown; to: unknown }>
  syncStatus: SyncStatus
}

export interface ServicePreset {
  id: string
  label: string
  type: string
  supportMethod: string
  value: number
  quantity: number
  colour: string
  order?: number // display order; also the 1–9 keyboard shortcut
}

export interface VisitTemplate {
  id: string
  label: string
  items: { type: string; supportMethod: string; value: number; quantity: number }[]
  wholeHousehold: boolean
}

// ---------- people & permissions ----------

export type Role = 'Volunteer' | 'Staff' | 'Coordinator' | 'Admin'

export interface User {
  toursDone?: string[] // walkthroughs this person has finished or skipped
  id: string
  name: string
  role: Role
  homeSite: string
  pinSalt: string
  pinHash: string
  active: boolean
  createdAt: string
}

export interface Session {
  userId: string
  userName: string
  role: Role
  site: string
}

// ---------- configuration (admin-managed) ----------

export type CustomFieldType = 'text' | 'number' | 'date' | 'yesno' | 'select'

export interface CustomField {
  id: string
  key: string
  label: string
  type: CustomFieldType
  options: string[] // for 'select'
  required: boolean
  restricted: boolean // hidden from volunteers
  active: boolean
}

export interface AppConfig {
  id: 'main'
  orgName: string
  sites: string[]
  serviceTypes: string[]
  supportMethods: string[]
  eligibilityDays: number
  autoLockMinutes: number
  customFields: CustomField[]
  docketFooter: string
  docket: DocketBranding
}

export interface DocketBranding {
  logo: string // 'builtin' = ADRA logo, '' = none, or an uploaded PNG/JPEG data URL
  colour: string // accent colour
  subtitle: string // e.g. address and phone line under the name
  paper: 'A4' | 'receipt' // receipt = 80 mm thermal printer
  showHousehold: boolean
  showServices: boolean
  showEligibility: boolean
  showAppointment: boolean
  showInstructions: boolean
  showSignature: boolean
}

// ---------- scheduled reports ----------

export interface ReportSchedule {
  id: string
  name: string
  frequency: 'weekly' | 'monthly'
  site: string // '' = all
  type: string // '' = all
  active: boolean
  lastPeriodEnd: string // YYYY-MM-DD of the last period generated
  createdBy: string
}

export interface ReportRun {
  id: string
  scheduleId: string
  title: string
  createdAt: string
  read: boolean
  snapshot: unknown // ReportSnapshot (see lib/reportData)
}

export interface SavedSearch {
  id: string
  name: string
  query: string
  filters: SearchFilters
}

export interface SearchFilters {
  alert?: boolean
  interpreter?: boolean
  disability?: boolean
  visitedDays?: number
  suburb?: string
  incomeSource?: string
  culturalBackground?: string
}

// ---------- sync ----------

export type SyncEntity = 'client' | 'household' | 'service'

export interface Conflict {
  id: string
  entity: SyncEntity
  entityId: string
  field: string
  localValue: unknown
  serverValue: unknown
  serverUpdatedBy: string
  at: string
  resolved: boolean
  resolution?: 'kept-server' | 'kept-local'
  resolvedBy?: string
}

export interface SyncBase {
  key: string // `${entity}:${id}`
  data: Record<string, unknown>
}

export interface Meta {
  key: string
  value: unknown
}
