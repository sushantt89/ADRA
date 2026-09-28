import type { Role } from '../db/types'
import { can } from './permissions'

// Guided walkthroughs. Each step points at an element marked with
// data-tour="…" in the app. A step without a target (or whose target isn't
// on screen) shows as a centred card.

export interface TourStep {
  target?: string // value of a data-tour attribute
  title: string
  body: string
  placement?: 'bottom' | 'top' | 'left' | 'right'
}

export type TourId = 'welcome' | 'register' | 'client' | 'reports' | 'sync' | 'admin'

export interface TourInfo {
  id: TourId
  title: string
  description: string
  path: string // page the tour runs on ('client' = any client record)
  allowed: (role: Role) => boolean
}

export const TOURS: TourInfo[] = [
  { id: 'welcome', title: 'Welcome tour', description: 'The main screen, offline mode, syncing and locking.', path: '/', allowed: () => true },
  { id: 'register', title: 'Registering a client', description: 'Duplicate checks, family members and consent.', path: '/new', allowed: () => true },
  { id: 'client', title: 'Client record and services', description: 'One-tap services, households, templates and dockets.', path: 'client', allowed: () => true },
  { id: 'sync', title: 'Sync and conflicts', description: 'What happens to records made offline.', path: '/sync', allowed: () => true },
  { id: 'reports', title: 'Reports', description: 'Filters, funder summary, exports and scheduled reports.', path: '/reports', allowed: (r) => can(r, 'viewReports') },
  { id: 'admin', title: 'Admin', description: 'Users, lists, custom fields, dockets and buttons.', path: '/admin', allowed: (r) => can(r, 'admin') },
]

export function tourSteps(id: TourId, role: Role, name: string): TourStep[] {
  const first = name.split(/[\s(]/)[0] || name
  switch (id) {
    case 'welcome': {
      const steps: TourStep[] = [
        {
          title: `Welcome, ${first}!`,
          body: `This quick tour shows you around. You're signed in as ${role === 'Admin' ? 'an' : 'a'} ${role}. It takes about a minute, and you can replay it any time from Help.`,
        },
        {
          target: 'search',
          title: 'Find anyone fast',
          body: 'Start every visit here. Type a name, date of birth, phone, address or client ID. Spelling doesn\'t need to be exact: "Jon Smyth" finds "John Smith".',
          placement: 'bottom',
        },
        {
          target: 'new-client',
          title: 'Register someone new',
          body: 'If they\'re not found, register them here. The app warns you straight away if they might already be registered.',
          placement: 'bottom',
        },
        {
          target: 'online',
          title: 'Works without internet',
          body: 'This shows whether you are online. When it says Offline, keep working as normal. Everything is saved on this device.',
          placement: 'bottom',
        },
        {
          target: 'sync',
          title: 'Syncing',
          body: 'Records saved offline wait here and are sent automatically when the internet is back. Don\'t clear the browser\'s data while records are waiting.',
          placement: 'bottom',
        },
      ]
      if (can(role, 'viewReports'))
        steps.push({ target: 'nav-reports', title: 'Reports', body: 'See how many people and households were helped, and the funder summary.', placement: 'bottom' })
      if (can(role, 'mergeClients'))
        steps.push({ target: 'nav-duplicates', title: 'Duplicates', body: 'Check and merge people who were registered twice, including at other sites.', placement: 'bottom' })
      if (can(role, 'admin'))
        steps.push({ target: 'nav-admin', title: 'Admin', body: 'Add staff and volunteers, change lists and service buttons, add form questions and brand the dockets.', placement: 'bottom' })
      if (role === 'Volunteer')
        steps.push({
          title: 'Private details',
          body: 'Some sensitive details, such as disability notes and ID numbers, are hidden for volunteers. That\'s expected. Ask a staff member if you need them.',
        })
      steps.push(
        { target: 'lock', title: 'Lock when you step away', body: 'Lock the screen whenever you leave the device (or press Alt+L). It also locks itself after a few idle minutes.', placement: 'bottom' },
        { target: 'help', title: 'Help is always here', body: 'Guides, keyboard shortcuts and these tours live in Help.', placement: 'bottom' },
        { title: "You're ready", body: 'Try searching for a client now. You\'ll get short tips the first time you open each new screen.' },
      )
      return steps
    }
    case 'register':
      return [
        { title: 'Registering a client', body: 'Fields marked * are required. Everything saves on this device, even offline, and unfinished forms are kept as a draft.' },
        { target: 'reg-person', title: 'Name and date of birth first', body: 'As you type, the app checks for people already registered. If a warning appears, open the existing record instead of creating a new one.', placement: 'right' },
        { target: 'reg-household', title: 'The whole family at once', body: 'Add a partner, children and dependents here. They share this address, background and consent.', placement: 'top' },
        { target: 'reg-consent', title: 'Consent', body: "Tick consent and choose how it was given. Choose 'Signed on screen' to have the client sign with a finger or stylus.", placement: 'top' },
        { target: 'reg-save', title: 'Save', body: 'Press Register. The next screen is the client record, where you record what you gave them.', placement: 'top' },
      ]
    case 'client':
      return [
        { target: 'services', title: 'Record a service in one tap', body: "Tap a button to record it straight away. You can undo for a few seconds. Keys 1–9 press the buttons too. 'Given …' in orange means they already had it recently.", placement: 'right' },
        { target: 'scope', title: 'Just this person, or everyone', body: 'Choose Whole household to record the service for every family member at once (or press H).', placement: 'bottom' },
        { target: 'templates', title: 'Visit templates', body: 'Record a usual combination, like a food parcel plus transport, with one tap.', placement: 'top' },
        { target: 'household', title: 'Household', body: 'Everyone living together. Tap a name to open their record, or add someone new to the household.', placement: 'left' },
        { target: 'docket', title: 'Print a docket', body: 'Give the client a printed docket or PDF with what they received and when they can come back.', placement: 'bottom' },
        { target: 'history', title: 'History', body: 'Every service is listed here. Staff can also see the full change history: who changed what, and when.', placement: 'top' },
      ]
    case 'sync':
      return [
        { target: 'sync-status', title: 'Sync status', body: "Records made offline wait here. They're sent automatically when you're online. You can also press Sync now.", placement: 'bottom' },
        { target: 'conflicts', title: 'Conflicts', body: "If someone at another site changed the same detail before you synced, it's listed here. A coordinator chooses which value to keep. Everything else merges automatically.", placement: 'top' },
      ]
    case 'reports':
      return [
        { target: 'report-filters', title: 'Choose the period', body: 'Pick dates, a site and a service type. Everything below updates instantly.', placement: 'bottom' },
        { target: 'report-funder', title: 'Funder summary', body: 'The numbers funders usually ask for, ready to copy into a report.', placement: 'top' },
        ...(can(role, 'export')
          ? [{ target: 'report-export', title: 'Export', body: 'Download the report as a PDF, an Excel workbook or CSV files. Exports are recorded in the history.', placement: 'bottom' as const }]
          : []),
        { target: 'report-inbox', title: 'Report inbox', body: 'Reports made automatically each week or month appear here.', placement: 'bottom' },
      ]
    case 'admin':
      return [
        { target: 'admin-tabs', title: 'Admin', body: 'Everything here changes how the app works on this device. In the live system it will apply to every site.', placement: 'bottom' },
        { title: 'Users & roles', body: 'Add staff and volunteers, choose their role and reset PINs. Volunteers never see restricted details.' },
        { title: 'Custom fields', body: 'Add questions your funders need, without a developer. They appear on the client form and in reports.' },
        { title: 'Docket design', body: 'Add your logo, colour and contact line, choose A4 or receipt paper, and pick what the docket shows.' },
      ]
  }
}
