import { supabaseAdmin } from '@/lib/hub/supabase'
import { normaliseOrder, type ShopifyOrderNode } from '@/lib/shopify'
import { logOmsEvent } from '@/lib/oms/events'
import { TERMINAL_STATES, type OmsState } from '@/lib/oms/state'

// ════════════════════════════════════════════════════════════════════════════
// Full-mirror ingest — the SIDE-EFFECT-FREE half of order ingestion.
// mirrorOrder() faithfully reflects a Shopify order into oms_orders and NOTHING
// else: it never sends WhatsApp, never calls Claude, never writes to Shopify.
// The workflow half (lib/oms/ingest.ts › ingestOrder) is invoked separately, and
// only for brand-new ACTIVE orders (mirrorOrder returns enterWorkflow=true).
// ════════════════════════════════════════════════════════════════════════════

export type Lifecycle = 'active' | 'observed'

const DEFAULT_CUTOFF = '2026-07-01T00:00:00Z'

async function activationCutoff(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'oms_activation_cutoff').single()
    return data?.value || DEFAULT_CUTOFF
  } catch { return DEFAULT_CUTOFF }
}

const FULFILLED_STATES = new Set(['FULFILLED', 'PARTIALLY_FULFILLED', 'RESTOCKED'])

/**
 * Classify a Shopify order into the confirmation workflow (`active`) or a pure
 * read-only mirror row (`observed`). Only recent, open, unfulfilled orders are
 * actionable — everything else (fulfilled, cancelled, archived, or pre-OMS) is
 * observed so it is mirrored but never messaged.
 */
export function classifyLifecycle(node: ShopifyOrderNode, cutoffIso: string): Lifecycle {
  if (node.cancelledAt) return 'observed'
  if (FULFILLED_STATES.has((node.displayFulfillmentStatus ?? '').toUpperCase())) return 'observed'
  if (node.closedAt) return 'observed'
  const unfulfilled = (node.displayFulfillmentStatus ?? '').toUpperCase() === 'UNFULFILLED'
  if (!unfulfilled) return 'observed'
  const when = node.processedAt ?? node.createdAt ?? null
  return when && when >= cutoffIso ? 'active' : 'observed'
}

export interface MirrorResult {
  id: number | null
  created: boolean
  lifecycle: Lifecycle
  enterWorkflow: boolean   // caller should run ingestOrder() for this (new active order)
  changed: boolean
}

/**
 * Upsert one Shopify order into the mirror. Idempotent and side-effect-free.
 * - New + observed  → insert a mirror row (state='observed').
 * - New + active    → return enterWorkflow=true (workflow owns the insert/triage).
 * - Existing        → refresh mirror fields (high-water guard on Shopify updatedAt);
 *                     retire mid-workflow orders to 'observed' if Shopify has since
 *                     fulfilled/cancelled them out-of-band.
 */
export async function mirrorOrder(node: ShopifyOrderNode): Promise<MirrorResult> {
  const cutoff    = await activationCutoff()
  const lifecycle = classifyLifecycle(node, cutoff)
  const d         = normaliseOrder(node)                 // pure — no Claude / no network
  const incomingUpdated = node.updatedAt ?? node.createdAt ?? null

  const { data: existing } = await supabaseAdmin
    .from('oms_orders')
    .select('id, state, raw_shopify_order')
    .eq('shopify_order_id', d.shopify_order_id)
    .maybeSingle()

  // Mirror fields refreshed on every sync (workflow columns are never touched).
  const mirrorFields = {
    order_number:  d.order_number,
    customer_name: d.customer_name,
    phone:         d.phone,
    address_raw:   d.address_raw,
    address_area:  d.address_area,
    city:          d.city,
    items:         d.items,
    cod_amount:    d.cod_amount,
    raw_shopify_order: d.raw_shopify_order,
    updated_at:    new Date().toISOString(),
  }

  if (!existing) {
    if (lifecycle === 'active') {
      // Brand-new actionable order → let the workflow own insert + triage.
      return { id: null, created: false, lifecycle, enterWorkflow: true, changed: true }
    }
    const { data: ins, error } = await supabaseAdmin.from('oms_orders')
      .insert({ shopify_order_id: d.shopify_order_id, state: 'observed', ...mirrorFields })
      .select('id').single()
    if (error) throw new Error(error.message)
    return { id: ins.id as number, created: true, lifecycle, enterWorkflow: false, changed: true }
  }

  // Existing row — high-water guard: only rewrite when Shopify's copy is newer.
  const storedUpdated = (existing.raw_shopify_order as { updatedAt?: string } | null)?.updatedAt ?? null
  const changed = !storedUpdated || !incomingUpdated || incomingUpdated >= storedUpdated
  const curState = existing.state as OmsState

  if (changed) {
    await supabaseAdmin.from('oms_orders').update(mirrorFields).eq('id', existing.id)
  }

  // Shopify fulfilled/cancelled a still-in-workflow order out-of-band → retire it
  // to 'observed'. Terminal states (dispatched/cancelled/observed) are left alone.
  if (lifecycle === 'observed' && !TERMINAL_STATES.includes(curState)) {
    await supabaseAdmin.from('oms_orders')
      .update({ state: 'observed', updated_at: new Date().toISOString() }).eq('id', existing.id)
    await logOmsEvent(existing.id as number, {
      type: 'state_change', from: curState, to: 'observed',
      detail: 'retired to mirror (Shopify fulfilled/cancelled out-of-band)',
    })
  }

  return { id: existing.id as number, created: false, lifecycle, enterWorkflow: false, changed }
}

// ── Batched mirror (backfill / reconcile) ───────────────────────────────────
// One existence-fetch + bulk upserts instead of a round-trip per order — keeps
// the backfill well inside the serverless time limit even for large windows.
// Still side-effect-free; new ACTIVE orders are returned for the caller to run
// through the workflow (rare, since the tick/webhook already ingest live ones).

export interface BatchResult { seen: number; upserted: number; inserted: number; observed: number; active: number; retired: number }

// Rules-based triage for a NEW active order — no Claude / no risk / no network,
// so it's safe to run in bulk. Real-time single orders (webhook) still get the
// full ingestOrder() treatment (Claude address AI + risk hold + WhatsApp).
function lightState(d: ReturnType<typeof normaliseOrder>): OmsState {
  if (!d.address_complete) return 'incomplete_address'
  if (d.is_prepaid)        return 'confirmed'
  return 'pending_confirmation'
}

export async function mirrorOrdersBatch(nodes: ShopifyOrderNode[]): Promise<BatchResult> {
  const cutoff = await activationCutoff()
  const nowIso = new Date().toISOString()
  const ids    = nodes.map(n => n.id)

  // Pre-fetch existing rows' current state (to preserve workflow state on update).
  const existing = new Map<string, string>()
  if (ids.length) {
    const { data: ex } = await supabaseAdmin.from('oms_orders').select('shopify_order_id, state').in('shopify_order_id', ids)
    for (const r of ex ?? []) existing.set(r.shopify_order_id as string, r.state as string)
  }

  // Two record shapes → two upsert calls. PostgREST bulk upsert requires every
  // object in a batch to share the SAME keys, so we keep "mirror-only" rows
  // (base + state) separate from new active rows (base + state + address_*).
  const recMirror: Record<string, unknown>[] = []   // observed-new + all existing
  const recActive: Record<string, unknown>[] = []   // new active (extra address cols)
  let observed = 0, active = 0, retired = 0, inserted = 0

  for (const node of nodes) {
    const lifecycle = classifyLifecycle(node, cutoff)
    if (lifecycle === 'observed') observed++; else active++
    const d = normaliseOrder(node)
    const base = {
      shopify_order_id: d.shopify_order_id,
      order_number:  d.order_number,
      customer_name: d.customer_name,
      phone:         d.phone,
      address_raw:   d.address_raw,
      address_area:  d.address_area,
      city:          d.city,
      items:         d.items,
      cod_amount:    d.cod_amount,
      raw_shopify_order: d.raw_shopify_order,
      updated_at:    nowIso,
    }
    const prev = existing.get(d.shopify_order_id)
    if (prev === undefined) {
      inserted++
      if (lifecycle === 'active') {
        recActive.push({ ...base, state: lightState(d), address_complete: d.address_complete, address_score: d.address_score })
      } else {
        recMirror.push({ ...base, state: 'observed' })
      }
    } else {
      // Preserve the existing workflow state — unless Shopify has fulfilled/
      // cancelled it out-of-band, in which case retire it to 'observed'.
      let state = prev
      if (lifecycle === 'observed' && !TERMINAL_STATES.includes(prev as OmsState)) { state = 'observed'; retired++ }
      recMirror.push({ ...base, state })
    }
  }

  let upserted = 0
  for (const records of [recMirror, recActive]) {
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500)
      const { error } = await supabaseAdmin.from('oms_orders').upsert(batch, { onConflict: 'shopify_order_id' })
      if (error) throw new Error(error.message)
      upserted += batch.length
    }
  }

  return { seen: nodes.length, upserted, inserted, observed, active, retired }
}
