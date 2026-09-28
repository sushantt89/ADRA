import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getConfig, getPresets } from '../db/db'
import { uuid, wipeAll } from '../db/repo'
import type { AppConfig, CustomField, CustomFieldType, DocketBranding, Role, Session, ServicePreset, VisitTemplate } from '../db/types'
import DocketView from '../components/DocketView'
import { sampleDocket } from '../lib/docketData'
import { docketPdfBlob } from '../lib/exporters'
import { logoSrc } from '../lib/branding'
import { download } from '../lib/format'
import { createUser, logEvent, setPin, validPin } from '../lib/auth'
import { useConfig, useSession, useToast } from '../lib/context'
import { ROLE_HELP, ROLES } from '../lib/permissions'
import { resetServer } from '../sync/mockServer'
import { useAutoTour } from '../components/Tour'

type Tab = 'users' | 'lists' | 'fields' | 'buttons' | 'docket' | 'general'

async function saveConfig(patch: Partial<AppConfig>, s: Session) {
  const before = await getConfig()
  await db.config.put({ ...before, ...patch })
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of Object.keys(patch) as (keyof AppConfig)[]) changes[k] = { from: before[k], to: patch[k] }
  await logEvent(s, 'config', 'main', 'update', changes)
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')
  useAutoTour('admin')
  const tabs: [Tab, string][] = [
    ['users', 'Users & roles'],
    ['lists', 'Sites & lists'],
    ['fields', 'Custom fields'],
    ['buttons', 'Service buttons & templates'],
    ['docket', 'Docket design'],
    ['general', 'General'],
  ]
  return (
    <div className="page">
      <h1>Admin</h1>
      <p className="muted">Changes here apply to this device now. In the live system they're stored centrally and apply to every site.</p>
      <div className="tabs" role="tablist" data-tour="admin-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'lists' && <Lists />}
      {tab === 'fields' && <Fields />}
      {tab === 'buttons' && <Buttons />}
      {tab === 'docket' && <DocketDesign />}
      {tab === 'general' && <General />}
    </div>
  )
}

// ---------------- users ----------------

function Users() {
  const { session } = useSession()
  const toast = useToast()
  const config = useConfig()
  const users = useLiveQuery(() => db.users.toArray(), []) ?? []
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('Volunteer')
  const [site, setSite] = useState(config.sites[0])
  const [pin, setPinValue] = useState('')

  return (
    <div className="cols">
      <section className="card">
        <h2>People who can sign in</h2>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Home site</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...users]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'voided'}>
                    <td>{u.name}</td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.id === session.userId}
                        aria-label={`Role for ${u.name}`}
                        onChange={async (e) => {
                          await db.users.update(u.id, { role: e.target.value as Role })
                          await logEvent(session, 'user', u.id, 'update', { role: { from: u.role, to: e.target.value } })
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={u.homeSite} aria-label={`Home site for ${u.name}`} onChange={(e) => db.users.update(u.id, { homeSite: e.target.value })}>
                        {config.sites.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>{u.active ? 'Active' : 'Disabled'}</td>
                    <td className="actions">
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={async () => {
                          const p = window.prompt(`New PIN for ${u.name} (4–8 digits)`)
                          if (!p) return
                          try {
                            await setPin(u.id, p)
                            await logEvent(session, 'user', u.id, 'update', { pin: { from: '••••', to: 'reset' } })
                            toast({ text: `PIN reset for ${u.name}` })
                          } catch (err) {
                            toast({ text: (err as Error).message })
                          }
                        }}
                      >
                        Reset PIN
                      </button>
                      {u.id !== session.userId && (
                        <button
                          className="btn btn-small btn-ghost"
                          onClick={async () => {
                            await db.users.update(u.id, { active: !u.active })
                            await logEvent(session, 'user', u.id, 'update', { active: { from: u.active, to: !u.active } })
                          }}
                        >
                          {u.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Add a person</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return toast({ text: 'Enter a name' })
            if (!validPin(pin)) return toast({ text: 'PIN must be 4–8 digits' })
            await createUser(name, role, site, pin, session)
            toast({ text: `${name} added as ${role}` })
            setName('')
            setPinValue('')
          }}
        >
          <div className="grid">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Home site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                {config.sites.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Starting PIN</span>
              <input inputMode="numeric" value={pin} maxLength={8} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <button className="btn btn-primary" type="submit">
            Add person
          </button>
        </form>
        <h3 className="mt">What each role can do</h3>
        <dl className="facts">
          {ROLES.map((r) => (
            <div key={r} className="contents">
              <dt>{r}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

// ---------------- sites & lists ----------------

function ListEditor({ title, help, items, onSave }: { title: string; help: string; items: string[]; onSave: (v: string[]) => void }) {
  const [text, setText] = useState(items.join('\n'))
  const [dirty, setDirty] = useState(false)
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted small">{help}</p>
      <textarea
        rows={Math.max(5, items.length + 1)}
        value={text}
        aria-label={title}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
      />
      <div className="actions mt">
        <button
          className="btn btn-primary btn-small"
          disabled={!dirty}
          onClick={() => {
            onSave([...new Set(text.split('\n').map((x) => x.trim()).filter(Boolean))])
            setDirty(false)
          }}
        >
          Save
        </button>
        <span className="muted small">One per line. Renaming doesn't change past records.</span>
      </div>
    </section>
  )
}

function Lists() {
  const { session } = useSession()
  const toast = useToast()
  const config = useLiveQuery(() => getConfig(), [])
  if (!config) return null
  const save = async (patch: Partial<AppConfig>) => {
    await saveConfig(patch, session)
    toast({ text: 'Saved' })
  }
  return (
    <div className="report-grid">
      <ListEditor title="Sites" help="Service locations staff can sign in at." items={config.sites} onSave={(sites) => save({ sites })} />
      <ListEditor title="Service types" help="What was provided. Used on service buttons and in reports." items={config.serviceTypes} onSave={(serviceTypes) => save({ serviceTypes })} />
      <ListEditor title="Support methods" help="How support was given." items={config.supportMethods} onSave={(supportMethods) => save({ supportMethods })} />
    </div>
  )
}

// ---------------- custom fields ----------------

const FIELD_TYPES: [CustomFieldType, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['yesno', 'Yes / No'],
  ['select', 'Pick from list'],
]

function Fields() {
  const { session } = useSession()
  const config = useConfig()
  const fields = config.customFields
  const update = (id: string, patch: Partial<CustomField>) => saveConfig({ customFields: fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }, session)

  return (
    <section className="card">
      <h2>Custom client fields</h2>
      <p className="muted small">
        Add extra questions a funder or site needs, without a developer. They appear in a "More details" section on the client form, on the profile, in reports and in
        exports. Fields are never deleted, only switched off, so old answers are kept.
      </p>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Question</th>
              <th>Type</th>
              <th>Options (comma separated)</th>
              <th>Required</th>
              <th>Restricted</th>
              <th>On</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className={f.active ? '' : 'voided'}>
                <td>
                  <input defaultValue={f.label} aria-label="Question" onBlur={(e) => e.target.value !== f.label && update(f.id, { label: e.target.value })} />
                </td>
                <td>
                  <select value={f.type} aria-label="Type" onChange={(e) => update(f.id, { type: e.target.value as CustomFieldType })}>
                    {FIELD_TYPES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {f.type === 'select' ? (
                    <input
                      defaultValue={f.options.join(', ')}
                      aria-label="Options"
                      onBlur={(e) => update(f.id, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                    />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <input type="checkbox" checked={f.required} onChange={(e) => update(f.id, { required: e.target.checked })} aria-label="Required" />
                </td>
                <td>
                  <input type="checkbox" checked={f.restricted} onChange={(e) => update(f.id, { restricted: e.target.checked })} aria-label="Restricted" />
                </td>
                <td>
                  <input type="checkbox" checked={f.active} onChange={(e) => update(f.id, { active: e.target.checked })} aria-label="Active" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn btn-small mt"
        onClick={() =>
          saveConfig(
            {
              customFields: [
                ...fields,
                { id: uuid(), key: `field_${Date.now().toString(36)}`, label: 'New question', type: 'text', options: [], required: false, restricted: false, active: true },
              ],
            },
            session,
          )
        }
      >
        + Add field
      </button>
      <p className="muted small">Restricted fields are hidden from volunteers.</p>
    </section>
  )
}

// ---------------- service buttons & visit templates ----------------

function Buttons() {
  const config = useConfig()
  const presets = useLiveQuery(() => getPresets(), []) ?? []
  const templates = useLiveQuery(() => db.templates.toArray(), []) ?? []
  const upd = (id: string, patch: Partial<ServicePreset>) => db.presets.update(id, patch)
  const updT = (t: VisitTemplate) => db.templates.put(t)
  // Re-number all buttons after moving one, so the order (and keys 1–9) is predictable
  const move = async (i: number, dir: -1 | 1) => {
    const list = [...presets]
    const [x] = list.splice(i, 1)
    list.splice(i + dir, 0, x)
    await db.transaction('rw', db.presets, async () => {
      for (let n = 0; n < list.length; n++) await db.presets.update(list[n].id, { order: n + 1 })
    })
  }

  return (
    <>
      <section className="card">
        <h2>One-tap service buttons</h2>
        <p className="muted small">Shown on every client record. Staff can press 1–9 on the keyboard for the first nine. The first button is also the swipe action on the search screen.</p>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>#</th>
                <th>Button label</th>
                <th>Service type</th>
                <th>Method</th>
                <th className="num">Value $</th>
                <th>Colour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {presets.map((p, i) => (
                <tr key={p.id}>
                  <td className="muted nowrap">
                    <button className="icon-btn" aria-label={`Move ${p.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button className="icon-btn" aria-label={`Move ${p.label} down`} disabled={i === presets.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>{' '}
                    {i < 9 ? i + 1 : ''}
                  </td>
                  <td>
                    <input value={p.label} aria-label="Button label" onChange={(e) => upd(p.id, { label: e.target.value })} />
                  </td>
                  <td>
                    <select value={p.type} aria-label="Service type" onChange={(e) => upd(p.id, { type: e.target.value })}>
                      {config.serviceTypes.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={p.supportMethod} aria-label="Support method" onChange={(e) => upd(p.id, { supportMethod: e.target.value })}>
                      {config.supportMethods.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input type="number" min={0} className="w-num" aria-label="Value" value={p.value} onChange={(e) => upd(p.id, { value: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="color" value={p.colour} onChange={(e) => upd(p.id, { colour: e.target.value })} aria-label="Button colour" />
                  </td>
                  <td>
                    <button className="btn btn-small btn-ghost" onClick={() => db.presets.delete(p.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="btn btn-small mt"
          onClick={() => db.presets.add({ id: uuid(), order: presets.length + 1, label: 'New service', type: config.serviceTypes[0], supportMethod: config.supportMethods[0], value: 0, quantity: 1, colour: '#5b6770' })}
        >
          + Add button
        </button>
      </section>

      <section className="card">
        <h2>Visit templates</h2>
        <p className="muted small">Record a usual combination of services with one tap, e.g. "Standard visit" = food parcel + transport voucher.</p>
        {templates.map((t) => (
          <div key={t.id} className="template-edit">
            <div className="grid">
              <label className="field">
                <span>Template name</span>
                <input value={t.label} onChange={(e) => updT({ ...t, label: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={t.wholeHousehold} onChange={(e) => updT({ ...t, wholeHousehold: e.target.checked })} /> Whole household by default
              </label>
            </div>
            {t.items.map((it, i) => (
              <div key={i} className="template-item">
                <select value={it.type} aria-label="Service type" onChange={(e) => updT({ ...t, items: t.items.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                  {config.serviceTypes.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select value={it.supportMethod} aria-label="Support method" onChange={(e) => updT({ ...t, items: t.items.map((x, j) => (j === i ? { ...x, supportMethod: e.target.value } : x)) })}>
                  {config.supportMethods.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  className="w-num"
                  value={it.value}
                  aria-label="Value"
                  onChange={(e) => updT({ ...t, items: t.items.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })}
                />
                <button className="btn btn-small btn-ghost" onClick={() => updT({ ...t, items: t.items.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <div className="actions">
              <button className="btn btn-small" onClick={() => updT({ ...t, items: [...t.items, { type: config.serviceTypes[0], supportMethod: config.supportMethods[0], value: 0, quantity: 1 }] })}>
                + Add service
              </button>
              <button className="btn btn-small btn-ghost" onClick={() => db.templates.delete(t.id)}>
                Delete template
              </button>
            </div>
          </div>
        ))}
        <button className="btn btn-small mt" onClick={() => db.templates.add({ id: uuid(), label: 'New template', wholeHousehold: true, items: [] })}>
          + Add template
        </button>
      </section>
    </>
  )
}

// ---------------- docket design ----------------

/** Shrinks an uploaded logo so it stays small in the database and in PDFs. */
function resizeImage(file: File, max = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('That file is not an image the browser can read'))
    img.src = url
  })
}

function DocketDesign() {
  const { session } = useSession()
  const toast = useToast()
  const config = useConfig()
  const b = config.docket
  const save = (patch: Partial<DocketBranding>) => saveConfig({ docket: { ...b, ...patch } }, session)
  const toggles: [keyof DocketBranding, string][] = [
    ['showHousehold', 'Household members'],
    ['showServices', 'Services provided'],
    ['showEligibility', 'Next eligible date'],
    ['showAppointment', 'Next appointment'],
    ['showInstructions', 'Instructions'],
    ['showSignature', 'Signature lines'],
  ]

  return (
    <div className="cols docket-design">
      <section className="card">
        <h2>Docket design</h2>
        <p className="muted small">Applies to printed dockets, docket PDFs and report PDFs.</p>
        <div className="field">
          <span>Logo</span>
          <div className="logo-row">
            {logoSrc(b) ? <img src={logoSrc(b)} alt="Current logo" className="logo-preview" /> : <span className="muted small">No logo</span>}
            <label className="btn btn-small">
              Upload a different logo
              <input
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    await save({ logo: await resizeImage(f) })
                  } catch (err) {
                    toast({ text: (err as Error).message })
                  }
                }}
              />
            </label>
            {b.logo !== 'builtin' && (
              <button className="btn btn-small btn-ghost" onClick={() => save({ logo: 'builtin' })}>
                Use ADRA logo
              </button>
            )}
            {b.logo && (
              <button className="btn btn-small btn-ghost" onClick={() => save({ logo: '' })}>
                No logo
              </button>
            )}
          </div>
          <span className="muted small">The ADRA logo is used by default. You can upload a site-specific version (PNG or JPG).</span>
        </div>
        <div className="grid">
          <label className="field">
            <span>Accent colour</span>
            <input type="color" value={b.colour} onChange={(e) => save({ colour: e.target.value })} />
          </label>
          <label className="field">
            <span>Paper</span>
            <select value={b.paper} onChange={(e) => save({ paper: e.target.value as DocketBranding['paper'] })}>
              <option value="A4">A4 page</option>
              <option value="receipt">Receipt printer (80 mm)</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Line under the name (address, phone, ABN…)</span>
          <input defaultValue={b.subtitle} onBlur={(e) => e.target.value !== b.subtitle && save({ subtitle: e.target.value })} placeholder="e.g. 12 Example St, Adelaide · 08 0000 0000" />
        </label>
        <div className="field">
          <span>Show on the docket</span>
          <div className="toggle-grid">
            {toggles.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!b[k]} onChange={(e) => save({ [k]: e.target.checked } as Partial<DocketBranding>)} /> {label}
              </label>
            ))}
          </div>
        </div>
        <button
          className="btn btn-small"
          onClick={async () => download('sample-docket.pdf', await docketPdfBlob(sampleDocket(config), b))}
        >
          Download a sample PDF
        </button>
      </section>
      <section className="card">
        <h2>Preview</h2>
        <div className="docket-preview">
          <DocketView d={sampleDocket(config)} b={b} />
        </div>
      </section>
    </div>
  )
}

// ---------------- general ----------------

function General() {
  const { session } = useSession()
  const toast = useToast()
  const config = useLiveQuery(() => getConfig(), [])
  if (!config) return null
  return (
    <>
      <section className="card">
        <h2>General</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            await saveConfig(
              {
                orgName: String(f.get('orgName')),
                eligibilityDays: Number(f.get('eligibilityDays')),
                autoLockMinutes: Math.max(1, Number(f.get('autoLockMinutes'))),
                docketFooter: String(f.get('docketFooter')),
              },
              session,
            )
            toast({ text: 'Settings saved' })
          }}
        >
          <div className="grid">
            <label className="field">
              <span>Organisation / program name (shown on dockets)</span>
              <input name="orgName" defaultValue={config.orgName} />
            </label>
            <label className="field">
              <span>Days between eligible visits</span>
              <input name="eligibilityDays" type="number" min={0} defaultValue={config.eligibilityDays} />
            </label>
            <label className="field">
              <span>Auto-lock after (minutes idle)</span>
              <input name="autoLockMinutes" type="number" min={1} defaultValue={config.autoLockMinutes} />
            </label>
          </div>
          <label className="field">
            <span>Docket footer text</span>
            <input name="docketFooter" defaultValue={config.docketFooter} />
          </label>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </form>
      </section>
      <section className="card">
        <h2>Danger zone</h2>
        <div className="actions wrap">
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (window.confirm('Delete ALL clients, households, services and history from this device? Users and settings are kept. This cannot be undone.')) {
                await wipeAll()
                toast({ text: 'Client data cleared from this device' })
              }
            }}
          >
            Clear client data on this device
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (window.confirm('Reset the pretend cloud server (prototype only)?')) {
                await resetServer()
                await db.meta.clear()
                toast({ text: 'Mock server reset' })
              }
            }}
          >
            Reset mock server
          </button>
        </div>
      </section>
    </>
  )
}
