import { supabaseAdmin } from '@/lib/hub/supabase'

// Global "quiet mode" for mass imports. While ON, all outbound side effects
// (WhatsApp sends + Shopify write-back) short-circuit to shadow — belt-and-
// suspenders on top of the per-channel gates. Set ON for the duration of a
// backfill, then cleared. Stored in site_settings.oms_mirror_suppress_side_effects.

const KEY = 'oms_mirror_suppress_side_effects'

export async function isSideEffectsSuppressed(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', KEY).single()
    return data?.value === 'true'
  } catch { return false }
}

export async function setSideEffectsSuppressed(on: boolean): Promise<void> {
  await supabaseAdmin.from('site_settings').upsert(
    { key: KEY, value: on ? 'true' : 'false', updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
}
