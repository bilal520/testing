import { NextRequest, NextResponse } from 'next/server'
import { MARKETS, toPrimaryCurrency } from '@/lib/accounts'
import type { Market } from '@/lib/accounts'
import { getTikTokData, getGoogleAdsData } from '@/lib/windsor'
import { getFacebookToken } from '@/lib/facebook'

const FB_BASE = 'https://graph.facebook.com/v19.0'

// 1-hour cache — monthly totals don't need to be real-time
const cache = new Map<string, { data: unknown; ts: number }>()
const TTL = 60 * 60 * 1000

const UTC_OFFSET: Record<Market, number> = { pakistan: 5, uae: 4, bangladesh: 6 }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }

function getDateRanges(market: Market) {
  const now        = new Date()
  const marketNow  = new Date(now.getTime() + UTC_OFFSET[market] * 3600 * 1000)
  const year       = marketNow.getUTCFullYear()
  const month      = marketNow.getUTCMonth()  // 0-indexed
  const day        = marketNow.getUTCDate()

  // This month: 1st → today
  const thisStart  = `${year}-${pad(month + 1)}-01`
  const thisEnd    = `${year}-${pad(month + 1)}-${pad(day)}`

  // Last month: 1st → same day-of-month (clamped to last day of that month)
  const lastYear   = month === 0 ? year - 1 : year
  const lastMonth  = month === 0 ? 11 : month - 1
  // Days in last month
  const daysInLast = new Date(lastYear, lastMonth + 1, 0).getDate()
  const lastDay    = Math.min(day, daysInLast)
  const lastStart  = `${lastYear}-${pad(lastMonth + 1)}-01`
  const lastEnd    = `${lastYear}-${pad(lastMonth + 1)}-${pad(lastDay)}`

  // Human labels
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const thisLabel  = `${monthNames[month]} 1–${day}`
  const lastLabel  = `${monthNames[lastMonth]} 1–${lastDay}`

  return { thisStart, thisEnd, lastStart, lastEnd, thisLabel, lastLabel }
}

// ─── Facebook account-level spend ────────────────────────────────────────────

async function getFbAccountSpend(accountId: string, dateFrom: string, dateTo: string): Promise<number> {
  const key = `fb_monthly:${accountId}:${dateFrom}:${dateTo}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < TTL) return hit.data as number

  try {
    const url = new URL(`${FB_BASE}/act_${accountId}/insights`)
    url.searchParams.set('level', 'account')
    url.searchParams.set('fields', 'spend')
    url.searchParams.set('time_range', JSON.stringify({ since: dateFrom, until: dateTo }))
    url.searchParams.set('access_token', (await getFacebookToken()) ?? '')

    const res  = await fetch(url.toString(), { cache: 'no-store' })
    const json = await res.json()
    const spend = parseFloat(json.data?.[0]?.spend ?? '0')
    cache.set(key, { data: spend, ts: Date.now() })
    return spend
  } catch {
    return 0
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export interface PlatformSpend {
  platform: 'facebook' | 'tiktok' | 'google_ads'
  thisPeriod: number
  lastPeriod: number
}

export interface MonthlyData {
  market: string
  currency: string
  thisLabel: string
  lastLabel: string
  platforms: PlatformSpend[]
  total: { thisPeriod: number; lastPeriod: number }
}

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') ?? 'pakistan') as Market
  const config = MARKETS[market]
  const primary = config.primaryCurrency
  const { thisStart, thisEnd, lastStart, lastEnd, thisLabel, lastLabel } = getDateRanges(market)

  const fbAccounts  = config.accounts.filter(a => a.platform === 'facebook')
  const ttAccounts  = config.accounts.filter(a => a.platform === 'tiktok')
  const ggAccounts  = config.accounts.filter(a => a.platform === 'google_ads')
  const ttIds       = ttAccounts.map(a => a.id)
  const ggIds       = ggAccounts.map(a => a.id)

  // ── Facebook ──────────────────────────────────────────────────────────────
  const [fbThisRaw, fbLastRaw] = await Promise.all([
    Promise.all(fbAccounts.map(a => getFbAccountSpend(a.id, thisStart, thisEnd).then(s => ({ spend: s, currency: a.currency })))),
    Promise.all(fbAccounts.map(a => getFbAccountSpend(a.id, lastStart, lastEnd).then(s => ({ spend: s, currency: a.currency })))),
  ])
  const fbThis = fbThisRaw.reduce((s, r) => s + toPrimaryCurrency(r.spend, r.currency, market), 0)
  const fbLast = fbLastRaw.reduce((s, r) => s + toPrimaryCurrency(r.spend, r.currency, market), 0)

  // ── TikTok ────────────────────────────────────────────────────────────────
  let ttThis = 0, ttLast = 0
  if (ttIds.length > 0) {
    const [ttThisRows, ttLastRows] = await Promise.all([
      getTikTokData(ttIds, thisStart, thisEnd).catch(() => []),
      getTikTokData(ttIds, lastStart, lastEnd).catch(() => []),
    ])
    // TikTok accounts bill in AED for this market
    const ttCurrency = ttAccounts[0]?.currency ?? primary
    ttThis = ttThisRows.reduce((s, r) => s + toPrimaryCurrency(r.spend, ttCurrency, market), 0)
    ttLast = ttLastRows.reduce((s, r) => s + toPrimaryCurrency(r.spend, ttCurrency, market), 0)
  }

  // ── Google Ads ────────────────────────────────────────────────────────────
  let ggThis = 0, ggLast = 0
  if (ggIds.length > 0) {
    const [ggThisRows, ggLastRows] = await Promise.all([
      getGoogleAdsData(ggIds, thisStart, thisEnd).catch(() => []),
      getGoogleAdsData(ggIds, lastStart, lastEnd).catch(() => []),
    ])
    const ggCurrency = ggAccounts[0]?.currency ?? primary
    ggThis = ggThisRows.reduce((s, r) => s + toPrimaryCurrency(r.spend, ggCurrency, market), 0)
    ggLast = ggLastRows.reduce((s, r) => s + toPrimaryCurrency(r.spend, ggCurrency, market), 0)
  }

  const platforms: PlatformSpend[] = [
    ...(fbAccounts.length  > 0 ? [{ platform: 'facebook'   as const, thisPeriod: fbThis, lastPeriod: fbLast }] : []),
    ...(ttAccounts.length  > 0 ? [{ platform: 'tiktok'     as const, thisPeriod: ttThis, lastPeriod: ttLast }] : []),
    ...(ggAccounts.length  > 0 ? [{ platform: 'google_ads' as const, thisPeriod: ggThis, lastPeriod: ggLast }] : []),
  ]

  const total = {
    thisPeriod: platforms.reduce((s, p) => s + p.thisPeriod, 0),
    lastPeriod: platforms.reduce((s, p) => s + p.lastPeriod, 0),
  }

  const data: MonthlyData = { market, currency: primary, thisLabel, lastLabel, platforms, total }
  return NextResponse.json(data)
}
