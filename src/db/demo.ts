import { db } from './db'
import { createClient, createHousehold, recordServices, type ClientInput } from './repo'
import { createUser } from '../lib/auth'
import { runSync } from '../sync/sync'
import type { Relationship, Session } from './types'

// Fictional test data only. Never load real client information into a demo.

type Person = [first: string, last: string, dob: string, gender: string, rel: Relationship, extra?: Partial<ClientInput>]

const HOUSEHOLDS: {
  name: string
  address: string
  suburb: string
  postcode: string
  housing: string
  people: Person[]
  base: Partial<ClientInput>
}[] = [
  {
    name: 'Smith household', address: '14 Rosella St', suburb: 'Salisbury', postcode: '5108', housing: 'Renting (private)',
    base: { countryOfBirth: 'Australia', culturalBackground: 'Australian', languages: 'English', incomeSource: 'JobSeeker', concessionCard: 'Health Care Card' },
    people: [
      ['John', 'Smith', '1984-03-12', 'Male', 'Primary', { phone: '0412 345 678', crn: '123 456 789X', medicareNo: '2951 23456 1' }],
      ['Kate', 'Smith', '1986-07-02', 'Female', 'Partner', { phone: '0412 555 101', incomeSource: 'Parenting Payment' }],
      ['Mia', 'Smith', '2014-05-20', 'Female', 'Child'],
      ['Leo', 'Smith', '2018-11-03', 'Male', 'Child'],
    ],
  },
  {
    name: 'Nguyen household', address: '3/22 King St', suburb: 'Mansfield Park', postcode: '5012', housing: 'Public / community housing',
    base: { countryOfBirth: 'Vietnam', culturalBackground: 'Vietnamese', languages: 'Vietnamese, English', incomeSource: 'Age Pension', concessionCard: 'Pensioner Concession Card' },
    people: [
      ['Thi Lan', 'Nguyen', '1952-01-30', 'Female', 'Primary', { phone: '0433 210 998', interpreterNeeded: true }],
      ['Van Minh', 'Nguyen', '1949-09-14', 'Male', 'Partner', { hasDisability: true, disabilityNotes: 'Mobility, uses walker' }],
    ],
  },
  {
    name: 'Haidari household', address: '7 Grevillea Ave', suburb: 'Elizabeth', postcode: '5112', housing: 'Renting (private)',
    base: { countryOfBirth: 'Afghanistan', culturalBackground: 'Hazara', languages: 'Dari, Hazaragi', interpreterNeeded: true, incomeSource: 'Parenting Payment', concessionCard: 'Health Care Card' },
    people: [
      ['Fatima', 'Haidari', '1990-04-18', 'Female', 'Primary', { phone: '0450 887 123', crn: '987 654 321A' }],
      ['Ali', 'Haidari', '2012-02-09', 'Male', 'Child'],
      ['Zahra', 'Haidari', '2016-08-25', 'Female', 'Child'],
    ],
  },
  {
    name: 'Walker', address: 'No fixed address', suburb: 'Adelaide', postcode: '5000', housing: 'Homeless / sleeping rough',
    base: { countryOfBirth: 'Australia', culturalBackground: 'Aboriginal Australian', indigenousStatus: 'Aboriginal', languages: 'English', incomeSource: 'JobSeeker', concessionCard: 'Health Care Card' },
    people: [['Daniel', 'Walker', '1979-12-01', 'Male', 'Primary', { phone: '0401 222 333', riskFlag: true, riskNotes: 'Sleeping rough. Offer referral to housing service each visit.' }]],
  },
  {
    name: 'Okafor household', address: '51 Park Tce', suburb: 'Parafield Gardens', postcode: '5107', housing: 'Renting (private)',
    base: { countryOfBirth: 'Nigeria', culturalBackground: 'Nigerian (Igbo)', languages: 'English, Igbo', incomeSource: 'Wages (low income)', concessionCard: 'Health Care Card' },
    people: [
      ['Chinedu', 'Okafor', '1988-06-06', 'Male', 'Primary', { phone: '0422 909 808' }],
      ['Ngozi', 'Okafor', '1991-10-10', 'Female', 'Partner'],
      ['Ada', 'Okafor', '2020-01-15', 'Female', 'Child'],
    ],
  },
  {
    name: 'Russo', address: '9 Elm Ct', suburb: 'Campbelltown', postcode: '5074', housing: 'Own home',
    base: { countryOfBirth: 'Italy', culturalBackground: 'Italian', languages: 'Italian, English', incomeSource: 'Age Pension', concessionCard: 'Pensioner Concession Card' },
    people: [['Maria', 'Russo', '1945-02-14', 'Female', 'Primary', { phone: '08 8123 4567', hasDisability: true, disabilityNotes: 'Low vision' }]],
  },
  {
    name: 'Mohamed household', address: '2 Wattle Rd', suburb: 'Kilburn', postcode: '5084', housing: 'Temporary / crisis accommodation',
    base: { countryOfBirth: 'Sudan', culturalBackground: 'Sudanese', languages: 'Arabic, English', incomeSource: 'No income', concessionCard: 'None' },
    people: [
      ['Amina', 'Mohamed', '1995-09-09', 'Female', 'Primary', { phone: '0466 111 222', riskFlag: true, riskNotes: 'Recently arrived in crisis accommodation.' }],
      ['Yusuf', 'Mohamed', '2021-03-03', 'Male', 'Dependent'],
    ],
  },
  {
    name: 'Brown', address: '88 Main North Rd', suburb: 'Enfield', postcode: '5085', housing: 'Renting (private)',
    base: { countryOfBirth: 'England', culturalBackground: 'English', languages: 'English', incomeSource: 'Disability Support Pension', concessionCard: 'Pensioner Concession Card', hasDisability: true, disabilityNotes: 'Psychosocial' },
    people: [['Sarah', 'Brown', '1972-05-27', 'Female', 'Primary', { phone: '0499 876 543', licenceNo: 'SA1234567' }]],
  },
]

const SERVICE_MIX: { type: string; supportMethod: string; value: number }[] = [
  { type: 'Food parcel', supportMethod: 'Parcel', value: 0 },
  { type: 'Food parcel', supportMethod: 'Parcel', value: 0 },
  { type: 'Food voucher', supportMethod: 'Voucher', value: 50 },
  { type: 'Clothing', supportMethod: 'Parcel', value: 0 },
  { type: 'Bill assistance', supportMethod: 'Direct payment to provider', value: 100 },
  { type: 'Transport assistance', supportMethod: 'Voucher', value: 20 },
  { type: 'Referral', supportMethod: 'Referral only', value: 0 },
]

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const blank: ClientInput = {
  firstName: '', lastName: '', preferredName: '', dob: '', gender: '', phone: '', email: '', householdId: '', relationship: 'Primary',
  countryOfBirth: '', culturalBackground: '', languages: '', interpreterNeeded: false, indigenousStatus: 'Neither Aboriginal nor Torres Strait Islander',
  incomeSource: '', concessionCard: 'None', hasDisability: false, disabilityNotes: '',
  crn: '', medicareNo: '', licenceNo: '',
  consentGiven: true, consentDate: '', consentMethod: 'Verbal', consentSignature: '', privacyAcknowledged: true, riskFlag: false, riskNotes: '', notes: '',
  extra: {},
}

const REFERRALS = ['Word of mouth', 'Centrelink', 'Hospital / health service', 'School', 'Another charity']

/** Loads fictional data. Returns a short description of the demo sign-ins. */
export async function loadDemoData(s: Session): Promise<string> {
  if ((await db.clients.count()) > 0) throw new Error('Demo data can only be loaded into an empty database. Clear data first.')
  const demo: Session = { userId: 'demo', userName: 'Demo loader', role: 'Admin', site: s.site }
  const existing = new Set((await db.users.toArray()).map((u) => u.name))
  const demoUsers: [string, 'Volunteer' | 'Staff' | 'Coordinator', string][] = [
    ['Alex (volunteer)', 'Volunteer', '1111'],
    ['Sam (staff)', 'Staff', '2222'],
    ['Chris (coordinator)', 'Coordinator', '3333'],
  ]
  for (const [name, role, pin] of demoUsers) if (!existing.has(name)) await createUser(name, role, s.site, pin, s)
  let seed = 7
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)

  for (const hh of HOUSEHOLDS) {
    const h = await createHousehold({ name: hh.name, address: hh.address, suburb: hh.suburb, postcode: hh.postcode, housingSituation: hh.housing, notes: '' }, demo)
    const members = []
    for (const [firstName, lastName, dob, gender, relationship, extra] of hh.people) {
      const child = relationship === 'Child' || relationship === 'Dependent'
      members.push(
        await createClient(
          {
            ...blank, ...hh.base, ...(child ? { incomeSource: 'No income', concessionCard: 'None' } : {}), ...extra,
            firstName, lastName, dob, gender, relationship, householdId: h.id, consentDate: daysAgo(90),
            extra: relationship === 'Primary' ? { referralSource: REFERRALS[Math.floor(rand() * REFERRALS.length)] } : {},
          },
          demo,
        ),
      )
    }
    // A few visits per household over the last ~3 months
    const visits = 1 + Math.floor(rand() * 4)
    for (let v = 0; v < visits; v++) {
      const mix = SERVICE_MIX[Math.floor(rand() * SERVICE_MIX.length)]
      const date = daysAgo(Math.floor(rand() * 85))
      const whole = mix.type === 'Food parcel' || mix.type === 'Clothing'
      await recordServices({ ...mix, date, quantity: 1, notes: '' }, whole ? members : [members[0]], demo)
    }
  }
  // Send the demo data to the (mock) server so other "sites" can see it
  if (navigator.onLine) await runSync(s).catch(() => {})
  return 'Alex 1111 (volunteer), Sam 2222 (staff), Chris 3333 (coordinator)'
}
