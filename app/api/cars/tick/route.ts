import { NextRequest, NextResponse } from 'next/server'
import { ingestCheckouts, runSequences } from '@/lib/cars/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CARS heartbeat — pull abandoned checkouts + advance due sequences. Cron-only.
// Safe: sends are gated by cars_enabled (default OFF → shadow). See CARS_SPEC.md.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const ingest = await ingestCheckouts()
    const send = await runSequences()
    return NextResponse.json({ ok: true, ingest, send })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).replace(/^Error:\s*/, '').slice(0, 200) })
  }
}
