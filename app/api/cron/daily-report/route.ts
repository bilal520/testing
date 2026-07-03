import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { MARKETS, toPrimaryCurrency, Market } from '@/lib/accounts'
import { getFacebookData } from '@/lib/facebook'
import { getShopifyToken } from '@/lib/shopify'
import { subDays, format, startOfDay, formatISO } from 'date-fns'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── Helpers ────────────────────────────────────────────────────────────────────
function yesterday(): string {
  return format(subDays(new Date(), 1), 'yyyy-MM-dd')
}

function sodPKT(d: Date): Date {
  const PKT = 5 * 3600 * 1000
  const local = new Date(d.getTime() + PKT)
  const midnight = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
  return new Date(midnight.getTime() - PKT)
}

function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: decimals })
}

function cacRating(cac: number, market: Market): string {
  const cfg = MARKETS[market].cac
  if (cac <= cfg.excellent) return '🟢'
  if (cac <= cfg.good) return '🟡'
  if (cfg.average && cac <= cfg.average) return '🟠'
  return '🔴'
}

// ── Market summary from FB ─────────────────────────────────────────────────────
async function getMarketSummary(market: Market, date: string) {
  const cfg = MARKETS[market]
  const fbIds = cfg.accounts.filter(a => a.platform === 'facebook').map(a => a.id)
  if (!fbIds.length) return null

  const rows = await getFacebookData(fbIds, date, date).catch(() => [])
  const marketRows = rows.filter(r => r.date_start === date)

  let spend = 0, purchases = 0, revenue = 0
  for (const r of marketRows) {
    const acct = cfg.accounts.find(a => a.id === r.account_id)
    const cur = acct?.currency ?? cfg.primaryCurrency
    spend     += toPrimaryCurrency(r.spend    ?? 0, cur, market)
    purchases += r.purchases ?? 0
    revenue   += toPrimaryCurrency(r.revenue  ?? 0, cur, market)
  }

  const cac  = purchases > 0 ? spend / purchases : 0
  const roas = spend > 0 ? revenue / spend : 0

  return { spend, purchases, cac, roas, currency: cfg.primaryCurrency }
}

// ── Shopify yesterday summary ──────────────────────────────────────────────────
async function getShopifySummary() {
  try {
    const token = await getShopifyToken()
    if (!token) return null

    const domain = process.env.SHOPIFY_PK_DOMAIN ?? '482886-3.myshopify.com'
    const since = sodPKT(subDays(new Date(), 1))
    const until = sodPKT(new Date())

    let url: string | null = `https://${domain}/admin/api/2024-01/orders.json?` + new URLSearchParams({
      created_at_min: formatISO(since),
      created_at_max: formatISO(until),
      status: 'any',
      limit: '250',
      fields: 'id,subtotal_price,cancelled_at',
    })

    let orders: { subtotal_price: string; cancelled_at?: string | null }[] = []
    while (url) {
      const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
      if (!res.ok) break
      const data = await res.json()
      orders.push(...data.orders)
      const link = res.headers.get('Link') ?? ''
      const m = link.match(/<([^>]+)>;\s*rel="next"/)
      url = m ? m[1] : null
    }

    const active = orders.filter(o => !o.cancelled_at)
    const revenue = active.reduce((s, o) => s + (parseFloat(o.subtotal_price) || 0), 0)
    return { orders: active.length, revenue }
  } catch {
    return null
  }
}

// ── Send WhatsApp ──────────────────────────────────────────────────────────────
async function sendWhatsApp(to: string, message: string) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token   = process.env.WHATSAPP_ACCESS_TOKEN
  if (!phoneId || !token) return

  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  })
}

// ── Cron handler ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const date = yesterday()
  const dateLabel = format(subDays(new Date(), 1), 'd MMM yyyy')

  // Fetch all opted-in users (time-based delivery requires Vercel Pro hourly crons)
  const { data: users } = await supabaseAdmin
    .from('user_report_settings')
    .select('whatsapp_number')
    .eq('daily_report_enabled', true)
    .not('whatsapp_number', 'is', null)
    .neq('whatsapp_number', '')

  if (!users?.length) return NextResponse.json({ ok: true, sent: 0 })

  // Pull data for all markets + Shopify in parallel
  const [pk, uae, bd, shopify] = await Promise.all([
    getMarketSummary('pakistan', date),
    getMarketSummary('uae', date),
    getMarketSummary('bangladesh', date),
    getShopifySummary(),
  ])

  // Build message
  const line = (label: string, flag: string, s: typeof pk) => {
    if (!s || s.spend === 0) return `${flag} *${label}*\nNo data\n`
    const rating = cacRating(s.cac, label.toLowerCase() as Market)
    return (
      `${flag} *${label}*\n` +
      `Spend: ${s.currency} ${fmtNum(s.spend)} | Purchases: ${s.purchases} | CAC: ${s.currency} ${fmtNum(s.cac)} ${rating} | ROAS: ${s.roas.toFixed(2)}x\n`
    )
  }

  const shopifyLine = shopify
    ? `\n🛍 *Shopify PK (yesterday)*\nOrders: ${shopify.orders} | Revenue: PKR ${fmtNum(shopify.revenue)}\n`
    : ''

  const message =
    `📊 *Elyscents Daily Report — ${dateLabel}*\n\n` +
    line('Pakistan', '🇵🇰', pk) + '\n' +
    line('UAE', '🇦🇪', uae) + '\n' +
    line('Bangladesh', '🇧🇩', bd) +
    shopifyLine +
    `\nFull report in Google Sheets ✅`

  // Send to all opted-in users
  await Promise.all(users.map(u => sendWhatsApp(u.whatsapp_number, message)))

  return NextResponse.json({ ok: true, sent: users.length, date })
}
