import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import {
  postexListOrders, postexPaymentStatus, leopardsGetStatuses,
  leopardsGetPaymentDetails, leopardsGetInvoices,
  type CourierOrder,
} from '@/lib/courier'
import { normalisePhone } from '@/lib/shopify'

// Customer phone lives in the raw courier payload (PostEx customerPhone /
// Leopards consignment_phone). Normalize it for RTO matching (lib/oms/rto).
function rawPhone(raw: unknown): string | null {
  const r = (raw ?? {}) as { customerPhone?: string; consignment_phone?: string }
  return normalisePhone(r.customerPhone ?? r.consignment_phone ?? null)
}

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function dateRange(daysBack: number): { from: string; to: string } {
  const now  = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
}

// PostEx get-all-order returns fine for ~30-day ranges (~5-7k orders, ~50s) but
// times out (Cloudflare 524, ~100s) on larger windows. Pull the full window in
// 30-day chunks so orders older than 30 days keep getting status refreshes —
// otherwise their status freezes at whatever the last pull saw, inflating the
// in-transit bucket long after they've actually delivered or returned.
async function postexListOrdersChunked(daysBack = 90, chunkDays = 30): Promise<CourierOrder[]> {
  const today = new Date()
  const iso   = (d: Date) => d.toISOString().slice(0, 10)
  const chunks: Array<{ from: string; to: string }> = []
  for (let offset = 0; offset < daysBack; offset += chunkDays) {
    const to   = new Date(today); to.setDate(to.getDate() - offset)
    const from = new Date(today); from.setDate(from.getDate() - Math.min(offset + chunkDays, daysBack))
    chunks.push({ from: iso(from), to: iso(to) })
  }

  // One retry per chunk before giving up, so a single slow response doesn't
  // silently drop a whole month.
  const fetchChunk = async (c: { from: string; to: string }): Promise<CourierOrder[]> => {
    try { return await postexListOrders(c.from, c.to) }
    catch { try { return await postexListOrders(c.from, c.to) } catch { return [] } }
  }

  const results = await Promise.all(chunks.map(fetchChunk))
  const map = new Map<string, CourierOrder>()
  for (const arr of results) for (const o of arr) map.set(o.id, o)  // dedupe boundary days
  return Array.from(map.values())
}


async function upsertOrders(orders: CourierOrder[]): Promise<void> {
  if (orders.length === 0) return
  const rows = orders.map(o => {
    const base = {
      id:               o.id,
      courier:          o.courier,
      tracking_number:  o.trackingNumber,
      order_ref:        o.orderRef,
      booking_date:     o.bookingDate,
      delivery_date:    o.deliveryDate,
      status:           o.status,
      norm_status:      o.normStatus,
      city:             o.city,
      cod_amount:       o.codAmount,
      transaction_fee:  o.transactionFee,
      upfront_paid:     o.upfrontPaid,
      reserve_paid:     o.reservePaid,
      cust_phone_norm:  rawPhone(o.raw),
      synced_at:        new Date().toISOString(),
      raw:              o.raw,
    }
    // NOTE: return_reason, attempt_count and last_status_date are deliberately
    // NOT written here. They are owned by the tracking-enrichment step
    // (/api/courier/enrich-tracking), which reads each parcel's full timeline.
    // The mapper only ever produces empty values for them ("-"/0/null), so
    // including them here overwrote enrichment on every sync — leaving return
    // dates and reasons permanently blank. Same rationale as is_settled/cpr_*,
    // which are also enrichment-owned. Omitting a column from an upsert payload
    // leaves the existing value untouched on conflict.
    return base
  })

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('courier_orders')
      .upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) throw new Error(`Supabase upsert error: ${error.message}`)
  }
}

// Phase 2a: enrich PostEx delivered orders — call payment-status API for CPR + settle flag
async function enrichPostexPayments(): Promise<{ enriched: number; failed?: string }> {
  // Re-check delivered orders that aren't settled yet. Filter on is_settled, NOT
  // cpr_number — PostEx's payment-status API doesn't return a CPR number, so
  // cpr_number stays null even for paid orders; keying off it re-checked every
  // order forever and never let the settle flag stick past the 8000 cap.
  const { data: rows } = await supabaseAdmin
    .from('courier_orders')
    .select('tracking_number')
    .eq('courier', 'postex')
    .eq('norm_status', 'delivered')
    .not('is_settled', 'is', true)
    .order('booking_date', { ascending: true })
    .limit(8000)

  if (!rows?.length) return { enriched: 0 }

  // Only settled orders need a write; unpaid ones keep cpr_number null and get
  // re-checked next sync. Collect them so we can batch by CPR signature.
  const settled: Array<{ id: string; cprNumber: string | null; cprDate: string | null }> = []
  const CONCURRENCY = 20
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk   = rows.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(r => postexPaymentStatus(r.tracking_number)))
    for (let j = 0; j < chunk.length; j++) {
      const s = results[j]
      if (!s || !s.settle) continue
      settled.push({
        id:        `postex_${chunk[j].tracking_number}`,
        cprNumber: s.cprNumber1 ?? s.cprNumber2 ?? null,
        cprDate:   s.settlementDate,
      })
    }
  }

  if (settled.length === 0) return { enriched: 0 }

  // Group by CPR signature, then update() (NOT upsert — upsert validates the
  // NOT NULL courier column on the INSERT side and fails silently).
  const groups = new Map<string, { cprNumber: string | null; cprDate: string | null; ids: string[] }>()
  for (const s of settled) {
    const key = `${s.cprNumber}__${s.cprDate}`
    const g   = groups.get(key)
    if (g) g.ids.push(s.id)
    else groups.set(key, { cprNumber: s.cprNumber, cprDate: s.cprDate, ids: [s.id] })
  }

  let enriched = 0
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      const slice = g.ids.slice(i, i + 500)
      const { error } = await supabaseAdmin
        .from('courier_orders')
        .update({ is_settled: true, cpr_number: g.cprNumber, cpr_date: g.cprDate })
        .in('id', slice)
      if (error) return { enriched, failed: error.message }
      enriched += slice.length
    }
  }
  return { enriched }
}

// Phase 2c: enrich Leopards delivered orders that don't have a CPR yet.
// Oldest first + higher cap so auto-settle can work through the full backlog
// over successive syncs instead of re-checking an arbitrary 2000 each time.
async function enrichLeopardsPayments(): Promise<{ enriched: number; failed?: string }> {
  const { data: rows } = await supabaseAdmin
    .from('courier_orders')
    .select('tracking_number')
    .eq('courier', 'leopards')
    .eq('norm_status', 'delivered')
    .is('cpr_number', null)
    .order('booking_date', { ascending: true })
    .limit(12000)

  const cnNumbers = (rows ?? []).map(r => r.tracking_number as string)
  if (cnNumbers.length === 0) return { enriched: 0 }

  const paymentMap = await leopardsGetPaymentDetails(cnNumbers)
  if (paymentMap.size === 0) return { enriched: 0 }

  // Group by CPR signature, then update() (NOT upsert — same NOT NULL courier
  // pitfall as PostEx enrichment).
  const groups = new Map<string, { cprNumber: string | null; cprDate: string | null; ids: string[] }>()
  for (const [cn, p] of paymentMap.entries()) {
    const key = `${p.cprNumber}__${p.cprDate}`
    const g   = groups.get(key)
    if (g) g.ids.push(`leopards_${cn}`)
    else groups.set(key, { cprNumber: p.cprNumber, cprDate: p.cprDate, ids: [`leopards_${cn}`] })
  }

  let enriched = 0
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      const slice = g.ids.slice(i, i + 500)
      const { error } = await supabaseAdmin
        .from('courier_orders')
        .update({ is_settled: true, cpr_number: g.cprNumber, cpr_date: g.cprDate })
        .in('id', slice)
      if (error) return { enriched, failed: error.message }
      enriched += slice.length
    }
  }
  return { enriched }
}

// Phase 2d: sync Leopards CPR invoice list (last 90 days)
async function syncLeopardsCPRs(from: string, to: string): Promise<{ synced: number }> {
  const cprs = await leopardsGetInvoices(from, to)
  if (cprs.length === 0) return { synced: 0 }

  const rows = cprs.map(c => ({
    id:             c.id,
    courier:        'leopards',
    cpr_number:     c.cprNumber,
    payment_date:   c.paymentDate,
    amount:         c.amount,
    payment_method: c.paymentMethod,
    status:         c.status,
    synced_at:      new Date().toISOString(),
    raw:            c.raw,
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('courier_cprs')
      .upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) console.error('courier_cprs upsert:', error.message)
  }
  return { synced: cprs.length }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { from: from90, to } = dateRange(90)
  const results: Record<string, unknown> = {}

  // ── Phase 1: fetch + upsert both couriers in parallel ─────────────────────
  // PostEx pulled in 30-day chunks (its API times out on wider ranges);
  // Leopards supports the full 90 days in one call.
  const [pxResult, lpResult] = await Promise.allSettled([
    postexListOrdersChunked(90, 30),
    leopardsGetStatuses(from90, to),
  ])

  const [pxWrite, lpWrite] = (await Promise.allSettled([
    pxResult.status === 'fulfilled'
      ? upsertOrders(pxResult.value).then(() => ({ synced: pxResult.value.length, from: from90, to }))
      : Promise.reject(pxResult.reason),
    lpResult.status === 'fulfilled'
      ? upsertOrders(lpResult.value).then(() => ({ synced: lpResult.value.length, from: from90, to }))
      : Promise.reject(lpResult.reason),
  ])) as PromiseSettledResult<{ synced: number; from: string; to: string }>[]

  results.postex   = pxWrite.status === 'fulfilled' ? pxWrite.value   : { error: String(pxWrite.reason) }
  results.leopards = lpWrite.status === 'fulfilled' ? lpWrite.value   : { error: String(lpWrite.reason) }

  // ── Phase 2: enrich CPR settlement data for both couriers ─────────────────
  const [pxEnrich, lpEnrich, lpCPRs] = await Promise.allSettled([
    enrichPostexPayments(),
    enrichLeopardsPayments(),
    syncLeopardsCPRs(from90, to),
  ])
  results.postexEnrichment   = pxEnrich.status  === 'fulfilled' ? pxEnrich.value  : { error: String(pxEnrich.reason) }
  results.leopardsEnrichment = lpEnrich.status  === 'fulfilled' ? lpEnrich.value  : { error: String(lpEnrich.reason) }
  results.leopardsCPRs       = lpCPRs.status    === 'fulfilled' ? lpCPRs.value    : { error: String(lpCPRs.reason) }

  await supabaseAdmin.from('site_settings').upsert(
    { key: 'courier_last_synced', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )

  return NextResponse.json({ ok: true, results })
}
