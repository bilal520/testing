import { supabaseAdmin } from '@/lib/hub/supabase'
import { getCarsConfig } from '@/lib/cars/config'

// ════════════════════════════════════════════════════════════════════════════
// CARS reporting — funnel + "money actually made" (delivery-realized). Recovered
// orders are joined through the OMS/courier pipeline (oms_orders.tracking_number
// → courier_orders.norm_status) so recovery is measured as realized cash, not
// just orders placed. See docs/CARS_SPEC.md §9.
// ════════════════════════════════════════════════════════════════════════════

const startOf = (d: string) => `${d}T00:00:00.000Z`
const endOf = (d: string) => `${d}T23:59:59.999Z`

export function maskPhone(p?: string | null): string {
  if (!p) return '—'
  const d = p.replace(/\D/g, '')
  return d.length >= 8 ? `${d.slice(0, 4)}***${d.slice(-4)}` : '****'
}

async function pageAll<T = Record<string, unknown>>(build: (a: number, b: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let f = 0; ; f += 1000) {
    const { data } = await build(f, f + 999)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export interface CarsReport {
  range: { from: string; to: string }
  funnel: Record<string, number>
  money: Record<string, number>
  byStep: Array<{ step: number; sent: number; delivered: number; read: number }>
  byTemplate: Array<{ template: string; sent: number; recovered: number }>
  detail: Array<Record<string, unknown>>
}

export async function buildCarsReport(fromDate: string, toDate: string): Promise<CarsReport> {
  const cfg = await getCarsConfig()
  const from = startOf(fromDate), to = endOf(toDate)

  // ── checkouts abandoned in range ──
  const checkouts = await pageAll((a, b) => supabaseAdmin.from('cars_checkouts')
    .select('checkout_id, total_price, status, abandoned_at')
    .gte('abandoned_at', from).lte('abandoned_at', to).range(a, b))
  const abandoned = checkouts.length
  const abandonedValue = checkouts.reduce((s, c) => s + Number(c.total_price ?? 0), 0)

  // ── messages in range ──
  const msgs = await pageAll((a, b) => supabaseAdmin.from('cars_messages')
    .select('checkout_id, template_name, sequence_step, status, sent_at')
    .gte('sent_at', from).lte('sent_at', to).range(a, b))
  const isLive = (s: unknown) => ['sent', 'delivered', 'read', 'failed'].includes(String(s))
  const messagedCheckouts = new Set(msgs.map(m => String(m.checkout_id))).size
  const sent = msgs.filter(m => isLive(m.status)).length
  const delivered = msgs.filter(m => ['delivered', 'read'].includes(String(m.status))).length
  const read = msgs.filter(m => String(m.status) === 'read').length
  const failed = msgs.filter(m => String(m.status) === 'failed').length
  const shadow = msgs.filter(m => String(m.status) === 'shadow').length

  const byStep = [1, 2, 3].map(step => {
    const s = msgs.filter(m => Number(m.sequence_step) === step)
    return { step, sent: s.filter(m => isLive(m.status) || String(m.status) === 'shadow').length, delivered: s.filter(m => ['delivered', 'read'].includes(String(m.status))).length, read: s.filter(m => String(m.status) === 'read').length }
  })

  // ── replies in range ──
  const { count: replyCount } = await supabaseAdmin.from('cars_replies')
    .select('id', { count: 'exact', head: true }).gte('replied_at', from).lte('replied_at', to)

  // ── recoveries in range ──
  const recs = await pageAll((a, b) => supabaseAdmin.from('cars_recoveries')
    .select('order_id, order_name, checkout_id, phone, order_total, attribution_confidence, last_message_step, recovered_at')
    .gte('recovered_at', from).lte('recovered_at', to).range(a, b))
  const confirmed = recs.filter(r => ['exact', 'high'].includes(String(r.attribution_confidence)))
  const probable = recs.filter(r => String(r.attribution_confidence) === 'probable')
  const revenueConfirmed = confirmed.reduce((s, r) => s + Number(r.order_total ?? 0), 0)
  const revenueProbable = probable.reduce((s, r) => s + Number(r.order_total ?? 0), 0)

  // ── money view — join recoveries → oms_orders → courier_orders ──
  const orderIds = recs.map(r => String(r.order_id))
  const omsByGid: Record<string, { state: string; tracking: string | null }> = {}
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabaseAdmin.from('oms_orders')
      .select('shopify_order_id, state, tracking_number').in('shopify_order_id', orderIds.slice(i, i + 200))
    for (const o of (data ?? []) as Array<Record<string, unknown>>) omsByGid[String(o.shopify_order_id)] = { state: String(o.state ?? ''), tracking: (o.tracking_number as string) ?? null }
  }
  const cns = Object.values(omsByGid).map(o => o.tracking).filter(Boolean) as string[]
  const cnStatus: Record<string, string> = {}
  for (let i = 0; i < cns.length; i += 200) {
    const { data } = await supabaseAdmin.from('courier_orders')
      .select('tracking_number, norm_status').in('tracking_number', cns.slice(i, i + 200))
    for (const c of (data ?? []) as Array<Record<string, unknown>>) cnStatus[String(c.tracking_number)] = String(c.norm_status ?? '')
  }

  let deliveredOrders = 0, cashCollected = 0, inTransit = 0, inTransitValue = 0, returnedOrders = 0
  const detail: Array<Record<string, unknown>> = []
  for (const r of recs) {
    const gid = String(r.order_id)
    const total = Number(r.order_total ?? 0)
    const oms = omsByGid[gid]
    const cn = oms?.tracking ?? null
    const cstat = cn ? cnStatus[cn] : ''
    let deliveryStatus = 'pending'
    if (cstat === 'delivered') { deliveryStatus = 'delivered'; deliveredOrders++; cashCollected += total }
    else if (cstat === 'returned') { deliveryStatus = 'returned'; returnedOrders++ }
    else if (oms?.state === 'cancelled') deliveryStatus = 'cancelled'
    else { deliveryStatus = 'in_transit'; inTransit++; inTransitValue += total }
    detail.push({
      recoveredAt: r.recovered_at, order: r.order_name, phone: maskPhone(r.phone as string),
      value: total, confidence: r.attribution_confidence, step: r.last_message_step,
      deliveryStatus, cash: deliveryStatus === 'delivered' ? total : 0,
    })
  }

  const returnCost = returnedOrders * cfg.return_cost_pkr
  const msgCost = Math.round(sent * cfg.msg_cost_usd * cfg.usd_to_pkr)
  const incentiveCost = cfg.discount_type === 'percent'
    ? Math.round(cashCollected * (cfg.discount_percent / 100)) : 0
  const netMade = Math.round(cashCollected - incentiveCost - msgCost - returnCost)
  const roi = msgCost > 0 ? Math.round((netMade / msgCost) * 10) / 10 : 0

  const recoveryRate = messagedCheckouts > 0 ? Math.round((recs.length / messagedCheckouts) * 1000) / 10 : 0

  return {
    range: { from: fromDate, to: toDate },
    funnel: {
      abandoned, abandonedValue: Math.round(abandonedValue), messagedCheckouts,
      sent, shadow, delivered, read, failed, replies: replyCount ?? 0,
      recoveredConfirmed: confirmed.length, recoveredProbable: probable.length,
      revenueConfirmed: Math.round(revenueConfirmed), revenueProbable: Math.round(revenueProbable),
      recoveryRate,
    },
    money: {
      deliveredOrders, cashCollected: Math.round(cashCollected),
      inTransit, inTransitValue: Math.round(inTransitValue),
      returnedOrders, returnCost, msgCost, incentiveCost, netMade, roi,
    },
    byStep,
    byTemplate: Object.values(msgs.reduce((acc: Record<string, { template: string; sent: number; recovered: number }>, m) => {
      const t = String(m.template_name ?? 'unknown')
      acc[t] ??= { template: t, sent: 0, recovered: 0 }
      acc[t].sent++
      return acc
    }, {})),
    detail: detail.sort((a, b) => String(b.recoveredAt).localeCompare(String(a.recoveredAt))).slice(0, 500),
  }
}

/** Write one day's rollup into cars_daily_stats (idempotent upsert). */
export async function writeDailyStats(dateStr: string): Promise<CarsReport> {
  const rep = await buildCarsReport(dateStr, dateStr)
  await supabaseAdmin.from('cars_daily_stats').upsert({
    date: dateStr, store: 'PK',
    checkouts_abandoned: rep.funnel.abandoned, abandoned_value: rep.funnel.abandonedValue,
    messages_sent: rep.funnel.sent, msg_delivered: rep.funnel.delivered, msg_read: rep.funnel.read,
    msg_failed: rep.funnel.failed, replies: rep.funnel.replies,
    orders_recovered: rep.funnel.recoveredConfirmed + rep.funnel.recoveredProbable,
    orders_recovered_confirmed: rep.funnel.recoveredConfirmed,
    revenue_recovered: rep.funnel.revenueConfirmed, revenue_probable: rep.funnel.revenueProbable,
    recovery_rate: rep.funnel.recoveryRate,
    recovered_delivered: rep.money.deliveredOrders, cash_collected: rep.money.cashCollected,
    recovered_returned: rep.money.returnedOrders, return_cost: rep.money.returnCost,
    incentive_cost: rep.money.incentiveCost, msg_cost: rep.money.msgCost,
    net_made: rep.money.netMade, roi: rep.money.roi,
  }, { onConflict: 'date,store' })
  return rep
}
