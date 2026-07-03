import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Called by scheduled Claude task (which has Shopify MCP access with read_analytics)
// Caches analytics data in site_settings so intelligence route can read it
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { date, sessions, sessions_completed, conversion_rate } = body

  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const payload = {
    sessions:            Number(sessions)           || 0,
    sessions_completed:  Number(sessions_completed) || 0,
    conversion_rate_pct: Number(conversion_rate) * 100, // Shopify returns decimal, store as %
    updated_at:          new Date().toISOString(),
  }

  await supabaseAdmin.from('site_settings').upsert(
    { key: `shopify_pk_analytics_${date}`, value: JSON.stringify(payload), updated_at: payload.updated_at },
    { onConflict: 'key' }
  )

  return NextResponse.json({ ok: true, date, ...payload })
}
