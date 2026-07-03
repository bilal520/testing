import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { logOmsEvent } from '@/lib/oms/events'
import { shopifySync } from '@/lib/shopify-sync'
import { sendOmsWhatsapp, isWhatsappEnabled } from '@/lib/oms/whatsapp'
import { listOrdersUpdatedSince } from '@/lib/shopify'
import { mirrorOrdersBatch } from '@/lib/oms/mirror'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const MAX_ATTEMPTS = 3

// SLA / retry heartbeat (Phase 2). Cron-driven. Automates the confirmation
// cadence so agents only handle exceptions:
//  • pending_confirmation, >4h old, not yet reminded → send reminder
//  • no_answer past next_action_at → reminder + reschedule, or auto-cancel after N
// WhatsApp sends are gated (shadow-log until templates live). Auto-cancel writes
// OMS state + a Shopify TAG only (never a real Shopify cancel unless separately enabled).
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now  = new Date()
  const nowI = now.toISOString()
  let reminded = 0, cancelled = 0, firstReminders = 0, mirrored = 0

  // 0) Incremental full-mirror sync — reflect ALL order changes (create, edit,
  // fulfil, cancel) since the last high-water mark, regardless of status. Keeps
  // the dashboard identical to Shopify between reconciles. Uses the batched,
  // side-effect-free mirror (light rules-based triage for new active orders).
  try {
    const CURSOR = 'oms_mirror_incremental_cursor'
    const { data: cur } = await supabaseAdmin.from('site_settings').select('value').eq('key', CURSOR).single()
    const sinceIso = cur?.value || new Date(now.getTime() - 2 * 86_400_000).toISOString()
    let after: string | null = null, hw = sinceIso, pages = 0
    do {
      const page = await listOrdersUpdatedSince(sinceIso, after, 250)
      const r = await mirrorOrdersBatch(page.nodes)
      mirrored += r.upserted
      for (const node of page.nodes) if (node.updatedAt && node.updatedAt > hw) hw = node.updatedAt
      after = page.hasNextPage ? page.endCursor : null
      pages++
    } while (after && pages < 20)
    await supabaseAdmin.from('site_settings').upsert({ key: CURSOR, value: hw, updated_at: nowI }, { onConflict: 'key' })
  } catch { /* Shopify hiccup — retries next tick */ }

  // 0b) Auto "picked by courier" — advance picked_up → dispatched once the
  // courier tracking shows real movement (parcel actually left the warehouse).
  try {
    const { data: picked } = await supabaseAdmin.from('oms_orders')
      .select('id, tracking_number').eq('state', 'picked_up').not('tracking_number', 'is', null).limit(300)
    for (const o of picked ?? []) {
      const { data: co } = await supabaseAdmin.from('courier_orders')
        .select('norm_status').eq('tracking_number', o.tracking_number).maybeSingle()
      if (co && ['in_transit', 'out_for_delivery', 'delivered', 'attempted', 'returned'].includes(co.norm_status as string)) {
        await supabaseAdmin.from('oms_orders').update({ state: 'dispatched', updated_at: nowI }).eq('id', o.id)
        await logOmsEvent(o.id as number, { type: 'state_change', actor: 'system', channel: 'system', from: 'picked_up', to: 'dispatched', detail: `courier movement (${co.norm_status})` })
      }
    }
  } catch { /* retries next tick */ }

  const ctx = (o: Record<string, unknown>) => ({
    order_number: String(o.order_number ?? ''), customer_name: String(o.customer_name ?? ''),
    city: String(o.city ?? ''), cod_amount: Number(o.cod_amount ?? 0),
  })

  // The reminder + no-answer + auto-cancel loop only runs when WhatsApp is LIVE.
  // While gated (shadow), no customer is actually contacted, so we must NOT
  // count "no answer" or auto-cancel — that would wrongly cancel real orders.
  if (!(await isWhatsappEnabled())) {
    return NextResponse.json({ ok: true, mirrored, retryLoop: 'skipped (WhatsApp gated)', firstReminders: 0, reminded: 0, cancelled: 0 })
  }

  // 1) First reminder for pending orders older than 4h with no attempt yet.
  const fourHrsAgo = new Date(now.getTime() - 4 * 3_600_000).toISOString()
  const { data: pending } = await supabaseAdmin.from('oms_orders')
    .select('*').eq('state', 'pending_confirmation').eq('confirmation_attempts', 0)
    .lt('created_at', fourHrsAgo).limit(300)
  for (const o of pending ?? []) {
    await supabaseAdmin.from('oms_orders').update({ confirmation_attempts: 1, next_action_at: new Date(now.getTime() + 6 * 3_600_000).toISOString(), updated_at: nowI }).eq('id', o.id)
    await sendOmsWhatsapp(o.id as number, o.phone as string, 'confirm_reminder', ctx(o))
    await logOmsEvent(o.id as number, { type: 'retry', detail: 'auto reminder (pending 4h+)' })
    firstReminders++
  }

  // 2) no_answer orders whose retry time has passed → reminder/reschedule or cancel.
  const { data: due } = await supabaseAdmin.from('oms_orders')
    .select('*').eq('state', 'no_answer').lte('next_action_at', nowI).limit(300)
  for (const o of due ?? []) {
    const attempts = (o.confirmation_attempts as number ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      const reason = `unreachable after ${attempts} attempts`
      await supabaseAdmin.from('oms_orders').update({ state: 'cancelled', confirmation_attempts: attempts, cancel_reason: reason, updated_at: nowI }).eq('id', o.id)
      await logOmsEvent(o.id as number, { type: 'state_change', from: 'no_answer', to: 'cancelled', detail: 'auto-cancel (unreachable)' })
      await shopifySync(o.id as number, o.shopify_order_id as string, { kind: 'state_tag', state: 'cancelled' })
      await shopifySync(o.id as number, o.shopify_order_id as string, { kind: 'cancel', reason })
      cancelled++
    } else {
      await supabaseAdmin.from('oms_orders').update({ confirmation_attempts: attempts, next_action_at: new Date(now.getTime() + 24 * 3_600_000).toISOString(), updated_at: nowI }).eq('id', o.id)
      await sendOmsWhatsapp(o.id as number, o.phone as string, 'confirm_reminder', ctx(o))
      await logOmsEvent(o.id as number, { type: 'retry', detail: `auto retry attempt ${attempts}` })
      reminded++
    }
  }

  return NextResponse.json({ ok: true, mirrored, firstReminders, reminded, cancelled })
}
