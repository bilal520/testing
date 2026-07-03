import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { type NormalisedStatus } from '@/lib/courier'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DbOrder {
  id:              string
  courier:         string
  tracking_number: string
  booking_date:    string
  delivery_date:   string | null
  status:          string
  norm_status:     NormalisedStatus
  city:            string
  cod_amount:      number
  upfront_paid:    number
  reserve_paid:    number
  return_reason:   string | null
  attempt_count:   number
  last_status_date: string | null
  synced_at:       string
  is_settled:      boolean | null
  cpr_number:      string | null
  cpr_date:        string | null
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso).getTime()
  return Math.floor((b - a) / 86_400_000)
}

function cutoff(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

// ── Return rate ───────────────────────────────────────────────────────────────

// The date a parcel "closed" (reached a final state). Delivered → delivery_date;
// returned → last_status_date (the return date, from tracking enrichment). Falls
// back to booking_date when the resolution date isn't captured.
function resolutionDate(o: DbOrder): string {
  if (o.norm_status === 'delivered') return o.delivery_date ?? o.booking_date
  if (o.norm_status === 'returned')  return o.last_status_date ?? o.delivery_date ?? o.booking_date
  return o.booking_date
}

// Only parcels that CLOSED within the last N days (per spec) — in-transit excluded.
function returnRateForWindow(orders: DbOrder[], days: number) {
  const since = cutoff(days)
  const closed = orders.filter(o =>
    (o.norm_status === 'delivered' || o.norm_status === 'returned') && resolutionDate(o) >= since
  )
  const returned  = closed.filter(o => o.norm_status === 'returned').length
  const delivered = closed.filter(o => o.norm_status === 'delivered').length
  const total     = returned + delivered
  return {
    delivered,
    returned,
    total,
    rate: total > 0 ? Math.round((returned / total) * 1000) / 10 : 0,
  }
}

// ISO-week label (yyyy-Www) for the Monday of a date's week.
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7            // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3)         // nearest Thursday
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round((d.getTime() - firstThu.getTime()) / 86_400_000 / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// By booking-week cohort: of parcels BOOKED in a given week, how many have closed
// and what's the return rate — shows the aging pattern.
function returnRateByBookingWeek(orders: DbOrder[]) {
  const map = new Map<string, { delivered: number; returned: number }>()
  for (const o of orders) {
    if (o.norm_status !== 'delivered' && o.norm_status !== 'returned') continue
    const wk = isoWeek(o.booking_date)
    const e = map.get(wk) ?? { delivered: 0, returned: 0 }
    if (o.norm_status === 'delivered') e.delivered++
    else e.returned++
    map.set(wk, e)
  }
  return Array.from(map.entries())
    .map(([week, c]) => {
      const total = c.delivered + c.returned
      return { week, delivered: c.delivered, returned: c.returned, total, rate: total > 0 ? Math.round((c.returned / total) * 1000) / 10 : 0 }
    })
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 10)
}

// ── Classify return reason ────────────────────────────────────────────────────

// Patterns cover both plain text and courier codes. PostEx returns codes like
// "Attempt Made: RFD(REFUSED TO RECEIVE)" / ICA / CNA / OPN / HCR / RAD / PNA;
// Leopards returns text like "CONSIGNEE REFUSED". Checked in order — first hit wins.
const REASON_PATTERNS: Array<{ category: string; patterns: string[] }> = [
  { category: 'Address Issue',       patterns: ['incomplete address', 'address not found', 'wrong address', 'no such', 'address error', 'ica'] },
  { category: 'Customer Refused',    patterns: ['refus', 'reject', 'not interested', "don't want", 'dont want', 'rfd'] },
  { category: 'Wants to Open First', patterns: ['wants to open', 'open parcel', 'opn'] },
  { category: 'Payment Not Ready',   patterns: ['payment not available', 'no cash', 'payment not ready', 'pna'] },
  { category: 'Not Reachable',       patterns: ['not answer', 'no response', 'phone off', 'unreachable', 'switch off', 'not picking', 'not responding', 'cnr'] },
  { category: 'Not Available',       patterns: ['customer not available', 'not at home', 'out of city', 'not available', 'gone out', 'cna'] },
  { category: 'Rescheduled / Hold',  patterns: ['hold on consignee', 'reschedule', 're-attempt', 'reattempt', 'hcr'] },
  { category: 'Damaged',             patterns: ['damage', 'broken', 'poor condition', 'tamper'] },
  { category: 'Courier Fault',       patterns: ['misroute', 'wrong city', 'return without attempt', 'courier fault', 'restricted area', 'rad'] },
]

// Leopards frequently records only WHO took the return handover (self/staff/a
// relative) rather than why delivery failed — that's a missing-reason, which is
// itself a courier-negligence signal, so bucket it as "No Reason Given".
const DISPOSITION_ONLY = new Set(['self', 'staff', 'father', 'mother', 'brother', 'sister', 'son', 'daughter', 'wife', 'husband', 'guard', 'neighbour', 'neighbor', 'reception', 'receptionist', 'owner', 'friend'])

function classifyReason(reason: string | null): string {
  if (!reason) return 'No Reason Given'
  const r = reason.toLowerCase().trim()
  // Placeholder-only values (PostEx often stores "-") carry no information.
  if (!r || /^[-–—.\s]*$/.test(r)) return 'No Reason Given'
  if (DISPOSITION_ONLY.has(r)) return 'No Reason Given'
  for (const { category, patterns } of REASON_PATTERNS) {
    if (patterns.some(p => r.includes(p))) return category
  }
  return 'Other'
}

// ── City canonicalisation ─────────────────────────────────────────────────────
// The two couriers spell the same city differently (PostEx "Karachi" title-case,
// Leopards "MULTAN" upper-case) and case drifts within a courier too
// (Okara/OKARA). Group on a canonical UPPER key so a city is never split; a small
// alias map folds obvious short-forms. Displayed back in Title Case.
const CITY_ALIASES: Record<string, string> = {
  KHI: 'KARACHI', 'KARACHI CITY': 'KARACHI',
  LHR: 'LAHORE', LHE: 'LAHORE',
  ISB: 'ISLAMABAD', ISL: 'ISLAMABAD',
  RWP: 'RAWALPINDI', PINDI: 'RAWALPINDI',
  FSD: 'FAISALABAD', MUX: 'MULTAN',
}
function canonCity(raw: string | null): string {
  const c = (raw ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!c) return 'UNKNOWN'
  return CITY_ALIASES[c] ?? c
}
function titleCity(c: string): string {
  return c.split(' ').map(w => (w ? w[0] + w.slice(1).toLowerCase() : w)).join(' ')
}

// ── Transit aging ─────────────────────────────────────────────────────────────

function ageBucket(days: number): 'fresh' | 'watching' | 'stuck' | 'critical' | 'dead' {
  if (days <= 3)  return 'fresh'
  if (days <= 5)  return 'watching'
  if (days <= 7)  return 'stuck'
  if (days <= 10) return 'critical'
  return 'dead'
}

const TRANSIT_NORMS: NormalisedStatus[] = ['booked', 'in_transit', 'out_for_delivery', 'attempted', 'other']

// ── Main handler ──────────────────────────────────────────────────────────────

// PostgREST caps a single response at 1000 rows regardless of .limit(), so page
// through with .range() to get EVERY order in the window. Without this the
// analytics modules (summary, return rate, transit aging, by-city, reasons) only
// saw the newest 1000 orders — skewing them heavily toward fresh in-transit ones.
const ORDER_COLS = 'id, courier, tracking_number, booking_date, delivery_date, status, norm_status, city, cod_amount, upfront_paid, reserve_paid, return_reason, attempt_count, last_status_date, synced_at, is_settled, cpr_number, cpr_date'

async function fetchOrdersSince(since: string): Promise<DbOrder[]> {
  const all: DbOrder[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('courier_orders')
      .select(ORDER_COLS)
      .gte('booking_date', since)
      .order('booking_date', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...((data ?? []) as DbOrder[]))
    if (!data || data.length < 1000) break
  }
  return all
}

export async function GET() {
  const g = await guardModule('courier'); if (g) return g
  // Analytics window: 75 days. Returns lag delivery by ~4 weeks (median 29d, up to
  // ~45d), so a 30-day "closed in window" return-rate view needs parcels booked up
  // to ~75 days ago — a 45d fetch censored late returns and biased the rate low.
  const sinceOrders = cutoff(75)

  // Cash balance uses a wider 90-day window (separate from the analytics query)
  // so older unsettled orders aren't missed
  let orders: DbOrder[]
  let cashRpc: unknown
  let syncRow: { value: string } | null
  try {
    const [ord, cash, sync] = await Promise.all([
      fetchOrdersSince(sinceOrders),
      // RPC bypasses the same 1000-row cap — aggregates computed in Postgres
      supabaseAdmin.rpc('get_cash_balance', { days_back: 90 }),
      supabaseAdmin
        .from('site_settings').select('value').eq('key', 'courier_last_synced').single(),
    ])
    orders  = ord
    cashRpc = cash.data
    syncRow = sync.data as { value: string } | null
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const today      = new Date().toISOString().slice(0, 10)
  const lastSynced = syncRow?.value ?? null

  // ── Module 8: Cash Balance — server-side aggregation via RPC ─────────────
  type CashRpcRow = {
    courier:                string
    total_paid:             number
    delivered_order_count:  number
    delivered_cash_payable: number
    all_order_count:        number
    all_cash_payable:       number
  }
  const cashBalance = (['postex', 'leopards'] as const).map(courier => {
    const row = ((cashRpc ?? []) as CashRpcRow[]).find(r => r.courier === courier)
    return {
      courier,
      totalPaid:            Math.round(row?.total_paid             ?? 0),
      deliveredOrderCount:  row?.delivered_order_count  ?? 0,
      deliveredCashPayable: Math.round(row?.delivered_cash_payable ?? 0),
      allOrderCount:        row?.all_order_count         ?? 0,
      allCashPayable:       Math.round(row?.all_cash_payable       ?? 0),
    }
  })

  const cprHistory: unknown[] = []

  // ── Module 1: Return Rate ──────────────────────────────────────────────────
  const windows = [7, 14, 30] as const
  const pxOrders = orders.filter(o => o.courier === 'postex')
  const lpOrders = orders.filter(o => o.courier === 'leopards')
  const returnRate = {
    overall:  Object.fromEntries(windows.map(w => [`${w}d`, returnRateForWindow(orders,   w)])),
    postex:   Object.fromEntries(windows.map(w => [`${w}d`, returnRateForWindow(pxOrders, w)])),
    leopards: Object.fromEntries(windows.map(w => [`${w}d`, returnRateForWindow(lpOrders, w)])),
    byBookingWeek: returnRateByBookingWeek(orders),
  }

  // ── Module 3: Transit Aging ────────────────────────────────────────────────
  const inTransit = orders.filter(o => TRANSIT_NORMS.includes(o.norm_status))
  const agingMap: Record<string, { count: number; codValue: number; orders: Array<{ tracking: string; courier: string; city: string; daysOld: number; status: string; codAmount: number; attempts: number; lastMovement: string | null; daysSinceMovement: number | null }> }> = {
    fresh:    { count: 0, codValue: 0, orders: [] },
    watching: { count: 0, codValue: 0, orders: [] },
    stuck:    { count: 0, codValue: 0, orders: [] },
    critical: { count: 0, codValue: 0, orders: [] },
    dead:     { count: 0, codValue: 0, orders: [] },
  }
  for (const o of inTransit) {
    const daysOld = daysBetween(o.booking_date, today)
    const bucket  = ageBucket(daysOld)
    agingMap[bucket].count++
    agingMap[bucket].codValue += o.cod_amount ?? 0
    if (bucket !== 'fresh') {
      agingMap[bucket].orders.push({
        tracking:  o.tracking_number,
        courier:   o.courier,
        city:      o.city,
        daysOld,
        status:    o.status,
        codAmount: o.cod_amount ?? 0,
        attempts:  o.attempt_count ?? 0,
        lastMovement:      o.last_status_date,
        daysSinceMovement: o.last_status_date ? daysBetween(o.last_status_date, today) : null,
      })
    }
  }
  // Round COD values
  for (const b of Object.values(agingMap)) {
    b.codValue = Math.round(b.codValue)
    // Keep only top 20 per bucket for payload size
    b.orders = b.orders.slice(0, 20)
  }

  // ── Module 4: Return by City — courier × city scoreboard ───────────────────
  // One row per (canonical) city with PostEx vs Leopards side by side, so the
  // question "which courier is bad in which city" is answerable at a glance.
  const CITY_WINDOW = 45
  const sinceCity   = cutoff(CITY_WINDOW)
  type CityStat = { shipped: number; delivered: number; returned: number; cod: number }
  const blank = (): CityStat => ({ shipped: 0, delivered: 0, returned: 0, cod: 0 })
  const rateOf = (s: CityStat) => {
    const closed = s.delivered + s.returned
    return closed > 0 ? Math.round((s.returned / closed) * 1000) / 10 : 0
  }
  const cityMap = new Map<string, { postex: CityStat; leopards: CityStat }>()
  for (const o of orders) {
    if (o.booking_date < sinceCity) continue
    if (o.courier !== 'postex' && o.courier !== 'leopards') continue
    const city = canonCity(o.city)
    if (!cityMap.has(city)) cityMap.set(city, { postex: blank(), leopards: blank() })
    const s = cityMap.get(city)![o.courier]
    s.shipped++
    if (o.norm_status === 'delivered') s.delivered++
    if (o.norm_status === 'returned')  { s.returned++; s.cod += o.cod_amount ?? 0 }
  }
  const cityStat = (s: CityStat) =>
    s.shipped > 0 ? { shipped: s.shipped, delivered: s.delivered, returned: s.returned, returnRate: rateOf(s) } : null
  const cities = Array.from(cityMap.entries())
    .map(([city, cc]) => {
      const combined: CityStat = {
        shipped:   cc.postex.shipped   + cc.leopards.shipped,
        delivered: cc.postex.delivered + cc.leopards.delivered,
        returned:  cc.postex.returned  + cc.leopards.returned,
        cod:       cc.postex.cod       + cc.leopards.cod,
      }
      const px = cityStat(cc.postex)
      const lp = cityStat(cc.leopards)
      // Flag the worse courier only when both have enough closed volume to compare
      // fairly and the gap is material (≥10 pts).
      let worst: 'postex' | 'leopards' | null = null
      const pxClosed = cc.postex.delivered + cc.postex.returned
      const lpClosed = cc.leopards.delivered + cc.leopards.returned
      if (px && lp && pxClosed >= 5 && lpClosed >= 5 && Math.abs(px.returnRate - lp.returnRate) >= 10) {
        worst = px.returnRate > lp.returnRate ? 'postex' : 'leopards'
      }
      return {
        city: titleCity(city),
        shipped: combined.shipped, delivered: combined.delivered, returned: combined.returned,
        returnRate: rateOf(combined), codAtRisk: Math.round(combined.cod),
        postex: px, leopards: lp, worst,
      }
    })
    .filter(r => r.shipped >= 3)
    .sort((a, b) => b.shipped - a.shipped)
    .slice(0, 150)
  const returnByCity = { windowDays: CITY_WINDOW, cities }

  // ── Module 5: Return Reasons (per courier) ─────────────────────────────────
  // Split by courier: PostEx gives real codes (RFD/ICA/CNA/OPN…) while Leopards
  // mostly records only who took the handover ("SELF") → "No Reason Given". Kept
  // separate so Leopards' blanks don't swamp PostEx's real reason breakdown.
  const REASON_WINDOW = 45
  const sinceReason   = cutoff(REASON_WINDOW)
  function reasonsFor(subset: DbOrder[]) {
    const m = new Map<string, number>()
    let total = 0
    for (const o of subset) {
      if (o.norm_status !== 'returned') continue
      if (resolutionDate(o) < sinceReason) continue
      total++
      const cat = classifyReason(o.return_reason)
      m.set(cat, (m.get(cat) ?? 0) + 1)
    }
    return Array.from(m.entries())
      .map(([category, count]) => ({ category, count, pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count)
  }
  const returnReasons = {
    windowDays: REASON_WINDOW,
    overall:  reasonsFor(orders),
    postex:   reasonsFor(pxOrders),
    leopards: reasonsFor(lpOrders),
  }

  // ── Module 7: Stolen / Lost — escalation candidates ────────────────────────
  const stolenLost: Array<{
    tracking: string; courier: string; city: string; codAmount: number
    status: string; daysOld: number; daysSinceMovement: number | null; attempts: number; signal: string
  }> = []
  for (const o of orders) {
    const daysOld = daysBetween(o.booking_date, today)
    const dsm     = o.last_status_date ? daysBetween(o.last_status_date, today) : null
    const attempts = o.attempt_count ?? 0
    let signal: string | null = null

    if (o.norm_status === 'expired' || o.norm_status === 'cancelled') {
      signal = 'Expired / cancelled by courier'
    } else if (TRANSIT_NORMS.includes(o.norm_status) && dsm !== null && dsm > 10) {
      signal = `No movement for ${dsm} days`
    } else if (TRANSIT_NORMS.includes(o.norm_status) && attempts >= 3 && daysOld > 7) {
      signal = `${attempts} failed attempts, still unresolved`
    } else if (o.norm_status === 'delivered' && o.is_settled !== true && resolutionDate(o) <= cutoff(21)) {
      signal = 'Delivered 21+ days ago but COD not paid'
    }

    if (signal) {
      stolenLost.push({
        tracking: o.tracking_number, courier: o.courier, city: o.city,
        codAmount: Math.round(o.cod_amount ?? 0), status: o.status,
        daysOld, daysSinceMovement: dsm, attempts, signal,
      })
    }
  }
  stolenLost.sort((a, b) => b.codAmount - a.codAmount)
  const stolenLostSummary = {
    count:      stolenLost.length,
    codAtRisk:  stolenLost.reduce((s, o) => s + o.codAmount, 0),
    orders:     stolenLost.slice(0, 60),
  }

  // ── Module 6: CPR Register — settlement batches ────────────────────────────
  // Leopards batches keyed by CPR number; PostEx has no CPR number so we key by
  // settlement date (cpr_date). Each row = one payout batch.
  const cprMap = new Map<string, { courier: string; label: string; cprDate: string | null; orderCount: number; totalAmount: number }>()
  for (const o of orders) {
    if (o.is_settled !== true || o.norm_status !== 'delivered') continue
    const key   = o.cpr_number ? `${o.courier}__${o.cpr_number}` : `${o.courier}__d__${o.cpr_date ?? 'unknown'}`
    const label = o.cpr_number ?? (o.cpr_date ? `Settled ${o.cpr_date}` : 'Settled (no ref)')
    const e = cprMap.get(key) ?? { courier: o.courier, label, cprDate: o.cpr_date, orderCount: 0, totalAmount: 0 }
    e.orderCount++
    e.totalAmount += o.cod_amount ?? 0
    cprMap.set(key, e)
  }
  const cprRegister = Array.from(cprMap.values())
    .map(c => ({ ...c, totalAmount: Math.round(c.totalAmount) }))
    .sort((a, b) => (b.cprDate ?? '').localeCompare(a.cprDate ?? ''))
    .slice(0, 100)

  // ── Module 2: Booking counts ───────────────────────────────────────────────
  const since7 = cutoff(7)
  const bookingsByDay: Record<string, { postex: number; leopards: number }> = {}
  for (const o of orders.filter(o => o.booking_date >= since7)) {
    const d = o.booking_date
    if (!bookingsByDay[d]) bookingsByDay[d] = { postex: 0, leopards: 0 }
    bookingsByDay[d][o.courier as 'postex' | 'leopards']++
  }

  // ── Summary counts ─────────────────────────────────────────────────────────
  const summary = {
    total:     orders.length,
    delivered: orders.filter(o => o.norm_status === 'delivered').length,
    returned:  orders.filter(o => o.norm_status === 'returned').length,
    inTransit: inTransit.length,
    postex:    orders.filter(o => o.courier === 'postex').length,
    leopards:  orders.filter(o => o.courier === 'leopards').length,
  }

  return NextResponse.json({
    lastSynced,
    summary,
    cashBalance,
    cprRegister,
    returnRate,
    transitAging:  agingMap,
    returnByCity,
    returnReasons,
    stolenLost:    stolenLostSummary,
    bookingsByDay,
  })
}
