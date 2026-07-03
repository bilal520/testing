import { NextRequest, NextResponse } from 'next/server'
import { MARKETS } from '@/lib/accounts'
import type { Market } from '@/lib/accounts'
import { getFacebookToken } from '@/lib/facebook'

const FB_BASE  = 'https://graph.facebook.com/v19.0'

// 5-minute cache (activity feed should be fresh)
const cache = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000

// Market UTC offsets for computing "today" in local time
const UTC_OFFSET: Record<Market, number> = { pakistan: 5, uae: 4, bangladesh: 6 }

// ─── Types ───────────────────────────────────────────────────────────────────

interface FbActivity {
  event_type: string
  object_id: string
  object_name: string
  object_type: string
  created_time: string
  extra_data: string
  actor_name?: string
}

export type ActivityType =
  | 'new_ad' | 'new_adset' | 'new_campaign'
  | 'paused_ad' | 'activated_ad' | 'deleted_ad'
  | 'budget_change'

export interface ParsedActivity {
  type: ActivityType
  id: string
  name: string
  time: string
  actor?: string
  detail?: string
}

export interface AccountActivity {
  accountId: string
  accountName: string
  currency: string
  newAdCount: number
  activities: ParsedActivity[]
}

// ─── Facebook Activities fetch ────────────────────────────────────────────────

async function fetchAccountActivities(accountId: string, since: number, until: number): Promise<FbActivity[]> {
  const key = `act_${accountId}_${since}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data as FbActivity[]

  const fields = 'event_type,object_id,object_name,object_type,created_time,extra_data,actor_name'
  const FB_TOKEN = await getFacebookToken()
  const url = `${FB_BASE}/act_${accountId}/activities?fields=${fields}&since=${since}&until=${until}&limit=300&access_token=${FB_TOKEN}`

  try {
    const res  = await fetch(url, { cache: 'no-store' })
    const json = await res.json()
    if (json.error) {
      console.error(`Activity error ${accountId}:`, json.error.message)
      return []
    }
    const data = (json.data ?? []) as FbActivity[]
    cache.set(key, { data, ts: Date.now() })
    return data
  } catch (e) {
    console.error(`Activity fetch failed ${accountId}:`, e)
    return []
  }
}

// ─── Activity parser ──────────────────────────────────────────────────────────

// Facebook stores budgets in minor currency units (cents/paise/fils).
// PKR has no real sub-unit — FB treats it as 1 PKR = 1 unit.
// AED and USD: divide by 100.
function parseBudget(raw: string, currency: string): number {
  const n = parseInt(raw, 10)
  return currency === 'PKR' ? n : Math.round(n / 100)
}

function fmtBudget(n: number, currency: string): string {
  if (currency === 'PKR') return `Rs ${n.toLocaleString()}`
  if (currency === 'AED') return `AED ${n.toLocaleString()}`
  if (currency === 'USD') return `$${n.toLocaleString()}`
  return `${n} ${currency}`
}

function parseActivities(rows: FbActivity[], currency: string): ParsedActivity[] {
  const out: ParsedActivity[] = []

  for (const row of rows) {
    let extra: Record<string, Record<string, string>> = {}
    try { extra = JSON.parse(row.extra_data ?? '{}') } catch { /* ignore */ }

    const oldVal = extra.old_value ?? {}
    const newVal = extra.new_value ?? {}
    const base   = { id: row.object_id, name: row.object_name || '(unnamed)', time: row.created_time, actor: row.actor_name }

    switch (row.event_type) {

      case 'create_ad':
        out.push({ ...base, type: 'new_ad' })
        break

      case 'create_ad_set':
        out.push({ ...base, type: 'new_adset' })
        break

      case 'create_campaign':
        out.push({ ...base, type: 'new_campaign' })
        break

      case 'delete_ad':
        out.push({ ...base, type: 'deleted_ad' })
        break

      case 'update_ad': {
        const oldStatus = oldVal.configured_status
        const newStatus = newVal.configured_status
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          if (newStatus === 'PAUSED')  out.push({ ...base, type: 'paused_ad'    })
          if (newStatus === 'ACTIVE')  out.push({ ...base, type: 'activated_ad' })
          if (newStatus === 'DELETED') out.push({ ...base, type: 'deleted_ad'   })
        }
        break
      }

      case 'update_ad_set':
      case 'update_campaign': {
        const oldRaw = oldVal.daily_budget ?? oldVal.lifetime_budget
        const newRaw = newVal.daily_budget ?? newVal.lifetime_budget
        if (oldRaw && newRaw && oldRaw !== newRaw) {
          const oldB = parseBudget(oldRaw, currency)
          const newB = parseBudget(newRaw, currency)
          const kind = oldVal.daily_budget ? 'Daily' : 'Lifetime'
          const dir  = newB > oldB ? '↑' : '↓'
          out.push({
            ...base,
            type: 'budget_change',
            detail: `${kind} budget ${dir}  ${fmtBudget(oldB, currency)} → ${fmtBudget(newB, currency)}`,
          })
        }
        break
      }
    }
  }

  // Most recent first
  return out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') ?? 'pakistan') as Market
  const config = MARKETS[market]

  // Compute "today" in the market's local timezone
  const offset   = UTC_OFFSET[market]
  const utcNow   = new Date()
  // Shift now to market time so .getDate()/.getMonth() etc. reflect local date
  const marketNow     = new Date(utcNow.getTime() + offset * 3600 * 1000)
  const marketDateStr = marketNow.toISOString().slice(0, 10) // "2026-06-26"
  const sign          = offset >= 0 ? '+' : '-'
  const absOffset     = Math.abs(offset).toString().padStart(2, '0')
  const since         = Math.floor(new Date(`${marketDateStr}T00:00:00${sign}${absOffset}:00`).getTime() / 1000)
  const until         = Math.floor(utcNow.getTime() / 1000)

  const fbAccounts = config.accounts.filter(a => a.platform === 'facebook')

  const accounts: AccountActivity[] = await Promise.all(
    fbAccounts.map(async (account) => {
      const rows       = await fetchAccountActivities(account.id, since, until)
      const activities = parseActivities(rows, account.currency)
      const newAdCount = activities.filter(a => a.type === 'new_ad').length
      return { accountId: account.id, accountName: account.name, currency: account.currency, newAdCount, activities }
    })
  )

  const totalNewAds = accounts.reduce((s, a) => s + a.newAdCount, 0)

  return NextResponse.json({
    market,
    totalNewAds,
    goal: 5,
    accounts,
    fetchedAt: new Date().toISOString(),
  })
}
