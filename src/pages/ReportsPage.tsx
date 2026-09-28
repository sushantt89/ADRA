import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { today, uuid } from '../db/repo'
import type { ReportRun, ReportSchedule } from '../db/types'
import { useCan, useConfig, useSession, useToast } from '../lib/context'
import { logEvent } from '../lib/auth'
import { download, fmtDate, fmtDateTime, money } from '../lib/format'
import { computeReport, snapshot, type Counts, type ReportSnapshot } from '../lib/reportData'
import { excelBlob, exportCsv, reportPdfBlob } from '../lib/exporters'
import { lastCompletedPeriod, runDueSchedules } from '../lib/schedules'
import { useAutoTour } from '../components/Tour'

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

type Tab = 'report' | 'inbox' | 'schedules'

export default function ReportsPage() {
  const can = useCan()
  const unread = useLiveQuery(() => db.reportRuns.filter((r) => !r.read).count(), []) ?? 0
  const [tab, setTab] = useState<Tab>('report')
  useAutoTour('reports')
  return (
    <div className="page report-page">
      <div className="tabs no-print" role="tablist">
        <button role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>
          Report
        </button>
        <button role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')} data-tour="report-inbox">
          Report inbox{unread ? <span className="nav-badge">{unread}</span> : null}
        </button>
        {can('export') && (
          <button role="tab" aria-selected={tab === 'schedules'} className={tab === 'schedules' ? 'on' : ''} onClick={() => setTab('schedules')}>
            Scheduled reports
          </button>
        )}
      </div>
      {tab === 'report' && <LiveReport />}
      {tab === 'inbox' && <Inbox />}
      {tab === 'schedules' && <Schedules />}
    </div>
  )
}

// ---------------- live report ----------------

function LiveReport() {
  const { session } = useSession()
  const can = useCan()
  const canRestricted = can('viewRestricted')
  const config = useConfig()
  const toast = useToast()
  const [from, setFrom] = useState(daysAgo(90))
  const [to, setTo] = useState(today())
  const [site, setSite] = useState('')
  const [type, setType] = useState('')

  const data = useLiveQuery(async () => {
    const [services, clients, households] = await Promise.all([db.services.toArray(), db.clients.toArray(), db.households.toArray()])
    return { services, clients, households }
  }, [])

  const r = useMemo(() => (data ? computeReport(data, { from, to, site, type }, config, canRestricted) : null), [data, from, to, site, type, config, canRestricted])
  if (!r) return <div className="muted">Loading…</div>

  const period = `${from}_to_${to}${site ? `_${site.replace(/\W+/g, '-')}` : ''}`
  const logExport = (kind: string) => logEvent(session, 'config', 'report', 'export', { report: { from: null, to: `${kind} ${from}–${to}${site ? ` ${site}` : ''}` } })
  const snap = () => snapshot(r, 'ADRA client support report')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="muted print-only">
            {config.orgName} · {fmtDate(from)} – {fmtDate(to)} · {site || 'All sites'}
            {type ? ` · ${type}` : ''} · printed {fmtDate(today())} by {session.userName}
          </div>
        </div>
        {can('export') && (
          <div className="actions wrap no-print" data-tour="report-export">
            <button
              className="btn"
              onClick={() => {
                const s = snap()
                exportCsv(`summary_${period}.csv`, s.summary)
                logExport('Summary CSV')
              }}
            >
              Summary CSV
            </button>
            <button
              className="btn"
              onClick={() => {
                exportCsv(`services_${period}.csv`, snap().detail)
                logExport('Detail CSV')
              }}
            >
              Detail CSV
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  const s = snap()
                  download(`report_${period}.xlsx`, await excelBlob(s.summary, s.detail))
                  logExport('Excel')
                } catch (e) {
                  toast({ text: `Excel export failed: ${(e as Error).message}` })
                }
              }}
            >
              Excel
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  download(`report_${period}.pdf`, await reportPdfBlob(snap(), config.orgName, config.docket, session.userName))
                  logExport('PDF')
                } catch (e) {
                  toast({ text: `PDF export failed: ${(e as Error).message}` })
                }
              }}
            >
              PDF
            </button>
            <button className="btn btn-primary" onClick={() => window.print()}>
              Print
            </button>
          </div>
        )}
      </div>

      <div className="card filters no-print" data-tour="report-filters">
        <label className="field inline">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field inline">
          <span>To</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field inline">
          <span>Site</span>
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All sites</option>
            {config.sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Service type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {config.serviceTypes.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="quick">
          {(
            [
              ['7 days', 7],
              ['30 days', 30],
              ['90 days', 90],
              ['12 months', 365],
            ] as const
          ).map(([label, d]) => (
            <button
              key={label}
              className="btn btn-small btn-ghost"
              onClick={() => {
                setFrom(daysAgo(d))
                setTo(today())
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">Data on this device (includes other sites after sync)</span>
      </div>

      <div className="kpis">
        <Kpi label="Individuals assisted" value={r.people.length} sub={`${r.newClients} new · ${r.repeat} came back`} />
        <Kpi label="Households assisted" value={r.households} />
        <Kpi label="Service events" value={r.events} />
        <Kpi label="Total value" value={money(r.totalValue) || '$0'} />
      </div>

      <ReportBody funder={r.funder} sections={r.sections} />
    </>
  )
}

function ReportBody({ funder, sections }: { funder: [string, number][]; sections: ReportSnapshot['sections'] }) {
  return (
    <>
      <div className="card" data-tour="report-funder">
        <h3>Funder summary</h3>
        <p className="muted small">Common measures funders ask for. Check them against your funder's exact definitions (e.g. DSS Data Exchange) before submitting.</p>
        <div className="funder-grid">
          {funder.map(([label, value]) => (
            <div key={label} className="stat">
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="report-grid">
        {sections.map((s) => (
          <Bars key={s.title} title={s.title} rows={s.rows} unit={s.unit} isMoney={s.money} />
        ))}
      </div>
    </>
  )
}

// ---------------- inbox ----------------

function Inbox() {
  const { session } = useSession()
  const can = useCan()
  const config = useConfig()
  const toast = useToast()
  const runs = useLiveQuery(() => db.reportRuns.orderBy('createdAt').reverse().toArray(), []) ?? []
  const [open, setOpen] = useState<ReportRun | null>(null)

  const files = async (run: ReportRun, kind: 'pdf' | 'xlsx' | 'csv') => {
    const s = run.snapshot as ReportSnapshot
    const base = run.title.replace(/[^\w]+/g, '_')
    try {
      if (kind === 'pdf') download(`${base}.pdf`, await reportPdfBlob(s, config.orgName, config.docket, 'scheduled report'))
      if (kind === 'xlsx') download(`${base}.xlsx`, await excelBlob(s.summary, s.detail))
      if (kind === 'csv') exportCsv(`${base}.csv`, s.summary)
      await logEvent(session, 'config', run.id, 'export', { report: { from: null, to: `${kind} ${run.title}` } })
    } catch (e) {
      toast({ text: `Export failed: ${(e as Error).message}` })
    }
  }

  if (open) {
    const s = open.snapshot as ReportSnapshot
    return (
      <>
        <div className="page-head">
          <div>
            <h1>{open.title}</h1>
            <div className="muted small">Generated {fmtDateTime(open.createdAt)}</div>
          </div>
          <div className="actions wrap no-print">
            <button className="btn btn-ghost" onClick={() => setOpen(null)}>
              ← Inbox
            </button>
            {can('export') && (
              <>
                <button className="btn" onClick={() => files(open, 'csv')}>
                  CSV
                </button>
                <button className="btn" onClick={() => files(open, 'xlsx')}>
                  Excel
                </button>
                <button className="btn btn-primary" onClick={() => files(open, 'pdf')}>
                  PDF
                </button>
              </>
            )}
          </div>
        </div>
        <div className="kpis">
          {s.kpis.map(([k, v]) => (
            <Kpi key={k} label={k} value={v} />
          ))}
        </div>
        <ReportBody funder={s.funder} sections={s.sections} />
      </>
    )
  }

  return (
    <>
      <h1>Report inbox</h1>
      <p className="muted">Reports made automatically by your scheduled reports. They're saved on this device.</p>
      {!runs.length && (
        <div className="card empty">
          <p>No scheduled reports yet.</p>
          {can('export') && <p className="muted small">Set one up in the Scheduled reports tab.</p>}
        </div>
      )}
      <ul className="inbox">
        {runs.map((r) => (
          <li key={r.id} className={`card inbox-item ${r.read ? '' : 'unread'}`}>
            <button
              className="inbox-open"
              onClick={async () => {
                await db.reportRuns.update(r.id, { read: true })
                setOpen(r)
              }}
            >
              {!r.read && <span className="dot-new" aria-label="New" />}
              <b>{r.title}</b>
              <span className="muted small">{fmtDateTime(r.createdAt)}</span>
            </button>
            {can('export') && (
              <div className="actions">
                <button className="btn btn-small" onClick={() => files(r, 'pdf')}>
                  PDF
                </button>
                <button className="btn btn-small" onClick={() => files(r, 'xlsx')}>
                  Excel
                </button>
                <button className="btn btn-small btn-ghost" onClick={() => db.reportRuns.delete(r.id)}>
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------- schedules ----------------

function Schedules() {
  const { session } = useSession()
  const config = useConfig()
  const toast = useToast()
  const schedules = useLiveQuery(() => db.schedules.toArray(), []) ?? []
  const [name, setName] = useState('Weekly summary')
  const [frequency, setFrequency] = useState<ReportSchedule['frequency']>('weekly')
  const [site, setSite] = useState('')
  const [type, setType] = useState('')
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

  return (
    <div className="cols">
      <section className="card">
        <h2>Scheduled reports</h2>
        <p className="muted small">
          Each schedule makes a report automatically when a week (Monday–Sunday) or calendar month ends. It appears in the Report inbox the next time the app is open.
          Emailing reports to people will come with the cloud server.
        </p>
        {!schedules.length && <p className="muted">No schedules yet.</p>}
        <ul className="schedule-list">
          {schedules.map((s) => {
            const next = lastCompletedPeriod(s.frequency)
            return (
              <li key={s.id} className={s.active ? '' : 'voided'}>
                <div>
                  <b>{s.name}</b>
                  <div className="muted small">
                    {s.frequency === 'weekly' ? 'Every week' : 'Every month'} · {s.site || 'All sites'}
                    {s.type ? ` · ${s.type}` : ''} · last made for period ending {s.lastPeriodEnd ? fmtDate(s.lastPeriodEnd) : 'never'} · latest period {fmtDate(next.to)}
                  </div>
                </div>
                <div className="actions">
                  <button className="btn btn-small btn-ghost" onClick={() => db.schedules.update(s.id, { active: !s.active })}>
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn btn-small btn-ghost" onClick={() => db.schedules.delete(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="notify">
          {perm === 'granted' ? (
            <span className="muted small">Desktop notifications are on for this device.</span>
          ) : perm === 'unsupported' ? (
            <span className="muted small">This browser doesn't support notifications.</span>
          ) : (
            <button
              className="btn btn-small"
              onClick={async () => {
                const p = await Notification.requestPermission()
                setPerm(p)
              }}
            >
              Notify me when a report is ready
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>New schedule</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            await db.schedules.add({ id: uuid(), name: name.trim(), frequency, site, type, active: true, lastPeriodEnd: '', createdBy: session.userName })
            await logEvent(session, 'config', 'schedule', 'create', { schedule: { from: null, to: `${name} (${frequency})` } })
            const made = await runDueSchedules()
            toast({ text: made.length ? `Schedule added. First report is in the inbox: ${made[0]}` : 'Schedule added' })
          }}
        >
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid">
            <label className="field">
              <span>How often</span>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as ReportSchedule['frequency'])}>
                <option value="weekly">Weekly (Mon–Sun)</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="field">
              <span>Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="">All sites</option>
                {config.sites.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Service type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All</option>
                {config.serviceTypes.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-primary" type="submit">
            Add schedule
          </button>
          <p className="muted small">The report for the most recent finished period is made straight away, so you can check it.</p>
        </form>
      </section>
    </div>
  )
}

// ---------------- bits ----------------

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="kpi card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

function Bars({ title, rows, unit, isMoney }: { title: string; rows: Counts; unit: string; isMoney?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <div className="card">
      <h3>{title}</h3>
      {!rows.length && <p className="muted small">No data in this period.</p>}
      <ul className="bars">
        {rows.map(([k, v]) => (
          <li key={k} title={`${v} ${unit}`}>
            <span className="bar-label">{k}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="bar-value">{isMoney ? money(v) : v}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
