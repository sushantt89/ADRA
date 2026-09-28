import { db } from '../db/db'
import type { AppConfig, Client, Household } from '../db/types'
import { age, fmtDate, fullName, money } from './format'

// Everything that goes on a client docket, built once and used by the
// on-screen docket, the printed docket and the PDF docket.

export interface DocketLine {
  type: string
  method: string
  value: number
  who: string
}

export interface DocketData {
  orgName: string
  site: string
  clientNo: string
  name: string
  dob: string // formatted
  area: string // suburb + postcode
  members: { name: string; relationship: string; age: string }[]
  visitDate: string // formatted, '' if none
  lines: DocketLine[]
  nextEligible: string // formatted
  nextAppointment: string // formatted, '' if not set
  instructions: string
  issued: string
  footer: string
}

export async function loadDocket(clientId: string) {
  const client = await db.clients.get(clientId)
  if (!client) return null
  const [household, members, services] = await Promise.all([
    db.households.get(client.householdId),
    db.clients.where('householdId').equals(client.householdId).filter((m) => !m.deleted).toArray(),
    db.services.where('householdId').equals(client.householdId).filter((s) => !s.deleted).toArray(),
  ])
  return { client, household, members, services }
}

export function buildDocket(
  src: NonNullable<Awaited<ReturnType<typeof loadDocket>>>,
  config: AppConfig,
  opts: { site: string; userName: string; nextAppointment: string; instructions: string; issuedDate: string },
): DocketData {
  const { client, household, members, services } = src
  // Services for this visit = the most recent service date for the household
  const lastDate = services.map((s) => s.date).sort().at(-1)
  const visit = services.filter((s) => s.date === lastDate)
  const nameOf = (cid: string) => members.find((m) => m.id === cid)?.firstName ?? ''
  const next = lastDate ? new Date(lastDate) : new Date()
  next.setDate(next.getDate() + config.eligibilityDays)

  // Group household-level entries (one per member) into single lines
  const lines = new Map<string, { type: string; method: string; value: number; who: string[] }>()
  for (const s of visit) {
    const key = s.batchId ?? s.id
    const line = lines.get(key) ?? { type: s.type, method: s.supportMethod, value: 0, who: [] }
    line.value += s.value
    line.who.push(nameOf(s.clientId))
    lines.set(key, line)
  }

  return {
    orgName: config.orgName,
    site: opts.site,
    clientNo: client.clientNo,
    name: fullName(client),
    dob: fmtDate(client.dob),
    area: `${household?.suburb ?? ''} ${household?.postcode ?? ''}`.trim(),
    members: members.map((m) => ({ name: `${m.firstName} ${m.lastName}`, relationship: m.relationship, age: `${age(m.dob) ?? '?'} yrs` })),
    visitDate: lastDate ? fmtDate(lastDate) : '',
    lines: [...lines.values()].map((l) => ({ type: l.type, method: l.method, value: l.value, who: l.who.length > 1 ? 'Household' : l.who[0] })),
    nextEligible: fmtDate(next.toISOString().slice(0, 10)),
    nextAppointment: opts.nextAppointment ? fmtDate(opts.nextAppointment) : '',
    instructions: opts.instructions,
    issued: `Issued ${fmtDate(opts.issuedDate)} by ${opts.userName}.`,
    footer: config.docketFooter,
  }
}

/** Fictional docket used for the admin preview. */
export function sampleDocket(config: AppConfig): DocketData {
  return {
    orgName: config.orgName,
    site: config.sites[0] ?? 'Main site',
    clientNo: 'C-SAMPLE',
    name: 'Jordan Sample',
    dob: '01/01/1990',
    area: 'Salisbury 5108',
    members: [
      { name: 'Jordan Sample', relationship: 'Primary', age: '36 yrs' },
      { name: 'Riley Sample', relationship: 'Child', age: '8 yrs' },
    ],
    visitDate: fmtDate(new Date().toISOString().slice(0, 10)),
    lines: [
      { type: 'Food parcel', method: 'Parcel', value: 0, who: 'Household' },
      { type: 'Food voucher', method: 'Voucher', value: 50, who: 'Jordan' },
    ],
    nextEligible: '—',
    nextAppointment: '',
    instructions: 'Bring your Centrelink statement next visit.',
    issued: `Issued ${fmtDate(new Date().toISOString().slice(0, 10))} by Staff member.`,
    footer: config.docketFooter,
  }
}

export const lineValue = (l: DocketLine) => money(l.value)

export type { Client, Household }
