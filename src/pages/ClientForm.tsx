import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createClient, createHousehold, findDuplicates, today, updateClient, updateHousehold, type ClientInput, type HouseholdInput } from '../db/repo'
import { CONCESSION_CARDS, CONSENT_METHODS, GENDERS, HOUSING, INCOME_SOURCES, INDIGENOUS_STATUS, RELATIONSHIPS } from '../db/options'
import type { Client, ConsentMethod, Relationship } from '../db/types'
import { useCan, useConfig, useSession, useToast } from '../lib/context'
import { age, fmtDate, fullName } from '../lib/format'
import { mask } from '../lib/permissions'
import SignaturePad from '../components/SignaturePad'
import { useAutoTour } from '../components/Tour'
import { CustomFieldInput, isEmptyExtra } from '../components/CustomFields'

const EMPTY_CLIENT: ClientInput = {
  firstName: '', lastName: '', preferredName: '', dob: '', gender: '', phone: '', email: '', householdId: '', relationship: 'Primary',
  countryOfBirth: '', culturalBackground: '', languages: 'English', interpreterNeeded: false, indigenousStatus: '',
  incomeSource: '', concessionCard: '', hasDisability: false, disabilityNotes: '',
  crn: '', medicareNo: '', licenceNo: '',
  consentGiven: false, consentDate: '', consentMethod: '', consentSignature: '', privacyAcknowledged: false,
  riskFlag: false, riskNotes: '', notes: '', extra: {},
}

const EMPTY_HOUSEHOLD: HouseholdInput = { name: '', address: '', suburb: '', postcode: '', housingSituation: '', notes: '' }

interface ExtraMember {
  firstName: string
  lastName: string
  dob: string
  gender: string
  relationship: Relationship
}

type Draft = { c: ClientInput; h: HouseholdInput; members: ExtraMember[] }
const DRAFT_KEY = 'adra-draft-new-client'

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* storage unavailable */
  }
}

export default function ClientForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const can = useCan()
  const config = useConfig()
  const toast = useToast()
  const editing = !!id
  const joinHouseholdId = params.get('household')
  const isFreshNew = !editing && !joinHouseholdId && !params.get('name')
  const restricted = can('viewRestricted')
  // Restricted fields a volunteer can't see on an existing record are left as they were
  const lockedForMe = editing && !restricted

  const [c, setC] = useState<ClientInput>(EMPTY_CLIENT)
  const [h, setH] = useState<HouseholdInput>(EMPTY_HOUSEHOLD)
  const [members, setMembers] = useState<ExtraMember[]>([])
  const [existingHouseholdId, setExistingHouseholdId] = useState<string | null>(null)
  const [original, setOriginal] = useState<Client | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [notDuplicate, setNotDuplicate] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const saving = useRef(false)
  useAutoTour('register', !editing && !joinHouseholdId)

  const allClients = useLiveQuery(() => db.clients.toArray(), []) ?? []
  const customFields = config.customFields.filter((f) => f.active && (!f.restricted || !lockedForMe))

  // Load the record being edited, or pre-fill a new household member
  useEffect(() => {
    ;(async () => {
      if (id) {
        const existing = await db.clients.get(id)
        if (!existing) return
        setOriginal(existing)
        const { id: _i, clientNo: _n, createdAt: _a, updatedAt: _b, createdBy: _c, updatedBy: _d, site: _e, syncStatus: _f, deleted: _g, version: _v, ...rest } = existing
        setC({ ...EMPTY_CLIENT, ...rest, extra: rest.extra ?? {} })
        const hh = await db.households.get(existing.householdId)
        if (hh) {
          setExistingHouseholdId(hh.id)
          setH({ name: hh.name, address: hh.address, suburb: hh.suburb, postcode: hh.postcode, housingSituation: hh.housingSituation, notes: hh.notes })
        }
      } else if (joinHouseholdId) {
        const hh = await db.households.get(joinHouseholdId)
        const primary = (await db.clients.where('householdId').equals(joinHouseholdId).toArray()).find((x) => x.relationship === 'Primary')
        if (hh) {
          setExistingHouseholdId(hh.id)
          setH({ name: hh.name, address: hh.address, suburb: hh.suburb, postcode: hh.postcode, housingSituation: hh.housingSituation, notes: hh.notes })
        }
        // Auto-fill shared details from the household's primary person
        setC({
          ...EMPTY_CLIENT,
          relationship: 'Child',
          lastName: primary?.lastName ?? '',
          countryOfBirth: primary?.countryOfBirth ?? '',
          culturalBackground: primary?.culturalBackground ?? '',
          languages: primary?.languages ?? 'English',
          interpreterNeeded: primary?.interpreterNeeded ?? false,
          indigenousStatus: primary?.indigenousStatus ?? '',
          consentGiven: primary?.consentGiven ?? false,
          consentDate: primary?.consentGiven ? today() : '',
          consentMethod: primary?.consentGiven ? 'Verbal' : '',
          privacyAcknowledged: primary?.privacyAcknowledged ?? false,
        })
      } else {
        const draft = isFreshNew ? loadDraft() : null
        if (draft) {
          setC({ ...EMPTY_CLIENT, ...draft.c })
          setH(draft.h)
          setMembers(draft.members ?? [])
          setRestoredDraft(true)
        } else {
          const name = (params.get('name') ?? '').trim()
          const parts = name && !/\d/.test(name) ? name.split(/\s+/) : []
          setC({ ...EMPTY_CLIENT, firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') })
        }
      }
      setLoaded(true)
    })()
  }, [id, joinHouseholdId, params, isFreshNew])

  // Auto-save a brand-new registration so nothing is lost if the tab closes
  useEffect(() => {
    if (!loaded || editing || joinHouseholdId || saving.current) return
    const t = setTimeout(() => {
      const hasContent = c.firstName || c.lastName || c.phone || h.address || members.length
      saveDraft(hasContent ? { c: { ...c, consentSignature: '' }, h, members } : null)
    }, 500)
    return () => clearTimeout(t)
  }, [c, h, members, loaded, editing, joinHouseholdId])

  const dups = useMemo(() => findDuplicates(c, allClients, id), [c.firstName, c.lastName, c.dob, c.phone, allClients, id]) // eslint-disable-line

  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setC((x) => ({ ...x, [k]: v }))
  const setHh = <K extends keyof HouseholdInput>(k: K, v: HouseholdInput[K]) => setH((x) => ({ ...x, [k]: v }))
  const setExtra = (key: string, v: ClientInput['extra'][string]) => setC((x) => ({ ...x, extra: { ...x.extra, [key]: v } }))
  const setMember = (i: number, patch: Partial<ExtraMember>) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const addMember = (relationship: Relationship) => setMembers((ms) => [...ms, { firstName: '', lastName: '', dob: '', gender: '', relationship }])

  const save = async () => {
    const errs: string[] = []
    if (!c.firstName.trim()) errs.push('First name is required')
    if (!c.lastName.trim()) errs.push('Last name is required')
    if (!c.dob) errs.push('Date of birth is required')
    else if (c.dob > today()) errs.push('Date of birth cannot be in the future')
    if (!c.gender) errs.push('Gender is required')
    if (!c.consentGiven) errs.push('Record consent before saving (tick "Consent given")')
    else if (!c.consentMethod) errs.push('Choose how consent was given')
    else if (c.consentMethod === 'Signed on screen' && !c.consentSignature) errs.push('The client needs to sign in the signature box')
    if (c.phone && c.phone.replace(/\D/g, '').length < 8) errs.push('Phone number looks too short')
    if (!lockedForMe && c.medicareNo && c.medicareNo.replace(/\D/g, '').length < 10) errs.push('Medicare number should have 10–11 digits')
    if (!existingHouseholdId && !h.suburb.trim()) errs.push('Suburb is required (or "No fixed address")')
    for (const f of customFields) if (f.required && isEmptyExtra(f, c.extra[f.key])) errs.push(`${f.label} is required`)
    members.forEach((m, i) => {
      if (!m.firstName.trim() || !m.dob) errs.push(`Household member ${i + 1}: first name and date of birth are required`)
    })
    if (dups.length && !notDuplicate) errs.push('Possible duplicate found: open the existing record, or tick "This is a different person"')
    setErrors(errs)
    if (errs.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    let clean: ClientInput = {
      ...c,
      firstName: c.firstName.trim(),
      lastName: c.lastName.trim(),
      consentDate: c.consentGiven ? c.consentDate || today() : '',
      consentSignature: c.consentMethod === 'Signed on screen' ? c.consentSignature : '',
    }
    if (lockedForMe && original) {
      clean = {
        ...clean,
        disabilityNotes: original.disabilityNotes,
        riskNotes: original.riskNotes,
        crn: original.crn,
        medicareNo: original.medicareNo,
        licenceNo: original.licenceNo,
        extra: { ...original.extra, ...clean.extra },
      }
    }

    saving.current = true
    if (editing && id) {
      await updateClient(id, clean, session)
      if (existingHouseholdId) await updateHousehold(existingHouseholdId, h, session)
      toast({ text: 'Changes saved on this device' })
      navigate(`/client/${id}`)
      return
    }

    let householdId = existingHouseholdId
    if (!householdId) {
      const hh = await createHousehold({ ...h, name: h.name.trim() || `${clean.lastName} household` }, session)
      householdId = hh.id
    }
    const created = await createClient({ ...clean, householdId, relationship: existingHouseholdId ? clean.relationship : 'Primary' }, session)
    // Bulk family entry: everyone else in the household in the same step
    for (const m of members) {
      await createClient(
        {
          ...EMPTY_CLIENT,
          firstName: m.firstName.trim(),
          lastName: (m.lastName || clean.lastName).trim(),
          dob: m.dob,
          gender: m.gender,
          relationship: m.relationship,
          householdId,
          countryOfBirth: clean.countryOfBirth,
          culturalBackground: clean.culturalBackground,
          languages: clean.languages,
          interpreterNeeded: clean.interpreterNeeded,
          indigenousStatus: clean.indigenousStatus,
          incomeSource: m.relationship === 'Partner' ? '' : 'No income',
          consentGiven: clean.consentGiven,
          consentDate: clean.consentDate,
          consentMethod: clean.consentMethod === 'Signed on screen' ? 'Verbal' : clean.consentMethod,
          privacyAcknowledged: clean.privacyAcknowledged,
        },
        session,
      )
    }
    saveDraft(null)
    toast({ text: `${fullName(created)} registered (${created.clientNo})${members.length ? ` with ${members.length} household member${members.length > 1 ? 's' : ''}` : ''}` })
    navigate(`/client/${created.id}`)
  }

  if (!loaded) return <div className="page muted">Loading…</div>

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>{editing ? `Edit ${fullName(c)}` : existingHouseholdId ? `Add member to ${h.name}` : 'Register new client'}</h1>
        <Link to={editing ? `/client/${id}` : '/'} className="btn btn-ghost">
          Cancel
        </Link>
      </div>

      {restoredDraft && (
        <div className="alert alert-info">
          Restored an unsaved registration from earlier.
          <button
            className="btn btn-small btn-ghost"
            onClick={() => {
              saveDraft(null)
              setC(EMPTY_CLIENT)
              setH(EMPTY_HOUSEHOLD)
              setMembers([])
              setRestoredDraft(false)
            }}
          >
            Discard draft
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="alert alert-error" role="alert">
          <strong>Please fix:</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {dups.length > 0 && (
        <div className="alert alert-warn" role="alert">
          <strong>Possible duplicate{dups.length > 1 ? 's' : ''} already on this device</strong>
          <ul className="dup-list">
            {dups.map((d) => (
              <li key={d.client.id}>
                <span>
                  <b>{fullName(d.client)}</b> · DOB {fmtDate(d.client.dob)} · {d.client.phone || 'no phone'} · {d.client.clientNo} · {d.client.site}
                  <span className="muted"> — {d.reasons.join(', ')} ({Math.round(d.score * 100)}% match)</span>
                </span>
                <Link className="btn btn-small" to={`/client/${d.client.id}`}>
                  Open existing
                </Link>
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={notDuplicate} onChange={(e) => setNotDuplicate(e.target.checked)} /> This is a different person
          </label>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Section title="Person" tour="reg-person">
          <div className="grid">
            <Field label="First name *">
              <input value={c.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus={!editing} />
            </Field>
            <Field label="Last name *">
              <input value={c.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </Field>
            <Field label="Preferred name">
              <input value={c.preferredName} onChange={(e) => set('preferredName', e.target.value)} />
            </Field>
            <Field label={`Date of birth *${c.dob && age(c.dob) !== null ? ` (age ${age(c.dob)})` : ''}`}>
              <input type="date" value={c.dob} max={today()} onChange={(e) => set('dob', e.target.value)} />
            </Field>
            <Group label="Gender *">
              <Choice options={GENDERS} value={c.gender} onChange={(v) => set('gender', v)} />
            </Group>
            {existingHouseholdId && (
              <Field label="Relationship in household">
                <select value={c.relationship} onChange={(e) => set('relationship', e.target.value as Relationship)}>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid">
            <Field label="Phone">
              <input type="tel" value={c.phone} onChange={(e) => set('phone', e.target.value)} placeholder="04xx xxx xxx" />
            </Field>
            <Field label="Email">
              <input type="email" value={c.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title={existingHouseholdId ? `Household: ${h.name}` : 'Household (new)'} tour="reg-household">
          {!editing && !existingHouseholdId && (
            <p className="muted small">
              Is their partner or family already a client? Open that person's record and use <b>Add household member</b> instead.
            </p>
          )}
          <div className="grid">
            <Field label="Address">
              <input value={h.address} onChange={(e) => setHh('address', e.target.value)} placeholder="Street address or 'No fixed address'" />
            </Field>
            <Field label="Suburb *">
              <input value={h.suburb} onChange={(e) => setHh('suburb', e.target.value)} />
            </Field>
            <Field label="Postcode">
              <input inputMode="numeric" maxLength={4} value={h.postcode} onChange={(e) => setHh('postcode', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Housing situation">
              <select value={h.housingSituation} onChange={(e) => setHh('housingSituation', e.target.value)}>
                <option value="">—</option>
                {HOUSING.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          {existingHouseholdId && <p className="muted small">Changes to the address apply to everyone in this household.</p>}

          {!editing && !existingHouseholdId && (
            <div className="members">
              <h3>Other people in the household</h3>
              <p className="muted small">Add partner, children and dependents now. They share this address, background and consent.</p>
              {members.map((m, i) => (
                <div key={i} className="member-row">
                  <input placeholder="First name" aria-label={`Member ${i + 1} first name`} value={m.firstName} onChange={(e) => setMember(i, { firstName: e.target.value })} />
                  <input placeholder={c.lastName || 'Last name'} aria-label={`Member ${i + 1} last name`} value={m.lastName} onChange={(e) => setMember(i, { lastName: e.target.value })} />
                  <input type="date" max={today()} aria-label={`Member ${i + 1} date of birth`} value={m.dob} onChange={(e) => setMember(i, { dob: e.target.value })} />
                  <select aria-label={`Member ${i + 1} gender`} value={m.gender} onChange={(e) => setMember(i, { gender: e.target.value })}>
                    <option value="">Gender</option>
                    {GENDERS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  <select aria-label={`Member ${i + 1} relationship`} value={m.relationship} onChange={(e) => setMember(i, { relationship: e.target.value as Relationship })}>
                    {RELATIONSHIPS.filter((r) => r !== 'Primary').map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="actions wrap">
                <button type="button" className="btn btn-small" onClick={() => addMember('Partner')}>
                  + Partner
                </button>
                <button type="button" className="btn btn-small" onClick={() => addMember('Child')}>
                  + Child
                </button>
                <button type="button" className="btn btn-small" onClick={() => addMember('Dependent')}>
                  + Other dependent
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Background">
          <div className="grid">
            <Field label="Country of birth">
              <input value={c.countryOfBirth} onChange={(e) => set('countryOfBirth', e.target.value)} list="countries" />
            </Field>
            <Field label="Cultural background">
              <input value={c.culturalBackground} onChange={(e) => set('culturalBackground', e.target.value)} />
            </Field>
            <Field label="Languages spoken">
              <input value={c.languages} onChange={(e) => set('languages', e.target.value)} />
            </Field>
            <Field label="Aboriginal / Torres Strait Islander">
              <select value={c.indigenousStatus} onChange={(e) => set('indigenousStatus', e.target.value)}>
                <option value="">—</option>
                {INDIGENOUS_STATUS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={c.interpreterNeeded} onChange={(e) => set('interpreterNeeded', e.target.checked)} /> Interpreter needed
          </label>
          <datalist id="countries">
            {['Australia', 'Afghanistan', 'China', 'England', 'India', 'Italy', 'Nepal', 'New Zealand', 'Nigeria', 'Philippines', 'South Sudan', 'Sudan', 'Vietnam'].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Section>

        <Section title="Circumstances">
          <div className="grid">
            <Field label="Main income source">
              <select value={c.incomeSource} onChange={(e) => set('incomeSource', e.target.value)}>
                <option value="">—</option>
                {INCOME_SOURCES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Concession card">
              <select value={c.concessionCard} onChange={(e) => set('concessionCard', e.target.value)}>
                <option value="">—</option>
                {CONCESSION_CARDS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={c.hasDisability} onChange={(e) => set('hasDisability', e.target.checked)} /> Has disability or impairment
          </label>
          {c.hasDisability &&
            (lockedForMe ? (
              <p className="muted small">Disability details are restricted. Ask a staff member if they need updating.</p>
            ) : (
              <Field label="Disability / impairment notes (restricted)">
                <input value={c.disabilityNotes} onChange={(e) => set('disabilityNotes', e.target.value)} placeholder="Only what's needed to support the person" />
              </Field>
            ))}
        </Section>

        <Section title="Identity documents (restricted)">
          {lockedForMe ? (
            <dl className="facts">
              <dt>Centrelink CRN</dt>
              <dd>{mask(c.crn) || '—'}</dd>
              <dt>Medicare</dt>
              <dd>{mask(c.medicareNo) || '—'}</dd>
              <dt>Driver's licence</dt>
              <dd>{mask(c.licenceNo) || '—'}</dd>
            </dl>
          ) : (
            <>
              <p className="muted small">Optional. Only record what's needed to check eligibility. Volunteers see only the last 3 characters.</p>
              <div className="grid">
                <Field label="Centrelink CRN">
                  <input value={c.crn} onChange={(e) => set('crn', e.target.value.toUpperCase())} placeholder="123 456 789A" autoComplete="off" />
                </Field>
                <Field label="Medicare number">
                  <input value={c.medicareNo} onChange={(e) => set('medicareNo', e.target.value)} inputMode="numeric" autoComplete="off" />
                </Field>
                <Field label="Driver's licence">
                  <input value={c.licenceNo} onChange={(e) => set('licenceNo', e.target.value.toUpperCase())} autoComplete="off" />
                </Field>
              </div>
            </>
          )}
        </Section>

        {customFields.length > 0 && (
          <Section title="More details">
            <div className="grid">
              {customFields.map((f) => (
                <CustomFieldInput key={f.id} field={f} value={c.extra[f.key]} onChange={(v) => setExtra(f.key, v)} />
              ))}
            </div>
          </Section>
        )}

        <Section title="Consent & alerts" tour="reg-consent">
          <div className="consent-box">
            <label className="check check-lg">
              <input
                type="checkbox"
                checked={c.consentGiven}
                onChange={(e) => {
                  set('consentGiven', e.target.checked)
                  if (e.target.checked && !c.consentDate) set('consentDate', today())
                }}
              />{' '}
              Consent given to collect and store information *
            </label>
            {c.consentGiven && (
              <>
                <div className="grid">
                  <Group label="How was consent given? *">
                    <Choice options={[...CONSENT_METHODS]} value={c.consentMethod} onChange={(v) => set('consentMethod', v as ConsentMethod)} />
                  </Group>
                  <Field label="Consent date">
                    <input type="date" value={c.consentDate} max={today()} onChange={(e) => set('consentDate', e.target.value)} />
                  </Field>
                </div>
                {c.consentMethod === 'Signed on screen' && <SignaturePad value={c.consentSignature} onChange={(v) => set('consentSignature', v)} />}
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={c.privacyAcknowledged} onChange={(e) => set('privacyAcknowledged', e.target.checked)} /> Privacy statement explained
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={c.riskFlag} onChange={(e) => set('riskFlag', e.target.checked)} /> Alert / vulnerability flag
          </label>
          {c.riskFlag &&
            (lockedForMe ? (
              <p className="muted small">Alert details are restricted to staff.</p>
            ) : (
              <Field label="Alert notes (restricted — shown to staff on the client record)">
                <input value={c.riskNotes} onChange={(e) => set('riskNotes', e.target.value)} />
              </Field>
            ))}
          <Field label="General notes">
            <textarea rows={3} value={c.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </Section>

        <div className="form-actions" data-tour="reg-save">
          <button type="submit" className="btn btn-primary btn-lg">
            {editing ? 'Save changes' : members.length ? `Register ${members.length + 1} people` : 'Register client'}
          </button>
          <span className="muted small">
            Saves on this device instantly and works offline.{!editing && !joinHouseholdId ? ' Unsaved work is kept as a draft.' : ''}
          </span>
        </div>
      </form>
    </div>
  )
}

function Section({ title, tour, children }: { title: string; tour?: string; children: ReactNode }) {
  return (
    <fieldset className="card section" data-tour={tour}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** A labelled group of buttons (not a <label>, so clicking the text doesn't press a button). */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span>{label}</span>
      {children}
    </div>
  )
}

/** Big tap-friendly buttons instead of a dropdown for short lists. */
function Choice({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o} role="radio" aria-checked={value === o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}
