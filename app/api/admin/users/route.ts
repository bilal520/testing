import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { getAccess, ROLE_MODULES, type Role, type ModuleKey } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// All handlers are admin-only.
async function requireAdmin() {
  const a = await getAccess()
  return a.isAdmin ? a : null
}

// GET — list team members with their role + modules.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'admin only' }, { status: 403 })
  const client = await clerkClient()
  const res = await client.users.getUserList({ limit: 200 })
  const list = (res.data ?? res as unknown as unknown[]) as Array<{
    id: string; firstName?: string | null; lastName?: string | null
    primaryEmailAddress?: { emailAddress?: string } | null
    emailAddresses?: Array<{ emailAddress?: string }>
    publicMetadata?: { role?: Role; modules?: ModuleKey[] }
  }>
  const users = list.map(u => ({
    id:    u.id,
    email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? '',
    name:  [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
    role:  (u.publicMetadata?.role ?? 'none') as Role,
    modules: (u.publicMetadata?.modules ?? null),
  }))
  return NextResponse.json({ users })
}

// POST — invite a new team member by email with a role.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'admin only' }, { status: 403 })
  const body = await req.json().catch(() => null) as { email?: string; role?: Role } | null
  if (!body?.email || !body?.role) return NextResponse.json({ error: 'email and role required' }, { status: 400 })
  try {
    const client = await clerkClient()
    const inv = await client.invitations.createInvitation({
      emailAddress: body.email.trim(),
      publicMetadata: { role: body.role },
      redirectUrl: `${req.nextUrl.origin}/sign-up`,
      ignoreExisting: true,
    })
    return NextResponse.json({ ok: true, invitationId: inv.id })
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 })
  }
}

// PATCH — change a user's role and/or per-user module override.
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'admin only' }, { status: 403 })
  const body = await req.json().catch(() => null) as { userId?: string; role?: Role; modules?: ModuleKey[] | null } | null
  if (!body?.userId || !body?.role) return NextResponse.json({ error: 'userId and role required' }, { status: 400 })
  try {
    const client = await clerkClient()
    // modules: explicit array = custom override; null/undefined = fall back to role defaults.
    const modules = Array.isArray(body.modules) ? body.modules : null
    await client.users.updateUserMetadata(body.userId, { publicMetadata: { role: body.role, modules } })
    return NextResponse.json({ ok: true, role: body.role, modules: modules ?? ROLE_MODULES[body.role] })
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 })
  }
}
