import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// GET — the full-mirror "All Orders" list: server-side paginated, filterable by
// payment/fulfillment status, lifecycle (active vs observed), date and free-text.
// Display fields are derived from the faithful raw_shopify_order snapshot so the
// view matches Shopify Admin 1:1.
interface RawOrder {
  createdAt?: string; displayFinancialStatus?: string; displayFulfillmentStatus?: string
  cancelledAt?: string | null; tags?: string[]
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } }
}

export async function GET(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const sp        = req.nextUrl.searchParams
  const page      = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const pageSize  = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? 40) || 40))
  const fulfil    = sp.get('fulfillment')  // UNFULFILLED | FULFILLED | PARTIALLY_FULFILLED | RESTOCKED
  const financial = sp.get('financial')    // PAID | PENDING | REFUNDED | ...
  const lifecycle = sp.get('lifecycle')    // active | observed
  const q         = (sp.get('q') ?? '').trim()

  let query = supabaseAdmin
    .from('oms_orders')
    .select('id, order_number, customer_name, phone, city, cod_amount, state, items, created_at, raw_shopify_order', { count: 'exact' })

  if (fulfil)    query = query.filter('raw_shopify_order->>displayFulfillmentStatus', 'eq', fulfil)
  if (financial) query = query.filter('raw_shopify_order->>displayFinancialStatus', 'eq', financial)
  if (lifecycle === 'observed') query = query.eq('state', 'observed')
  if (lifecycle === 'active')   query = query.neq('state', 'observed')
  if (q) {
    const like = `*${q}*`
    query = query.or(`order_number.ilike.${like},phone.ilike.${like},customer_name.ilike.${like}`)
  }

  // Newest order first — sort by the Shopify order date inside the snapshot.
  query = query.order('raw_shopify_order->>createdAt', { ascending: false })
               .range((page - 1) * pageSize, page * pageSize - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(r => {
    const raw = (r.raw_shopify_order ?? {}) as RawOrder
    const items = (r.items ?? []) as Array<{ qty?: number }>
    return {
      id:                 r.id,
      order_number:       r.order_number,
      order_date:         raw.createdAt ?? r.created_at,
      customer_name:      r.customer_name,
      phone:              r.phone,
      city:               r.city,
      total:              Number(raw.totalPriceSet?.shopMoney?.amount ?? r.cod_amount ?? 0),
      currency:           raw.totalPriceSet?.shopMoney?.currencyCode ?? 'PKR',
      financial_status:   raw.displayFinancialStatus ?? '—',
      fulfillment_status: raw.displayFulfillmentStatus ?? '—',
      cancelled:          !!raw.cancelledAt,
      tags:               raw.tags ?? [],
      items_count:        items.reduce((s, it) => s + (it.qty ?? 1), 0),
      state:              r.state,
      lifecycle:          r.state === 'observed' ? 'observed' : 'active',
    }
  })

  return NextResponse.json({
    page, pageSize, total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    rows,
  })
}
