import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { postexTrackOrder, leopardsTrackPackets, type TrackingInfo } from '@/lib/courier'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// In-motion statuses — refreshed repeatedly so "days since last movement" stays
// current for the stolen/lost detector. Returned orders are enriched once (their
// reason + return date don't change). Delivered orders carry delivery_date already.
const TRANSIT_STATUSES = ['booked', 'in_transit', 'out_for_delivery', 'attempted', 'other']

// How stale an in-transit order's last_status_date can be before we re-pull it.
function staleCutoff(): string {
  const d = new Date(); d.setDate(d.getDate() - 2)
  return d.toISOString().slice(0, 10)
}

interface EnrichTarget { tracking_number: string; booking_date: string; delivery_date: string | null }

// Select the parcels to enrich for a courier: all returned-without-a-date (once)
// plus in-transit orders that are new or stale (refresh), stalest first. Carries
// booking_date/delivery_date so a successful-but-dateless track still gets a
// resolution date (prevents a returned parcel churning in the null queue forever).
async function selectToEnrich(courier: string, limit: number): Promise<EnrichTarget[]> {
  const half = Math.ceil(limit / 2)
  const cols = 'tracking_number, booking_date, delivery_date'
  const [ret, transit] = await Promise.all([
    supabaseAdmin.from('courier_orders').select(cols)
      .eq('courier', courier).eq('norm_status', 'returned').is('last_status_date', null)
      .order('booking_date', { ascending: true }).limit(half),
    supabaseAdmin.from('courier_orders').select(cols)
      .eq('courier', courier).in('norm_status', TRANSIT_STATUSES)
      .or(`last_status_date.is.null,last_status_date.lt.${staleCutoff()}`)
      .order('last_status_date', { ascending: true, nullsFirst: true }).limit(half),
  ])
  const map = new Map<string, EnrichTarget>()
  for (const r of ret.data ?? [])     map.set(r.tracking_number as string, r as EnrichTarget)
  for (const r of transit.data ?? []) map.set(r.tracking_number as string, r as EnrichTarget)
  return Array.from(map.values())
}

async function applyUpdates(
  rows: Array<{ id: string; info: TrackingInfo }>,
): Promise<number> {
  let n = 0
  const CONCURRENCY = 10
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(async ({ id, info }) => {
      const { error } = await supabaseAdmin
        .from('courier_orders')
        .update({
          last_status_date: info.lastStatusDate,
          attempt_count:    info.attemptCount,
          // don't overwrite an existing reason with null
          ...(info.returnReason ? { return_reason: info.returnReason } : {}),
        })
        .eq('id', id)
      if (!error) n++
    }))
  }
  return n
}

// When a track call succeeds but yields no movement date, stamp the parcel's own
// delivery/booking date so it leaves the "returned + null date" queue instead of
// being re-selected every run. (Only when the API answered — a missing/failed CN
// stays null so it's retried next time.)
function withFallbackDate(info: TrackingInfo, t: EnrichTarget): TrackingInfo {
  return info.lastStatusDate ? info : { ...info, lastStatusDate: t.delivery_date ?? t.booking_date }
}

async function enrichPostex(limit: number): Promise<{ checked: number; updated: number }> {
  const targets = await selectToEnrich('postex', limit)
  if (targets.length === 0) return { checked: 0, updated: 0 }

  const updates: Array<{ id: string; info: TrackingInfo }> = []
  const CONCURRENCY = 20
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY)
    const infos = await Promise.all(chunk.map(t => postexTrackOrder(t.tracking_number)))
    for (let j = 0; j < chunk.length; j++) {
      if (infos[j]) updates.push({ id: `postex_${chunk[j].tracking_number}`, info: withFallbackDate(infos[j]!, chunk[j]) })
    }
  }
  const updated = await applyUpdates(updates)
  return { checked: targets.length, updated }
}

async function enrichLeopards(limit: number): Promise<{ checked: number; updated: number }> {
  const targets = await selectToEnrich('leopards', limit)
  if (targets.length === 0) return { checked: 0, updated: 0 }

  const byCn = new Map(targets.map(t => [t.tracking_number, t]))
  const map  = await leopardsTrackPackets(targets.map(t => t.tracking_number))
  const updates: Array<{ id: string; info: TrackingInfo }> = []
  for (const [cn, info] of map.entries()) {
    const t = byCn.get(cn)
    updates.push({ id: `leopards_${cn}`, info: t ? withFallbackDate(info, t) : info })
  }
  const updated = await applyUpdates(updates)
  return { checked: targets.length, updated }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 400), 1500)

  const [px, lp] = await Promise.allSettled([enrichPostex(limit), enrichLeopards(limit)])
  return NextResponse.json({
    ok: true,
    postex:   px.status === 'fulfilled' ? px.value : { error: String(px.reason) },
    leopards: lp.status === 'fulfilled' ? lp.value : { error: String(lp.reason) },
  })
}
