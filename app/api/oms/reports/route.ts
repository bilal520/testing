import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { guardModule } from '@/lib/rbac'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Operations reports. One call returns the full bundle for a date range.
// Sources: oms_orders (dispatch/products), oms_events (cancellations/pack/staff),
// courier_orders (returns/courier summary), oms_returns_received.

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown')
function tally<T>(rows: T[], key: (r: T) => string) {
  const m: Record<string, number> = {}
  for (const r of rows) { const k = key(r) || 'unknown'; m[k] = (m[k] ?? 0) + 1 }
  return m
}
const sortedEntries = (m: Record<string, number>, n = 30) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }))

// Page a table fully (past the 1000 cap) for a date-filtered select.
async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let f = 0; ; f += 1000) {
    const { data } = await build(f, f + 999)
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const g = await guardModule('reports'); if (g) return g
  const sp   = req.nextUrl.searchParams
  const to   = (sp.get('to')   || new Date().toISOString().slice(0, 10)) + 'T23:59:59Z'
  const from = (sp.get('from') || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)) + 'T00:00:00Z'

  // ── Dispatched orders (dispatch + products + courier selection) ───────────
  const dispatched = await pageAll((a, b) => supabaseAdmin.from('oms_orders')
    .select('courier, city, items, cod_amount, dispatched_at')
    .not('dispatched_at', 'is', null).gte('dispatched_at', from).lte('dispatched_at', to).range(a, b))
  const products: Record<string, number> = {}
  for (const o of dispatched) for (const it of ((o.items as Array<{ name?: string; qty?: number }>) ?? [])) {
    const n = (it.name ?? 'Item'); products[n] = (products[n] ?? 0) + (it.qty ?? 1)
  }
  const dispatch = {
    total: dispatched.length,
    byCourier: tally(dispatched, o => String(o.courier ?? 'unknown')),
    byCity: sortedEntries(tally(dispatched, o => String(o.city ?? 'Unknown')), 15),
    byDay: sortedEntries(tally(dispatched, o => day(o.dispatched_at as string)), 60),
  }

  // ── Events (cancellations, pack, staff) ───────────────────────────────────
  const events = await pageAll((a, b) => supabaseAdmin.from('oms_events')
    .select('event_type, to_state, actor, detail, created_at')
    .gte('created_at', from).lte('created_at', to).range(a, b))
  const cancels = events.filter(e => e.to_state === 'cancelled')
  const packs   = events.filter(e => e.to_state === 'packed')
  const cancellations = {
    total: cancels.length,
    byDay: sortedEntries(tally(cancels, e => day(e.created_at as string)), 60),
    byAgent: sortedEntries(tally(cancels, e => String(e.actor ?? 'system')), 15),
    reasons: sortedEntries(tally(cancels, e => String(e.detail ?? '').replace(/^cancel:\s*/, '').slice(0, 40)), 15),
  }
  const pack = {
    total: packs.length,
    byDay: sortedEntries(tally(packs, e => day(e.created_at as string)), 60),
    byAgent: sortedEntries(tally(packs, e => String(e.actor ?? 'warehouse')), 15),
  }
  // Staff: actions per agent (only agent:* actors)
  const agentEvents = events.filter(e => String(e.actor ?? '').startsWith('agent'))
  const staffMap: Record<string, { agent: string; total: number; confirms: number; cancels: number; packs: number; moves: number }> = {}
  for (const e of agentEvents) {
    const a = String(e.actor)
    const s = staffMap[a] ??= { agent: a.replace(/^agent:?/, '') || a, total: 0, confirms: 0, cancels: 0, packs: 0, moves: 0 }
    s.total++
    if (e.to_state === 'confirmed') s.confirms++
    if (e.to_state === 'cancelled') s.cancels++
    if (e.to_state === 'packed') s.packs++
    if (e.event_type === 'manual_move') s.moves++
  }
  const staff = Object.values(staffMap).sort((a, b) => b.total - a.total)

  // ── Courier returns + courier summary (courier_orders) ────────────────────
  const courierRows = await pageAll((a, b) => supabaseAdmin.from('courier_orders')
    .select('courier, city, return_reason, norm_status, cod_amount, booking_date')
    .gte('booking_date', from.slice(0, 10)).lte('booking_date', to.slice(0, 10)).range(a, b))
  const returnedRows = courierRows.filter(r => r.norm_status === 'returned')
  const returns = {
    total: returnedRows.length,
    byCourier: tally(returnedRows, r => String(r.courier ?? 'unknown')),
    byCity: sortedEntries(tally(returnedRows, r => String(r.city ?? 'Unknown')), 15),
    byReason: sortedEntries(tally(returnedRows, r => (String(r.return_reason ?? '').trim() || 'unspecified')), 15),
  }
  const courierSummary = ['leopards', 'postex'].map(c => {
    const rows = courierRows.filter(r => r.courier === c)
    const delivered = rows.filter(r => r.norm_status === 'delivered').length
    const returned  = rows.filter(r => r.norm_status === 'returned').length
    const total = rows.length
    return {
      courier: c, total, delivered, returned,
      returnRate: total ? Math.round((returned / total) * 1000) / 10 : 0,
      cod: Math.round(rows.reduce((s, r) => s + Number(r.cod_amount ?? 0), 0)),
    }
  }).filter(x => x.total > 0)

  // ── Returns received (oms_returns_received) ───────────────────────────────
  let returnsReceived = { total: 0, good: 0, damaged: 0, byDay: [] as Array<{ key: string; count: number }> }
  try {
    const rr = await pageAll((a, b) => supabaseAdmin.from('oms_returns_received')
      .select('condition, received_at').gte('received_at', from).lte('received_at', to).range(a, b))
    returnsReceived = {
      total: rr.length,
      good: rr.filter(r => r.condition === 'good').length,
      damaged: rr.filter(r => r.condition === 'damaged').length,
      byDay: sortedEntries(tally(rr, r => day(r.received_at as string)), 60),
    }
  } catch { /* table not created yet */ }

  return NextResponse.json({
    range: { from: from.slice(0, 10), to: to.slice(0, 10) },
    dispatch, products: sortedEntries(products, 30), cancellations, pack, staff, returns, courierSummary, returnsReceived,
  })
}
