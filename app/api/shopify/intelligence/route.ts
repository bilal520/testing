import { NextRequest, NextResponse } from 'next/server'
import { subDays, formatISO, format } from 'date-fns'
import { getShopifyToken } from '@/lib/shopify'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// ── In-memory cache ────────────────────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; expiry: number }>()
function getCache(k: string) { const e = _cache.get(k); return (e && Date.now() < e.expiry) ? e.data : null }
function setCache(k: string, data: unknown, ttl: number) { _cache.set(k, { data, expiry: Date.now() + ttl }) }

// ── Shopify types ──────────────────────────────────────────────────────────────
interface LineItem {
  id: number; title: string; sku: string; quantity: number
  price: string; product_id: number; variant_title?: string | null
}
interface ShopifyOrder {
  id: number; created_at: string; total_price: string; subtotal_price: string; currency: string
  cancelled_at?: string | null
  line_items: LineItem[]
  shipping_address?: { city?: string; province?: string } | null
  discount_codes?: { code: string; amount: string; type: string }[]
  customer?: { id: number; email?: string; orders_count?: number } | null
  landing_site?: string | null
}

// ── ShopifyQL analytics (exact match to Shopify Admin numbers) ────────────────

// ── Batch-fetch customer order counts (embedded customer in orders lacks orders_count) ──
async function fetchCustomerOrderCounts(domain: string, token: string, ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  for (let i = 0; i < ids.length; i += 250) {
    const batch = ids.slice(i, i + 250)
    try {
      const res = await fetch(
        `https://${domain}/admin/api/2024-01/customers.json?` + new URLSearchParams({
          ids: batch.join(','),
          fields: 'id,orders_count',
          limit: '250',
        }),
        { headers: { 'X-Shopify-Access-Token': token } }
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const c of (data.customers ?? [])) map.set(c.id, c.orders_count ?? 1)
    } catch { /* skip batch */ }
  }
  return map
}

// ── Fetch all orders with cursor pagination ────────────────────────────────────
async function fetchAllOrders(domain: string, token: string, since: Date, until: Date): Promise<ShopifyOrder[]> {
  const fields = 'id,created_at,total_price,subtotal_price,currency,cancelled_at,line_items,shipping_address,discount_codes,customer,landing_site'
  const all: ShopifyOrder[] = []
  let url: string | null = `https://${domain}/admin/api/2024-01/orders.json?` + new URLSearchParams({
    created_at_min: formatISO(since),
    created_at_max: formatISO(until),
    status: 'any',
    limit: '250',
    fields,
  })

  while (url) {
    const res: Response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Shopify ${res.status}: ${txt.slice(0, 300)}`)
    }
    const data = await res.json()
    all.push(...(data.orders as ShopifyOrder[]))

    // Cursor-based next page
    const link: string = res.headers.get('Link') ?? ''
    const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/)
    url = m ? m[1] : null
  }

  return all
}

// ── Process orders into intelligence ──────────────────────────────────────────
function processOrders(orders: ShopifyOrder[]) {
  const skuMap       = new Map<string, { title: string; sku: string; qty: number; revenue: number; orderCount: number }>()
  const cityMap      = new Map<string, { orders: number; revenue: number }>()
  const discountMap  = new Map<string, { code: string; uses: number; revenue: number; saved: number }>()
  const customerMap  = new Map<number, { count: number; products: Set<string>; isReturning: boolean }>()
  const bundleMap    = new Map<string, number>()   // product-pair → count
  const landingMap   = new Map<string, number>()
  const productCustMap = new Map<string, Set<number>>()  // productTitle → set of customerIds

  let totalRevenue = 0
  let activeOrders = 0

  for (const order of orders) {
    if (order.cancelled_at) continue   // exclude cancelled/voided orders
    activeOrders++
    const rev  = parseFloat(order.subtotal_price) || 0   // subtotal matches Shopify Admin revenue (excl. shipping)
    totalRevenue += rev

    // ── City ──────────────────────────────────────────────────────────────────
    const city = (order.shipping_address?.city?.trim()) || 'Unknown'
    const c = cityMap.get(city) ?? { orders: 0, revenue: 0 }
    cityMap.set(city, { orders: c.orders + 1, revenue: c.revenue + rev })

    // ── Discounts ─────────────────────────────────────────────────────────────
    for (const d of (order.discount_codes ?? [])) {
      const code  = d.code.toUpperCase()
      const e     = discountMap.get(code) ?? { code, uses: 0, revenue: 0, saved: 0 }
      discountMap.set(code, { code, uses: e.uses + 1, revenue: e.revenue + rev, saved: e.saved + (parseFloat(d.amount) || 0) })
    }

    // ── Customer ──────────────────────────────────────────────────────────────
    const custId = order.customer?.id
    if (custId) {
      const ce = customerMap.get(custId) ?? {
        count: 0,
        products: new Set<string>(),
        // orders_count includes today's order; >=2 means they had prior history
        isReturning: (order.customer?.orders_count ?? 1) >= 2,
      }
      ce.count++
      for (const item of (order.line_items ?? [])) ce.products.add(item.title)
      customerMap.set(custId, ce)
    }

    // ── SKUs ──────────────────────────────────────────────────────────────────
    const productTitles: string[] = []
    for (const item of (order.line_items ?? [])) {
      const key  = item.sku || item.title
      const e    = skuMap.get(key) ?? { title: item.title, sku: item.sku ?? '', qty: 0, revenue: 0, orderCount: 0 }
      const irev = (parseFloat(item.price) || 0) * item.quantity
      skuMap.set(key, { title: item.title, sku: item.sku ?? '', qty: e.qty + item.quantity, revenue: e.revenue + irev, orderCount: e.orderCount + 1 })
      productTitles.push(item.title)

      // Track product → customers (for repeat product buyers)
      if (custId) {
        const s = productCustMap.get(item.title) ?? new Set<number>()
        s.add(custId)
        productCustMap.set(item.title, s)
      }
    }

    // ── Bundles (pairs of products in same order) ──────────────────────────────
    const uniq = [...new Set(productTitles)].sort()
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const key = `${uniq[i]} + ${uniq[j]}`
        bundleMap.set(key, (bundleMap.get(key) ?? 0) + 1)
      }
    }

    // ── Landing page ──────────────────────────────────────────────────────────
    if (order.landing_site) {
      try {
        const path = new URL(order.landing_site, 'https://x').pathname
        if (path && path !== '/') landingMap.set(path, (landingMap.get(path) ?? 0) + 1)
      } catch { /* ignore */ }
    }
  }

  // ── Derive repeat-buyer products ───────────────────────────────────────────
  // Products that have at least 1 customer who has ordered them 2+ times
  const repeatProducts = Array.from(skuMap.entries())
    .filter(([k]) => {
      const productTitle = skuMap.get(k)?.title ?? ''
      // Find customers who ordered this product AND have placed 2+ total orders
      for (const [custId] of customerMap) {
        const ce = customerMap.get(custId)!
        if (ce.count > 1 && ce.products.has(productTitle)) return true
      }
      return false
    })
    .map(([, v]) => ({ ...v }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10)

  // ── Assemble results ───────────────────────────────────────────────────────
  const repeatBuyers      = [...customerMap.values()].filter(e => e.count > 1).length
  const returningCustomers = [...customerMap.values()].filter(e => e.isReturning).length
  const totalCustomers    = customerMap.size
  const multiItemOrders = orders.filter(o => {
    if (o.cancelled_at) return false
    const uniq = new Set((o.line_items ?? []).map(i => i.product_id))
    return uniq.size > 1
  }).length

  return {
    totalOrders:           activeOrders,
    totalRevenue,
    totalCustomers,
    repeatBuyers,
    repeatRate:            totalCustomers > 0 ? repeatBuyers / totalCustomers : 0,
    returningCustomers,
    returningCustomerRate: totalCustomers > 0 ? (returningCustomers / totalCustomers) * 100 : 0,
    avgOrderValue:         activeOrders > 0 ? totalRevenue / activeOrders : 0,
    multiItemOrders,
    bundleRate:       activeOrders > 0 ? multiItemOrders / activeOrders : 0,

    topSKUsByQty: [...skuMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 15),
    topSKUsByRevenue: [...skuMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15),

    topCitiesByOrders:  [...cityMap.entries()].sort((a, b) => b[1].orders  - a[1].orders).slice(0, 15).map(([city, v]) => ({ city, ...v })),
    topCitiesByRevenue: [...cityMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 15).map(([city, v]) => ({ city, ...v })),

    topDiscounts: [...discountMap.values()].sort((a, b) => b.uses - a.uses).slice(0, 15),

    topBundles:       [...bundleMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([combo, count]) => ({ combo, count })),

    repeatProducts,

    topLanding: [...landingMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([path, count]) => ({ path, count })),
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  type Period = 'today' | 'yesterday' | '7d' | '30d'
  const period = (req.nextUrl.searchParams.get('period') || '7d') as Period

  const cached = getCache(period)
  if (cached) return NextResponse.json(cached)

  const now = new Date()
  const PKT = 5 * 3600 * 1000
  function sodPKT(d: Date): Date {
    const local = new Date(d.getTime() + PKT)
    const midnight = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
    return new Date(midnight.getTime() - PKT)
  }
  let since: Date, until: Date

  switch (period) {
    case 'today':     since = sodPKT(now);              until = now;          break
    case 'yesterday': since = sodPKT(subDays(now, 1)); until = sodPKT(now);  break
    case '7d':        since = sodPKT(subDays(now, 7)); until = now;           break
    case '30d':       since = sodPKT(subDays(now, 30)); until = now;          break
  }

  const domain = process.env.SHOPIFY_PK_DOMAIN ?? '482886-3.myshopify.com'

  try {
    const token = await getShopifyToken()
    if (!token) throw new Error('NOT_CONNECTED')

    // Fetch orders, then batch-fetch customer order counts
    // (customer object embedded in orders is a stripped subset — orders_count not included)
    const orders = await fetchAllOrders(domain, token, since!, until!)
    const activeOrders = orders.filter(o => !o.cancelled_at)
    const uniqueCustomerIds = [...new Set(
      activeOrders.map(o => o.customer?.id).filter((id): id is number => !!id)
    )]
    const customerOrderCounts = await fetchCustomerOrderCounts(domain, token, uniqueCustomerIds)

    // orders_count includes the current order, so >= 2 = had prior purchases
    const returningCustomers    = uniqueCustomerIds.filter(id => (customerOrderCounts.get(id) ?? 1) >= 2).length
    const totalCustomers        = uniqueCustomerIds.length
    const returningCustomerRate = totalCustomers > 0 ? (returningCustomers / totalCustomers) * 100 : 0

    const data = processOrders(orders)

    // Read cached analytics (sessions + CVR) via Vercel cron that calls ShopifyQL directly
    const PKT = 5 * 3600 * 1000
    const pktNow = new Date(Date.now() + PKT)
    const analyticsKeys = period === 'yesterday'
      ? [format(new Date(pktNow.getTime() - 86400_000), 'yyyy-MM-dd')]
      : period === 'today'
      ? [format(pktNow, 'yyyy-MM-dd')]
      : [] // 7d/30d: sum not implemented yet

    // Auto-refresh analytics if stale (> 3 hours) — so clicking Refresh shows live CVR
    if (analyticsKeys.length > 0 && process.env.CRON_SECRET) {
      const { data: checkRow } = await supabaseAdmin
        .from('site_settings').select('value').eq('key', `shopify_pk_analytics_${analyticsKeys[0]}`).single()
      const isStale = !checkRow?.value || (() => {
        try { return Date.now() - new Date(JSON.parse(checkRow.value).updated_at).getTime() > 3 * 60 * 60 * 1000 }
        catch { return true }
      })()
      if (isStale) {
        await fetch(`${req.nextUrl.origin}/api/cron/shopify-analytics`, {
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        }).catch(() => {})
      }
    }

    let cachedSessions = 0, cachedConversionRate: number | null = null
    for (const dateKey of analyticsKeys) {
      const { data: row } = await supabaseAdmin
        .from('site_settings')
        .select('value')
        .eq('key', `shopify_pk_analytics_${dateKey}`)
        .single()
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value)
          cachedSessions      = parsed.sessions           ?? 0
          cachedConversionRate = parsed.conversion_rate_pct ?? null
        } catch { /* ignore */ }
      }
    }

    const result = {
      period,
      since: since!.toISOString(),
      until: until!.toISOString(),
      ...data,
      totalCustomers,
      returningCustomers,
      returningCustomerRate,
      sessions:       cachedSessions,
      conversionRate: cachedConversionRate,
    }

    const ttl = period === 'today' ? 30 * 60_000 : period === 'yesterday' ? 4 * 3600_000 : 24 * 3600_000
    setCache(period, result, ttl)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
