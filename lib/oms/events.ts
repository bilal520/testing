import { supabaseAdmin } from '@/lib/hub/supabase'

export interface OmsEventInput {
  type:    string
  actor?:  string     // system | agent:<name> | customer
  channel?: string    // whatsapp | call | system | shopify
  from?:   string | null
  to?:     string | null
  detail?: string
  payload?: unknown
}

/** Append to the immutable OMS audit log. Never throws (audit must not break flow). */
export async function logOmsEvent(orderId: number | null, e: OmsEventInput): Promise<void> {
  try {
    await supabaseAdmin.from('oms_events').insert({
      order_id:   orderId,
      event_type: e.type,
      actor:      e.actor ?? 'system',
      channel:    e.channel ?? 'system',
      from_state: e.from ?? null,
      to_state:   e.to ?? null,
      detail:     e.detail ?? null,
      payload:    (e.payload ?? null) as never,
    })
  } catch { /* swallow */ }
}
