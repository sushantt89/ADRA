import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { useSession, useToast } from '../lib/context'
import { can, ROLE_HELP } from '../lib/permissions'
import { TOURS, type TourInfo } from '../lib/tours'
import { useTour } from '../components/Tour'

// In-app guide and training handout. "Print guide" gives a paper copy for
// volunteer inductions.

interface Guide {
  id: string
  title: string
  who?: (role: ReturnType<typeof useSession>['session']['role']) => boolean
  steps: ReactNode[]
  tip?: ReactNode
}

const GUIDES: Guide[] = [
  {
    id: 'find',
    title: 'Find a client',
    steps: [
      <>Go to <b>Search</b> (or press <kbd>/</kbd>).</>,
      'Type part of their name, their date of birth (dd/mm/yyyy), phone number, suburb, client ID or Centrelink number.',
      <>Use the arrow keys and <kbd>Enter</kbd>, or tap the right person.</>,
      <>Can't find them? Try a different spelling or their date of birth before registering someone new. <b>Filters</b> narrow the list (for example, people with an alert).</>,
    ],
    tip: 'Family members of the person you find are listed too, marked "Same household".',
  },
  {
    id: 'register',
    title: 'Register a new client',
    steps: [
      <>Press <b>New client</b> (<kbd>Alt</kbd>+<kbd>N</kbd>).</>,
      'Enter first name, last name and date of birth. Watch for the yellow "possible duplicate" box. If it shows the same person, open their record instead.',
      'Choose gender, add phone and suburb.',
      'Add partner, children and dependents under "Other people in the household".',
      'Tick consent, choose how it was given (signed on screen, verbal or paper form), and explain the privacy statement.',
      <>Press <b>Register</b>. If you get interrupted, the form is kept as a draft.</>,
    ],
  },
  {
    id: 'service',
    title: 'Record what you gave',
    steps: [
      'Open the client.',
      <>Choose <b>{'<name>'} only</b> or <b>Whole household</b> (press <kbd>H</kbd> to switch).</>,
      <>Tap a service button (or press <kbd>1</kbd>–<kbd>9</kbd>). It's saved straight away. Press <b>Undo</b> if you made a mistake.</>,
      'For a usual combination, tap a visit template such as "Standard visit".',
      <>For anything else, tap <b>Other…</b>, which fills in from their last visit.</>,
    ],
    tip: 'An orange "Given …" date on a button means the household already had that service recently. Check before giving it again.',
  },
  {
    id: 'swipe',
    title: 'Quick record from search (touch screens)',
    steps: [
      'Search for the client.',
      'Swipe their row to the right to record the first service button for them.',
      'Swipe it to the left to record it for their whole household.',
      <>An <b>Undo</b> button appears for a few seconds.</>,
    ],
  },
  {
    id: 'docket',
    title: 'Give a docket',
    steps: [
      <>On the client record press <b>Print docket</b>.</>,
      'Add a next appointment date or instructions if needed.',
      <>Press <b>Print</b>, or <b>Download PDF</b> to email or save it.</>,
    ],
  },
  {
    id: 'offline',
    title: 'Working without internet',
    steps: [
      'Keep working as normal. The top bar shows Offline, and everything saves on this device.',
      'The "not synced" counter shows how many records are waiting.',
      'When the internet is back, they are sent automatically. You can also press the counter to sync.',
      'Never clear the browser\'s data or use a private window while records are waiting.',
    ],
    tip: 'Open the app while online at the start of each shift so it has the latest records from other sites.',
  },
  {
    id: 'conflicts',
    title: 'Sync conflicts',
    steps: [
      'If the same detail was changed here and at another site before syncing, the Sync page lists a conflict.',
      "A coordinator compares both values and chooses which to keep. Everything else merges automatically.",
    ],
  },
  {
    id: 'duplicates',
    title: 'Merge duplicate clients',
    who: (r) => can(r, 'mergeClients'),
    steps: [
      <>Open <b>Duplicates</b>. It lists likely pairs, including people registered at other sites.</>,
      'Compare the two records.',
      <>Press <b>Keep this one</b> on the record to keep. Services move across, and the other record is archived (never deleted).</>,
      <>If they're different people, press <b>Different people — hide</b>.</>,
    ],
  },
  {
    id: 'reports',
    title: 'Reports and exports',
    who: (r) => can(r, 'viewReports'),
    steps: [
      <>Open <b>Reports</b> and choose dates, site and service type.</>,
      'The funder summary shows the usual funder numbers.',
      <>Coordinators can download a <b>PDF</b>, <b>Excel</b> or <b>CSV</b>, and set up <b>Scheduled reports</b> that are made automatically each week or month.</>,
    ],
  },
  {
    id: 'admin',
    title: 'Admin tasks',
    who: (r) => can(r, 'admin'),
    steps: [
      <><b>Users & roles</b>: add people, set their role, reset a forgotten PIN, disable leavers.</>,
      <><b>Sites & lists</b>: sites, service types and support methods.</>,
      <><b>Custom fields</b>: add questions to the client form.</>,
      <><b>Service buttons & templates</b>: the one-tap buttons and their order.</>,
      <><b>Docket design</b>: logo, colour, contact line, A4 or receipt paper, and which sections to show.</>,
    ],
  },
]

const FAQ: [string, string][] = [
  ['I forgot my PIN.', 'Ask an admin to reset it on the Admin page.'],
  ["Why can't I see someone's disability notes or ID numbers?", 'Those details are restricted to staff. Volunteers see only whether something is recorded.'],
  ['I recorded the wrong service.', 'Press Undo straight away. Later, a staff member can void it from the service history with a reason.'],
  ['The screen locked.', 'Enter your PIN to carry on where you left off. The app locks itself after a few idle minutes to protect client information.'],
  ['Is anything lost if the internet drops?', "No. Records are saved on the device and sent when the connection returns. Just don't clear the browser's data."],
]

export default function HelpPage() {
  const { session } = useSession()
  const { start } = useTour()
  const navigate = useNavigate()
  const toast = useToast()
  const [openId, setOpenId] = useState<string | null>(null)
  const role = session.role
  const guides = GUIDES.filter((g) => !g.who || g.who(role))

  const runTour = async (t: TourInfo) => {
    if (t.path === 'client') {
      const c = await db.clients.filter((x) => !x.deleted).first()
      if (!c) return toast({ text: 'Register a client first, then start this tour.' })
      navigate(`/client/${c.id}`)
    } else navigate(t.path)
    setTimeout(() => start(t.id), 500)
  }

  return (
    <div className="page narrow help">
      <div className="page-head">
        <div>
          <h1>Help & training</h1>
          <p className="muted">Short guides for everyday tasks. Print this page to use as a training handout.</p>
        </div>
        <button
          className="btn no-print"
          onClick={() => {
            // Expand every guide so the printout has all the steps
            document.querySelectorAll('details.guide').forEach((d) => d.setAttribute('open', ''))
            setTimeout(() => window.print(), 50)
          }}
        >
          Print guide
        </button>
      </div>

      <section className="card no-print">
        <h2>Guided tours</h2>
        <p className="muted small">Step-by-step tips that point at each part of the screen.</p>
        <div className="tour-list">
          {TOURS.filter((t) => t.allowed(role)).map((t) => (
            <button key={t.id} className="tour-tile" onClick={() => runTour(t)}>
              <b>{t.title}</b>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Your role: {role}</h2>
        <p>{ROLE_HELP[role]}</p>
      </section>

      <section className="card">
        <h2>How to…</h2>
        <div className="guides">
          {guides.map((g) => (
            <details key={g.id} className="guide" open={openId === g.id || undefined} onToggle={(e) => (e.currentTarget.open ? setOpenId(g.id) : null)}>
              <summary>{g.title}</summary>
              <ol>
                {g.steps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ol>
              {g.tip && <p className="guide-tip">Tip: {g.tip}</p>}
            </details>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Keyboard shortcuts</h2>
        <dl className="facts">
          <dt>
            <kbd>/</kbd>
          </dt>
          <dd>Search</dd>
          <dt>
            <kbd>Alt</kbd>+<kbd>N</kbd>
          </dt>
          <dd>New client</dd>
          <dt>
            <kbd>Alt</kbd>+<kbd>L</kbd>
          </dt>
          <dd>Lock the screen</dd>
          <dt>
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd>
          </dt>
          <dd>Move through search results and open one</dd>
          <dt>
            <kbd>1</kbd>–<kbd>9</kbd>
          </dt>
          <dd>Record a service button (on a client record)</dd>
          <dt>
            <kbd>H</kbd>
          </dt>
          <dd>Switch between this person and the whole household</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Common questions</h2>
        <dl className="faq">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
