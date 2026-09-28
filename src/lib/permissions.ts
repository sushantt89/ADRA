import type { Role } from '../db/types'

// Who can do what. The server enforces the same rules later
// (PostgreSQL row-level security + column privileges).
const RANK: Record<Role, number> = { Volunteer: 0, Staff: 1, Coordinator: 2, Admin: 3 }

export type Action =
  | 'viewRestricted' // disability notes, alert details, ID numbers, restricted custom fields
  | 'voidService'
  | 'viewReports'
  | 'export' // CSV / Excel / PDF / backups
  | 'resolveConflicts'
  | 'mergeClients'
  | 'viewAudit'
  | 'admin' // users, sites, lists, custom fields, clear data

const MIN_ROLE: Record<Action, Role> = {
  viewRestricted: 'Staff',
  voidService: 'Staff',
  viewReports: 'Staff',
  viewAudit: 'Staff',
  export: 'Coordinator',
  resolveConflicts: 'Coordinator',
  mergeClients: 'Coordinator',
  admin: 'Admin',
}

export function can(role: Role, action: Action): boolean {
  return RANK[role] >= RANK[MIN_ROLE[action]]
}

export const ROLES: Role[] = ['Volunteer', 'Staff', 'Coordinator', 'Admin']

export const ROLE_HELP: Record<Role, string> = {
  Volunteer: 'Search, register clients, record services, print dockets. Sensitive details hidden.',
  Staff: 'Volunteer access plus sensitive details, void services, view reports and history.',
  Coordinator: 'Staff access plus exports, merging duplicates and resolving sync conflicts.',
  Admin: 'Everything, including users, sites, lists, custom fields and clearing data.',
}

/** Show only the last 3 characters of an ID number. */
export function mask(v: string): string {
  if (!v) return ''
  const clean = v.replace(/\s/g, '')
  return clean.length <= 3 ? '•••' : '•'.repeat(Math.min(clean.length - 3, 8)) + clean.slice(-3)
}
