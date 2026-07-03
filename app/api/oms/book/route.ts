import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { canBook } from '@/lib/oms/state'
import { logOmsEvent } from '@/lib/oms/events'
import { shopifySync } from '@/lib/shopify-sync'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// Dispatch a confirmed order. Guard: ONLY from ready_to_dispatch (the whole point
// of the OMS — nothing ships unconfirmed). The agent books in the courier portal
// and enters the CN here; we record it, mark dispatched, and write the Shopify
// fulfillment (which flows into courier_orders + Courier Intelligence).
// (Direct-API booking via PostEx create-order / Leopards bookPacket is a future
// enhancement — it needs the merchant pickup/shipper config + a supervised test.)
export async function POST(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const body = await req.json().catch(() => null) as { orderId?: number; courier?: string; trackingNumber?: string } | null
  const courier = body?.courier
  if (!body?.orderId || !courier || !['postex', 'leopards'].includes(courier)) {
    return NextResponse.json({ error: 'orderId and courier (postex|leopards) required' }, { status: 400 })
  }
  const tracking = (body.trackingNumber ?? '').trim()
  if (!tracking) {
    return NextResponse.json({ error: 'tracking number (CN) required — book in the courier portal, then enter the CN' }, { status: 400 })
  }

  const { data: order, error } = await supabaseAdmin.from('oms_orders').select('*').eq('id', body.orderId).single()
  if (error || !order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  if (!canBook(order.state)) {
    return NextResponse.json({ error: `order is "${order.state}", not ready_to_dispatch — confirm it first` }, { status: 409 })
  }

  const { error: upErr } = await supabaseAdmin.from('oms_orders').update({
    state: 'dispatched', courier, tracking_number: tracking,
    dispatched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', body.orderId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await logOmsEvent(body.orderId, { type: 'booked', actor: 'agent', channel: 'system', from: 'ready_to_dispatch', to: 'dispatched', detail: `${courier} ${tracking}` })
  await shopifySync(body.orderId, order.shopify_order_id, { kind: 'state_tag', state: 'dispatched' })
  await shopifySync(body.orderId, order.shopify_order_id, { kind: 'fulfillment', trackingNumber: tracking, courier })

  return NextResponse.json({ ok: true, courier, tracking })
}
