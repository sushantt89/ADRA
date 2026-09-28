import type { AppConfig, Client, CustomField, Household, Service } from '../db/types'
import { age, fmtDate } from './format'
import { normalise } from './fuzzy'

// ============================================================================
// Report calculations, shared by the Reports screen, PDF/Excel/CSV exports
// and scheduled reports, so every output shows the same numbers.
// ============================================================================

export type Counts = [string, number][]

export interface ReportParams {
  from: string // YYYY-MM-DD
  to: string
  site: string // '' = all sites
  type: string // '' = all service types
}

export interface ReportInput {
  services: Service[]
  clients: Client[]
  households: Household[]
}

export function ageGroup(c: Client) {
  const a = age(c.dob)
  if (a === null) return 'Unknown'
  if (a < 18) return '0–17'
  if (a < 25) return '18–24'
  if (a < 45) return '25–44'
  if (a < 65) return '45–64'
  return '65+'
}

/** Culturally and linguistically diverse: born overseas or speaks a language other than English. */
export function isCald(c: Client) {
  const born = normalise(c.countryOfBirth)
  const langs = normalise(c.languages).split(' ').filter(Boolean)
  return (!!born && born !== 'australia') || langs.some((l) => l !== 'english')
}

function tally<T>(items: T[], key: (x: T) => string | string[]): Counts {
  const m = new Map<string, number>()
  for (const x of items) {
    const ks = key(x)
    for (const k0 of Array.isArray(ks) ? ks : [ks]) {
      const k = k0 || 'Not recorded'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface ReportSection {
  title: string
  unit: string
  rows: Counts
  money?: boolean
}

export function computeReport(data: ReportInput, p: ReportParams, config: AppConfig, canRestricted: boolean) {
  const clientMap = new Map(data.clients.map((c) => [c.id, c]))
  const hhMap = new Map(data.households.map((h) => [h.id, h]))
  const all = data.services.filter((s) => !s.deleted && (!p.site || s.site === p.site) && (!p.type || s.type === p.type))
  const svc = all.filter((s) => s.date >= p.from && s.date <= p.to)
  const people = [...new Set(svc.map((s) => s.clientId))].map((id) => clientMap.get(id)).filter(Boolean) as Client[]
  const hhs = [...new Set(svc.map((s) => s.householdId))].map((id) => hhMap.get(id)).filter(Boolean) as Household[]

  // A household-level entry (one row per member) counts as one service event
  const events = new Map<string, Service>()
  for (const s of svc) if (!events.has(s.batchId ?? s.id)) events.set(s.batchId ?? s.id, s)
  const eventList = [...events.values()]

  // New = first ever service falls inside the period
  const firstService = new Map<string, string>()
  for (const s of all) if (!firstService.has(s.clientId) || s.date < firstService.get(s.clientId)!) firstService.set(s.clientId, s.date)
  const newClients = people.filter((c) => (firstService.get(c.id) ?? '') >= p.from).length
  const visitDays = new Map<string, Set<string>>()
  for (const s of svc) visitDays.set(s.clientId, (visitDays.get(s.clientId) ?? new Set()).add(s.date))
  const repeat = [...visitDays.values()].filter((d) => d.size > 1).length

  const sizeOf = new Map<string, number>()
  for (const c of data.clients) if (!c.deleted) sizeOf.set(c.householdId, (sizeOf.get(c.householdId) ?? 0) + 1)
  const monthly = new Map<string, number>()
  for (const e of eventList) monthly.set(e.date.slice(0, 7), (monthly.get(e.date.slice(0, 7)) ?? 0) + 1)

  const visibleCustom: CustomField[] = config.customFields.filter((f) => f.active && (!f.restricted || canRestricted))

  const sections: ReportSection[] = [
    {
      title: 'Service events by month',
      unit: 'events',
      rows: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [`${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, v]),
    },
    { title: 'Services by type', unit: 'events', rows: tally(eventList, (s) => s.type) },
    {
      title: 'Value by service type',
      unit: 'dollars',
      money: true,
      rows: ([...svc.reduce((m, s) => m.set(s.type, (m.get(s.type) ?? 0) + s.value), new Map<string, number>())] as Counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    },
    { title: 'Support method', unit: 'events', rows: tally(eventList, (s) => s.supportMethod) },
    { title: 'Services by site', unit: 'events', rows: tally(eventList, (s) => s.site) },
    { title: 'Age group', unit: 'people', rows: tally(people, ageGroup).sort((a, b) => a[0].localeCompare(b[0])) },
    { title: 'Gender', unit: 'people', rows: tally(people, (c) => c.gender) },
    { title: 'Cultural background', unit: 'people', rows: tally(people, (c) => c.culturalBackground) },
    { title: 'Country of birth', unit: 'people', rows: tally(people, (c) => c.countryOfBirth) },
    {
      title: 'Languages spoken',
      unit: 'people',
      rows: tally(people, (c) =>
        c.languages
          .split(/[,;/]/)
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    },
    { title: 'Income source', unit: 'people', rows: tally(people, (c) => c.incomeSource) },
    { title: 'Aboriginal / Torres Strait Islander status', unit: 'people', rows: tally(people, (c) => c.indigenousStatus) },
    {
      title: 'Household size',
      unit: 'households',
      rows: tally(hhs, (h) => {
        const n = sizeOf.get(h.id) ?? 1
        return n >= 5 ? '5 or more people' : `${n} ${n === 1 ? 'person' : 'people'}`
      }).sort((a, b) => a[0].localeCompare(b[0])),
    },
    { title: 'Housing situation', unit: 'households', rows: tally(hhs, (h) => h.housingSituation) },
    { title: 'Top suburbs', unit: 'households', rows: tally(hhs, (h) => h.suburb).slice(0, 10) },
    ...visibleCustom
      .filter((f) => f.type !== 'text')
      .map((f) => ({
        title: f.label,
        unit: 'people',
        rows: tally(people, (c) => {
          const v = c.extra?.[f.key]
          return v === undefined || v === '' ? '' : f.type === 'yesno' ? (v ? 'Yes' : 'No') : String(v)
        }),
      })),
  ]

  const funder: [string, number][] = [
    ['Individuals', people.length],
    ['New clients', newClients],
    ['Households', hhs.length],
    ['Children 0–17', people.filter((c) => (age(c.dob) ?? 99) < 18).length],
    ['Aged 65+', people.filter((c) => (age(c.dob) ?? 0) >= 65).length],
    ['Aboriginal / TSI', people.filter((c) => /aboriginal|torres/i.test(c.indigenousStatus) && !/neither/i.test(c.indigenousStatus)).length],
    ['CALD', people.filter(isCald).length],
    ['With disability', people.filter((c) => c.hasDisability).length],
    ['Needed interpreter', people.filter((c) => c.interpreterNeeded).length],
  ]

  return {
    params: p,
    svc,
    clientMap,
    hhMap,
    people,
    households: hhs.length,
    events: eventList.length,
    totalValue: svc.reduce((sum, s) => sum + s.value, 0),
    newClients,
    repeat,
    funder,
    sections,
    visibleCustom,
  }
}

export type Report = ReturnType<typeof computeReport>

export function describeParams(p: ReportParams) {
  return `${fmtDate(p.from)} to ${fmtDate(p.to)} · ${p.site || 'All sites'}${p.type ? ` · ${p.type}` : ''}`
}

export function summaryRows(r: Report): Record<string, unknown>[] {
  return [
    { measure: 'Period', category: '', value: `${fmtDate(r.params.from)} to ${fmtDate(r.params.to)}` },
    { measure: 'Site', category: '', value: r.params.site || 'All sites' },
    { measure: 'Service type', category: '', value: r.params.type || 'All' },
    { measure: 'Individuals assisted', category: '', value: r.people.length },
    { measure: 'Clients with repeat visits', category: '', value: r.repeat },
    { measure: 'Service events', category: '', value: r.events },
    { measure: 'Total value ($)', category: '', value: r.totalValue },
    ...r.funder.map(([k, v]) => ({ measure: `Funder summary: ${k}`, category: '', value: v })),
    ...r.sections.flatMap((s) => s.rows.map(([category, value]) => ({ measure: s.title, category, value }))),
  ]
}

export function detailRows(r: Report): Record<string, unknown>[] {
  return r.svc.map((s) => {
    const c = r.clientMap.get(s.clientId)
    const h = r.hhMap.get(s.householdId)
    const row: Record<string, unknown> = {
      service_date: s.date,
      service_type: s.type,
      support_method: s.supportMethod,
      value: s.value,
      quantity: s.quantity,
      household_entry: s.batchId ? 'yes' : 'no',
      client_id: c?.clientNo ?? '',
      age_group: c ? ageGroup(c) : '',
      gender: c?.gender ?? '',
      cultural_background: c?.culturalBackground ?? '',
      country_of_birth: c?.countryOfBirth ?? '',
      languages: c?.languages ?? '',
      cald: c && isCald(c) ? 'yes' : 'no',
      indigenous_status: c?.indigenousStatus ?? '',
      income_source: c?.incomeSource ?? '',
      disability: c?.hasDisability ? 'yes' : 'no',
      suburb: h?.suburb ?? '',
      postcode: h?.postcode ?? '',
      site: s.site,
      recorded_by: s.createdBy,
    }
    for (const f of r.visibleCustom) row[f.key] = c?.extra?.[f.key] ?? ''
    return row
  })
}

/** A report frozen at a point in time (used by scheduled reports). */
export interface ReportSnapshot {
  title: string
  params: ReportParams
  generatedAt: string
  kpis: [string, string | number][]
  funder: [string, number][]
  sections: ReportSection[]
  summary: Record<string, unknown>[]
  detail: Record<string, unknown>[]
}

export function snapshot(r: Report, title: string): ReportSnapshot {
  return {
    title,
    params: r.params,
    generatedAt: new Date().toISOString(),
    kpis: [
      ['Individuals assisted', r.people.length],
      ['Households assisted', r.households],
      ['Service events', r.events],
      ['Total value', `$${r.totalValue.toLocaleString('en-AU')}`],
    ],
    funder: r.funder,
    sections: r.sections,
    summary: summaryRows(r),
    detail: detailRows(r),
  }
}
