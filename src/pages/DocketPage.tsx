import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { today } from '../db/repo'
import { useConfig, useSession, useToast } from '../lib/context'
import { download } from '../lib/format'
import { buildDocket, loadDocket } from '../lib/docketData'
import { docketPdfBlob } from '../lib/exporters'
import DocketView from '../components/DocketView'

export default function DocketPage() {
  const { id } = useParams()
  const { session } = useSession()
  const config = useConfig()
  const toast = useToast()
  const [nextAppt, setNextAppt] = useState('')
  const [instructions, setInstructions] = useState('')

  const src = useLiveQuery(() => (id ? loadDocket(id) : null), [id])
  if (src === undefined) return <div className="page muted">Loading…</div>
  if (src === null) return <div className="page">Client not found.</div>

  const b = config.docket
  const d = buildDocket(src, config, { site: session.site, userName: session.userName, nextAppointment: nextAppt, instructions, issuedDate: today() })

  return (
    <div className="docket-page">
      {/* Receipt printers need a narrow page */}
      {b.paper === 'receipt' && <style>{'@page { size: 80mm auto; margin: 3mm; }'}</style>}
      <div className="no-print docket-toolbar">
        <Link to={`/client/${src.client.id}`} className="btn btn-ghost">
          ← Back
        </Link>
        {b.showAppointment && (
          <label className="field inline">
            <span>Next appointment</span>
            <input type="date" value={nextAppt} min={today()} onChange={(e) => setNextAppt(e.target.value)} />
          </label>
        )}
        {b.showInstructions && (
          <label className="field inline grow">
            <span>Instructions</span>
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Bring Centrelink statement next visit" />
          </label>
        )}
        <button
          className="btn"
          onClick={async () => {
            try {
              download(`docket_${d.clientNo}_${today()}.pdf`, await docketPdfBlob(d, b))
            } catch (e) {
              toast({ text: `PDF failed: ${(e as Error).message}` })
            }
          }}
        >
          Download PDF
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <DocketView d={d} b={b} />
    </div>
  )
}
