const WINDSOR_BASE = 'https://connectors.windsor.ai'
const API_KEY = process.env.WINDSOR_API_KEY!

export interface WindsorRow {
  date: string
  account_id: string
  account_name: string
  ad_name: string
  campaign_name: string
  spend: number
  complete_payment: number       // purchases (TikTok)
  cost_per_conversion: number    // CAC
  complete_payment_roas: number  // ROAS
  value_per_complete_payment: number // AOV
  total_complete_payment_rate: number // TikTok website purchase VALUE (revenue). The "_rate" name is misleading — it is the total value, not a ratio. The old total_on_web_order_value field returns 0.
  conversions?: number           // Google Ads conversions
  conversion_value?: number      // Google Ads revenue
  clicks?: number                // Google Ads clicks
  impressions?: number           // Google Ads impressions
}

const TIKTOK_FIELDS = [
  'date', 'account_id', 'account_name', 'ad_name', 'campaign_name',
  'spend', 'complete_payment', 'cost_per_conversion',
  'complete_payment_roas', 'value_per_complete_payment', 'total_complete_payment_rate',
].join(',')

const GOOGLE_FIELDS = [
  'date', 'account_id', 'account_name', 'ad_name', 'campaign_name',
  'spend', 'clicks', 'impressions', 'conversions', 'cost_per_conversion', 'conversion_value',
].join(',')

// Simple in-memory cache: key -> { data, expiry }
const cache = new Map<string, { data: WindsorRow[]; expiry: number }>()
// 5 min keeps "today" fresh (Windsor itself syncs coarsely, so shorter buys
// little) while still batching repeat loads from the team so we don't hammer
// the Windsor API.
const TTL = 5 * 60 * 1000 // 5 minutes

async function fetchWindsor(connector: 'tiktok' | 'google_ads', fields: string, dateFrom: string, dateTo: string): Promise<WindsorRow[]> {
  const key = `${connector}:${dateFrom}:${dateTo}`
  const cached = cache.get(key)
  if (cached && cached.expiry > Date.now()) return cached.data

  const url = new URL(`${WINDSOR_BASE}/${connector}`)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('date_from', dateFrom)
  url.searchParams.set('date_to', dateTo)
  url.searchParams.set('fields', fields)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Windsor ${connector} error: ${res.status}`)

  const json = await res.json()
  const data: WindsorRow[] = json.data ?? json ?? []

  cache.set(key, { data, expiry: Date.now() + TTL })
  return data
}

export async function getTikTokData(accountIds: string[], dateFrom: string, dateTo: string): Promise<WindsorRow[]> {
  const rows = await fetchWindsor('tiktok', TIKTOK_FIELDS, dateFrom, dateTo)
  return rows.filter(r => accountIds.includes(String(r.account_id)))
}

export async function getGoogleAdsData(accountIds: string[], dateFrom: string, dateTo: string): Promise<WindsorRow[]> {
  const rows = await fetchWindsor('google_ads', GOOGLE_FIELDS, dateFrom, dateTo)
  return rows.filter(r => accountIds.includes(String(r.account_id)))
}

export function clearCache() {
  cache.clear()
}
