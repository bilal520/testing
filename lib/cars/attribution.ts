import { supabaseAdmin } from '@/lib/hub/supabase'
import { normalisePhone, type ShopifyOrderNode } from '@/lib/shopify'
import { getOrderDiscountCodes } from '@/lib/cars/shopify'
import { getCarsConfig } from '@/lib/cars/config'

// ════════════════════════════════════════════════════════════════════════════
// Revenue attribution — match a new order back to a recovery message.
//  Tier 1 (exact)    : order used a unique recovery discount code.
//  Tier 3 (probable) : order phone matches a messaged checkout within the window.
//  (Tier 2 checkout-token: not exposed by GraphQL Order — deferred.)
// Confirmed = exact/high, Assisted = probable. See docs/CARS_SPEC.md §7.
// ════════════════════════════════════════════════════════════════════════════

export async function attributeOrder(node: ShopifyOrderNode, opts: { withCodes?: boolean } = {}): Promise<boolean> {
  const gid = node.id
  if (!gid) return false
  const { data: exists } = await supabaseAdmin.from('cars_recoveries').select('order_id').eq('order_id', gid).maybeSingle()
  if (exists) return false

  const phone = normalisePhone(node.phone) ?? normalisePhone(node.shippingAddress?.phone) ?? normalisePhone(node.customer?.phone)
  const total = Number(node.totalPriceSet?.shopMoney?.amount ?? 0)
  const createdAt = node.createdAt
  const cfg = await getCarsConfig()

  let checkoutId: string | null = null
  let method = ''
  let confidence = ''

  // Tier 1 — exact discount code
  if (opts.withCodes !== false) {
    const codes = await getOrderDiscountCodes(gid)
    if (codes.length) {
      const { data } = await supabaseAdmin.from('cars_checkouts')
        .select('checkout_id').in('discount_code', codes).limit(1).maybeSingle()
      if (data) { checkoutId = data.checkout_id as string; method = 'discount_code'; confidence = 'exact' }
    }
  }

  // Tier 3 — phone match within the attribution window
  if (!checkoutId && phone) {
    const winStart = new Date(new Date(createdAt).getTime() - cfg.attribution_window_hours * 3_600_000).toISOString()
    // Only a REAL send (not a shadow log) can have driven a recovery.
    const { data: msg } = await supabaseAdmin.from('cars_messages')
      .select('checkout_id, sent_at')
      .eq('phone', phone).in('status', ['sent', 'delivered', 'read'])
      .gte('sent_at', winStart).lte('sent_at', createdAt)
      .order('sent_at', { ascending: false }).limit(1).maybeSingle()
    if (msg) { checkoutId = msg.checkout_id as string; method = 'phone_match_48h'; confidence = 'probable' }
  }

  if (!checkoutId) return false

  // last message on the matched checkout → step + hours-to-order
  const { data: last } = await supabaseAdmin.from('cars_messages')
    .select('sequence_step, sent_at').eq('checkout_id', checkoutId)
    .order('sent_at', { ascending: false }).limit(1).maybeSingle()
  const lastStep = last ? Number(last.sequence_step ?? 0) : null
  const hours = last?.sent_at ? Math.round(((new Date(createdAt).getTime() - new Date(last.sent_at as string).getTime()) / 3_600_000) * 10) / 10 : null

  await supabaseAdmin.from('cars_recoveries').upsert({
    order_id: gid, order_name: node.name ?? null, checkout_id: checkoutId, phone,
    order_total: total, attribution_method: method, attribution_confidence: confidence,
    last_message_step: lastStep, hours_from_message_to_order: hours, recovered_at: new Date().toISOString(),
  }, { onConflict: 'order_id' })
  await supabaseAdmin.from('cars_checkouts').update({ status: 'recovered', updated_at: new Date().toISOString() }).eq('checkout_id', checkoutId)
  return true
}

/** Hourly safety-net sweep over recently-mirrored orders (missed webhooks).
 *  Tier-3 only (skips the per-order Shopify discount-code fetch). */
export async function attributeRecent(hours = 3): Promise<{ scanned: number; attributed: number }> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const { data } = await supabaseAdmin.from('oms_orders')
    .select('raw_shopify_order').gte('created_at', since).limit(500)
  let attributed = 0
  const rows = data ?? []
  for (const r of rows) {
    const node = r.raw_shopify_order as ShopifyOrderNode | null
    if (node?.id) { if (await attributeOrder(node, { withCodes: false })) attributed++ }
  }
  return { scanned: rows.length, attributed }
}
