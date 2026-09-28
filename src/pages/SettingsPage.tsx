import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { exportAll } from '../db/repo'
import { loadDemoData } from '../db/demo'
import { useCan, useOnline, useSession, useToast } from '../lib/context'
import { download } from '../lib/format'
import { logEvent } from '../lib/auth'

export default function SettingsPage() {
  const { session } = useSession()
  const can = useCan()
  const toast = useToast()
  const online = useOnline()
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const counts = useLiveQuery(async () => ({
    clients: await db.clients.count(),
    households: await db.households.count(),
    services: await db.services.count(),
    audit: await db.audit.count(),
  }), [])

  const refreshStorage = async () => {
    if (!navigator.storage?.estimate) return
    const est = await navigator.storage.estimate()
    const persisted = (await navigator.storage.persisted?.()) ?? false
    setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted })
  }
  useEffect(() => {
    refreshStorage()
  }, [counts])

  const swActive = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller

  return (
    <div className="page narrow">
      <h1>This device</h1>

      <section className="card">
        <h2>Status</h2>
        <dl className="facts">
          <dt>Signed in</dt>
          <dd>
            {session.userName} at {session.site}
          </dd>
          <dt>Connection</dt>
          <dd>{online ? 'Online' : 'Offline'}</dd>
          <dt>Offline app</dt>
          <dd>{swActive ? 'Saved on this device — opens without internet' : 'Not saved yet. Reload once while online.'}</dd>
          <dt>Records stored here</dt>
          <dd>
            {counts ? `${counts.clients} clients · ${counts.households} households · ${counts.services} services · ${counts.audit} audit entries` : '…'}
          </dd>
          {storage && (
            <>
              <dt>Storage used</dt>
              <dd>
                {(storage.usage / 1024 / 1024).toFixed(1)} MB of {(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB available
              </dd>
              <dt>Protected storage</dt>
              <dd>
                {storage.persisted ? (
                  'Yes — the browser won’t clear this data automatically'
                ) : (
                  <>
                    No{' '}
                    <button
                      className="btn btn-small"
                      onClick={async () => {
                        const ok = await navigator.storage.persist?.()
                        toast({ text: ok ? 'Storage protected' : 'The browser declined. Installing the app usually allows it.' })
                        refreshStorage()
                      }}
                    >
                      Protect data on this device
                    </button>
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="card">
        <h2>Data</h2>
        <div className="actions wrap">
          {can('admin') && (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const pins = await loadDemoData(session)
                  toast({ text: `Demo data loaded. Demo sign-ins: ${pins}` })
                } catch (e) {
                  toast({ text: (e as Error).message })
                } finally {
                  setBusy(false)
                }
              }}
            >
              Load demo data
            </button>
          )}
          {can('export') && (
            <button
              className="btn"
              onClick={async () => {
                const data = await exportAll()
                await logEvent(session, 'config', 'backup', 'export', { records: { from: null, to: data.clients.length } })
                download(`client-portal-backup-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')
              }}
            >
              Download backup (JSON)
            </button>
          )}
          {!can('admin') && !can('export') && <p className="muted small">Your role has no data tools on this page.</p>}
        </div>
        {can('admin') && (
          <p className="muted small">
            Demo data adds fictional clients plus three demo sign-ins: <b>Alex</b> (Volunteer, PIN 1111), <b>Sam</b> (Staff, 2222) and <b>Chris</b> (Coordinator, 3333).
          </p>
        )}
      </section>

      <section className="card">
        <h2>About this prototype</h2>
        <ul className="small">
          <li>Everything is stored only in this browser on this device (IndexedDB). There is no server yet.</li>
          <li>Sync talks to a pretend cloud server that lives in this browser. The live system swaps it for a real cloud database (e.g. Supabase in Sydney) with PowerSync.</li>
          <li>Use fictional test data only. Do not enter real client information into the prototype.</li>
        </ul>
      </section>
    </div>
  )
}
