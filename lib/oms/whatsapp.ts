import { supabaseAdmin } from '@/lib/hub/supabase'
import { logOmsEvent } from '@/lib/oms/events'
import { shopifySync } from '@/lib/shopify-sync'
import { canTransition, type OmsState } from '@/lib/oms/state'
import { isSideEffectsSuppressed } from '@/lib/oms/suppress'

// OMS WhatsApp sends (Phase 2). GATED behind site_settings.oms_whatsapp_enabled
// (default OFF) because business-initiated WhatsApp needs Meta-APPROVED templates.
// While gated it shadow-logs the intended message and sends nothing — same safety
// model as the Shopify write-back. Flip the flag ON only after templates are live.

const WA_BASE = 'https://graph.facebook.com/v21.0'

async function setting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single()
    return data?.value ?? null
  } catch { return null }
}

export async function isWhatsappEnabled(): Promise<boolean> {
  return (await setting('oms_whatsapp_enabled')) === 'true'
}
const waEnabled = isWhatsappEnabled

// DB-first (OAuth-refreshable) → env fallback — same pattern as Shopify/FB tokens.
export async function getWhatsappToken(): Promise<string | null> {
  return (await setting('whatsapp_access_token')) ?? process.env.WHATSAPP_ACCESS_TOKEN ?? null
}
export async function getWabaId(): Promise<string | null> {
  return (await setting('whatsapp_business_account_id')) ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null
}
export async function getPhoneId(): Promise<string | null> {
  return (await setting('whatsapp_phone_number_id')) ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null
}

// Meta app credentials for the OAuth flow — DB-first so the panel works even if
// Vercel env drifts. site_settings.meta_app_id / meta_app_secret → env fallback.
export async function getMetaAppCreds(): Promise<{ appId: string | null; secret: string | null }> {
  return {
    appId:  (await setting('meta_app_id'))     ?? process.env.META_APP_ID     ?? null,
    secret: (await setting('meta_app_secret')) ?? process.env.META_APP_SECRET ?? null,
  }
}

// OMS message-type → approved template mapping (set in the WhatsApp panel).
export interface WaTemplateMap { [k: string]: { name: string; language: string } }
const DEFAULT_MAP: WaTemplateMap = {
  order_confirm:    { name: 'new_order_button_url', language: 'en' },
  confirm_reminder: { name: 'new_order_button_url', language: 'en' },
  address_request:  { name: 'incomplete_address',   language: 'en' },
}
export async function getTemplateMap(): Promise<WaTemplateMap> {
  const raw = await setting('oms_wa_templates')
  if (!raw) return DEFAULT_MAP
  try { return { ...DEFAULT_MAP, ...JSON.parse(raw) } } catch { return DEFAULT_MAP }
}

// Per-template spec needed to build a correct send payload.
export interface TemplateSpec { bodyVars: number; urlButtonDynamic: boolean }
const _specs = new Map<string, TemplateSpec>()
let _specsExp = 0

interface RawComponent { type: string; text?: string; buttons?: Array<{ type: string; url?: string; example?: unknown[] }> }
function parseSpec(components: RawComponent[]): TemplateSpec {
  const body = components.find(c => c.type === 'BODY')
  const bodyVars = (body?.text?.match(/\{\{\d+\}\}/g) ?? []).length
  const btns = components.find(c => Array.isArray(c.buttons))?.buttons ?? []
  const urlBtn = btns.find(b => b.type === 'URL')
  const urlButtonDynamic = !!urlBtn && (!!urlBtn.example || !!urlBtn.url?.includes('{{'))
  return { bodyVars, urlButtonDynamic }
}

// Fetch live templates from Meta + cache each spec (for correct sends).
export async function fetchTemplates(): Promise<{ connected: boolean; phone?: unknown; templates: Array<{ name: string; status: string; language: string; category: string; vars: number; hasButtons: boolean }>; error?: string }> {
  const token = await getWhatsappToken()
  const waba  = await getWabaId()
  const phoneId = await getPhoneId()
  if (!token || !waba) return { connected: false, templates: [], error: 'WhatsApp not configured' }
  try {
    const r = await fetch(`${WA_BASE}/${waba}/message_templates?fields=name,status,language,category,components&limit=100&access_token=${token}`)
    const j = await r.json()
    if (j.error) return { connected: false, templates: [], error: j.error.message }
    _specs.clear(); _specsExp = Date.now() + 30 * 60 * 1000
    const templates = (j.data ?? []).map((t: { name: string; status: string; language: string; category: string; components?: RawComponent[] }) => {
      const spec = parseSpec(t.components ?? [])
      _specs.set(t.name, spec)
      return { name: t.name, status: t.status, language: t.language, category: t.category, vars: spec.bodyVars, hasButtons: (t.components ?? []).some(c => Array.isArray(c.buttons) && c.buttons.length > 0) }
    })
    let phone: unknown = null
    if (phoneId) {
      const p = await fetch(`${WA_BASE}/${phoneId}?fields=display_phone_number,verified_name,quality_rating&access_token=${token}`)
      const pj = await p.json(); if (!pj.error) phone = pj
    }
    return { connected: true, phone, templates }
  } catch (err) {
    return { connected: false, templates: [], error: String(err).slice(0, 150) }
  }
}

export async function getTemplateSpec(name: string): Promise<TemplateSpec> {
  if (_specs.has(name) && Date.now() < _specsExp) return _specs.get(name)!
  await fetchTemplates()   // repopulates the cache
  return _specs.get(name) ?? { bodyVars: 0, urlButtonDynamic: false }
}

// Positional body params per OMS message type (matches the approved templates:
// {{1}}=customer name, {{2}}=order number).
function bodyParams(kind: WaKind, o: { order_number: string; customer_name: string }): string[] {
  switch (kind) {
    case 'order_confirm':    return [o.customer_name, o.order_number]
    case 'confirm_reminder': return [o.customer_name, o.order_number]
    case 'address_request':  return [o.customer_name]
  }
}

// Convert 03XXXXXXXXX → 92XXXXXXXXXX (WhatsApp E.164 without +).
function toWa(phone: string | null): string | null {
  if (!phone) return null
  const d = phone.replace(/[^\d]/g, '')
  if (d.startsWith('0')) return '92' + d.slice(1)
  if (d.startsWith('92')) return d
  return null
}

export type WaKind = 'order_confirm' | 'confirm_reminder' | 'address_request'

function bodyText(kind: WaKind, o: { order_number: string; customer_name: string; city: string; cod_amount: number }): string {
  switch (kind) {
    case 'order_confirm':
      return `Assalam o Alaikum ${o.customer_name}! Elyscents here 🌸. We received your order ${o.order_number} — COD PKR ${Math.round(o.cod_amount).toLocaleString()} to ${o.city}. Please reply: 1 to Confirm, 2 to Cancel, 3 to Change Address.`
    case 'confirm_reminder':
      return `Reminder: your Elyscents order ${o.order_number} is awaiting confirmation. Reply 1 to Confirm or 2 to Cancel so we can dispatch it. 🌸`
    case 'address_request':
      return `To make sure your Elyscents order ${o.order_number} reaches you, please reply with your COMPLETE address + a nearby landmark (house/street/area, city). 🙏`
  }
}

/**
 * Send (or shadow-log) an OMS WhatsApp to a customer.
 * Returns { sent } — false when gated (shadow) or on failure.
 */
export async function sendOmsWhatsapp(
  orderId: number,
  phone: string | null,
  kind: WaKind,
  order: { order_number: string; customer_name: string; city: string; cod_amount: number },
): Promise<{ sent: boolean; shadow?: boolean; error?: string }> {
  const to = toWa(phone)
  const map = await getTemplateMap()
  const tpl = map[kind]

  // Global suppression (mass import) → shadow-log, never send.
  if (await isSideEffectsSuppressed()) {
    await logOmsEvent(orderId, { type: 'whatsapp_shadow', actor: 'system', channel: 'whatsapp', detail: `SUPPRESSED (mass import) — WOULD send [${kind}] → ${to ?? 'no-phone'}` })
    return { sent: false, shadow: true }
  }
  if (!(await waEnabled())) {
    await logOmsEvent(orderId, { type: 'whatsapp_shadow', actor: 'system', channel: 'whatsapp', detail: `WOULD send [${kind}] via template "${tpl?.name ?? '(unmapped)'}" → ${to ?? 'no-phone'}` })
    return { sent: false, shadow: true }
  }
  if (!to) return { sent: false, error: 'no valid phone' }
  if (!tpl?.name) return { sent: false, error: `no template mapped for ${kind}` }

  const token   = await getWhatsappToken()
  const phoneId = await getPhoneId()
  if (!token || !phoneId) return { sent: false, error: 'WhatsApp not configured' }

  try {
    // Business-initiated → must use an APPROVED template. Build components to
    // match the template's actual spec (body-var count + dynamic URL button).
    const spec = await getTemplateSpec(tpl.name)
    const all  = bodyParams(kind, order)
    const components: Array<Record<string, unknown>> = []
    const bodyPs = all.slice(0, spec.bodyVars).map(p => ({ type: 'text', text: String(p) }))
    if (bodyPs.length) components.push({ type: 'body', parameters: bodyPs })
    if (spec.urlButtonDynamic) {
      components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: order.order_number.replace(/^#/, '') }] })
    }
    const res = await fetch(`${WA_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: tpl.name,
          language: { code: tpl.language || 'en' },
          ...(components.length ? { components } : {}),
        },
      }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      await logOmsEvent(orderId, { type: 'whatsapp_error', channel: 'whatsapp', detail })
      return { sent: false, error: detail }
    }
    await logOmsEvent(orderId, { type: 'whatsapp_sent', channel: 'whatsapp', detail: `[${kind}] template "${tpl.name}" → ${to}` })
    return { sent: true }
  } catch (err) {
    return { sent: false, error: String(err).slice(0, 200) }
  }
}

// Handle an inbound customer WhatsApp reply → drive the order's state.
// Called from the webhook (additive/best-effort). "1"=confirm, "2"=cancel,
// "3"=change address (also matches confirm/cancel/pata keywords).
export async function applyOmsReply(fromWaId: string, text: string): Promise<boolean> {
  const digits = (fromWaId ?? '').replace(/[^\d]/g, '')
  const phone = digits.startsWith('92') ? '0' + digits.slice(2) : digits.startsWith('0') ? digits : null
  if (!phone) return false

  const t = (text ?? '').trim().toLowerCase()
  let action: 'confirm' | 'cancel' | 'address' | null = null
  if (t === '1' || /\b(confirm|yes|haan|han|ok|okay|theek)\b/.test(t)) action = 'confirm'
  else if (t === '2' || /\b(cancel|no|nahi|nahin)\b/.test(t)) action = 'cancel'
  else if (t === '3' || /(address|pata|location)/.test(t)) action = 'address'
  if (!action) return false

  const { data: order } = await supabaseAdmin.from('oms_orders')
    .select('*').eq('phone', phone)
    .in('state', ['pending_confirmation', 'no_answer', 'incomplete_address'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!order) return false

  const from = order.state as OmsState
  const gid  = order.shopify_order_id as string
  const id   = order.id as number
  const now  = new Date().toISOString()

  if (action === 'confirm') {
    if (!canTransition(from, 'confirmed')) return false
    const clean = order.address_complete && !order.is_duplicate && order.risk_level !== 'high'
    await supabaseAdmin.from('oms_orders').update({ state: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', id)
    await logOmsEvent(id, { type: 'state_change', actor: 'customer', channel: 'whatsapp', from, to: 'confirmed', detail: 'customer confirmed via WhatsApp' })
    await shopifySync(id, gid, { kind: 'state_tag', state: 'confirmed' })
    if (clean && canTransition('confirmed', 'ready_to_dispatch')) {
      await supabaseAdmin.from('oms_orders').update({ state: 'ready_to_dispatch', updated_at: now }).eq('id', id)
      await logOmsEvent(id, { type: 'state_change', actor: 'system', from: 'confirmed', to: 'ready_to_dispatch', detail: 'auto-advanced (clean)' })
      await shopifySync(id, gid, { kind: 'state_tag', state: 'ready_to_dispatch' })
    }
  } else if (action === 'cancel') {
    if (!canTransition(from, 'cancelled')) return false
    await supabaseAdmin.from('oms_orders').update({ state: 'cancelled', cancel_reason: 'customer cancelled via WhatsApp', updated_at: now }).eq('id', id)
    await logOmsEvent(id, { type: 'state_change', actor: 'customer', channel: 'whatsapp', from, to: 'cancelled', detail: 'customer cancelled via WhatsApp' })
    await shopifySync(id, gid, { kind: 'state_tag', state: 'cancelled' })
    await shopifySync(id, gid, { kind: 'cancel', reason: 'customer cancelled via WhatsApp' })
  } else { // address
    if (from !== 'incomplete_address') {
      if (!canTransition(from, 'incomplete_address')) return false
      await supabaseAdmin.from('oms_orders').update({ state: 'incomplete_address', updated_at: now }).eq('id', id)
      await logOmsEvent(id, { type: 'state_change', actor: 'customer', channel: 'whatsapp', from, to: 'incomplete_address', detail: 'customer wants to change address' })
    }
    await sendOmsWhatsapp(id, order.phone as string, 'address_request', { order_number: order.order_number, customer_name: order.customer_name, city: order.city, cod_amount: Number(order.cod_amount ?? 0) })
  }
  return true
}
