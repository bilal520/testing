// Central config — add new ad accounts here without touching anything else.
// For each account: id = the platform account ID, currency = what the account bills in.

export type Platform = 'facebook' | 'tiktok' | 'google_ads'
export type Market = 'pakistan' | 'uae' | 'bangladesh'
export type CacRating = 'excellent' | 'good' | 'average' | 'bad'

export interface AdAccount {
  id: string
  name: string
  platform: Platform
  currency: string
}

export interface MarketConfig {
  name: string
  flag: string
  primaryCurrency: string
  // Exchange rates to primary currency (for cross-currency accounts)
  exchangeRates: Record<string, number>
  cac: {
    excellent: number
    good: number
    average: number | null // null = no average tier (e.g. UAE)
  }
  minSpend: number // in primary currency
  accounts: AdAccount[]
}

export const MARKETS: Record<Market, MarketConfig> = {
  pakistan: {
    name: 'Pakistan',
    flag: '🇵🇰',
    primaryCurrency: 'PKR',
    exchangeRates: { PKR: 1, AED: 80, USD: 305 },
    cac: { excellent: 300, good: 400, average: 500 },
    minSpend: 1000,
    accounts: [
      { id: '370296538938550',   name: 'Elyscents - WYP',       platform: 'facebook',   currency: 'PKR' },
      { id: '332304497644348',   name: 'K_ELYSCENT PAK 3',      platform: 'facebook',   currency: 'AED' },
      { id: '959998310151549',   name: 'ES1 2026',              platform: 'facebook',   currency: 'USD' },
      { id: '7545918710952034305', name: 'K314 TikTok PK',      platform: 'tiktok',     currency: 'AED' },
      { id: '512-340-2619',      name: 'AGN Amin (Google)',     platform: 'google_ads', currency: 'AED' },
    ],
  },
  uae: {
    name: 'UAE',
    flag: '🇦🇪',
    primaryCurrency: 'AED',
    exchangeRates: { AED: 1, USD: 3.67 },
    cac: { excellent: 4, good: 6, average: 8 },
    minSpend: 10,
    accounts: [
      { id: '1396321775133016',    name: 'Elyscents UAE',       platform: 'facebook',   currency: 'AED' },
      { id: '7541737089831436304', name: 'K309 TikTok UAE',     platform: 'tiktok',     currency: 'AED' },
      { id: '7545916335125987346', name: 'G9 TikTok UAE 2',     platform: 'tiktok',     currency: 'USD' },
    ],
  },
  bangladesh: {
    name: 'Bangladesh',
    flag: '🇧🇩',
    primaryCurrency: 'PKR',
    exchangeRates: { PKR: 1 },
    cac: { excellent: 500, good: 650, average: 750 },
    minSpend: 1000,
    accounts: [
      { id: '883030644666446', name: 'Elyscents Bangladesh', platform: 'facebook', currency: 'PKR' },
    ],
  },
}

export function getCacRating(cac: number, market: Market): CacRating {
  const thresholds = MARKETS[market].cac
  if (cac < thresholds.excellent) return 'excellent'
  if (cac < thresholds.good) return 'good'
  if (thresholds.average !== null && cac < thresholds.average) return 'average'
  return 'bad'
}

export function toPrimaryCurrency(amount: number, fromCurrency: string, market: Market): number {
  const rates = MARKETS[market].exchangeRates
  const rate = rates[fromCurrency] ?? 1
  return amount * rate
}

// The whole team operates on Pakistan time, so every market's "today" is
// anchored to a single Pakistan business day — NOT each market's local zone.
export const BUSINESS_TIMEZONE = 'Asia/Karachi'

// Returns the last 4 days as YYYY-MM-DD strings, index 0 = today.
// Pass a timezone so "today" is the business day, not the server's (Vercel runs
// in UTC — without this, "today" shows the previous calendar day for the first
// ~5 hours of every Pakistan day).
export function getLast4Days(timezone: string = BUSINESS_TIMEZONE): string[] {
  // Local YYYY-MM-DD in the target timezone. en-CA formats as YYYY-MM-DD.
  const todayStr = timezone
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
    : new Date().toISOString().split('T')[0]

  const [y, m, d] = todayStr.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const days: string[] = []
  for (let i = 0; i < 4; i++) {
    days.push(new Date(base - i * 86_400_000).toISOString().split('T')[0])
  }
  return days
}

export const DAY_LABELS = ['Today', 'Yesterday', '2 days ago', '3 days ago']
