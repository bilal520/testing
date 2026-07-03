import { shopifyGraphQL, normalisePhone } from '@/lib/shopify'

// ════════════════════════════════════════════════════════════════════════════
// CARS Shopify reads — abandoned-checkout pull + order discount-code lookup.
// Reuses the OMS Shopify GraphQL client (DB-first token, PK domain, 2024-10).
// Requires the `read_checkouts` scope on the custom app.
// ════════════════════════════════════════════════════════════════════════════

export interface AbandonedCheckoutNode {
  id: string
  name?: string | null
  createdAt: string
  updatedAt?: string | null
  completedAt?: string | null
  abandonedCheckoutUrl?: string | null
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } }
  customer?: { id?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; numberOfOrders?: number | string | null } | null
  billingAddress?: { phone?: string | null } | null
  shippingAddress?: { phone?: string | null; city?: string | null } | null
  lineItems?: { nodes: Array<{ title?: string | null; quantity?: number | null }> }
}

export interface CarsCheckoutDraft {
  checkout_id: string
  store: string
  phone: string | null
  email: string | null
  customer_id: string | null
  customer_name: string
  is_returning: boolean
  cart: Array<{ title: string; qty: number }>
  cart_summary: string
  total_price: number
  currency: string
  recovery_url: string
  abandoned_at: string
  completed: boolean
  city: string | null
}

const CHECKOUT_FIELDS = `
  id name createdAt updatedAt completedAt abandonedCheckoutUrl
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { id firstName lastName phone email numberOfOrders }
  billingAddress { phone }
  shippingAddress { phone city }
  lineItems(first: 20) { nodes { title quantity } }
`

/** Pull abandoned checkouts created within `hours` (default 72), cursor-paged. */
export async function listAbandonedCheckouts(hours = 72, max = 500): Promise<AbandonedCheckoutNode[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const out: AbandonedCheckoutNode[] = []
  let cursor: string | null = null
  do {
    const data: { abandonedCheckouts: { nodes: AbandonedCheckoutNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await shopifyGraphQL(`
        query($q: String!, $after: String) {
          abandonedCheckouts(first: 100, query: $q, after: $after, sortKey: CREATED_AT, reverse: true) {
            nodes { ${CHECKOUT_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`, { q: `created_at:>=${since}`, after: cursor })
    out.push(...data.abandonedCheckouts.nodes)
    cursor = data.abandonedCheckouts.pageInfo.hasNextPage ? data.abandonedCheckouts.pageInfo.endCursor : null
  } while (cursor && out.length < max)
  return out
}

export function normaliseCheckout(n: AbandonedCheckoutNode): CarsCheckoutDraft {
  const phone = normalisePhone(n.customer?.phone) ?? normalisePhone(n.shippingAddress?.phone) ?? normalisePhone(n.billingAddress?.phone)
  const items = (n.lineItems?.nodes ?? []).map(li => ({ title: (li.title ?? 'Item').trim(), qty: li.quantity ?? 1 }))
  const first = items[0]?.title ?? 'your cart'
  const cart_summary = items.length > 1 ? `${first} + ${items.length - 1} more` : first
  const name = `${n.customer?.firstName ?? ''} ${n.customer?.lastName ?? ''}`.trim() || 'there'
  const nOrders = Number(n.customer?.numberOfOrders ?? 0)
  return {
    checkout_id:   n.id,
    store:         'PK',
    phone,
    email:         n.customer?.email ?? null,
    customer_id:   n.customer?.id ?? null,
    customer_name: name,
    is_returning:  nOrders > 0,
    cart:          items,
    cart_summary,
    total_price:   Number(n.totalPriceSet?.shopMoney?.amount ?? 0),
    currency:      n.totalPriceSet?.shopMoney?.currencyCode ?? 'PKR',
    recovery_url:  n.abandonedCheckoutUrl ?? '',
    abandoned_at:  n.createdAt,
    completed:     !!n.completedAt,
    city:          n.shippingAddress?.city ?? null,
  }
}

/** Discount codes applied to a completed order — for Tier-1 (exact) attribution. */
export async function getOrderDiscountCodes(gid: string): Promise<string[]> {
  try {
    const data: { order: { discountCodes?: string[] } | null } = await shopifyGraphQL(`
      query($id: ID!) { order(id: $id) { discountCodes } }`, { id: gid })
    return (data.order?.discountCodes ?? []).map(c => String(c).toUpperCase())
  } catch { return [] }
}
