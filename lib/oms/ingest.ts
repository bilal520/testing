import { supabaseAdmin } from '@/lib/hub/supabase'
import { normaliseOrder, type ShopifyOrderNode } from '@/lib/shopify'
import { shopifySync } from '@/lib/shopify-sync'
import { logOmsEvent } from '@/lib/oms/events'
import { computeRisk } from '@/lib/oms/risk'
import { classifyAddress } from '@/lib/oms/address-ai'
import { sendOmsWhatsapp } from '@/lib/oms/whatsapp'
import { getRtoProfile } from '@/lib/oms/rto'
import type { OmsState } from '@/lib/oms/state'

export interface IngestResult { id: number | null; state: OmsState | 'existing'; created: boolean; isDuplicate?: boolean }

/**
 * Ingest one Shopify order into the OMS: normalise → snapshot → duplicate check
 * → triage state → insert → audit → shadow-sync the state tag.
 * Idempotent: an order already present (by shopify_order_id) is skipped.
 */
export async function ingestOrder(node: ShopifyOrderNode): Promise<IngestResult> {
  const d = normaliseOrder(node)

  // Idempotency — never double-ingest.
  const { data: exists } = await supabaseAdmin
    .from('oms_orders').select('id').eq('shopify_order_id', d.shopify_order_id).maybeSingle()
  if (exists) return { id: exists.id as number, state: 'existing', created: false }

  // Basic duplicate detection: same phone, active order, last 7 days.
  let isDuplicate = false
  let duplicateOf: number | null = null
  if (d.phone) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data: dup } = await supabaseAdmin
      .from('oms_orders').select('id')
      .eq('phone', d.phone).gte('created_at', since).neq('state', 'cancelled')
      .limit(1)
    if (dup && dup.length) { isDuplicate = true; duplicateOf = dup[0].id as number }
  }

  // Address AI refinement (Phase 3) — only for borderline addresses, to bound cost.
  let addressComplete = d.address_complete
  if (d.address_score < 85) {
    const ai = await classifyAddress(d.address_raw, d.city)
    if (ai) addressComplete = ai.complete
  }

  // Risk scoring (Phase 4) — city return rate + COD value + address quality.
  const risk = await computeRisk({ city: d.city, codAmount: d.cod_amount, addressScore: d.address_score })

  // RTO defense (Phase 2a) — has this phone had parcels RETURNED before?
  const rto = await getRtoProfile(d.phone)
  const isRto = rto.returnCount > 0

  // Triage → initial state.
  //  duplicate            → review_hold
  //  repeat returner      → rto_hold      (agent decides prepaid / confirm / cancel)
  //  incomplete address   → incomplete_address
  //  high risk            → review_hold
  //  prepaid + complete   → confirmed (no COD call needed)
  //  COD + complete       → pending_confirmation
  const state: OmsState =
    isDuplicate            ? 'review_hold'
    : isRto                ? 'rto_hold'
    : !addressComplete     ? 'incomplete_address'
    : risk.level === 'high'? 'review_hold'
    : d.is_prepaid         ? 'confirmed'
    :                        'pending_confirmation'

  const { data: inserted, error } = await supabaseAdmin.from('oms_orders').insert({
    shopify_order_id: d.shopify_order_id,
    order_number:     d.order_number,
    customer_name:    d.customer_name,
    phone:            d.phone,
    address_raw:      d.address_raw,
    address_area:     d.address_area,
    city:             d.city,
    address_complete: addressComplete,
    address_score:    d.address_score,
    items:            d.items,
    cod_amount:       d.cod_amount,
    state,
    is_duplicate:     isDuplicate,
    duplicate_of:     duplicateOf,
    risk_score:       risk.score,
    risk_level:       risk.level,
    risk_factors:     risk.factors,
    rto_return_count:   rto.returnCount,
    rto_last_return_at: rto.lastReturnAt,
    rto_reasons:        rto.reasons,
    raw_shopify_order: d.raw_shopify_order,
    next_action_at:   new Date().toISOString(),
  }).select('id').single()

  if (error) throw new Error(error.message)
  const id = inserted.id as number

  await logOmsEvent(id, { type: 'state_change', from: 'new', to: state, detail: isDuplicate ? 'ingested (duplicate)' : 'ingested' })
  // Mirror the state tag to Shopify (shadow-mode by default — logs, sends nothing).
  await shopifySync(id, d.shopify_order_id, { kind: 'state_tag', state })

  // Kick off the confirmation touch (WhatsApp gated → shadow-logs until enabled).
  const waCtx = { order_number: d.order_number, customer_name: d.customer_name, city: d.city, cod_amount: d.cod_amount }
  if (state === 'pending_confirmation')    await sendOmsWhatsapp(id, d.phone, 'order_confirm', waCtx)
  else if (state === 'incomplete_address') await sendOmsWhatsapp(id, d.phone, 'address_request', waCtx)

  return { id, state, created: true, isDuplicate }
}
