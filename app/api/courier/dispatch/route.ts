import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

// Module 2 — Daily Dispatch Reconciliation.
// Warehouse hands N parcels to the rider; how many actually get booked in the
// courier system? Delta = leakage. Manual dispatch counts are stored in
// site_settings (key `dispatch:<date>:<courier>`) so no extra table is needed.

const DKEY = (date: string, courier: string) => `dispatch:${date}:${courier}`

// GET ?days=14 — dispatched (manual) vs booked (courier API) per day, with variance.
export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? 14), 60)
  const since = new Date(); since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  // manual dispatch counts
  const { data: settings } = await supabaseAdmin
    .from('site_settings').select('key, value').like('key', 'dispatch:%')
  const dispatched = new Map<string, number>()   // `${date}:${courier}` -> count
  for (const s of settings ?? []) {
    const m = (s.key as string).match(/^dispatch:(\d{4}-\d{2}-\d{2}):(postex|leopards)$/)
    if (m && m[1] >= sinceStr) dispatched.set(`${m[1]}:${m[2]}`, Number(s.value) || 0)
  }

  // booked counts from courier_orders (paginate past 1000 cap)
  const booked = new Map<string, number>()        // `${date}:${courier}` -> count
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('courier_orders')
      .select('courier, booking_date')
      .gte('booking_date', sinceStr)
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const o of data ?? []) {
      const k = `${o.booking_date}:${o.courier}`
      booked.set(k, (booked.get(k) ?? 0) + 1)
    }
    if (!data || data.length < 1000) break
  }

  // build rows per date/courier
  const dates = new Set<string>()
  for (const k of dispatched.keys()) dates.add(k.split(':')[0])
  for (const k of booked.keys())     dates.add(k.split(':')[0])

  const rows: Array<{ date: string; courier: string; dispatched: number | null; booked: number; variance: number | null }> = []
  for (const date of Array.from(dates).sort().reverse()) {
    for (const courier of ['postex', 'leopards'] as const) {
      const d = dispatched.has(`${date}:${courier}`) ? dispatched.get(`${date}:${courier}`)! : null
      const b = booked.get(`${date}:${courier}`) ?? 0
      if (d === null && b === 0) continue
      rows.push({ date, courier, dispatched: d, booked: b, variance: d === null ? null : d - b })
    }
  }
  return NextResponse.json({ rows })
}

// POST { date, courier, count } — save a manual dispatch count.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { date?: string; courier?: string; count?: number } | null
  const date    = body?.date
  const courier = body?.courier
  const count   = body?.count
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !courier || !['postex', 'leopards'].includes(courier) || typeof count !== 'number' || count < 0) {
    return NextResponse.json({ error: 'date (yyyy-mm-dd), courier (postex|leopards) and count (>=0) required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('site_settings').upsert(
    { key: DKEY(date, courier), value: String(Math.round(count)), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
