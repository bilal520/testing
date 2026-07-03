import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { cache } from 'react'
import { ROLE_MODULES, type Role, type ModuleKey } from '@/lib/rbac-constants'

// ════════════════════════════════════════════════════════════════════════════
// Dashboard-wide role-based access control (server).
// Identity = Clerk. A user's role + optional per-user module override live in
// Clerk publicMetadata ({ role, modules }). The founder is always Admin via the
// email allowlist (so nobody can be locked out before roles are assigned).
// Roles/modules/matrix live in lib/rbac-constants.ts (client-safe).
// ════════════════════════════════════════════════════════════════════════════

export * from '@/lib/rbac-constants'

// The founder — always Admin, even before any metadata is assigned.
const ADMIN_EMAILS = ['elyscentsiq@gmail.com']

// API path prefix → module (for server-side route guards).
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname.startsWith('/api/oms'))     return 'oms'
  if (pathname.startsWith('/api/cars'))    return 'recovery'
  if (pathname.startsWith('/api/cf'))      return 'intelligence'
  if (pathname.startsWith('/api/courier')) return 'courier'
  if (pathname.startsWith('/api/admin'))   return 'team'
  return null
}

export interface Access { userId: string | null; email: string | null; role: Role; modules: ModuleKey[]; isAdmin: boolean }

/** Resolve the current signed-in user's access. Reads role/modules from the
 *  session token if present (fast), else falls back to a Clerk user fetch. */
export const getAccess = cache(async (): Promise<Access> => {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { userId: null, email: null, role: 'none', modules: [], isAdmin: false }

  const claims = sessionClaims as unknown as { metadata?: { role?: Role; modules?: ModuleKey[] }; email?: string }
  let meta: { role?: Role; modules?: ModuleKey[] } | undefined = claims?.metadata
  let email: string | null = claims?.email ?? null

  if (!meta || !email) {
    try {
      const u = await (await clerkClient()).users.getUser(userId)
      meta  = meta  ?? (u.publicMetadata as { role?: Role; modules?: ModuleKey[] })
      email = email ?? (u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? null)
    } catch { /* keep what we have */ }
  }

  const isFounder = !!email && ADMIN_EMAILS.includes(email.toLowerCase())
  const role: Role = isFounder ? 'admin' : (meta?.role ?? 'none')
  const modules = (meta?.modules && meta.modules.length) ? meta.modules : (ROLE_MODULES[role] ?? [])
  return { userId, email, role, modules, isAdmin: role === 'admin' }
})

export function canAccess(a: Access, m: ModuleKey): boolean {
  return a.isAdmin || a.modules.includes(m)
}

// Route guard — call at the top of a protected API handler:
//   const g = await guardModule('oms'); if (g) return g
export async function guardModule(m: ModuleKey): Promise<NextResponse | null> {
  const a = await getAccess()
  if (a.userId && canAccess(a, m)) return null
  return NextResponse.json({ error: 'forbidden — you do not have access to this module' }, { status: 403 })
}
