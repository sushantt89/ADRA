import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, setMeta } from '../db/db'
import { mergeClients, scanDuplicates } from '../db/repo'
import type { Client } from '../db/types'
import { useSession, useToast } from '../lib/context'
import { fmtDate, fullName } from '../lib/format'

// Cross-site duplicate review. Registration already warns about duplicates
// on this device; this catches ones created at other sites or while offline.

export default function DuplicatesPage() {
  const { session } = useSession()
  const toast = useToast()
  const clients = useLiveQuery(() => db.clients.toArray(), [])
  const serviceCounts = useLiveQuery(async () => {
    const m = new Map<string, number>()
    await db.services.each((s) => {
      if (!s.deleted) m.set(s.clientId, (m.get(s.clientId) ?? 0) + 1)
    })
    return m
  }, [])
  // Pairs marked as different people are remembered on this device
  const dismissedList = useLiveQuery(() => getMeta<string[]>('notDuplicates', []), []) ?? []
  const dismissed = new Set(dismissedList)
  const pairs = useMemo(() => (clients ? scanDuplicates(clients) : []), [clients])
  const shown = pairs.filter((p) => !dismissed.has(`${p.a.id}|${p.b.id}`))

  const merge = async (keep: Client, remove: Client) => {
    if (!window.confirm(`Merge ${remove.clientNo} into ${keep.clientNo}? Services move to ${keep.clientNo} and ${remove.clientNo} is archived. This is recorded in the history.`)) return
    await mergeClients(keep.id, remove.id, session)
    toast({ text: `Merged ${remove.clientNo} into ${keep.clientNo}` })
  }

  const Person = ({ c }: { c: Client }) => (
    <div className="dup-person">
      <Link to={`/client/${c.id}`}>
        <b>{fullName(c)}</b>
      </Link>
      <div className="small">
        {c.clientNo} · DOB {fmtDate(c.dob)} · {c.phone || 'no phone'}
      </div>
      <div className="muted small">
        Registered at {c.site} by {c.createdBy} · {serviceCounts?.get(c.id) ?? 0} services
      </div>
    </div>
  )

  return (
    <div className="page narrow">
      <h1>Possible duplicates</h1>
      <p className="muted">
        Checks every client on this device, including records from other sites that arrived by sync. Compare the two records, then merge them or mark them as different
        people.
      </p>
      {clients === undefined && <p className="muted">Checking…</p>}
      {clients && !shown.length && (
        <div className="card empty">
          <p>No likely duplicates found.</p>
        </div>
      )}
      {shown.map((p) => (
        <div key={`${p.a.id}|${p.b.id}`} className="card dup-pair">
          <div className="dup-head">
            <span className="tag tag-warn">{Math.round(p.score * 100)}% match</span>
            <span className="muted small">{p.reasons.join(', ')}</span>
          </div>
          <div className="dup-cols">
            <div>
              <Person c={p.a} />
              <button className="btn btn-small" onClick={() => merge(p.a, p.b)}>
                Keep this one
              </button>
            </div>
            <div>
              <Person c={p.b} />
              <button className="btn btn-small" onClick={() => merge(p.b, p.a)}>
                Keep this one
              </button>
            </div>
          </div>
          <button className="btn btn-small btn-ghost" onClick={() => setMeta('notDuplicates', [...dismissedList, `${p.a.id}|${p.b.id}`])}>
            Different people — hide
          </button>
        </div>
      ))}
    </div>
  )
}
