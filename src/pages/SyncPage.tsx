import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta } from '../db/db'
import { updateClient, updateHousehold, type ClientInput, type HouseholdInput } from '../db/repo'
import type { Conflict } from '../db/types'
import { useCan, useOnline, useSession, useToast } from '../lib/context'
import { fmtDateTime } from '../lib/format'
import { runSync } from '../sync/sync'
import { serverStats, simulateOtherSite } from '../sync/mockServer'
import { useAutoTour } from '../components/Tour'

const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone', email: 'Email', firstName: 'First name', lastName: 'Last name', dob: 'Date of birth', address: 'Address', suburb: 'Suburb',
  postcode: 'Postcode', notes: 'Notes', incomeSource: 'Income source', languages: 'Languages', riskNotes: 'Alert notes',
}

const show = (v: unknown) => (v === '' || v == null ? '(blank)' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function SyncPage() {
  const { session } = useSession()
  const can = useCan()
  const online = useOnline()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  useAutoTour('sync')

  const status = useLiveQuery(async () => {
    const pending = {
      clients: await db.clients.where('syncStatus').equals('pending').count(),
      households: await db.households.where('syncStatus').equals('pending').count(),
      services: await db.services.where('syncStatus').equals('pending').count(),
      audit: await db.audit.where('syncStatus').equals('pending').count(),
    }
    return { pending, lastSyncAt: await getMeta<string>('lastSyncAt', '') }
  }, [])
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), []) ?? []
  const open = conflicts.filter((c) => !c.resolved)
  const names = useLiveQuery(async () => {
    const m = new Map<string, string>()
    for (const c of open) {
      if (c.entity === 'client') {
        const x = await db.clients.get(c.entityId)
        if (x) m.set(c.entityId, `${x.firstName} ${x.lastName}`)
      } else if (c.entity === 'household') {
        const x = await db.households.get(c.entityId)
        if (x) m.set(c.entityId, x.name)
      }
    }
    return m
  }, [open.length])
  const server = useLiveQuery(() => serverStats(), [status?.lastSyncAt, log.length])

  const sync = async () => {
    setBusy(true)
    try {
      const r = await runSync(session)
      setLog((l) => [`${new Date().toLocaleTimeString()} — sent ${r.pushed}, received ${r.pulled}, conflicts ${r.conflicts}`, ...l])
    } catch (e) {
      toast({ text: `Sync failed: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (c: Conflict, keep: 'server' | 'local') => {
    if (keep === 'local') {
      // Re-apply this device's value as a new edit; it wins on the next sync
      if (c.entity === 'client') await updateClient(c.entityId, { [c.field]: c.localValue } as Partial<ClientInput>, session)
      if (c.entity === 'household') await updateHousehold(c.entityId, { [c.field]: c.localValue } as Partial<HouseholdInput>, session)
    }
    await db.conflicts.update(c.id, { resolved: true, resolution: keep === 'local' ? 'kept-local' : 'kept-server', resolvedBy: session.userName })
    toast({ text: keep === 'local' ? 'Kept your value. It will be sent on the next sync.' : 'Kept the server value' })
  }

  const pendingTotal = status ? status.pending.clients + status.pending.households + status.pending.services : 0

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Sync</h1>
        <button className="btn btn-primary" onClick={sync} disabled={!online || busy}>
          {busy ? 'Syncing…' : online ? 'Sync now' : 'Offline — sync unavailable'}
        </button>
      </div>

      <div className="kpis" data-tour="sync-status">
        <div className="kpi card">
          <div className="kpi-value">{pendingTotal}</div>
          <div className="kpi-label">Records waiting to send</div>
        </div>
        <div className="kpi card">
          <div className="kpi-value">{open.length}</div>
          <div className="kpi-label">Conflicts to review</div>
        </div>
        <div className="kpi card">
          <div className="kpi-value kpi-small">{status?.lastSyncAt ? fmtDateTime(status.lastSyncAt) : 'Never'}</div>
          <div className="kpi-label">Last sync</div>
        </div>
      </div>

      {status && pendingTotal > 0 && (
        <p className="muted small">
          Waiting: {status.pending.clients} clients, {status.pending.households} households, {status.pending.services} services, {status.pending.audit} history entries.
          They're safe on this device and send automatically when online.
        </p>
      )}

      <section className="card" data-tour="conflicts">
        <h2>Conflicts</h2>
        <p className="muted small">
          A conflict happens when the same detail was changed on this device and at another site before they synced. Everything else is merged automatically.
        </p>
        {!open.length && <p className="muted">No conflicts.</p>}
        {open.map((c) => (
          <div key={c.id} className="conflict">
            <div>
              <b>{names?.get(c.entityId) ?? c.entity}</b> — {FIELD_LABELS[c.field] ?? c.field}
              <div className="muted small">
                Detected {fmtDateTime(c.at)} · other change by {c.serverUpdatedBy || 'another site'}
              </div>
            </div>
            <div className="conflict-values">
              <div>
                <span className="muted small">This device</span>
                <b>{show(c.localValue)}</b>
              </div>
              <div>
                <span className="muted small">Server (kept for now)</span>
                <b>{show(c.serverValue)}</b>
              </div>
            </div>
            <div className="actions">
              {can('resolveConflicts') ? (
                <>
                  <button className="btn btn-small" onClick={() => resolve(c, 'local')}>
                    Use this device's value
                  </button>
                  <button className="btn btn-small" onClick={() => resolve(c, 'server')}>
                    Keep server value
                  </button>
                </>
              ) : (
                <span className="muted small">A coordinator will review this.</span>
              )}
              {c.entity === 'client' && (
                <Link className="btn btn-small btn-ghost" to={`/client/${c.entityId}`}>
                  Open record
                </Link>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Prototype test tools</h2>
        <p className="muted small">
          There's no real cloud server yet. Sync talks to a pretend server stored in this browser
          {server ? ` (holding ${server.clients} clients, ${server.households} households, ${server.services} services, ${server.audit} history entries)` : ''}.
        </p>
        <p className="small">
          Try it: edit a client's phone number, then press the button below. It changes the same client's phone "at Salisbury". Then press Sync now: you'll get a
          conflict to review, and a new near-duplicate client appears on the Duplicates page.
        </p>
        <button
          className="btn"
          disabled={!online}
          onClick={async () => {
            try {
              // Target the client most recently edited on this device, to show a conflict
              const pending = await db.clients.where('syncStatus').equals('pending').toArray()
              const recent = pending.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
              const notes = await simulateOtherSite(recent?.id)
              setLog((l) => [...notes.map((n) => `${new Date().toLocaleTimeString()} — ${n}`), ...l])
            } catch (e) {
              toast({ text: (e as Error).message })
            }
          }}
        >
          Simulate changes from another site
        </button>
        {log.length > 0 && (
          <ul className="small log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
