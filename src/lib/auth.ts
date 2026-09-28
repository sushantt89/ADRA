import { db } from '../db/db'
import { now, uuid } from '../db/repo'
import type { Role, Session, User } from '../db/types'

// PROTOTYPE LOGIN: users and hashed PINs live on this device so sign-in works
// offline. The real system uses a cloud identity provider (Supabase Auth or
// Microsoft Entra ID) with passwords + MFA, and caches a short-lived offline
// session on the device.

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPin(pin: string, salt: string) {
  return sha256(`${salt}:${pin}`)
}

export function validPin(pin: string) {
  return /^\d{4,8}$/.test(pin)
}

export async function createUser(name: string, role: Role, homeSite: string, pin: string, by?: Session): Promise<User> {
  if (!validPin(pin)) throw new Error('PIN must be 4–8 digits')
  const pinSalt = uuid()
  const user: User = { id: uuid(), name: name.trim(), role, homeSite, pinSalt, pinHash: await hashPin(pin, pinSalt), active: true, createdAt: now() }
  await db.users.add(user)
  await logEvent(by ?? { userId: user.id, userName: user.name, role, site: homeSite }, 'user', user.id, 'create', { name: { from: null, to: user.name }, role: { from: null, to: role } })
  return user
}

export async function setPin(userId: string, pin: string) {
  if (!validPin(pin)) throw new Error('PIN must be 4–8 digits')
  const pinSalt = uuid()
  await db.users.update(userId, { pinSalt, pinHash: await hashPin(pin, pinSalt) })
}

export async function checkPin(user: User, pin: string) {
  return (await hashPin(pin, user.pinSalt)) === user.pinHash
}

export async function logEvent(
  s: Session,
  entity: 'session' | 'user' | 'config',
  entityId: string,
  action: 'login' | 'logout' | 'create' | 'update' | 'export',
  changes: Record<string, { from: unknown; to: unknown }> = {},
) {
  await db.audit.add({ id: uuid(), at: now(), user: s.userName, site: s.site, entity, entityId, action, changes, syncStatus: 'pending' })
}
