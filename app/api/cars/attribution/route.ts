import { NextRequest, NextResponse } from 'next/server'
import { attributeRecent } from '@/lib/cars/attribution'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Hourly safety-net attribution sweep (missed order webhooks). Cron-only.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const r = await attributeRecent(3)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).replace(/^Error:\s*/, '').slice(0, 200) })
  }
}
