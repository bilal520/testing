import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { canTransition, MOVE_TARGETS, type OmsState } from '@/lib/oms/state'
import { logOmsEvent } from '@/lib/oms/events'
import { shopifySync } from '@/lib/shopify-sync'
import { scoreAddress } from '@/lib/shopify'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 3

type Action =
  | 'confirm' | 'cancel' | 'no_answer' | 'fix_address' | 'release' | 'mark_ready' | 'merge'
  | 'move' | 'require_prepaid' | 'mark_paid' | 'add_note'

interface Body {
  orderId: number
  action:  Action
  agent?:  string
  reason?: string
  note?:   string
  to?:     OmsState                                   // for 'move'
  method?: 'jazzcash' | 'easypaisa' | 'bank'          // for 'mark_paid'
  amount?: number
  ref?:    string
  address?: { address1?: string; city?: string }
}

export async function POST(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const body = await req.json().catch(() => null) as Body | null
  if (!body?.orderId || !body?.action) {
    return NextResponse.json({ error: 'orderId and action required' }, { status: 400 })
  }

  const { data: order, error } = await supabaseAdmin.from('oms_orders').select('*').eq('id', body.orderId).single()
  if (error || !order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const from = order.state as OmsState
  const actor = body.agent ? `agent:${body.agent}` : 'agent'
  const now = new Date().toISOString()
  const note = (body.note ?? body.reason ?? '').trim()

  // add_note — just append a note to the timeline (no state change). Mandatory text.
  if (body.action === 'add_note') {
    if (!note) return NextResponse.json({ error: 'a note is required' }, { status: 400 })
    await logOmsEvent(body.orderId, { type: 'note', actor, channel: 'system', detail: note })
    return NextResponse.json({ ok: true, note: true })
  }

  const patch: Record<string, unknown> = { updated_at: now, assigned_agent: body.agent ?? order.assigned_agent }
  let to: OmsState = from
  let cancelToShopify = false
  let advanceToReady = false
  let manual = false                                   // manual moves bypass the transition guard

  switch (body.action) {
    case 'confirm': {
      // Always confirm first (a legal single hop). If the order is clean, we then
      // auto-advance the SECOND legal hop confirmed → ready_to_dispatch below.
      to = 'confirmed'
      patch.confirmed_at = now
      advanceToReady = order.address_complete && !order.is_duplicate && order.risk_level !== 'high'
      break
    }
    case 'cancel':
      if (!body.reason || !body.reason.trim()) {
        return NextResponse.json({ error: 'a cancel reason is required' }, { status: 400 })
      }
      to = 'cancelled'; patch.cancel_reason = body.reason.trim(); cancelToShopify = true
      break
    case 'no_answer': {
      const attempts = (order.confirmation_attempts ?? 0) + 1
      patch.confirmation_attempts = attempts
      if (attempts >= MAX_ATTEMPTS) {
        to = 'cancelled'; patch.cancel_reason = `unreachable after ${attempts} attempts`; cancelToShopify = true
      } else {
        to = 'no_answer'
        const next = new Date(Date.now() + 6 * 3_600_000).toISOString()   // retry in 6h
        patch.next_action_at = next
      }
      break
    }
    case 'fix_address': {
      const a1   = (body.address?.address1 ?? order.address_area ?? '').trim()
      const city = (body.address?.city ?? order.city ?? '').trim()
      const { score, complete } = scoreAddress(a1, '', city, order.phone)
      patch.address_area = a1; patch.address_raw = a1; patch.city = city
      patch.address_score = score; patch.address_complete = complete
      to = complete ? 'pending_confirmation' : 'incomplete_address'
      break
    }
    case 'release':  // release a duplicate/high-risk hold back into the flow
      to = 'pending_confirmation'; patch.is_duplicate = false
      break
    case 'merge':    // cancel this order as a duplicate of another (ship one parcel)
      to = 'cancelled'
      patch.cancel_reason = `merged — duplicate of order ${order.duplicate_of ? `#${order.duplicate_of}` : '(linked)'}`
      cancelToShopify = true
      break
    case 'mark_ready':
      to = 'ready_to_dispatch'
      break
    case 'move': {   // manual re-routing between tabs — note is mandatory
      if (!body.to || !(MOVE_TARGETS as string[]).includes(body.to)) {
        return NextResponse.json({ error: 'a valid destination tab is required' }, { status: 400 })
      }
      if (!note) return NextResponse.json({ error: 'a note explaining the move is required' }, { status: 400 })
      to = body.to; manual = true
      break
    }
    case 'require_prepaid': {   // send to Online Payments (prepaid) tab
      if (!note) return NextResponse.json({ error: 'a note (why prepaid) is required' }, { status: 400 })
      to = 'awaiting_payment'; manual = true
      patch.payment_state = 'awaiting'
      patch.payment_link_sent_at = now
      break
    }
    case 'mark_paid': {   // customer paid (manual confirm) → confirm the order
      if (!body.method || !(body.amount && body.amount > 0)) {
        return NextResponse.json({ error: 'payment method and amount are required' }, { status: 400 })
      }
      to = 'confirmed'; manual = true
      patch.payment_state = 'paid'
      patch.payment_method = body.method
      patch.payment_amount = body.amount
      patch.payment_ref = body.ref ?? null
      patch.paid_at = now
      patch.paid_by = body.agent ?? 'agent'
      patch.confirmed_at = now
      advanceToReady = order.address_complete && !order.is_duplicate && order.risk_level !== 'high'
      break
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  if (to !== from && !manual && !canTransition(from, to)) {
    return NextResponse.json({ error: `illegal transition ${from} → ${to}` }, { status: 409 })
  }

  patch.state = to
  const { error: upErr } = await supabaseAdmin.from('oms_orders').update(patch).eq('id', body.orderId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const evType = body.action === 'move' ? 'manual_move' : body.action === 'mark_paid' ? 'paid' : 'state_change'
  await logOmsEvent(body.orderId, { type: evType, actor, channel: 'system', from, to, detail: body.action + (note ? `: ${note}` : '') })

  // Mirror to Shopify (shadow-mode by default — nothing sent live)
  await shopifySync(body.orderId, order.shopify_order_id, { kind: 'state_tag', state: to })
  if (cancelToShopify) await shopifySync(body.orderId, order.shopify_order_id, { kind: 'cancel', reason: String(patch.cancel_reason) })

  // Second legal hop: a clean confirmed order auto-advances to ready_to_dispatch.
  let finalTo: OmsState = to
  if (advanceToReady && to === 'confirmed' && canTransition('confirmed', 'ready_to_dispatch')) {
    const { error: e2 } = await supabaseAdmin.from('oms_orders')
      .update({ state: 'ready_to_dispatch', updated_at: new Date().toISOString() }).eq('id', body.orderId)
    if (!e2) {
      await logOmsEvent(body.orderId, { type: 'state_change', actor, channel: 'system', from: 'confirmed', to: 'ready_to_dispatch', detail: 'auto-advanced (clean order)' })
      await shopifySync(body.orderId, order.shopify_order_id, { kind: 'state_tag', state: 'ready_to_dispatch' })
      finalTo = 'ready_to_dispatch'
    }
  }

  return NextResponse.json({ ok: true, from, to: finalTo })
}
