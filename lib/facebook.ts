import { supabaseAdmin } from '@/lib/hub/supabase'

const FB_BASE = 'https://graph.facebook.com/v19.0'

// Resolve the FB token DB-first (site_settings.facebook_access_token) → env
// fallback — mirrors the Shopify token pattern. Production Vercel env can drift
// stale; the DB copy is the source of truth. Cached 5 min to avoid a DB hit per call.
let _fbTok: { val: string | null; exp: number } | null = null
export async function getFacebookToken(): Promise<string | null> {
  if (_fbTok && _fbTok.exp > Date.now()) return _fbTok.val
  let val: string | null = null
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'facebook_access_token').single()
    val = data?.value ?? null
  } catch { /* table/row may be absent */ }
  if (!val) val = process.env.FACEBOOK_ACCESS_TOKEN ?? null
  _fbTok = { val, exp: Date.now() + 5 * 60 * 1000 }
  return val
}

export interface FbRow {
  date_start: string
  ad_id: string
  ad_name: string
  account_id: string
  spend: number
  purchases: number
  revenue: number
  cac: number
  roas: number
  clicks: number
  impressions: number
  frequency: number
}

// Parse Facebook's actions array for purchase counts
function parsePurchases(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0
  const action = actions.find(a =>
    a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
    a.action_type === 'purchase'
  )
  return action ? parseFloat(action.value) : 0
}

function parseRevenue(actionValues?: { action_type: string; value: string }[]): number {
  if (!actionValues) return 0
  const av = actionValues.find(a =>
    a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
    a.action_type === 'purchase'
  )
  return av ? parseFloat(av.value) : 0
}

const cache = new Map<string, { data: FbRow[]; expiry: number }>()
const TTL = 15 * 60 * 1000

export async function getFacebookData(accountIds: string[], dateFrom: string, dateTo: string): Promise<FbRow[]> {
  const TOKEN = await getFacebookToken()
  if (!TOKEN) return [] // no token configured yet

  const results: FbRow[] = []

  for (const accountId of accountIds) {
    const cacheKey = `fb:${accountId}:${dateFrom}:${dateTo}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      results.push(...cached.data)
      continue
    }

    const url = new URL(`${FB_BASE}/act_${accountId}/insights`)
    url.searchParams.set('level', 'ad')
    url.searchParams.set('fields', 'ad_id,ad_name,account_id,spend,actions,action_values,purchase_roas,impressions,clicks,frequency')
    url.searchParams.set('time_range', JSON.stringify({ since: dateFrom, until: dateTo }))
    url.searchParams.set('time_increment', '1')
    url.searchParams.set('access_token', TOKEN)
    url.searchParams.set('limit', '500')

    try {
      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) continue

      const json = await res.json()
      const rows: FbRow[] = (json.data ?? []).map((d: Record<string, unknown>) => {
        const spend = parseFloat(String(d.spend ?? 0))
        const purchases = parsePurchases(d.actions as { action_type: string; value: string }[])
        const revenue = parseRevenue(d.action_values as { action_type: string; value: string }[])
        const purchaseRoas = d.purchase_roas as { action_type: string; value: string }[] | undefined
        const roasEntry = purchaseRoas?.find(r =>
          r.action_type === 'offsite_conversion.fb_pixel_purchase' || r.action_type === 'purchase'
        )
        const roas = roasEntry ? parseFloat(roasEntry.value) : (spend > 0 && revenue > 0 ? revenue / spend : 0)

        return {
          date_start: String(d.date_start),
          ad_id: String(d.ad_id),
          ad_name: String(d.ad_name ?? ''),
          account_id: String(d.account_id),
          spend,
          purchases,
          revenue,
          cac: purchases > 0 ? spend / purchases : 0,
          roas,
          clicks:      parseFloat(String(d.clicks      ?? 0)),
          impressions: parseFloat(String(d.impressions ?? 0)),
          frequency:   parseFloat(String(d.frequency   ?? 0)),
        } satisfies FbRow
      })

      cache.set(cacheKey, { data: rows, expiry: Date.now() + TTL })
      results.push(...rows)
    } catch {
      // silently skip — FB token may not be set up yet
    }
  }

  return results
}

export function clearFbCache() {
  cache.clear()
}

const thumbCache = new Map<string, { url: string; expiry: number }>()
const THUMB_TTL = 60 * 60 * 1000 // 1 hour — creative images don't change

export async function getFbThumbnails(adIds: string[]): Promise<Record<string, string>> {
  const TOKEN = await getFacebookToken()
  if (!TOKEN || adIds.length === 0) return {}

  const result: Record<string, string> = {}
  const uncached: string[] = []

  for (const id of adIds) {
    const hit = thumbCache.get(id)
    if (hit && hit.expiry > Date.now()) result[id] = hit.url
    else uncached.push(id)
  }

  for (let i = 0; i < uncached.length; i += 50) {
    const chunk = uncached.slice(i, i + 50)
    const url = new URL(`${FB_BASE}`)
    url.searchParams.set('ids', chunk.join(','))
    url.searchParams.set('fields', 'creative{thumbnail_url,image_url}')
    url.searchParams.set('access_token', TOKEN)

    try {
      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) continue
      const json = await res.json() as Record<string, {
        creative?: { thumbnail_url?: string; image_url?: string }
      }>
      for (const [adId, adData] of Object.entries(json)) {
        const thumbUrl = adData.creative?.thumbnail_url ?? adData.creative?.image_url
        if (thumbUrl) {
          result[adId] = thumbUrl
          thumbCache.set(adId, { url: thumbUrl, expiry: Date.now() + THUMB_TTL })
        }
      }
    } catch { /* skip silently */ }
  }

  return result
}
