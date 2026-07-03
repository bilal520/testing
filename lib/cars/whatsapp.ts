import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { getWhatsappToken, getPhoneId, getTemplateSpec } from '@/lib/oms/whatsapp'
import { getCarsTemplateMap, getCarsPhoneIdOverride } from '@/lib/cars/config'

// ════════════════════════════════════════════════════════════════════════════
// CARS recovery sender. Reuses the OMS WhatsApp primitives (token, phone-number
// id, template spec) but sends the recovery templates and logs to cars_messages.
// The engine decides `live` (shadow vs real); when not live it logs a shadow row
// and calls nothing. Default number = the OMS number (reuse decision); override
// with cars_whatsapp_phone_number_id.
// ════════════════════════════════════════════════════════════════════════════

const WA_BASE = 'https://graph.facebook.com/v21.0'

// 03XXXXXXXXX → 92XXXXXXXXXX (WhatsApp E.164 without +).
function toWa(phone: string | null): string | null {
  if (!phone) return null
  const d = phone.replace(/[^\d]/g, '')
  if (d.startsWith('0')) return '92' + d.slice(1)
  if (d.startsWith('92')) return d
  return null
}

// Positional body params by step — MUST match the approved template var order.
// step1 {{1}}name {{2}}product {{3}}url · step2/3 {{1}}name {{2}}product {{3}}code {{4}}url
function buildParams(step: number, ctx: RecoverySendCtx): string[] {
  return step === 1
    ? [ctx.name, ctx.cartSummary, ctx.recoveryUrl]
    : [ctx.name, ctx.cartSummary, ctx.discountCode ?? '', ctx.recoveryUrl]
}

export interface RecoverySendCtx {
  checkoutId: string
  phone: string
  step: number            // 1 | 2 | 3
  name: string
  cartSummary: string
  recoveryUrl: string
  discountCode?: string | null
  live: boolean
  costUsd: number
}

export interface RecoverySendResult { sent: boolean; shadow: boolean; messageId: string | null; error?: string }

async function logMessage(row: {
  message_id: string; checkout_id: string; phone: string; template_name: string
  sequence_step: number; status: string; failure_reason?: string | null; cost_estimate: number
}) {
  await supabaseAdmin.from('cars_messages').upsert({
    ...row, sent_at: new Date().toISOString(), status_updated_at: new Date().toISOString(),
  }, { onConflict: 'message_id' })
}

export async function sendRecovery(ctx: RecoverySendCtx): Promise<RecoverySendResult> {
  const map = await getCarsTemplateMap()
  const tpl = map[String(ctx.step)]
  const to = toWa(ctx.phone)
  const tplName = tpl?.name ?? `cart_recovery_step${ctx.step}`

  // SHADOW — log the intended send, call nothing.
  if (!ctx.live) {
    const id = `shadow_${randomUUID()}`
    await logMessage({ message_id: id, checkout_id: ctx.checkoutId, phone: ctx.phone, template_name: tplName, sequence_step: ctx.step, status: 'shadow', cost_estimate: 0 })
    return { sent: false, shadow: true, messageId: id }
  }

  if (!to) return { sent: false, shadow: false, messageId: null, error: 'no valid phone' }
  if (!tpl?.name) return { sent: false, shadow: false, messageId: null, error: `no template mapped for step ${ctx.step}` }

  const token = await getWhatsappToken()
  const phoneId = (await getCarsPhoneIdOverride()) || (await getPhoneId())
  if (!token || !phoneId) return { sent: false, shadow: false, messageId: null, error: 'WhatsApp not configured' }

  try {
    const spec = await getTemplateSpec(tpl.name)
    const all = buildParams(ctx.step, ctx)
    const components: Array<Record<string, unknown>> = []
    // Send the params our approved templates expect (step1=3, step2/3=4). Use the
    // fetched var-count only when it's valid — a failed template fetch returns 0,
    // which would send zero body params and trip Meta #132000.
    const bodyVars = spec.bodyVars > 0 ? spec.bodyVars : all.length
    const bodyPs = all.slice(0, bodyVars).map(p => ({ type: 'text', text: String(p) }))
    if (bodyPs.length) components.push({ type: 'body', parameters: bodyPs })
    if (spec.urlButtonDynamic) {
      components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: ctx.recoveryUrl }] })
    }
    const res = await fetch(`${WA_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: tpl.name, language: { code: tpl.language || 'en' }, ...(components.length ? { components } : {}) },
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = (j?.error?.message ?? JSON.stringify(j)).slice(0, 200)
      const id = `fail_${randomUUID()}`
      await logMessage({ message_id: id, checkout_id: ctx.checkoutId, phone: ctx.phone, template_name: tpl.name, sequence_step: ctx.step, status: 'failed', failure_reason: detail, cost_estimate: 0 })
      return { sent: false, shadow: false, messageId: id, error: detail }
    }
    const wamid: string = j?.messages?.[0]?.id ?? `sent_${randomUUID()}`
    await logMessage({ message_id: wamid, checkout_id: ctx.checkoutId, phone: ctx.phone, template_name: tpl.name, sequence_step: ctx.step, status: 'sent', cost_estimate: ctx.costUsd })
    return { sent: true, shadow: false, messageId: wamid }
  } catch (err) {
    return { sent: false, shadow: false, messageId: null, error: String(err).slice(0, 200) }
  }
}

// Inbound reply from a recovery contact → stop sequence + log + opt-out handling.
// Best-effort; called from the WhatsApp webhook alongside the OMS reply handler.
export async function applyCarsReply(fromWaId: string, text: string): Promise<boolean> {
  const digits = (fromWaId ?? '').replace(/[^\d]/g, '')
  const phone = digits.startsWith('92') ? '0' + digits.slice(2) : digits.startsWith('0') ? digits : null
  if (!phone) return false
  const t = (text ?? '').trim().toLowerCase()

  // find the most-recent active recovery for this phone
  const { data: co } = await supabaseAdmin.from('cars_checkouts')
    .select('checkout_id, status')
    .eq('phone', phone).in('status', ['queued', 'in_sequence', 'new'])
    .order('abandoned_at', { ascending: false }).limit(1).maybeSingle()

  const optOut = /\b(stop|unsubscribe|band karo|band kardo|block|remove)\b/.test(t)
  if (optOut) {
    const { addCarsSuppression } = await import('@/lib/cars/suppress')
    await addCarsSuppression(phone, 'customer opt-out')
    if (co) await supabaseAdmin.from('cars_checkouts').update({ status: 'suppressed', updated_at: new Date().toISOString() }).eq('checkout_id', co.checkout_id)
    await supabaseAdmin.from('cars_replies').insert({ checkout_id: co?.checkout_id ?? null, phone, reply_text: text?.slice(0, 500), handled_by: 'auto', outcome: 'opted_out' })
    return true
  }

  if (!co) return false
  // stop the sequence, mark replied, hand to a human
  await supabaseAdmin.from('cars_checkouts').update({ status: 'replied', next_action_at: null, updated_at: new Date().toISOString() }).eq('checkout_id', co.checkout_id)
  await supabaseAdmin.from('cars_replies').insert({ checkout_id: co.checkout_id, phone, reply_text: text?.slice(0, 500), handled_by: 'human', outcome: 'pending' })
  return true
}
