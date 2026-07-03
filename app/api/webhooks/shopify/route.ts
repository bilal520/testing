import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getOrder } from '@/lib/shopify'
import { mirrorOrder } from '@/lib/oms/mirror'
import { ingestOrder } from '@/lib/oms/ingest'
import { attributeOrder } from '@/lib/cars/attribution'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { logOmsEvent } from '@/lib/oms/events'

export const dynamic = 'force-dynamic'

// Shopify order webhooks → keep the full mirror in sync in near-real-time.
// Handles orders/{create,updated,cancelled,fulfilled,delete}. Every event
// refreshes the mirror (side-effect-free); a brand-new ACTIVE order additionally
// enters the confirmation workflow. Fulfilled/cancelled orders are mirrored as
// 'observed' by the classifier — no customer is ever messaged from here.
export async function POST(req: NextRequest) {
  const raw   = await req.text()
  const topic = req.headers.get('x-shopify-topic') ?? ''

  // HMAC verification (enforced only when the secret is configured).
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (secret) {
    const hmac = req.headers.get('x-shopify-hmac-sha256') ?? ''
    const digest = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
    const ok = hmac.length === digest.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest))
    if (!ok) return NextResponse.json({ error: 'invalid hmac' }, { status: 401 })
  }

  let payload: { id?: number | string }
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }
  if (!payload.id) return NextResponse.json({ ok: true })
  const gid = `gid://shopify/Order/${payload.id}`

  // Deletion → retire the mirror row to 'observed' (kept for the audit trail).
  if (topic === 'orders/delete') {
    const { data } = await supabaseAdmin.from('oms_orders').select('id, state').eq('shopify_order_id', gid).maybeSingle()
    if (data) {
      await supabaseAdmin.from('oms_orders').update({ state: 'observed', updated_at: new Date().toISOString() }).eq('id', data.id)
      await logOmsEvent(data.id as number, { type: 'shopify_delete', channel: 'shopify', from: data.state as string, to: 'observed', detail: 'order deleted in Shopify' })
    }
    return NextResponse.json({ ok: true, topic })
  }

  // All other topics → re-fetch the canonical GraphQL node and mirror it.
  try {
    const node = await getOrder(gid)
    if (node) {
      const r = await mirrorOrder(node)
      if (r.enterWorkflow) await ingestOrder(node)
      // CARS: match this order back to a recovery message (idempotent).
      await attributeOrder(node).catch(() => {})
    }
  } catch {
    // Never fail the webhook — Shopify retries on non-2xx; we log-and-move-on.
  }
  return NextResponse.json({ ok: true, topic })
}
