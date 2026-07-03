import { supabaseAdmin } from '@/lib/hub/supabase'

// ════════════════════════════════════════════════════════════════════════════
// Courier API booking — creates REAL consignments (CN + label). Gated by
// site_settings.oms_booking_api_enabled (default OFF). Manual CN is the fallback.
// PostEx: fully auto (cities + pickup discovered via API).
// Leopards: needs a city-name→id map (getAllCities); cached in site_settings and
// refreshed server-side — falls back to a clear error if the map isn't available.
// ════════════════════════════════════════════════════════════════════════════

const PB = 'https://api.postex.pk/services/integration/api/order'
const LB = 'https://merchantapi.leopardscourier.com/api'

export interface BookableOrder {
  order_number: string; customer_name: string; phone: string | null
  address_raw: string; city: string; cod_amount: number
  items: Array<{ name: string; qty: number }>
}
export interface BookResult { cn: string; labelUrl: string | null; courier: string }

async function setting(key: string): Promise<string | null> {
  try { const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single(); return data?.value ?? null } catch { return null }
}
async function setSetting(key: string, value: string) {
  await supabaseAdmin.from('site_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function isBookingApiEnabled(): Promise<boolean> {
  return (await setting('oms_booking_api_enabled')) === 'true'
}

// ── PostEx ───────────────────────────────────────────────────────────────────
let _pxCities: { at: number; list: Array<{ name: string; delivery: boolean }> } | null = null
async function postexCities() {
  if (_pxCities && Date.now() - _pxCities.at < 6 * 3_600_000) return _pxCities.list
  const token = process.env.POSTEX_TOKEN
  const r = await fetch(`${PB}/v2/get-operational-city`, { headers: { token: token ?? '' } })
  const j = await r.json() as { dist?: Array<{ operationalCityName: string; isDeliveryCity: boolean }> }
  const list = (j.dist ?? []).map(c => ({ name: c.operationalCityName, delivery: !!c.isDeliveryCity }))
  _pxCities = { at: Date.now(), list }
  return list
}
let _pxPickup: { at: number; code: string } | null = null
async function postexPickupCode(): Promise<string> {
  if (_pxPickup && Date.now() - _pxPickup.at < 6 * 3_600_000) return _pxPickup.code
  const override = await setting('oms_postex_pickup_code')
  if (override) { _pxPickup = { at: Date.now(), code: override }; return override }
  const token = process.env.POSTEX_TOKEN
  const r = await fetch(`${PB}/v1/get-merchant-address`, { headers: { token: token ?? '' } })
  const j = await r.json() as { dist?: Array<{ addressCode: string; addressType: string }> }
  const def = (j.dist ?? []).find(a => /default/i.test(a.addressType)) ?? j.dist?.[0]
  const code = def?.addressCode ?? '001'
  _pxPickup = { at: Date.now(), code }
  return code
}
function matchCity<T extends { name: string }>(city: string, list: T[]): T | null {
  const n = norm(city)
  return list.find(c => norm(c.name) === n) ?? list.find(c => norm(c.name).startsWith(n) || n.startsWith(norm(c.name))) ?? null
}

export async function postexCreateOrder(o: BookableOrder): Promise<BookResult> {
  const token = process.env.POSTEX_TOKEN
  if (!token) throw new Error('POSTEX_TOKEN not configured')
  if (!o.phone) throw new Error('order has no phone')
  const cities = await postexCities()
  const match = matchCity(o.city, cities.filter(c => c.delivery))
  if (!match) throw new Error(`PostEx has no delivery city matching "${o.city}" — book manually`)
  const pickupAddressCode = await postexPickupCode()
  const body = {
    cityName: match.name, customerName: o.customer_name, customerPhone: o.phone,
    deliveryAddress: o.address_raw || o.city, invoicePayment: Math.round(o.cod_amount || 0),
    orderRefNumber: o.order_number.replace(/^#/, ''),
    orderDetail: o.items.map(i => `${i.qty}x ${i.name}`).join(', ').slice(0, 250) || 'Order',
    items: Math.max(1, o.items.reduce((s, i) => s + (i.qty || 1), 0)),
    orderType: 'Normal', transactionNotes: '', pickupAddressCode,
  }
  const r = await fetch(`${PB}/v3/create-order`, { method: 'POST', headers: { token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json() as { statusCode?: string; statusMessage?: string; dist?: { trackingNumber?: string } }
  if (j.statusCode !== '200' || !j.dist?.trackingNumber) throw new Error(`PostEx: ${j.statusMessage ?? 'booking failed'}`)
  return { cn: j.dist.trackingNumber, labelUrl: null, courier: 'postex' }
}

// ── Leopards ─────────────────────────────────────────────────────────────────
// City map is cached in site_settings.oms_leopards_cities (JSON: { NORMNAME: id }).
export async function refreshLeopardsCities(): Promise<number> {
  const api_key = process.env.LEOPARDS_API_KEY, api_password = process.env.LEOPARDS_API_PASSWORD
  if (!api_key || !api_password) throw new Error('Leopards creds not configured')
  // MUST be POST with a JSON body — the GET/query-param form 504s on their side.
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 90_000)
  let txt: string
  try {
    const r = await fetch(`${LB}/getAllCities/format/json/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key, api_password }), signal: ac.signal,
    })
    txt = await r.text()
  }
  catch { throw new Error("Leopards' cities API is not responding (their server timed out). PostEx auto-booking works; try Leopards again later.") }
  finally { clearTimeout(timer) }
  let j: { city_list?: Array<{ id?: number | string; city_id?: number | string; name?: string; city_name?: string }> }
  try { j = JSON.parse(txt) } catch { throw new Error("Leopards' cities API returned an error (504/timeout on their side). Try again later — PostEx auto-booking works now.") }
  const list = j.city_list ?? []
  const map: Record<string, number> = {}
  for (const c of list) { const id = Number(c.id ?? c.city_id); const nm = c.name ?? c.city_name; if (id && nm) map[norm(nm)] = id }
  if (!Object.keys(map).length) throw new Error('Leopards returned no cities right now — try again later.')
  await setSetting('oms_leopards_cities', JSON.stringify(map))
  return Object.keys(map).length
}
async function leopardsCityMap(): Promise<Record<string, number>> {
  const raw = await setting('oms_leopards_cities')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
function leopardsCityId(city: string, map: Record<string, number>): number | null {
  const n = norm(city)
  if (map[n]) return map[n]
  const k = Object.keys(map).find(k => k.startsWith(n) || n.startsWith(k))
  return k ? map[k] : null
}

export async function leopardsBookPacket(o: BookableOrder): Promise<BookResult> {
  const api_key = process.env.LEOPARDS_API_KEY, api_password = process.env.LEOPARDS_API_PASSWORD
  if (!api_key || !api_password) throw new Error('Leopards creds not configured')
  if (!o.phone) throw new Error('order has no phone')
  const map = await leopardsCityMap()
  if (!Object.keys(map).length) throw new Error('Leopards city map not cached yet — refresh cities in Booking setup, or book manually')
  const dest = leopardsCityId(o.city, map)
  if (!dest) throw new Error(`Leopards has no city id for "${o.city}" — book manually`)
  // origin_city + shipment_* = 'self' → Leopards uses YOUR registered merchant
  // details (name/email/phone/address/origin city). No shipper config needed.
  const body = {
    api_key, api_password,
    booked_packet_weight: 500, booked_packet_no_piece: 1,
    booked_packet_collect_amount: Math.round(o.cod_amount || 0),
    booked_packet_order_id: o.order_number.replace(/^#/, ''),
    origin_city: 'self', destination_city: dest,
    shipment_name_eng: 'self', shipment_email: 'self', shipment_phone: 'self', shipment_address: 'self',
    consignment_name_eng: o.customer_name, consignment_email: '', consignment_phone: o.phone, consignment_address: o.address_raw || o.city,
    special_instructions: o.items.map(i => `${i.qty}x ${i.name}`).join(', ').slice(0, 200),
    shipment_type: 'overnight', custom_data: '',
  }
  const r = await fetch(`${LB}/bookPacket/format/json/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json() as { status?: number; error?: string; track_number?: string; slip_link?: string }
  if (j.status !== 1 || !j.track_number) throw new Error(`Leopards: ${j.error ?? 'booking failed'}`)
  return { cn: String(j.track_number), labelUrl: j.slip_link ?? null, courier: 'leopards' }
}

export async function bookOrder(o: BookableOrder, courier: 'leopards' | 'postex'): Promise<BookResult> {
  return courier === 'postex' ? postexCreateOrder(o) : leopardsBookPacket(o)
}
