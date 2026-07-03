import { NextRequest, NextResponse } from 'next/server'
import { guardModule } from '@/lib/rbac'
import { buildCarsReport } from '@/lib/cars/report'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Recovery report bundle for the dashboard tab. Guarded to the `recovery` module.
export async function GET(req: NextRequest) {
  const g = await guardModule('recovery'); if (g) return g
  const sp = req.nextUrl.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const to = sp.get('to') || today
  const from = sp.get('from') || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  try {
    const report = await buildCarsReport(from, to)
    return NextResponse.json(report)
  } catch (e) {
    // Tables not created yet, etc. — return an empty, well-formed shell.
    return NextResponse.json({ error: String(e).slice(0, 200), range: { from, to }, funnel: {}, money: {}, byStep: [], byTemplate: [], detail: [] })
  }
}
