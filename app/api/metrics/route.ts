import { NextRequest, NextResponse } from 'next/server'
import { MARKETS, getLast4Days, Market, toPrimaryCurrency } from '@/lib/accounts'
import { getTikTokData, getGoogleAdsData } from '@/lib/windsor'
import { getFacebookData } from '@/lib/facebook'
import { clearCache } from '@/lib/windsor'
import { clearFbCache } from '@/lib/facebook'
import { canRefresh, recordRefresh } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get('market') as Market
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'

  if (!market || !MARKETS[market]) {
    return NextResponse.json({ error: 'invalid market' }, { status: 400 })
  }

  if (refresh && canRefresh(`metrics:${market}`)) {
    clearCache()
    clearFbCache()
    recordRefresh(`metrics:${market}`)
  }

  const config = MARKETS[market]
  const days = getLast4Days() // Pakistan business day for the whole team
  const dateFrom = days[3] // 3 days ago
  const dateTo = days[0]   // today
  const tikTokIds = config.accounts.filter(a => a.platform === 'tiktok').map(a => a.id)
  const googleIds  = config.accounts.filter(a => a.platform === 'google_ads').map(a => a.id)
  const fbIds      = config.accounts.filter(a => a.platform === 'facebook').map(a => a.id)

  const [tikTokRows, googleRows, fbRows] = await Promise.all([
    tikTokIds.length ? getTikTokData(tikTokIds, dateFrom, dateTo).catch(() => []) : Promise.resolve([]),
    googleIds.length ? getGoogleAdsData(googleIds, dateFrom, dateTo).catch(() => []) : Promise.resolve([]),
    fbIds.length     ? getFacebookData(fbIds, dateFrom, dateTo).catch(() => [])     : Promise.resolve([]),
  ])

  // Build per-day cumulative totals (in primary currency)
  const cumulative: Record<string, { spend: number; purchases: number; revenue: number }> = {}

  for (const day of days) {
    cumulative[day] = { spend: 0, purchases: 0, revenue: 0 }
  }

  for (const row of tikTokRows) {
    if (!cumulative[row.date]) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    const currency = acct?.currency ?? config.primaryCurrency
    cumulative[row.date].spend     += toPrimaryCurrency(row.spend ?? 0, currency, market)
    cumulative[row.date].purchases += row.complete_payment ?? 0
    cumulative[row.date].revenue   += toPrimaryCurrency(row.total_complete_payment_rate ?? 0, currency, market)
  }

  for (const row of googleRows) {
    if (!cumulative[row.date]) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    const currency = acct?.currency ?? config.primaryCurrency
    cumulative[row.date].spend     += toPrimaryCurrency(row.spend ?? 0, currency, market)
    cumulative[row.date].purchases += row.conversions ?? 0
  }

  for (const row of fbRows) {
    if (!cumulative[row.date_start]) continue
    const acct = config.accounts.find(a => a.id === String(row.account_id))
    const currency = acct?.currency ?? config.primaryCurrency
    cumulative[row.date_start].spend     += toPrimaryCurrency(row.spend, currency, market)
    cumulative[row.date_start].purchases += row.purchases
    cumulative[row.date_start].revenue   += toPrimaryCurrency(row.revenue, currency, market)
  }

  // Derive CAC, ROAS, AOV from aggregated totals
  const cumulativeMetrics = Object.fromEntries(
    days.map(day => {
      const d = cumulative[day]
      const cac  = d.purchases > 0 ? d.spend / d.purchases : 0
      const roas = d.spend > 0 ? d.revenue / d.spend : 0
      const aov  = d.purchases > 0 ? d.revenue / d.purchases : 0
      return [day, { spend: d.spend, purchases: d.purchases, revenue: d.revenue, cac, roas, aov }]
    })
  )

  // Build per-account breakdown
  const byAccount: Record<string, {
    name: string; platform: string; currency: string;
    days: Record<string, { spend: number; purchases: number; cac: number; roas: number; revenue: number }>
  }> = {}

  for (const acct of config.accounts) {
    byAccount[acct.id] = { name: acct.name, platform: acct.platform, currency: acct.currency, days: {} }
    for (const day of days) {
      byAccount[acct.id].days[day] = { spend: 0, purchases: 0, cac: 0, roas: 0, revenue: 0 }
    }
  }

  for (const row of tikTokRows) {
    const id = String(row.account_id)
    if (!byAccount[id]) continue
    const day = row.date
    if (!byAccount[id].days[day]) continue
    byAccount[id].days[day].spend     += row.spend ?? 0
    byAccount[id].days[day].purchases += row.complete_payment ?? 0
    byAccount[id].days[day].revenue   += row.total_complete_payment_rate ?? 0
  }

  for (const row of googleRows) {
    const id = String(row.account_id)
    if (!byAccount[id]) continue
    const day = row.date
    if (!byAccount[id].days[day]) continue
    byAccount[id].days[day].spend     += row.spend ?? 0
    byAccount[id].days[day].purchases += row.conversions ?? 0
  }

  for (const row of fbRows) {
    const id = String(row.account_id)
    if (!byAccount[id]) continue
    const day = row.date_start
    if (!byAccount[id].days[day]) continue
    byAccount[id].days[day].spend     += row.spend
    byAccount[id].days[day].purchases += row.purchases
    byAccount[id].days[day].revenue   += row.revenue
  }

  // Derive CAC/ROAS per account per day
  for (const acct of Object.values(byAccount)) {
    for (const day of Object.values(acct.days)) {
      day.cac  = day.purchases > 0 ? day.spend / day.purchases : 0
      day.roas = day.spend > 0 ? day.revenue / day.spend : 0
    }
  }

  return NextResponse.json({
    market,
    days,
    cumulative: cumulativeMetrics,
    byAccount,
    fetchedAt: new Date().toISOString(),
  })
}
