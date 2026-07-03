import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface Row {
  state: string; created_at: string; confirmed_at: string | null; dispatched_at: string | null
  is_duplicate: boolean; risk_level: string; address_complete: boolean
  cod_amount: number; tracking_number: string | null
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

// Module K — OMS KPIs. All from oms_orders + oms_events (internal, live).
export async function GET() {
  const g = await guardModule('oms'); if (g) return g
  // Pull all orders (paginate past the 1000 cap)
  const orders: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('oms_orders')
      .select('state, created_at, confirmed_at, dispatched_at, is_duplicate, risk_level, address_complete, cod_amount, tracking_number')
      .neq('state', 'observed')   // workflow KPIs only — exclude the full-mirror rows
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    orders.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  const total = orders.length
  const byState: Record<string, number> = {}
  for (const o of orders) byState[o.state] = (byState[o.state] ?? 0) + 1

  const confirmedish = (byState.confirmed ?? 0) + (byState.ready_to_dispatch ?? 0) + (byState.dispatched ?? 0)
  const cancelled    = byState.cancelled ?? 0
  const decided      = confirmedish + cancelled
  const confirmationRate = decided ? Math.round((confirmedish / decided) * 1000) / 10 : 0

  // Time-to-confirmation (minutes) for orders with a confirmed_at
  const ttc = orders.filter(o => o.confirmed_at)
    .map(o => Math.max(0, Math.round((new Date(o.confirmed_at!).getTime() - new Date(o.created_at).getTime()) / 60000)))
  const medianTtcMin = median(ttc)

  const codCancelled = orders.filter(o => o.state === 'cancelled').reduce((s, o) => s + (o.cod_amount || 0), 0)

  // NDR: dispatched OMS orders whose courier record shows failed attempts.
  const dispatchedTns = orders.filter(o => o.state === 'dispatched' && o.tracking_number).map(o => o.tracking_number as string)
  let ndrCount = 0
  if (dispatchedTns.length) {
    for (let i = 0; i < dispatchedTns.length; i += 300) {
      const { data } = await supabaseAdmin.from('courier_orders')
        .select('attempt_count, norm_status')
        .in('tracking_number', dispatchedTns.slice(i, i + 300))
        .gt('attempt_count', 0).neq('norm_status', 'delivered')
      ndrCount += (data ?? []).length
    }
  }

  // Agent productivity from the audit log (last 30 days)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: events } = await supabaseAdmin.from('oms_events')
    .select('actor, event_type').gte('created_at', since).eq('event_type', 'state_change').limit(5000)
  const agents: Record<string, number> = {}
  for (const e of events ?? []) {
    if (typeof e.actor === 'string' && e.actor.startsWith('agent')) agents[e.actor] = (agents[e.actor] ?? 0) + 1
  }

  return NextResponse.json({
    total,
    byState,
    confirmationRate,                          // %
    medianTimeToConfirmMin: medianTtcMin,
    preDispatchCancels: cancelled,             // each = a prevented RTO
    codValueCancelled: Math.round(codCancelled),
    incompleteAddressRate: total ? Math.round(((byState.incomplete_address ?? 0) / total) * 1000) / 10 : 0,
    duplicateRate:         total ? Math.round((orders.filter(o => o.is_duplicate).length / total) * 1000) / 10 : 0,
    highRiskRate:          total ? Math.round((orders.filter(o => o.risk_level === 'high').length / total) * 1000) / 10 : 0,
    dispatched:            byState.dispatched ?? 0,
    ndrOpen:               ndrCount,
    agentProductivity:     Object.entries(agents).map(([agent, actions]) => ({ agent, actions })).sort((a, b) => b.actions - a.actions),
  })
}
