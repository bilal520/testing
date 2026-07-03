import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { queueFor, type OmsState, type OmsQueue } from '@/lib/oms/state'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface Row {
  id: number; order_number: string; customer_name: string; phone: string | null
  city: string; cod_amount: number; state: OmsState; is_duplicate: boolean
  risk_level: string; address_complete: boolean; address_score: number
  items: Array<{ name: string; qty: number }>; created_at: string; next_action_at: string | null
  confirmation_attempts: number; duplicate_of: number | null
  rto_return_count: number; payment_state: string | null
}

// GET — all active (non-terminal) orders grouped into agent queues, with counts.
export async function GET() {
  const g = await guardModule('oms'); if (g) return g
  const { data, error } = await supabaseAdmin
    .from('oms_orders')
    .select('id, order_number, customer_name, phone, city, cod_amount, state, is_duplicate, risk_level, address_complete, address_score, items, created_at, next_action_at, confirmation_attempts, duplicate_of, rto_return_count, payment_state')
    .not('state', 'in', '(dispatched,cancelled,observed,booked,cn_printed,packed,picked_up)')
    .order('created_at', { ascending: true })
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const queues: Record<OmsQueue, Row[]> = { rto: [], payments: [], pending: [], no_answer: [], incomplete_address: [], duplicates: [], high_risk: [], ready: [] }
  for (const r of (data ?? []) as Row[]) {
    const q = queueFor(r.state, r.is_duplicate, r.risk_level)
    if (q) queues[q].push(r)
  }

  // "attention flags" per order help the agent see what needs work
  const withFlags = (rows: Row[]) => rows.map(r => ({
    ...r,
    flags: [
      r.rto_return_count > 0 && `⚠ ${r.rto_return_count} prior return${r.rto_return_count === 1 ? '' : 's'}`,
      r.payment_state === 'awaiting' && 'Awaiting payment',
      r.payment_state === 'paid' && '✓ Paid',
      !r.phone && 'No phone',
      !r.address_complete && `Incomplete address (${r.address_score}/100)`,
      r.is_duplicate && 'Duplicate order',
      r.risk_level === 'high' && 'High risk',
      r.cod_amount >= 6000 && 'High COD value',
      r.confirmation_attempts > 0 && `${r.confirmation_attempts} attempt(s)`,
    ].filter(Boolean),
  }))

  return NextResponse.json({
    counts: {
      rto:                queues.rto.length,
      payments:           queues.payments.length,
      pending:            queues.pending.length,
      no_answer:          queues.no_answer.length,
      incomplete_address: queues.incomplete_address.length,
      duplicates:         queues.duplicates.length,
      high_risk:          queues.high_risk.length,
      ready:              queues.ready.length,
    },
    queues: {
      rto:                withFlags(queues.rto),
      payments:           withFlags(queues.payments),
      pending:            withFlags(queues.pending),
      no_answer:          withFlags(queues.no_answer),
      incomplete_address: withFlags(queues.incomplete_address),
      duplicates:         withFlags(queues.duplicates),
      high_risk:          withFlags(queues.high_risk),
      ready:              withFlags(queues.ready),
    },
  })
}
