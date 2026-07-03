import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// GET — the signed-in user's access (role + allowed modules), for the dashboard
// to render only the tabs they're permitted to see.
export async function GET() {
  const a = await getAccess()
  return NextResponse.json({ role: a.role, modules: a.modules, isAdmin: a.isAdmin, email: a.email })
}
