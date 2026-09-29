import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getPresets } from '../db/db'
import { recordServices, recordTemplate, today, voidService, type ServiceInput } from '../db/repo'
import type { Client, Service, ServicePreset, VisitTemplate } from '../db/types'
import { useCan, useConfig, useSession, useToast } from '../lib/context'
import { mask } from '../lib/permissions'
import { displayExtra } from '../components/CustomFields'
import { useAutoTour } from '../components/Tour'
import { age, fmtDate, fmtDateTime, fullName, money } from '../lib/format'

const ACTION_LABEL: Record<string, string> = { create: 'Created', update: 'Updated', delete: 'Voided', merge: 'Merged', conflict: 'Sync conflict on' }

export default function ClientPage() {
  const { id } = useParams()
  const { session } = useSession()
  const toast = useToast()
  const can = useCan()
  const config = useConfig()
  const [scope, setScope] = useState<'person' | 'household'>('person')
  const [date, setDate] = useState(today())
  const [custom, setCustom] = useState<ServiceInput | null>(null)
  const [tab, setTab] = useState<'services' | 'audit'>('services')

  const client = useLiveQuery(() => (id ? db.clients.get(id) : undefined), [id])
  useAutoTour('client', !!client)
  const household = useLiveQuery(() => (client ? db.households.get(client.householdId) : undefined), [client?.householdId])
  const members = useLiveQuery(
    () => (client ? db.clients.where('householdId').equals(client.householdId).filter((m) => !m.deleted).toArray() : []),
    [client?.householdId],
  )
  const hhServices = useLiveQuery(
    () => (client ? db.services.where('householdId').equals(client.householdId).reverse().sortBy('date') : []),
    [client?.householdId],
  )
  const presets = useLiveQuery(() => getPresets(), []) ?? []
  const templates = useLiveQuery(() => db.templates.toArray(), []) ?? []
  const auditRows = useLiveQuery(async () => {
    if (!client) return []
    const rows = await db.audit.where('entityId').anyOf([client.id, client.householdId]).toArray()
    return rows.sort((a, b) => b.at.localeCompare(a.at))
  }, [client?.id, client?.householdId])

  const memberMap = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members])

  // Keyboard: 1–9 press the service buttons, H toggles whole household
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (client === undefined) return <div className="page muted">Loading…</div>
  if (!client) return <div className="page">Client not found. <Link to="/">Back to search</Link></div>

  const myServices = (hhServices ?? []).filter((s) => s.clientId === client.id)
  const activeServices = (hhServices ?? []).filter((s) => !s.deleted)
  const lastOwn = myServices.find((s) => !s.deleted)
  // Show a household-level entry (one row per member) as a single line
  const serviceLines: { s: Service; rows: Service[] }[] = []
  const byBatch = new Map<string, { s: Service; rows: Service[] }>()
  for (const s of hhServices ?? []) {
    const key = s.batchId ?? s.id
    const line = byBatch.get(key)
    if (line) line.rows.push(s)
    else {
      const l = { s, rows: [s] }
      byBatch.set(key, l)
      serviceLines.push(l)
    }
  }
  const targets: Client[] = scope === 'household' ? members ?? [client] : [client]

  // Eligibility indicator: same service type to this household in the last week
  const recentOfType = (type: string) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - config.eligibilityDays)
    const c = cutoff.toISOString().slice(0, 10)
    return activeServices.find((s) => s.type === type && s.date >= c)
  }

  const record = async (input: ServiceInput, label: string) => {
    const rows = await recordServices(input, targets, session)
    const who = targets.length > 1 ? `${targets.length} household members` : client.firstName
    toast({
      text: `${label} recorded for ${who}`,
      action: {
        label: 'Undo',
        run: async () => {
          for (const r of rows) await voidService(r.id, 'Undone immediately after entry', session)
          toast({ text: 'Undone' })
        },
      },
    })
  }

  const tapPreset = (p: ServicePreset) =>
    record({ date, type: p.type, supportMethod: p.supportMethod, value: p.value, quantity: p.quantity, notes: '' }, p.label)

  const tapTemplate = async (t: VisitTemplate) => {
    const who = t.wholeHousehold && members && members.length > 1 ? members : targets
    const rows = await recordTemplate(t, date, who, session)
    toast({
      text: `${t.label} recorded (${t.items.length} service${t.items.length === 1 ? '' : 's'}) for ${who.length > 1 ? `${who.length} household members` : client.firstName}`,
      action: {
        label: 'Undo',
        run: async () => {
          for (const r of rows) await voidService(r.id, 'Undone immediately after entry', session)
          toast({ text: 'Undone' })
        },
      },
    })
  }

  keyHandler.current = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return
    const n = Number(e.key)
    if (n >= 1 && n <= 9 && presets[n - 1]) {
      e.preventDefault()
      tapPreset(presets[n - 1])
    } else if (e.key.toLowerCase() === 'h' && (members?.length ?? 1) > 1) {
      setScope((sc) => (sc === 'household' ? 'person' : 'household'))
    }
  }

  const openCustom = () =>
    setCustom({
      date,
      // Auto-fill from the previous visit
      type: lastOwn?.type ?? config.serviceTypes[0],
      supportMethod: lastOwn?.supportMethod ?? config.supportMethods[0],
      value: lastOwn?.value ?? 0,
      quantity: 1,
      notes: '',
    })

  const a = age(client.dob)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {fullName(client)} {client.interpreterNeeded && <span className="tag">Interpreter: {client.languages}</span>}
          </h1>
          <div className="muted">
            {client.clientNo} · DOB {fmtDate(client.dob)}
            {a !== null ? ` (age ${a})` : ''} · {client.gender} · {client.phone || 'no phone'}
            {client.syncStatus === 'pending' && <span className="tag tag-warn">Not synced</span>}
          </div>
        </div>
        <div className="actions">
          <Link to={`/client/${client.id}/edit`} className="btn">
            Edit
          </Link>
          <Link to={`/client/${client.id}/docket`} className="btn btn-primary" data-tour="docket">
            Print docket
          </Link>
        </div>
      </div>

      {client.riskFlag && (
        <div className="alert alert-risk">
          <strong>Alert:</strong> {can('viewRestricted') ? client.riskNotes || 'Vulnerability flag set' : 'Vulnerability flag set. Speak to a staff member before proceeding.'}
        </div>
      )}
      {!client.consentGiven && <div className="alert alert-error">No consent recorded. Edit the record to capture consent.</div>}

      <div className="cols">
        <section className="card" data-tour="services">
          <div className="card-head">
            <h2>Record a service</h2>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Service date" className="date-compact" />
          </div>
          <div className="seg" role="radiogroup" aria-label="Who is this for" data-tour="scope">
            <button role="radio" aria-checked={scope === 'person'} className={scope === 'person' ? 'on' : ''} onClick={() => setScope('person')}>
              {client.firstName} only
            </button>
            <button role="radio" aria-checked={scope === 'household'} className={scope === 'household' ? 'on' : ''} onClick={() => setScope('household')} disabled={(members?.length ?? 1) < 2}>
              Whole household ({members?.length ?? 1})
            </button>
          </div>
          <div className="presets">
            {presets.map((p, i) => {
              const recent = recentOfType(p.type)
              return (
                <button key={p.id} className="preset" style={{ ['--c' as string]: p.colour }} onClick={() => tapPreset(p)}>
                  {i < 9 && <kbd className="preset-key">{i + 1}</kbd>}
                  <span className="preset-label">{p.label}</span>
                  <span className="preset-meta">
                    {p.supportMethod}
                    {p.value ? ` · ${money(p.value)}` : ''}
                  </span>
                  {recent && <span className="preset-warn">Given {fmtDate(recent.date)}</span>}
                </button>
              )
            })}
            <button className="preset preset-other" onClick={openCustom}>
              <span className="preset-label">Other…</span>
              <span className="preset-meta">Custom service</span>
            </button>
          </div>
          {templates.length > 0 && (
            <div className="templates" data-tour="templates">
              <span className="muted small">Visit templates:</span>
              {templates.map((t) => (
                <button key={t.id} className="btn btn-small" onClick={() => tapTemplate(t)} disabled={!t.items.length} title={t.items.map((x) => x.type).join(' + ')}>
                  {t.label}
                  <span className="muted"> ({t.items.map((x) => x.type).join(' + ')})</span>
                </button>
              ))}
            </div>
          )}
          <p className="muted small">
            One tap records the service; you can undo for a few seconds. Keys <kbd>1</kbd>–<kbd>9</kbd> press the buttons, <kbd>H</kbd> switches whole household.
          </p>

          {custom && (
            <form
              className="custom-service"
              onSubmit={async (e) => {
                e.preventDefault()
                await record(custom, custom.type)
                setCustom(null)
              }}
            >
              <div className="grid">
                <label className="field">
                  <span>Service type</span>
                  <select value={custom.type} onChange={(e) => setCustom({ ...custom, type: e.target.value })}>
                    {config.serviceTypes.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Support method</span>
                  <select value={custom.supportMethod} onChange={(e) => setCustom({ ...custom, supportMethod: e.target.value })}>
                    {config.supportMethods.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Value ($)</span>
                  <input type="number" min={0} step="0.01" value={custom.value} onChange={(e) => setCustom({ ...custom, value: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Quantity</span>
                  <input type="number" min={1} value={custom.quantity} onChange={(e) => setCustom({ ...custom, quantity: Number(e.target.value) })} />
                </label>
              </div>
              <label className="field">
                <span>Case notes</span>
                <textarea rows={2} value={custom.notes} onChange={(e) => setCustom({ ...custom, notes: e.target.value })} />
              </label>
              {recentOfType(custom.type) && <p className="small warn-text">This household received {custom.type} on {fmtDate(recentOfType(custom.type)!.date)}.</p>}
              <div className="actions">
                <button className="btn btn-primary" type="submit">
                  Record for {targets.length > 1 ? `${targets.length} people` : client.firstName}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setCustom(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="card" data-tour="household">
          <div className="card-head">
            <h2>{household?.name ?? 'Household'}</h2>
            <Link to={`/new?household=${client.householdId}`} className="btn btn-small">
              + Add household member
            </Link>
          </div>
          <p className="muted small">
            {household ? `${household.address}, ${household.suburb} ${household.postcode}` : ''}
            {household?.housingSituation ? ` · ${household.housingSituation}` : ''}
          </p>
          <HouseholdTree members={members ?? []} currentId={client.id} />
          <dl className="facts">
            <dt>Adults / children</dt>
            <dd>
              {(members ?? []).filter((m) => (age(m.dob) ?? 18) >= 18).length} / {(members ?? []).filter((m) => (age(m.dob) ?? 18) < 18).length}
            </dd>
            <dt>Background</dt>
            <dd>{[client.culturalBackground, client.countryOfBirth].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Income</dt>
            <dd>
              {client.incomeSource || '—'}
              {client.concessionCard && client.concessionCard !== 'None' ? ` · ${client.concessionCard}` : ''}
            </dd>
            <dt>Disability</dt>
            <dd>{client.hasDisability ? (can('viewRestricted') ? client.disabilityNotes || 'Yes' : 'Yes (details restricted)') : 'None recorded'}</dd>
            <dt>Consent</dt>
            <dd>
              {client.consentGiven ? `Given ${fmtDate(client.consentDate)}${client.consentMethod ? ` · ${client.consentMethod}` : ''}` : 'Not recorded'}
              {client.consentSignature && can('viewRestricted') && <img className="sig-thumb" src={client.consentSignature} alt="Client's consent signature" />}
            </dd>
            {(client.crn || client.medicareNo || client.licenceNo) && (
              <>
                <dt>ID numbers</dt>
                <dd>
                  {[
                    client.crn && `CRN ${can('viewRestricted') ? client.crn : mask(client.crn)}`,
                    client.medicareNo && `Medicare ${can('viewRestricted') ? client.medicareNo : mask(client.medicareNo)}`,
                    client.licenceNo && `Licence ${can('viewRestricted') ? client.licenceNo : mask(client.licenceNo)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </>
            )}
            {config.customFields
              .filter((f) => f.active && (can('viewRestricted') || !f.restricted) && client.extra?.[f.key] !== undefined && client.extra?.[f.key] !== '')
              .map((f) => (
                <div key={f.id} className="contents">
                  <dt>{f.label}</dt>
                  <dd>{displayExtra(f, client.extra[f.key])}</dd>
                </div>
              ))}
          </dl>
          {client.notes && <p className="small notes">{client.notes}</p>}
        </section>
      </div>

      <section className="card" data-tour="history">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'services'} className={tab === 'services' ? 'on' : ''} onClick={() => setTab('services')}>
            Service history ({serviceLines.filter((l) => !l.s.deleted).length})
          </button>
{can('viewAudit') && (
          <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>
            Change history ({auditRows?.length ?? 0})
          </button>
          )}
        </div>

        {tab === 'services' && (
          <div className="table-wrap">
            <table className="table stack">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Service</th>
                  <th>Method</th>
                  <th className="num">Value</th>
                  <th>Recorded by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {serviceLines.map(({ s, rows }) => {
                  const names = rows.map((r) => memberMap.get(r.clientId)?.firstName ?? '?')
                  const value = rows.reduce((sum, r) => sum + r.value, 0)
                  const includesMe = rows.some((r) => r.clientId === client.id)
                  return (
                    <tr key={s.id} className={s.deleted ? 'voided' : includesMe ? 'mine' : ''}>
                      <td className="c-date">{fmtDate(s.date)}</td>
                      <td className="c-person">{rows.length > 1 ? <span title={names.join(', ')}>Household ({rows.length})</span> : names[0]}</td>
                      <td className="c-service">
                        {s.type}
                        {s.notes && <div className="muted small">{s.notes}</div>}
                      </td>
                      <td className="c-method">{s.supportMethod}</td>
                      <td className="num c-value">{money(value)}</td>
                      <td className="small c-by">
                        {s.createdBy}
                        <div className="muted">
                          {s.site}
                          {s.syncStatus === 'pending' ? ' · not synced' : ''}
                        </div>
                      </td>
                      <td className="c-act">
                        {!s.deleted && can('voidService') && (
                          <button
                            className="btn btn-small btn-ghost"
                            onClick={async () => {
                              const reason = window.prompt('Reason for voiding this service?')
                              if (reason) for (const r of rows) await voidService(r.id, `VOID: ${reason}`, session)
                            }}
                          >
                            Void
                          </button>
                        )}
                        {s.deleted && <span className="tag">Voided</span>}
                      </td>
                    </tr>
                  )
                })}
                {!serviceLines.length && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No services recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'audit' && can('viewAudit') && (
          <ul className="audit">
            {(auditRows ?? []).map((r) => (
              <li key={r.id}>
                <div>
                  <b>{ACTION_LABEL[r.action] ?? r.action}</b> {r.entity} · {r.user} at {r.site}
                  <span className="muted"> · {fmtDateTime(r.at)}</span>
                </div>
                {r.action !== 'create' && Object.keys(r.changes).length > 0 && (
                  <div className="small muted">
                    {Object.entries(r.changes)
                      .map(([k, v]) => `${k}: "${String(v.from ?? '')}" → "${String(v.to ?? '')}"`)
                      .join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function HouseholdTree({ members, currentId }: { members: Client[]; currentId: string }) {
  const order = ['Primary', 'Partner', 'Parent', 'Child', 'Dependent', 'Other relative', 'Other']
  const adults = members.filter((m) => ['Primary', 'Partner', 'Parent'].includes(m.relationship))
  const others = members.filter((m) => !adults.includes(m))
  const sort = (xs: Client[]) => [...xs].sort((a, b) => order.indexOf(a.relationship) - order.indexOf(b.relationship) || a.dob.localeCompare(b.dob))
  const Node = ({ m }: { m: Client }) => (
    <Link to={`/client/${m.id}`} className={`node ${m.id === currentId ? 'current' : ''}`}>
      <span className="node-name">
        {m.firstName} {m.lastName}
      </span>
      <span className="node-meta">
        {m.relationship} · {age(m.dob) ?? '?'}y{m.riskFlag ? ' · ⚑' : ''}
      </span>
    </Link>
  )
  return (
    <div className="tree">
      <div className="tree-row">{sort(adults).map((m) => <Node key={m.id} m={m} />)}</div>
      {others.length > 0 && (
        <>
          <div className="tree-line" aria-hidden />
          <div className="tree-row">{sort(others).map((m) => <Node key={m.id} m={m} />)}</div>
        </>
      )}
    </div>
  )
}
