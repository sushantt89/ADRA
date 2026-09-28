import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getConfig } from '../db/db'
import type { Session, User } from '../db/types'
import { checkPin, createUser, logEvent, validPin } from '../lib/auth'
import { DEFAULT_CONFIG } from '../db/options'
import { ADRA_LOGO } from '../lib/branding'

type Props = {
  onSignIn: (s: Session) => void
  /** When set, the screen is a lock screen for this signed-in session. */
  locked?: Session
  onSwitchUser?: () => void
}

export default function SignIn({ onSignIn, locked, onSwitchUser }: Props) {
  const users = useLiveQuery(() => db.users.toArray(), [])
  const config = useLiveQuery(() => getConfig(), []) ?? DEFAULT_CONFIG
  const active = (users ?? []).filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name))

  if (users === undefined) return null
  if (!users.length) return <FirstRun sites={config.sites} onDone={onSignIn} />

  return (
    <div className="signin">
      <PinForm users={active} sites={config.sites} locked={locked} onSignIn={onSignIn} onSwitchUser={onSwitchUser} orgName={config.orgName} />
    </div>
  )
}

function Brand({ orgName, sub }: { orgName: string; sub: string }) {
  return (
    <div className="signin-brand">
      <img src={ADRA_LOGO} alt={orgName} className="signin-logo" />
      <div className="muted">{sub}</div>
    </div>
  )
}

function PinForm({
  users,
  sites,
  locked,
  onSignIn,
  onSwitchUser,
  orgName,
}: {
  users: User[]
  sites: string[]
  locked?: Session
  onSignIn: (s: Session) => void
  onSwitchUser?: () => void
  orgName: string
}) {
  const [userId, setUserId] = useState(locked?.userId ?? '')
  const [site, setSite] = useState(locked?.site ?? '')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const user = users.find((u) => u.id === userId)

  useEffect(() => {
    if (user && !locked) setSite(user.homeSite)
  }, [user, locked])

  const submit = async () => {
    if (!user) return setError('Choose your name')
    if (attempts >= 5) return setError('Too many attempts. Ask a coordinator to reset your PIN.')
    if (!(await checkPin(user, pin))) {
      setAttempts((a) => a + 1)
      setPin('')
      return setError('Wrong PIN')
    }
    const s: Session = { userId: user.id, userName: user.name, role: user.role, site: site || user.homeSite }
    if (!locked) await logEvent(s, 'session', user.id, 'login', { site: { from: null, to: s.site } })
    onSignIn(s)
  }

  return (
    <form
      className="card signin-card"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Brand orgName={orgName} sub={locked ? 'Locked — enter your PIN to continue' : 'Sign in to start your shift'} />
      {locked ? (
        <p>
          Signed in as <b>{locked.userName}</b> at {locked.site}
        </p>
      ) : (
        <>
          <div className="field">
            <span>Who are you?</span>
            <div className="user-grid">
              {users.map((u) => (
                <button type="button" key={u.id} className={`user-tile ${u.id === userId ? 'on' : ''}`} onClick={() => setUserId(u.id)}>
                  <b>{u.name}</b>
                  <span className="muted small">{u.role}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Site</span>
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              {!site && <option value="">—</option>}
              {sites.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="field">
        <span>PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={!!locked}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''))
            setError('')
          }}
          maxLength={8}
          className="pin-input"
          aria-label="PIN"
        />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={!userId || pin.length < 4}>
        {locked ? 'Unlock' : 'Start shift'}
      </button>
      {locked && onSwitchUser && (
        <button type="button" className="btn btn-ghost btn-block" onClick={onSwitchUser}>
          Not {locked.userName}? Sign out
        </button>
      )}
      {import.meta.env.VITE_TEST_BANNER !== 'off' && (
        <div className="alert alert-warn small">Test version: use made-up details only. Anything you enter stays in this browser on this device.</div>
      )}
      <p className="muted small">Prototype sign-in with a PIN stored on this device. The live system adds passwords and multi-factor authentication.</p>
    </form>
  )
}

function FirstRun({ sites, onDone }: { sites: string[]; onDone: (s: Session) => void }) {
  const [name, setName] = useState('')
  const [site, setSite] = useState(sites[0])
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')

  return (
    <div className="signin">
      <form
        className="card signin-card"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return setError('Enter your name')
          if (!validPin(pin)) return setError('PIN must be 4–8 digits')
          if (pin !== pin2) return setError('PINs do not match')
          const u = await createUser(name, 'Admin', site, pin)
          const s: Session = { userId: u.id, userName: u.name, role: u.role, site }
          await logEvent(s, 'session', u.id, 'login', { site: { from: null, to: site } })
          onDone(s)
        }}
      >
        <Brand orgName="ADRA" sub="First-time setup on this device" />
        <p className="small">Create the first administrator. You can add staff and volunteers afterwards in Admin.</p>
        {import.meta.env.VITE_TEST_BANNER !== 'off' && (
          <div className="alert alert-warn small">Test version: use made-up details only. Anything you enter stays in this browser on this device.</div>
        )}
        <label className="field">
          <span>Your name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Home site</span>
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="grid">
          <label className="field">
            <span>Choose a PIN (4–8 digits)</span>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} />
          </label>
          <label className="field">
            <span>Repeat PIN</span>
            <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} maxLength={8} />
          </label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" type="submit">
          Create administrator
        </button>
      </form>
    </div>
  )
}
