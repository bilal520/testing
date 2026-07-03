import { supabaseAdmin } from '@/lib/hub/supabase'
import { getCarsConfig, isCarsEnabled, isCarsPaused, getTestNumbers, type CarsConfig } from '@/lib/cars/config'
import { isSideEffectsSuppressed } from '@/lib/oms/suppress'
import { listAbandonedCheckouts, normaliseCheckout, type CarsCheckoutDraft } from '@/lib/cars/shopify'
import { createRecoveryCode } from '@/lib/cars/discounts'
import { sendRecovery } from '@/lib/cars/whatsapp'

// ════════════════════════════════════════════════════════════════════════════
// CARS sequence engine — ingest abandoned checkouts (+ exclusions) and advance
// due sequences. Lookups are BATCHED (bulk queries, not per-checkout) so the
// cron completes well inside its budget. Master switch OFF ⇒ sendRecovery
// shadow-logs and sends nothing. See docs/CARS_SPEC.md.
// ════════════════════════════════════════════════════════════════════════════

const now = () => new Date().toISOString()
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

// ── time helpers (Pakistan business clock) ──────────────────────────────────
function pktParts(): { date: string; minutes: number } {
  const d = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const h = Number(t.find(p => p.type === 'hour')?.value ?? 0)
  const m = Number(t.find(p => p.type === 'minute')?.value ?? 0)
  return { date, minutes: h * 60 + m }
}
function isInSendWindow(cfg: CarsConfig): boolean {
  const [a, b] = (cfg.send_window || '09:00-22:00').split('-')
  const toMin = (s: string) => { const [h, m] = s.trim().split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const { minutes } = pktParts()
  return minutes >= toMin(a) && minutes <= toMin(b)
}
function pktDayStartIso(): string { return new Date(`${pktParts().date}T00:00:00+05:00`).toISOString() }
function addMinutes(iso: string, min: number): string { return new Date(new Date(iso).getTime() + min * 60_000).toISOString() }

// ── batched lookups ─────────────────────────────────────────────────────────
/** phones that appear as an order at/after their checkout's abandonment. */
async function ordersByPhone(phones: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  const floor = new Date(Date.now() - 30 * 86_400_000).toISOString() // bound the fetch
  for (const c of chunk(phones, 200)) {
    const { data } = await supabaseAdmin.from('oms_orders').select('phone, created_at').in('phone', c).gte('created_at', floor)
    for (const r of (data ?? []) as Array<{ phone: string; created_at: string }>) (map[r.phone] ??= []).push(r.created_at)
  }
  return map
}
async function suppressedSet(phones: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (const c of chunk(phones, 200)) {
    const { data } = await supabaseAdmin.from('cars_suppression').select('phone').in('phone', c)
    for (const r of (data ?? []) as Array<{ phone: string }>) set.add(r.phone)
  }
  return set
}
async function existingCheckouts(ids: string[]): Promise<Record<string, { status: string; next_step: number }>> {
  const map: Record<string, { status: string; next_step: number }> = {}
  for (const c of chunk(ids, 200)) {
    const { data } = await supabaseAdmin.from('cars_checkouts').select('checkout_id, status, next_step').in('checkout_id', c)
    for (const r of (data ?? []) as Array<{ checkout_id: string; status: string; next_step: number }>) map[r.checkout_id] = { status: r.status, next_step: r.next_step }
  }
  return map
}
// Skip a cart if the customer ordered at/after the EARLIER of (their abandonment,
// or RECENT_ORDER_MS ago). The recent-order floor makes this robust even when
// abandoned_at is imprecise (e.g. a re-based/reset cart) — never chase someone
// who has bought in the last few days.
const RECENT_ORDER_MS = 96 * 3_600_000 // 4 days
function orderedRecently(orders: Record<string, string[]>, phone: string | null, abandonedAt: string): boolean {
  if (!phone) return false
  const cutoff = new Date(Math.min(new Date(abandonedAt).getTime(), Date.now() - RECENT_ORDER_MS)).toISOString()
  return (orders[phone] ?? []).some(c => c >= cutoff)
}

// ── ingest ──────────────────────────────────────────────────────────────────
export interface IngestResult { pulled: number; inserted: number; updated: number; eligible: number; excluded: number }

export async function ingestCheckouts(): Promise<IngestResult> {
  const cfg = await getCarsConfig()
  const nodes = await listAbandonedCheckouts(72)
  const drafts = nodes.map(normaliseCheckout)
  const res: IngestResult = { pulled: drafts.length, inserted: 0, updated: 0, eligible: 0, excluded: 0 }
  if (!drafts.length) return res

  const phones = [...new Set(drafts.map(d => d.phone).filter(Boolean) as string[])]
  const [existing, supp, orders] = await Promise.all([
    existingCheckouts(drafts.map(d => d.checkout_id)),
    suppressedSet(phones),
    ordersByPhone(phones),
  ])

  const stopReason = (d: CarsCheckoutDraft): string | null => {
    if (d.completed) return 'completed'
    if (!d.phone) return 'no_phone'
    if (supp.has(d.phone)) return 'suppressed'
    if (d.total_price < cfg.min_cart_value) return 'below_floor'
    if (orderedRecently(orders, d.phone, d.abandoned_at)) return 'already_ordered'
    return null
  }

  const inserts: Record<string, unknown>[] = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []

  for (const d of drafts) {
    const reason = stopReason(d)
    const ex = existing[d.checkout_id]
    if (!ex) {
      const disp = reason
        ? { status: reason === 'suppressed' ? 'suppressed' : 'excluded', exclusion_reason: reason, next_step: 1, next_action_at: null as string | null }
        : { status: 'queued', exclusion_reason: null as string | null, next_step: 1, next_action_at: addMinutes(d.abandoned_at, cfg.sequence_delays_min[0] ?? 60) }
      inserts.push({
        checkout_id: d.checkout_id, checkout_token: null, store: d.store, phone: d.phone, email: d.email,
        customer_id: d.customer_id, customer_name: d.customer_name, is_returning: d.is_returning,
        cart: d.cart, cart_summary: d.cart_summary, total_price: d.total_price, currency: d.currency,
        recovery_url: d.recovery_url, abandoned_at: d.abandoned_at, ...disp, created_at: now(), updated_at: now(),
      })
      if (disp.status === 'queued') res.eligible++; else res.excluded++
    } else if (['queued', 'in_sequence', 'new'].includes(ex.status) && reason) {
      // a stop condition now applies to an active/early row → halt it
      updates.push({ id: d.checkout_id, patch: { status: reason === 'suppressed' ? 'suppressed' : 'excluded', exclusion_reason: reason, next_action_at: null, updated_at: now() } })
      res.excluded++
    }
  }

  for (const c of chunk(inserts, 100)) {
    const { error } = await supabaseAdmin.from('cars_checkouts').upsert(c, { onConflict: 'checkout_id', ignoreDuplicates: true })
    if (!error) res.inserted += c.length
  }
  for (const u of updates) { await supabaseAdmin.from('cars_checkouts').update(u.patch).eq('checkout_id', u.id); res.updated++ }
  return res
}

// ── advance sequences (send due steps) ───────────────────────────────────────
export interface SendResult { due: number; sent: number; shadow: number; skipped: number; failed: number; window: boolean }

export async function runSequences(): Promise<SendResult> {
  const cfg = await getCarsConfig()
  const out: SendResult = { due: 0, sent: 0, shadow: 0, skipped: 0, failed: 0, window: true }
  if (!isInSendWindow(cfg)) { out.window = false; return out }

  const [enabled, paused, mass, tests] = await Promise.all([isCarsEnabled(), isCarsPaused(), isSideEffectsSuppressed(), getTestNumbers()])
  let capLeft = cfg.daily_send_cap - (await liveSentToday())

  const { data: dueRows } = await supabaseAdmin.from('cars_checkouts')
    .select('checkout_id, phone, customer_name, cart_summary, recovery_url, total_price, abandoned_at, next_step, discount_code')
    .in('status', ['queued', 'in_sequence']).not('next_action_at', 'is', null).lte('next_action_at', now())
    .order('total_price', { ascending: false }).limit(400)
  const due = (dueRows ?? []) as Array<Record<string, unknown>>
  out.due = due.length
  if (!due.length) return out
  const maxStep = cfg.step3_enabled ? 3 : 2

  // batched guards for the due set
  const duePhones = [...new Set(due.map(d => d.phone).filter(Boolean) as string[])]
  const [supp, orders, recentMsgs] = await Promise.all([
    suppressedSet(duePhones),
    ordersByPhone(duePhones),
    recentMessagesByPhone(duePhones, cfg.frequency_cap_hours),
  ])

  for (const co of due) {
    const checkoutId = co.checkout_id as string
    const phone = co.phone as string | null
    const step = Number(co.next_step ?? 1)
    if (!phone) { await mark(checkoutId, { status: 'excluded', exclusion_reason: 'no_phone', next_action_at: null }); continue }
    if (step > maxStep) { await mark(checkoutId, { next_action_at: null }); continue }
    if (supp.has(phone)) { await mark(checkoutId, { status: 'suppressed', next_action_at: null }); out.skipped++; continue }
    if (orderedRecently(orders, phone, co.abandoned_at as string)) { await mark(checkoutId, { status: 'excluded', exclusion_reason: 'already_ordered', next_action_at: null }); out.skipped++; continue }
    if (step === 1 && (recentMsgs[phone] ?? []).some(m => m.checkout_id !== checkoutId)) {
      await mark(checkoutId, { status: 'excluded', exclusion_reason: 'frequency_cap', next_action_at: null }); out.skipped++; continue
    }

    let live = enabled && !paused && !mass
    if (live && tests.length && !tests.includes(phone)) live = false
    if (live && capLeft <= 0) { out.skipped++; continue }

    let code = (co.discount_code as string | null) ?? null
    if (step >= 2 && cfg.discount_type !== 'none' && !code) code = live ? await createRecoveryCode(checkoutId, cfg) : 'SHADOWCODE'

    const r = await sendRecovery({
      checkoutId, phone, step,
      name: (co.customer_name as string) || 'there',
      cartSummary: (co.cart_summary as string) || 'your cart',
      recoveryUrl: (co.recovery_url as string) || '',
      discountCode: code, live, costUsd: cfg.msg_cost_usd,
    })
    if (r.sent) { out.sent++; capLeft-- } else if (r.shadow) out.shadow++; else out.failed++
    // track this send for the freq-cap of later rows in the same batch
    ;(recentMsgs[phone] ??= []).push({ checkout_id: checkoutId })

    const nextStep = step + 1
    const upd: Record<string, unknown> = { status: 'in_sequence', updated_at: now() }
    if (code && live && step >= 2) upd.discount_code = code
    if (nextStep > maxStep) { upd.next_step = nextStep; upd.next_action_at = null }
    else { upd.next_step = nextStep; upd.next_action_at = addMinutes(co.abandoned_at as string, cfg.sequence_delays_min[nextStep - 1] ?? 4320) }
    await mark(checkoutId, upd)
  }
  return out
}

async function liveSentToday(): Promise<number> {
  const { count } = await supabaseAdmin.from('cars_messages')
    .select('message_id', { count: 'exact', head: true })
    .in('status', ['sent', 'delivered', 'read', 'failed']).gte('sent_at', pktDayStartIso())
  return count ?? 0
}
async function recentMessagesByPhone(phones: string[], hours: number): Promise<Record<string, Array<{ checkout_id: string }>>> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const map: Record<string, Array<{ checkout_id: string }>> = {}
  for (const c of chunk(phones, 200)) {
    const { data } = await supabaseAdmin.from('cars_messages').select('phone, checkout_id').in('phone', c).gte('sent_at', since)
    for (const r of (data ?? []) as Array<{ phone: string; checkout_id: string }>) (map[r.phone] ??= []).push({ checkout_id: r.checkout_id })
  }
  return map
}
async function mark(checkoutId: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from('cars_checkouts').update({ updated_at: now(), ...patch }).eq('checkout_id', checkoutId)
}
