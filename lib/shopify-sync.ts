// OMS → Shopify write-back — the ONLY place that mutates Shopify.
// SAFETY MODEL (see docs/OMS_SPEC.md §1A):
//   • Kill-switch: oms_settings.shopify_writeback_enabled (default FALSE).
//   • Mode: 'shadow' (default) logs the intended write and sends NOTHING.
//   • Additive-only: tagsAdd (never replaces); notes are appended.
//   • Destructive ops (cancel / address) gated behind explicit settings.
//   • Every attempt — shadow or live — is logged to oms_events.
import { supabaseAdmin } from '@/lib/hub/supabase'
import { shopifyGraphQL } from '@/lib/shopify'
import { STATE_TAG, type OmsState } from '@/lib/oms/state'
import { isSideEffectsSuppressed } from '@/lib/oms/suppress'

export interface OmsSettings {
  shopify_writeback_enabled: boolean
  shopify_writeback_mode:    'shadow' | 'live'
  auto_cancel_to_shopify:    boolean
  auto_cancel_daily_cap:     number
  backfill_days:             number
}

const DEFAULT_SETTINGS: OmsSettings = {
  shopify_writeback_enabled: false,   // OFF until explicitly enabled
  shopify_writeback_mode:    'shadow',
  auto_cancel_to_shopify:    false,
  auto_cancel_daily_cap:     20,
  backfill_days:             14,
}

export async function getOmsSettings(): Promise<OmsSettings> {
  try {
    const { data } = await supabaseAdmin.from('oms_settings').select('*').eq('id', 1).single()
    return { ...DEFAULT_SETTINGS, ...(data ?? {}) }
  } catch { return DEFAULT_SETTINGS }   // table missing → safe defaults (shadow/off)
}

export type ShopifyChange =
  | { kind: 'state_tag'; state: OmsState }
  | { kind: 'tag';         tag: string }
  | { kind: 'note';        text: string }
  | { kind: 'cancel';      reason: string }
  | { kind: 'fulfillment'; trackingNumber: string; courier: string }
  | { kind: 'address';     address1: string; city: string }

export interface SyncResult { sent: boolean; shadow: boolean; skipped?: string; error?: string }

// Human-readable description of what a change WOULD do (used in shadow logs).
function describe(change: ShopifyChange): string {
  switch (change.kind) {
    case 'state_tag':   return `add tag "${STATE_TAG[change.state]}"`
    case 'tag':         return `add tag "${change.tag}"`
    case 'note':        return `append note "${change.text}"`
    case 'cancel':      return `cancel order (reason: ${change.reason})`
    case 'fulfillment': return `create fulfillment ${change.courier} ${change.trackingNumber}`
    case 'address':     return `update address → ${change.address1}, ${change.city}`
  }
}

async function logEvent(orderId: number | null, type: string, detail: string, payload: unknown) {
  try {
    await supabaseAdmin.from('oms_events').insert({
      order_id: orderId, event_type: type, actor: 'system', channel: 'shopify', detail,
      payload: payload as never,
    })
  } catch { /* never let audit logging break the flow */ }
}

// ── GraphQL mutations (only reached in LIVE mode) ───────────────────────────

async function gqlAddTags(gid: string, tags: string[]) {
  return shopifyGraphQL(`mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id,tags:$tags){ userErrors{ field message } } }`, { id: gid, tags })
}
async function gqlAppendNote(gid: string, text: string) {
  // read-before-write: fetch current note, append (never overwrite)
  const cur = await shopifyGraphQL<{ order: { note: string | null } }>(`query($id:ID!){ order(id:$id){ note } }`, { id: gid })
  const note = [cur.order?.note, `[OMS ${new Date().toISOString().slice(0, 16)}] ${text}`].filter(Boolean).join('\n')
  return shopifyGraphQL(`mutation($id:ID!,$note:String){ orderUpdate(input:{id:$id,note:$note}){ userErrors{ field message } } }`, { id: gid, note })
}
async function gqlCreateFulfillment(gid: string, trackingNumber: string, courier: string) {
  const fo = await shopifyGraphQL<{ order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null }>(
    `query($id:ID!){ order(id:$id){ fulfillmentOrders(first:10){ nodes{ id status } } } }`, { id: gid })
  const open = (fo.order?.fulfillmentOrders?.nodes ?? []).filter(n => n.status === 'OPEN' || n.status === 'IN_PROGRESS')
  const company = courier === 'postex' ? 'PostEx' : 'Leopards'
  for (const f of open) {
    await shopifyGraphQL(
      `mutation($fo:ID!,$tn:String!,$co:String!){ fulfillmentCreateV2(fulfillment:{ lineItemsByFulfillmentOrder:[{fulfillmentOrderId:$fo}], trackingInfo:{ number:$tn, company:$co }, notifyCustomer:false }){ userErrors{ field message } } }`,
      { fo: f.id, tn: trackingNumber, co: company })
  }
}

/**
 * Apply an OMS change to Shopify — but only for real when the kill-switch is ON
 * and mode is 'live'. Otherwise it's logged as shadow and nothing is sent.
 */
export async function shopifySync(orderId: number | null, shopifyGid: string, change: ShopifyChange): Promise<SyncResult> {
  const settings = await getOmsSettings()
  const desc     = describe(change)

  // Global suppression (mass import) OR shadow / disabled → log intent, send nothing.
  if (await isSideEffectsSuppressed()) {
    await logEvent(orderId, 'shopify_sync_shadow', `SUPPRESSED (mass import) — WOULD ${desc}`, { change, gid: shopifyGid })
    return { sent: false, shadow: true, skipped: 'suppressed' }
  }
  if (!settings.shopify_writeback_enabled || settings.shopify_writeback_mode === 'shadow') {
    await logEvent(orderId, 'shopify_sync_shadow', `WOULD ${desc}`, { change, gid: shopifyGid })
    return { sent: false, shadow: true }
  }

  // LIVE — enforce per-op safety gates before touching Shopify.
  try {
    switch (change.kind) {
      case 'state_tag': await gqlAddTags(shopifyGid, [STATE_TAG[change.state]]); break
      case 'tag':       await gqlAddTags(shopifyGid, [change.tag]); break
      case 'note':      await gqlAppendNote(shopifyGid, change.text); break
      case 'cancel': {
        // TAG-ONLY by design — the OMS NEVER cancels the real Shopify order,
        // it only adds an "oms-cancelled" tag. The order stays open in Shopify.
        await gqlAddTags(shopifyGid, ['oms-cancelled'])
        await logEvent(orderId, 'shopify_sync', 'tagged oms-cancelled (tag-only — Shopify order NOT cancelled)', { change })
        return { sent: true, shadow: false, skipped: 'tag-only-cancel' }
      }
      case 'fulfillment':
        await gqlCreateFulfillment(shopifyGid, change.trackingNumber, change.courier)
        break
      case 'address':
        // Overwriting a live Shopify shipping address is destructive — kept gated.
        await logEvent(orderId, 'shopify_sync', 'address write-back deferred (kept gated for safety)', { change })
        return { sent: false, shadow: false, skipped: 'address-deferred' }
    }
    await supabaseAdmin.from('oms_orders').update({ shopify_synced_at: new Date().toISOString(), shopify_sync_error: null }).eq('shopify_order_id', shopifyGid)
    await logEvent(orderId, 'shopify_sync', `did ${desc}`, { change })
    return { sent: true, shadow: false }
  } catch (err) {
    const msg = String(err).slice(0, 300)
    await supabaseAdmin.from('oms_orders').update({ shopify_sync_error: msg }).eq('shopify_order_id', shopifyGid)
    await logEvent(orderId, 'shopify_sync_error', `FAILED ${desc}`, { change, error: msg })
    return { sent: false, shadow: false, error: msg }
  }
}
