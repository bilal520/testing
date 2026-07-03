import { supabaseAdmin } from '@/lib/hub/supabase'

// ════════════════════════════════════════════════════════════════════════════
// CARS config + gating. All state lives in site_settings (DB-first), same as the
// OMS/WhatsApp/Shopify tokens. The master switch `cars_enabled` defaults OFF →
// the whole engine runs in SHADOW mode (computes + logs intended sends, sends
// nothing). See docs/CARS_SPEC.md §5, §11.
// ════════════════════════════════════════════════════════════════════════════

export interface CarsConfig {
  store: string
  min_cart_value: number            // Rs floor — carts below this aren't worth a message
  sequence_delays_min: number[]     // minutes after abandonment for steps 1/2/3
  frequency_cap_hours: number       // one sequence per phone per N hours
  attribution_window_hours: number  // order counts as recovered if within N h of last msg
  discount_type: 'free_shipping' | 'percent' | 'none'
  discount_percent: number
  send_window: string               // "HH:MM-HH:MM" in PKT
  daily_send_cap: number            // respects WABA tier
  quality_pause: boolean            // auto-pause sends on Yellow/Red quality
  step3_enabled: boolean
  // money-view economics (for ROI + "money actually made")
  msg_cost_usd: number              // per-conversation estimate
  usd_to_pkr: number
  return_cost_pkr: number           // avg return-shipping cost per RTO
}

export const DEFAULT_CONFIG: CarsConfig = {
  store: 'PK',
  min_cart_value: 1000,
  sequence_delays_min: [60, 1440, 4320], // 60m, 24h, 72h
  frequency_cap_hours: 72,
  attribution_window_hours: 48,
  discount_type: 'free_shipping',
  discount_percent: 0,
  send_window: '09:00-22:00',
  daily_send_cap: 200,
  quality_pause: true,
  step3_enabled: true,
  msg_cost_usd: 0.03,
  usd_to_pkr: 280,
  return_cost_pkr: 250,
}

async function get(key: string): Promise<string | null> {
  try { const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single(); return data?.value ?? null }
  catch { return null }
}
async function set(key: string, value: string) {
  await supabaseAdmin.from('site_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export async function getCarsConfig(): Promise<CarsConfig> {
  const raw = await get('cars_config')
  if (!raw) return DEFAULT_CONFIG
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } } catch { return DEFAULT_CONFIG }
}
export async function setCarsConfig(patch: Partial<CarsConfig>): Promise<CarsConfig> {
  const next = { ...(await getCarsConfig()), ...patch }
  await set('cars_config', JSON.stringify(next))
  return next
}

export async function isCarsEnabled(): Promise<boolean> {
  return (await get('cars_enabled')) === 'true'
}
export async function setCarsEnabled(on: boolean) { await set('cars_enabled', on ? 'true' : 'false') }

// Quality auto-pause flag (set by the daily quality check; blocks live sends).
export async function isCarsPaused(): Promise<boolean> {
  return (await get('cars_paused')) === 'true'
}
export async function setCarsPaused(on: boolean) { await set('cars_paused', on ? 'true' : 'false') }

// Supervised first-live allowlist. When non-empty, ONLY these phones get real
// sends; everyone else is shadowed. Empty array = send to all (normal live).
export async function getTestNumbers(): Promise<string[]> {
  const raw = await get('cars_test_numbers')
  if (!raw) return []
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}
export async function setTestNumbers(nums: string[]) { await set('cars_test_numbers', JSON.stringify(nums)) }

// step → approved template. Mirrors the OMS oms_wa_templates shape.
export interface CarsTemplateMap { [step: string]: { name: string; language: string } }
const DEFAULT_TEMPLATES: CarsTemplateMap = {
  '1': { name: 'cart_recovery_1h',  language: 'en' },
  '2': { name: 'cart_recovery_24h', language: 'en' },
  '3': { name: 'cart_recovery_72h', language: 'en' },
}
export async function getCarsTemplateMap(): Promise<CarsTemplateMap> {
  const raw = await get('cars_wa_templates')
  if (!raw) return DEFAULT_TEMPLATES
  try { return { ...DEFAULT_TEMPLATES, ...JSON.parse(raw) } } catch { return DEFAULT_TEMPLATES }
}
export async function setCarsTemplateMap(map: CarsTemplateMap) { await set('cars_wa_templates', JSON.stringify(map)) }

// Optional dedicated recovery phone-number-id. Empty → reuse the OMS number.
export async function getCarsPhoneIdOverride(): Promise<string | null> { return get('cars_whatsapp_phone_number_id') }
