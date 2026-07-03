import { NextRequest, NextResponse } from 'next/server'
import { guardModule } from '@/lib/rbac'
import { runHunt } from '@/lib/counterfeit/hunt'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET = cron (CRON_SECRET). POST = manual "Hunt now" (guarded).
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ ok: true, ...(await runHunt()) }) }
  catch (e) { return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }) }
}

export async function POST() {
  const g = await guardModule('intelligence'); if (g) return g
  try { return NextResponse.json({ ok: true, ...(await runHunt()) }) }
  catch (e) { return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 }) }
}
