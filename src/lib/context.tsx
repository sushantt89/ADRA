import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AppConfig, Session } from '../db/types'
import { getConfig } from '../db/db'
import { DEFAULT_CONFIG } from '../db/options'
import { can, type Action } from './permissions'

export const SessionContext = createContext<{ session: Session; signOut: () => void; lock: () => void } | null>(null)

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside provider')
  return ctx
}

/** Permission check for the signed-in user. */
export function useCan() {
  const { session } = useSession()
  return (a: Action) => can(session.role, a)
}

/** Live admin configuration (lists, sites, custom fields…). */
export function useConfig(): AppConfig {
  return useLiveQuery(() => getConfig(), []) ?? DEFAULT_CONFIG
}

// ---------- toasts (with optional Undo) ----------

interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts((xs) => [...xs, { ...t, id }])
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 6000)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn-small btn-ghost-light"
                onClick={() => {
                  t.action!.run()
                  setToasts((xs) => xs.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ---------- online / offline ----------

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
