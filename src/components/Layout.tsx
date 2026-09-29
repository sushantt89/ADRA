import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useCan, useOnline, useSession, useToast } from '../lib/context'
import { db } from '../db/db'
import { runSync } from '../sync/sync'
import { runDueSchedules } from '../lib/schedules'
import { ADRA_LOGO } from '../lib/branding'
import { useAutoTour } from './Tour'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

export default function Layout() {
  const { session, signOut, lock } = useSession()
  const can = useCan()
  const [syncing, setSyncing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const openConflicts = useLiveQuery(() => db.conflicts.filter((c) => !c.resolved).count(), []) ?? 0
  const online = useOnline()
  const toast = useToast()
  const navigate = useNavigate()
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null)

  const pending =
    useLiveQuery(async () => {
      const [c, h, s] = await Promise.all([
        db.clients.where('syncStatus').equals('pending').count(),
        db.households.where('syncStatus').equals('pending').count(),
        db.services.where('syncStatus').equals('pending').count(),
      ])
      return c + h + s
    }, []) ?? 0

  // Service worker: tells us when the app is saved for offline use / updated
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (offlineReady) {
      toast({ text: 'App saved on this device. It will now open without internet.' })
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady, toast])

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  // Keyboard shortcuts for experienced operators
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/new')
      } else if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        navigate('/')
        setTimeout(() => document.getElementById('search')?.focus(), 0)
      } else if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        lock()
      } else if (!typing && e.key === '/') {
        e.preventDefault()
        navigate('/')
        setTimeout(() => document.getElementById('search')?.focus(), 0)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [navigate, lock])

  const sync = async (quiet = false) => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      const r = await runSync(session)
      if (!quiet || r.conflicts) {
        const parts = [`sent ${r.pushed}`, `received ${r.pulled}`]
        if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} to review`)
        toast({ text: `Synced: ${parts.join(', ')}`, action: r.conflicts ? { label: 'Review', run: () => navigate('/sync') } : undefined })
      }
    } catch (e) {
      if (!quiet) toast({ text: `Sync failed: ${(e as Error).message}. Records stay safe on this device.` })
    } finally {
      setSyncing(false)
    }
  }

  // First sign-in: show the welcome walkthrough
  useAutoTour('welcome')

  // Scheduled reports: make any that are due, now and every 30 minutes
  const unreadReports = useLiveQuery(() => db.reportRuns.filter((r) => !r.read).count(), []) ?? 0
  useEffect(() => {
    const check = () =>
      runDueSchedules()
        .then((made) => {
          if (made.length && can('viewReports'))
            toast({ text: `New report${made.length > 1 ? 's' : ''} ready: ${made.join(', ')}`, action: { label: 'Open', run: () => navigate('/reports') } })
        })
        .catch(() => {})
    const t0 = setTimeout(check, 3000)
    const t = setInterval(check, 30 * 60_000)
    return () => {
      clearTimeout(t0)
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-sync: when the connection comes back, and every minute while online
  useEffect(() => {
    if (!online) return
    const t0 = setTimeout(() => sync(true), 1500)
    const t = setInterval(() => sync(true), 60_000)
    return () => {
      clearTimeout(t0)
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  return (
    <div className="app">
      {import.meta.env.VITE_TEST_BANNER !== 'off' && (
        <div className="test-banner" role="note">
          TEST VERSION — use made-up details only.<span className="desktop-only-inline"> Do not enter real client information.</span>
        </div>
      )}
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-logo-chip">
            <img src={ADRA_LOGO} alt="ADRA" className="brand-logo" />
          </span>
        </NavLink>
        <nav className="nav desktop-only">
          <NavLinks can={can} unreadReports={unreadReports} openConflicts={openConflicts} />
        </nav>
        <div className="status">
          <span data-tour="online" className={`pill ${online ? 'pill-ok' : 'pill-off'}`} title={online ? 'Connected' : 'No internet — records are saved on this device'}>
            <span className="dot" /> {online ? 'Online' : 'Offline'}
          </span>
          <button
            data-tour="sync"
            className={`pill pill-btn ${pending ? 'pill-warn' : ''}`}
            onClick={() => sync()}
            disabled={!online || syncing}
            title={online ? 'Send saved records to the server' : 'Connect to the internet to sync'}
          >
            {syncing ? 'Syncing…' : pending ? (
              <>
                {pending}
                <span className="desktop-only-inline"> not synced · Sync</span>
                <span className="mobile-only-inline"> to sync</span>
              </>
            ) : (
              'All synced'
            )}
          </button>
          <span className="who desktop-only-inline" title="Signed in">
            {session.userName} ({session.role}) · {session.site}
          </span>
          <button className="btn btn-small btn-ghost desktop-only-inline" onClick={lock} title="Lock screen (Alt+L)" data-tour="lock">
            Lock
          </button>
          <button className="btn btn-small btn-ghost desktop-only-inline" onClick={signOut}>
            End shift
          </button>
        </div>
      </header>

      {/* Phone: bottom tab bar within thumb reach */}
      <nav className="tabbar mobile-only" aria-label="Main">
        <NavLink to="/" end onClick={() => setMenuOpen(false)}>
          <TabIcon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" />
          <span>Search</span>
        </NavLink>
        <NavLink to="/new" onClick={() => setMenuOpen(false)} data-tour="new-client">
          <TabIcon d="M12 5v14M5 12h14" />
          <span>New client</span>
        </NavLink>
        <NavLink to="/sync" onClick={() => setMenuOpen(false)} data-tour="nav-sync">
          <TabIcon d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />
          <span>Sync</span>
          {openConflicts > 0 && <span className="tab-badge">{openConflicts}</span>}
        </NavLink>
        <button className={menuOpen ? 'active' : ''} onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} data-tour="menu">
          <TabIcon d="M4 7h16M4 12h16M4 17h16" />
          <span>Menu</span>
          {unreadReports > 0 && <span className="tab-badge">{unreadReports}</span>}
        </button>
      </nav>

      {menuOpen && (
        <div className="menu-sheet-backdrop mobile-only" onClick={() => setMenuOpen(false)}>
          <div className="menu-sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="menu-who">
              <b>{session.userName}</b>
              <span className="muted small">
                {session.role} · {session.site}
              </span>
            </div>
            <nav className="menu-links" onClick={() => setMenuOpen(false)}>
              <NavLinks can={can} unreadReports={unreadReports} openConflicts={openConflicts} />
            </nav>
            <div className="menu-actions">
              <button
                className="btn"
                onClick={() => {
                  setMenuOpen(false)
                  lock()
                }}
              >
                Lock screen
              </button>
              <button
                className="btn"
                onClick={() => {
                  setMenuOpen(false)
                  signOut()
                }}
              >
                End shift
              </button>
            </div>
          </div>
        </div>
      )}

      {(needRefresh || installEvt) && (
        <div className="banner">
          {needRefresh && (
            <>
              <span>A new version is available.</span>
              <button className="btn btn-small btn-primary" onClick={() => updateServiceWorker(true)}>
                Update now
              </button>
            </>
          )}
          {installEvt && !needRefresh && (
            <>
              <span>Install this app for reliable offline use.</span>
              <button
                className="btn btn-small btn-primary"
                onClick={async () => {
                  await installEvt.prompt()
                  setInstallEvt(null)
                }}
              >
                Install
              </button>
            </>
          )}
        </div>
      )}
      {!online && pending > 0 && (
        <div className="banner banner-warn">
          You're offline. {pending} record{pending === 1 ? ' is' : 's are'} saved on this device and will sync when you reconnect. Don't clear browser data.
        </div>
      )}

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

function NavLinks({ can, unreadReports, openConflicts }: { can: ReturnType<typeof useCan>; unreadReports: number; openConflicts: number }) {
  return (
    <>
      <NavLink to="/" end>
        Search
      </NavLink>
      <NavLink to="/new" data-tour="new-client">
        New client
      </NavLink>
      {can('viewReports') && (
        <NavLink to="/reports" data-tour="nav-reports">
          Reports{unreadReports > 0 && <span className="nav-badge">{unreadReports}</span>}
        </NavLink>
      )}
      {can('mergeClients') && (
        <NavLink to="/duplicates" data-tour="nav-duplicates">
          Duplicates
        </NavLink>
      )}
      <NavLink to="/sync">
        Sync{openConflicts > 0 && <span className="nav-badge">{openConflicts}</span>}
      </NavLink>
      {can('admin') && (
        <NavLink to="/admin" data-tour="nav-admin">
          Admin
        </NavLink>
      )}
      <NavLink to="/settings">Device</NavLink>
      <NavLink to="/help" data-tour="help">
        Help
      </NavLink>
    </>
  )
}

function TabIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}
