import { supabaseAdmin } from '@/lib/hub/supabase'

// Permanent opt-out list. Checked before EVERY send (non-negotiable for WABA
// health). Keyed by normalised 03XXXXXXXXX phone.

export async function isCarsSuppressed(phone: string | null): Promise<boolean> {
  if (!phone) return false
  const { data } = await supabaseAdmin.from('cars_suppression').select('phone').eq('phone', phone).maybeSingle()
  return !!data
}

export async function addCarsSuppression(phone: string | null, reason = 'opt-out'): Promise<void> {
  if (!phone) return
  await supabaseAdmin.from('cars_suppression').upsert(
    { phone, reason, added_at: new Date().toISOString() }, { onConflict: 'phone' },
  )
}
