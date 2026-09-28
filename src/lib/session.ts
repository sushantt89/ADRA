import type { Session } from '../db/types'

// Remembers who is signed in on this device. After a reload the app shows the
// lock screen, so a PIN is always needed to get back in.
const KEY = 'adra-session-v2'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as Session) : null
    return s && s.userId && s.role ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}
