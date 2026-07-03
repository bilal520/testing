import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { refreshLeopardsCities } from '@/lib/courier-booking'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Daily self-heal for the Leopards city map. Their getAllCities API is often
// down (504); this retries once a day and caches the map the moment it responds,
// which silently unlocks Leopards auto-booking. Cron-only (CRON_SECRET).
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Already cached → nothing to do.
  const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'oms_leopards_cities').maybeSingle()
  try { if (data?.value && Object.keys(JSON.parse(data.value)).length) return NextResponse.json({ ok: true, cached: true }) } catch { /* refetch */ }

  // Return 200 even on failure so the cron doesn't retry-storm — it tries again tomorrow.
  try { const cities = await refreshLeopardsCities(); return NextResponse.json({ ok: true, cities }) }
  catch (e) { return NextResponse.json({ ok: false, error: String(e).replace(/^Error:\s*/, '').slice(0, 160) }) }
}
