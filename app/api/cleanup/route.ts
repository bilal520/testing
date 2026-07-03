import { NextResponse } from 'next/server'
import { MARKETS, getCacRating, toPrimaryCurrency, getLast4Days } from '@/lib/accounts'
import type { Market, Platform } from '@/lib/accounts'
import { getFacebookData, getFbThumbnails } from '@/lib/facebook'
import type { FbRow } from '@/lib/facebook'
import { getTikTokData, getGoogleAdsData } from '@/lib/windsor'
import type { WindsorRow } from '@/lib/windsor'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CleanupDayData {
  date: string
  cac: number        // in account billing currency
  primaryCac: number // in market primary currency
  spend: number      // in account billing currency
  purchases: number
  impressions: number
}

export interface CleanupAd {
  id: string
  name: string
  platform: Platform
  accountName: string
  currency: string       // account billing currency
  market: Market
  dayData: CleanupDayData[]       // always exactly 3 entries
  wastedSpend: number             // total 3-day spend in primary currency
  avgPrimaryCac: number
  thumbnailUrl?: string
}

export interface MarketCleanup {
  market: Market
  marketName: string
  flag: string
  primaryCurrency: string
  flaggedAds: CleanupAd[]
  totalWastedSpend: number  // in primary currency
}

export interface CleanupResponse {
  markets: MarketCleanup[]
  checkedDates: string[]   // [yesterday, -2d, -3d]
  totalFlagged: number
  fetchedAt: string
}

// ─── Helper: is this day's performance "bad"? ─────────────────────────────────
// Zero purchases with any spend = bad (infinite CAC)
// Otherwise use getCacRating

function isBadDay(spend: number, purchases: number, primaryCac: number, market: Market): boolean {
  if (spend <= 0) return false             // ad wasn't running
  if (purchases === 0) return true         // spending with zero conversions
  return getCacRating(primaryCac, market) === 'bad'
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET() {
  const allDays      = getLast4Days()          // [today, yesterday, -2d, -3d]
  const checkedDates = allDays.slice(1, 4)     // skip today (incomplete) → 3 complete days
  const dateFrom     = checkedDates[2]         // -3d (oldest)
  const dateTo       = checkedDates[0]         // yesterday (most recent)

  const MARKET_LIST: Market[] = ['pakistan', 'uae', 'bangladesh']
  const resultMarkets: MarketCleanup[] = []

  for (const market of MARKET_LIST) {
    const config      = MARKETS[market]
    const fbAccounts  = config.accounts.filter(a => a.platform === 'facebook')
    const ttAccounts  = config.accounts.filter(a => a.platform === 'tiktok')
    const ggAccounts  = config.accounts.filter(a => a.platform === 'google_ads')
    const flaggedAds: CleanupAd[] = []

    // ── Facebook ────────────────────────────────────────────────────────────
    if (fbAccounts.length > 0) {
      const rows = await getFacebookData(fbAccounts.map(a => a.id), dateFrom, dateTo).catch(() => [])

      // Group rows by ad_id
      const byAd = new Map<string, FbRow[]>()
      for (const row of rows) {
        if (!byAd.has(row.ad_id)) byAd.set(row.ad_id, [])
        byAd.get(row.ad_id)!.push(row)
      }

      for (const [adId, adRows] of byAd) {
        const acct    = fbAccounts.find(a => adRows.some(r => String(r.account_id) === a.id))
                        ?? fbAccounts[0]
        const dayMap  = new Map(adRows.map(r => [r.date_start, r]))

        const dayData: (CleanupDayData | null)[] = checkedDates.map(date => {
          const r = dayMap.get(date)
          if (!r || r.impressions <= 0) return null   // not active that day
          const primaryCac = toPrimaryCurrency(r.cac, acct.currency, market)
          return { date, cac: r.cac, primaryCac, spend: r.spend, purchases: r.purchases, impressions: r.impressions }
        })

        // Must be active on ALL 3 days
        if (dayData.some(d => d === null)) continue
        const days = dayData as CleanupDayData[]

        // Must have bad CAC on ALL 3 days
        if (!days.every(d => isBadDay(d.spend, d.purchases, d.primaryCac, market))) continue

        const wastedSpend  = days.reduce((s, d) => s + toPrimaryCurrency(d.spend, acct.currency, market), 0)
        const avgPrimaryCac = days.filter(d => d.purchases > 0).reduce((s, d) => s + d.primaryCac, 0)
                              / (days.filter(d => d.purchases > 0).length || 1)

        flaggedAds.push({ id: adId, name: adRows[0].ad_name, platform: 'facebook', accountName: acct.name, currency: acct.currency, market, dayData: days, wastedSpend, avgPrimaryCac })
      }
    }

    // ── TikTok ──────────────────────────────────────────────────────────────
    if (ttAccounts.length > 0) {
      const rows = await getTikTokData(ttAccounts.map(a => a.id), dateFrom, dateTo).catch(() => [])

      const byAd = new Map<string, WindsorRow[]>()
      for (const row of rows) {
        const key = `${row.account_id}::${row.ad_name}`
        if (!byAd.has(key)) byAd.set(key, [])
        byAd.get(key)!.push(row)
      }

      for (const [key, adRows] of byAd) {
        const accId = key.split('::')[0]
        const acct  = ttAccounts.find(a => a.id === accId) ?? ttAccounts[0]
        const dayMap = new Map(adRows.map(r => [r.date, r]))

        const dayData: (CleanupDayData | null)[] = checkedDates.map(date => {
          const r = dayMap.get(date)
          if (!r || r.spend <= 0) return null  // use spend as proxy for active (TikTok has no impressions field)
          const cac        = r.cost_per_conversion ?? 0
          const primaryCac = toPrimaryCurrency(cac, acct.currency, market)
          return { date, cac, primaryCac, spend: r.spend, purchases: r.complete_payment ?? 0, impressions: 1 }
        })

        if (dayData.some(d => d === null)) continue
        const days = dayData as CleanupDayData[]
        if (!days.every(d => isBadDay(d.spend, d.purchases, d.primaryCac, market))) continue

        const wastedSpend   = days.reduce((s, d) => s + toPrimaryCurrency(d.spend, acct.currency, market), 0)
        const avgPrimaryCac = days.filter(d => d.purchases > 0).reduce((s, d) => s + d.primaryCac, 0)
                              / (days.filter(d => d.purchases > 0).length || 1)

        flaggedAds.push({ id: key, name: adRows[0].ad_name, platform: 'tiktok', accountName: acct.name, currency: acct.currency, market, dayData: days, wastedSpend, avgPrimaryCac })
      }
    }

    // ── Google Ads ───────────────────────────────────────────────────────────
    if (ggAccounts.length > 0) {
      const rows = await getGoogleAdsData(ggAccounts.map(a => a.id), dateFrom, dateTo).catch(() => [])

      const byAd = new Map<string, WindsorRow[]>()
      for (const row of rows) {
        const key = `${row.account_id}::${row.ad_name}`
        if (!byAd.has(key)) byAd.set(key, [])
        byAd.get(key)!.push(row)
      }

      for (const [key, adRows] of byAd) {
        const accId = key.split('::')[0]
        const acct  = ggAccounts.find(a => a.id === accId) ?? ggAccounts[0]
        const dayMap = new Map(adRows.map(r => [r.date, r]))

        const dayData: (CleanupDayData | null)[] = checkedDates.map(date => {
          const r = dayMap.get(date)
          if (!r || r.spend <= 0) return null
          const cac        = r.cost_per_conversion ?? 0
          const primaryCac = toPrimaryCurrency(cac, acct.currency, market)
          return { date, cac, primaryCac, spend: r.spend, purchases: r.conversions ?? 0, impressions: 1 }
        })

        if (dayData.some(d => d === null)) continue
        const days = dayData as CleanupDayData[]
        if (!days.every(d => isBadDay(d.spend, d.purchases, d.primaryCac, market))) continue

        const wastedSpend   = days.reduce((s, d) => s + toPrimaryCurrency(d.spend, acct.currency, market), 0)
        const avgPrimaryCac = days.filter(d => d.purchases > 0).reduce((s, d) => s + d.primaryCac, 0)
                              / (days.filter(d => d.purchases > 0).length || 1)

        flaggedAds.push({ id: key, name: adRows[0].ad_name, platform: 'google_ads', accountName: acct.name, currency: acct.currency, market, dayData: days, wastedSpend, avgPrimaryCac })
      }
    }

    // Fetch thumbnails for flagged FB ads
    const fbFlagged = flaggedAds.filter(a => a.platform === 'facebook')
    if (fbFlagged.length > 0) {
      const thumbs = await getFbThumbnails(fbFlagged.map(a => a.id)).catch(() => ({} as Record<string, string>))
      for (const ad of fbFlagged) {
        if (thumbs[ad.id]) ad.thumbnailUrl = thumbs[ad.id]
      }
    }

    // Sort worst offenders (highest wasted spend) first
    flaggedAds.sort((a, b) => b.wastedSpend - a.wastedSpend)

    resultMarkets.push({
      market,
      marketName:      config.name,
      flag:            config.flag,
      primaryCurrency: config.primaryCurrency,
      flaggedAds,
      totalWastedSpend: flaggedAds.reduce((s, a) => s + a.wastedSpend, 0),
    })
  }

  const response: CleanupResponse = {
    markets:      resultMarkets,
    checkedDates,
    totalFlagged: resultMarkets.reduce((s, m) => s + m.flaggedAds.length, 0),
    fetchedAt:    new Date().toISOString(),
  }

  return NextResponse.json(response)
}
