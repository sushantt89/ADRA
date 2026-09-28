import { useEffect, useRef, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { SessionContext, ToastProvider, useConfig } from './lib/context'
import { loadSession, saveSession } from './lib/session'
import { logEvent } from './lib/auth'
import { can } from './lib/permissions'
import type { Session } from './db/types'
import Layout from './components/Layout'
import SignIn from './pages/SignIn'
import SearchPage from './pages/SearchPage'
import ClientForm from './pages/ClientForm'
import ClientPage from './pages/ClientPage'
import DocketPage from './pages/DocketPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import SyncPage from './pages/SyncPage'
import DuplicatesPage from './pages/DuplicatesPage'
import HelpPage from './pages/HelpPage'
import { TourProvider } from './components/Tour'

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  // A remembered session always starts locked, so a reload needs the PIN
  const [locked, setLocked] = useState(() => !!loadSession())
  const config = useConfig()
  const lastActivity = useRef(Date.now())
  const navigate = useNavigate()

  // Auto-lock after the configured idle time
  useEffect(() => {
    if (!session || locked) return
    const bump = () => (lastActivity.current = Date.now())
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > config.autoLockMinutes * 60_000) setLocked(true)
    }, 15_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(timer)
    }
  }, [session, locked, config.autoLockMinutes])

  const signOut = async () => {
    if (session) await logEvent(session, 'session', session.userId, 'logout')
    saveSession(null)
    setSession(null)
    setLocked(false)
    // The next person starts on the search screen, not on a page from the last shift
    navigate('/', { replace: true })
  }

  if (!session || locked) {
    return (
      <SignIn
        locked={locked && session ? session : undefined}
        onSwitchUser={signOut}
        onSignIn={(s) => {
          saveSession(s)
          setSession(s)
          setLocked(false)
          lastActivity.current = Date.now()
        }}
      />
    )
  }

  return (
    <SessionContext.Provider value={{ session, signOut, lock: () => setLocked(true) }}>
      <ToastProvider>
        <TourProvider session={session}>
        <Routes>
          <Route path="/client/:id/docket" element={<DocketPage />} />
          <Route element={<Layout />}>
            <Route index element={<SearchPage />} />
            <Route path="/new" element={<ClientForm />} />
            <Route path="/client/:id" element={<ClientPage />} />
            <Route path="/client/:id/edit" element={<ClientForm />} />
            <Route path="/reports" element={can(session.role, 'viewReports') ? <ReportsPage /> : <NoAccess />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/duplicates" element={can(session.role, 'mergeClients') ? <DuplicatesPage /> : <NoAccess />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/admin" element={can(session.role, 'admin') ? <AdminPage /> : <NoAccess />} />
            <Route path="*" element={<SearchPage />} />
          </Route>
        </Routes>
        </TourProvider>
      </ToastProvider>
    </SessionContext.Provider>
  )
}

function NoAccess() {
  return (
    <div className="page narrow">
      <div className="card empty">
        <p>Your role doesn't have access to this page.</p>
      </div>
    </div>
  )
}
