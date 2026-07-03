import { supabaseAdmin } from '@/lib/hub/supabase'

async function getSetting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single()
    return data?.value ?? null
  } catch { return null }
}

export async function getShopifyToken(): Promise<string | null> {
  const fromDb = await getSetting('shopify_pk_access_token')
  if (fromDb) return fromDb
  return process.env.SHOPIFY_PK_ACCESS_TOKEN ?? null
}

export async function saveShopifyToken(token: string): Promise<void> {
  await supabaseAdmin.from('site_settings').upsert(
    { key: 'shopify_pk_access_token', value: token, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
}

export async function testShopifyToken(domain: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token },
    })
    return res.ok
  } catch { return false }
}

// ════════════════════════════════════════════════════════════════════════════
// OMS — Shopify pull + order normaliser
// Uses getShopifyToken() (DB-first, env fallback). READ operations only; the
// OMS write-back lives in lib/shopify-sync.ts and is gated by the kill-switch.
// ════════════════════════════════════════════════════════════════════════════

const API_VERSION = '2024-10'

// Domain resolution mirrors the rest of the app: env → DB → hardcoded fallback.
// In production SHOPIFY_PK_DOMAIN isn't set, so the DB/fallback path is used.
async function shopDomain(): Promise<string> {
  const d = process.env.SHOPIFY_PK_DOMAIN ?? await getSetting('shopify_pk_domain') ?? '482886-3.myshopify.com'
  return d.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export async function shopifyGraphQL<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const domain = await shopDomain()
  const token  = await getShopifyToken()
  if (!domain || !token) throw new Error('Shopify domain/token not configured')
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method:  'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as { data?: T; errors?: unknown }
  if (json.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`)
  return json.data as T
}

export interface ShopifyOrderNode {
  id: string
  name: string
  createdAt: string
  updatedAt?: string | null
  processedAt?: string | null
  cancelledAt?: string | null
  closedAt?: string | null
  displayFinancialStatus: string
  displayFulfillmentStatus: string
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } }
  tags?: string[]
  note?: string | null
  phone?: string | null
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null } | null
  shippingAddress?: { name?: string | null; phone?: string | null; address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null } | null
  lineItems?: { nodes: Array<{ sku?: string | null; title?: string | null; quantity?: number; originalUnitPriceSet?: { shopMoney?: { amount?: string } } }> }
}

// ── Normalisation (PURE — unit tested) ──────────────────────────────────────

/** Canonicalise a PK mobile to 03XXXXXXXXX, or null if it can't be made valid. */
export function normalisePhone(raw?: string | null): string | null {
  if (!raw) return null
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+92')) d = '0' + d.slice(3)
  else if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2)
  else if (d.startsWith('3') && d.length === 10) d = '0' + d
  d = d.replace(/^\+/, '')
  return /^03\d{9}$/.test(d) ? d : null
}

/** Trim a Shopify city string; strip a trailing province word if tacked on. */
export function cleanCity(raw?: string | null): string {
  if (!raw) return 'Unknown'
  let c = raw.trim().replace(/\s+/g, ' ')
  const PROV = ['sindh', 'punjab', 'kpk', 'khyber pakhtunkhwa', 'balochistan', 'gilgit', 'ajk', 'pakistan']
  const parts = c.split(' ')
  if (parts.length > 1 && PROV.includes(parts[parts.length - 1].toLowerCase())) c = parts.slice(0, -1).join(' ')
  return c.replace(/\b\w/g, m => m.toUpperCase()) || 'Unknown'
}

// Rules-based address completeness (Claude refinement is Phase 3). 0-100.
const JUNK_A2 = new Set(['no', 'na', 'n/a', 'etc', 'etc.', '-', '.', 'none'])
export function scoreAddress(a1: string, a2: string, city: string, phone: string | null): { score: number; complete: boolean } {
  let s = 0
  const line = `${a1} ${a2}`.trim()
  if (phone) s += 30
  if (a1 && a1.trim().length >= 12) s += 30
  else if (a1 && a1.trim().length >= 6) s += 15
  if (city && city !== 'Unknown') s += 20
  if (a2 && !JUNK_A2.has(a2.trim().toLowerCase())) s += 10
  if (/\d/.test(line)) s += 5
  if (/(house|st\b|street|road|block|sector|gali|mohalla|near|masjid|market|colony|town)/i.test(line)) s += 5
  return { score: Math.min(s, 100), complete: s >= 60 && !!phone }
}

export interface OmsOrderDraft {
  shopify_order_id:  string
  order_number:      string
  customer_name:     string
  phone:             string | null
  address_raw:       string
  address_area:      string
  city:              string
  address_score:     number
  address_complete:  boolean
  items:             Array<{ sku: string | null; name: string; qty: number; price: number }>
  cod_amount:        number
  is_prepaid:        boolean
  raw_shopify_order: ShopifyOrderNode
}

export function normaliseOrder(o: ShopifyOrderNode): OmsOrderDraft {
  const sa    = o.shippingAddress ?? {}
  const phone = normalisePhone(o.phone) ?? normalisePhone(sa.phone) ?? normalisePhone(o.customer?.phone)
  const city  = cleanCity(sa.city)
  const a1    = (sa.address1 ?? '').trim()
  const a2    = (sa.address2 ?? '').trim()
  const { score, complete } = scoreAddress(a1, a2, city, phone)
  const prepaid = (o.displayFinancialStatus ?? '').toUpperCase() === 'PAID'
  const total   = Number(o.totalPriceSet?.shopMoney?.amount ?? 0)
  const custName = sa.name?.trim()
    || `${o.customer?.firstName ?? ''} ${o.customer?.lastName ?? ''}`.trim()
    || 'Unknown'
  return {
    shopify_order_id: o.id,
    order_number:     o.name,
    customer_name:    custName,
    phone,
    address_raw:      [a1, a2].filter(Boolean).join(', '),
    address_area:     a1,
    city,
    address_score:    score,
    address_complete: complete,
    items:            (o.lineItems?.nodes ?? []).map(li => ({
      sku:   li.sku ?? null,
      name:  li.title ?? 'Item',
      qty:   li.quantity ?? 1,
      price: Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0),
    })),
    cod_amount:  prepaid ? 0 : total,
    is_prepaid:  prepaid,
    raw_shopify_order: o,
  }
}

// ── Pull operations ─────────────────────────────────────────────────────────

const ORDER_FIELDS = `
  id name createdAt updatedAt processedAt cancelledAt closedAt
  displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  tags note phone
  customer { firstName lastName phone }
  shippingAddress { name phone address1 address2 city province zip }
  lineItems(first: 20) { nodes { sku title quantity originalUnitPriceSet { shopMoney { amount } } } }
`

/** Unfulfilled, open orders created within `days` — the OMS backfill/poll set. */
export async function listUnfulfilledOrders(days = 14, limit = 50): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrderNode[] } }>(`
    query($q: String!) {
      orders(first: ${limit}, query: $q, sortKey: CREATED_AT, reverse: true) {
        nodes { ${ORDER_FIELDS} }
      }
    }`, { q: `fulfillment_status:unfulfilled created_at:>=${since}` })
  return data.orders.nodes
}

export async function getOrder(gid: string): Promise<ShopifyOrderNode | null> {
  const data = await shopifyGraphQL<{ order: ShopifyOrderNode | null }>(`
    query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: gid })
  return data.order
}

// ── Full-mirror pulls (all statuses, cursor-paginated) ──────────────────────
// Unlike listUnfulfilledOrders, these apply NO status filter — they feed the
// side-effect-free mirror (lib/oms/mirror.ts), not the confirmation workflow.

export interface OrderPage { nodes: ShopifyOrderNode[]; hasNextPage: boolean; endCursor: string | null }

async function listOrders(q: string, sortKey: string, reverse: boolean, cursor: string | null, first: number): Promise<OrderPage> {
  const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(`
    query($q: String!, $after: String) {
      orders(first: ${first}, query: $q, sortKey: ${sortKey}, reverse: ${reverse}, after: $after) {
        nodes { ${ORDER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`, { q, after: cursor })
  return { nodes: data.orders.nodes, hasNextPage: data.orders.pageInfo.hasNextPage, endCursor: data.orders.pageInfo.endCursor }
}

/** All orders (any status) created within `days`, newest first — backfill set. */
export async function listAllOrders(days = 30, cursor: string | null = null, first = 250): Promise<OrderPage> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return listOrders(`created_at:>=${since}`, 'CREATED_AT', true, cursor, first)
}

/** All orders (any status) changed at/after `sinceIso`, oldest-change first —
 *  ascending so the caller can advance an updated_at high-water cursor. */
export async function listOrdersUpdatedSince(sinceIso: string, cursor: string | null = null, first = 250): Promise<OrderPage> {
  return listOrders(`updated_at:>=${sinceIso}`, 'UPDATED_AT', false, cursor, first)
}

/** Count of orders (any status) created within `days` — for reconciliation. */
export async function countOrders(days = 30): Promise<number | null> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  try {
    const data = await shopifyGraphQL<{ ordersCount: { count: number } }>(`
      query($q: String!) { ordersCount(query: $q) { count } }`, { q: `created_at:>=${since}` })
    return data.ordersCount?.count ?? null
  } catch { return null }
}
