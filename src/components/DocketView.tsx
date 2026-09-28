import type { DocketBranding } from '../db/types'
import type { DocketData } from '../lib/docketData'
import { lineValue } from '../lib/docketData'
import { logoSrc } from '../lib/branding'

/** The docket itself, styled by the admin's branding settings. */
export default function DocketView({ d, b }: { d: DocketData; b: DocketBranding }) {
  return (
    <article className={`docket ${b.paper === 'receipt' ? 'docket-receipt' : ''}`} style={{ ['--docket-accent' as string]: b.colour }}>
      <header className="docket-head">
        <div className="docket-brand">
          {logoSrc(b) && <img src={logoSrc(b)} alt="" className="docket-logo" />}
          <div>
            {!(b.logo === 'builtin' && d.orgName.trim().toUpperCase() === 'ADRA') && <div className="docket-org">{d.orgName}</div>}
            {b.subtitle && <div className="small">{b.subtitle}</div>}
            <div className="small">{d.site} · Emergency relief docket</div>
          </div>
        </div>
        <div className="docket-id">{d.clientNo}</div>
      </header>

      <section>
        <h2>{d.name}</h2>
        <div className="small">
          DOB {d.dob}
          {d.area ? ` · ${d.area}` : ''}
        </div>
      </section>

      {b.showHousehold && (
        <section>
          <h3>Household ({d.members.length})</h3>
          <table className="docket-table">
            <tbody>
              {d.members.map((m, i) => (
                <tr key={i}>
                  <td>{m.name}</td>
                  <td>{m.relationship}</td>
                  <td>{m.age}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {b.showServices && (
        <section>
          <h3>Services provided {d.visitDate ? `— ${d.visitDate}` : ''}</h3>
          {d.lines.length ? (
            <table className="docket-table">
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.type}</td>
                    <td>{l.method}</td>
                    <td>{l.who}</td>
                    <td className="num">{lineValue(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small">No services recorded.</p>
          )}
        </section>
      )}

      {(b.showEligibility || b.showAppointment) && (
        <section className="docket-grid">
          {b.showEligibility && (
            <div>
              <h3>Eligibility</h3>
              <p className="small">Next eligible for assistance from: {d.nextEligible}</p>
            </div>
          )}
          {b.showAppointment && (
            <div>
              <h3>Next appointment</h3>
              <p className="small">{d.nextAppointment || '________________'}</p>
            </div>
          )}
        </section>
      )}

      {b.showInstructions && d.instructions && (
        <section>
          <h3>Instructions</h3>
          <p className="small">{d.instructions}</p>
        </section>
      )}

      {b.showSignature && (
        <section className="docket-sign">
          <div>
            <span className="sign-line" />
            <span className="small">Client signature</span>
          </div>
          <div>
            <span className="sign-line" />
            <span className="small">Staff signature</span>
          </div>
        </section>
      )}

      <footer className="docket-foot small">
        {d.issued} {d.footer}
      </footer>
    </article>
  )
}
