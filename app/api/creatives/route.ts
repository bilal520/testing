import { NextRequest, NextResponse } from 'next/server'
import { MARKETS, getLast4Days, Market, getCacRating, toPrimaryCurrency, CacRating } from '@/lib/accounts'
import { getTikTokData, getGoogleAdsData } from '@/lib/windsor'
import { getFacebookData, getFbThumbnails } from '@/lib/facebook'

export interface CreativeDay {
  spend: number
  purchases: number
  cac: number
  roas: number
  revenue: number
  clicks: number
  impressions: number
  frequency: number
  ctr: number        // computed: (clicks / impressions) * 100
}

export interface Creative {
  id: string
  name: string
  platform: 'facebook' | 'tiktok' | 'google_ads'
  accountId: string
  accountName: string
  currency: string
  cacRating: CacRating
  days: Record<string, CreativeDay>
  // Pre-converted to primary currency for client-side sorting (no exchange rate logic needed in browser)
  primaryCac: number       // 4-day avg CAC in market primary currency
  primarySpend: number     // 4-day total spend in market primary currency
  totalPurchases: number   // 4-day total purchases
  thumbnailUrl?: string
}

function buildCreativeKey(platform: string, adId: string) {
  return `${platform}:${adId}`
}

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get('market') as Market
  if (!market || !MARKETS[market]) {
    return NextResponse.json({ error: 'invalid market' }, { status: 400 })
  }

  const config = MARKETS[market]
  const days = getLast4Days() // Pakistan business day for the whole team
  const dateFrom = days[3]
  const dateTo = days[0]
  const minSpend = config.minSpend

  const tikTokIds = config.accounts.filter(a => a.platform === 'tiktok').map(a => a.id)
  const fbIds     = config.accounts.filter(a => a.platform === 'facebook').map(a => a.id)
  const googleIds = config.accounts.filter(a => a.platform === 'google_ads').map(a => a.id)

  const [tikTokRows, fbRows, googleRows] = await Promise.all([
    tikTokIds.length ? getTikTokData(tikTokIds, dateFrom, dateTo).catch(() => [])    : Promise.resolve([]),
    fbIds.length     ? getFacebookData(fbIds, dateFrom, dateTo).catch(() => [])      : Promise.resolve([]),
    googleIds.length ? getGoogleAdsData(googleIds, dateFrom, dateTo).catch(() => []) : Promise.resolve([]),
  ])

  const creativeMap = new Map<string, Creative>()

  const makeEntry = (
    key: string, name: string, platform: Creative['platform'],
    accountId: string, accountName: string, currency: string
  ): Creative => ({
    id: key, name, platform, accountId, accountName, currency,
    cacRating: 'bad',
    days: Object.fromEntries(days.map(d => [d, { spend: 0, purchases: 0, cac: 0, roas: 0, revenue: 0, clicks: 0, impressions: 0, frequency: 0, ctr: 0 }])),
    primaryCac: 0, primarySpend: 0, totalPurchases: 0,
  })

  for (const row of tikTokRows) {
    if (!days.includes(row.date)) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    if (!acct) continue
    const key = buildCreativeKey('tiktok', `${row.account_id}:${row.ad_name}`)
    if (!creativeMap.has(key)) creativeMap.set(key, makeEntry(key, row.ad_name ?? 'Unknown ad', 'tiktok', acct.id, acct.name, acct.currency))
    const c = creativeMap.get(key)!
    c.days[row.date].spend     += row.spend ?? 0
    c.days[row.date].purchases += row.complete_payment ?? 0
    c.days[row.date].revenue   += row.total_complete_payment_rate ?? 0
  }

  for (const row of fbRows) {
    if (!days.includes(row.date_start)) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    if (!acct) continue
    const key = buildCreativeKey('facebook', row.ad_id)
    if (!creativeMap.has(key)) creativeMap.set(key, makeEntry(key, row.ad_name ?? 'Unknown ad', 'facebook', acct.id, acct.name, acct.currency))
    const c = creativeMap.get(key)!
    c.days[row.date_start].spend       += row.spend
    c.days[row.date_start].purchases   += row.purchases
    c.days[row.date_start].revenue     += row.revenue
    c.days[row.date_start].clicks      += row.clicks
    c.days[row.date_start].impressions += row.impressions
    c.days[row.date_start].frequency    = row.frequency  // avg — set not sum
  }

  for (const row of googleRows) {
    if (!days.includes(row.date)) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    if (!acct) continue
    const key = buildCreativeKey('google_ads', `${row.account_id}:${row.ad_name}`)
    if (!creativeMap.has(key)) creativeMap.set(key, makeEntry(key, row.ad_name ?? 'Unknown ad', 'google_ads', acct.id, acct.name, acct.currency))
    const c = creativeMap.get(key)!
    c.days[row.date].spend       += row.spend ?? 0
    c.days[row.date].purchases   += row.conversions ?? 0
    c.days[row.date].revenue     += row.conversion_value ?? 0
    c.days[row.date].clicks      += row.clicks ?? 0
    c.days[row.date].impressions += row.impressions ?? 0
  }

  // Derive per-day metrics and aggregate sorting fields
  const qualified: Creative[] = []

  for (const creative of creativeMap.values()) {
    for (const day of days) {
      const d = creative.days[day]
      d.cac  = d.purchases > 0 ? d.spend / d.purchases : 0
      d.roas = d.spend > 0 ? d.revenue / d.spend : 0
      d.ctr  = d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0
    }

    const totalSpend     = days.reduce((s, d) => s + creative.days[d].spend, 0)
    const totalPurchases = days.reduce((s, d) => s + creative.days[d].purchases, 0)
    const avgCac         = totalPurchases > 0 ? totalSpend / totalPurchases : 0

    creative.totalPurchases = totalPurchases
    creative.primarySpend   = toPrimaryCurrency(totalSpend, creative.currency, market)
    creative.primaryCac     = toPrimaryCurrency(avgCac, creative.currency, market)
    creative.cacRating      = totalPurchases > 0 ? getCacRating(creative.primaryCac, market) : 'bad'

    // Must have min spend on today or yesterday
    const todaySpendPrimary = toPrimaryCurrency(creative.days[days[0]].spend, creative.currency, market)
    const ydaySpendPrimary  = toPrimaryCurrency(creative.days[days[1]]?.spend ?? 0, creative.currency, market)
    if (todaySpendPrimary < minSpend && ydaySpendPrimary < minSpend) continue

    // Must have at least one purchase in the 4-day window to be ranked
    if (totalPurchases === 0) continue

    qualified.push(creative)
  }

  // Fetch thumbnails for all qualifying Facebook creatives (cached 1hr, so subsequent sort-mode switches are free)
  const fbAdIds = qualified
    .filter(c => c.platform === 'facebook')
    .map(c => c.id.replace('facebook:', ''))
  const thumbnails = await getFbThumbnails(fbAdIds)

  for (const c of qualified) {
    if (c.platform === 'facebook') {
      const adId = c.id.replace('facebook:', '')
      if (thumbnails[adId]) c.thumbnailUrl = thumbnails[adId]
    }
  }

  return NextResponse.json({ market, days, creatives: qualified, fetchedAt: new Date().toISOString() })
}
