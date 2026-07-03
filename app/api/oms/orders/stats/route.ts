import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// GET — counts + sync status for the "All Orders" header.
async function count(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number> {
  const { count } = await build(base())
  return count ?? 0
}
const base = () => supabaseAdmin.from('oms_orders').select('id', { count: 'exact', head: true })
const setting = async (k: string): Promise<string | null> => {
  const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', k).maybeSingle()
  return data?.value ?? null
}

export async function GET() {
  const g = await guardModule('oms'); if (g) return g
  const [total, observed, unfulfilled, fulfilled, partially, cancelled, paid, pending] = await Promise.all([
    count(q => q),
    count(q => q.eq('state', 'observed')),
    count(q => q.filter('raw_shopify_order->>displayFulfillmentStatus', 'eq', 'UNFULFILLED')),
    count(q => q.filter('raw_shopify_order->>displayFulfillmentStatus', 'eq', 'FULFILLED')),
    count(q => q.filter('raw_shopify_order->>displayFulfillmentStatus', 'eq', 'PARTIALLY_FULFILLED')),
    count(q => q.filter('raw_shopify_order->>cancelledAt', 'not.is', null)),
    count(q => q.filter('raw_shopify_order->>displayFinancialStatus', 'eq', 'PAID')),
    count(q => q.filter('raw_shopify_order->>displayFinancialStatus', 'eq', 'PENDING')),
  ])

  const active = total - observed
  const backfillRaw  = await setting('oms_mirror_backfill_status')
  const reconcileRaw = await setting('oms_mirror_last_reconcile')
  let backfill: unknown = null, reconcile: unknown = null
  try { backfill  = backfillRaw  ? JSON.parse(backfillRaw)  : null } catch { backfill  = backfillRaw }
  try { reconcile = reconcileRaw ? JSON.parse(reconcileRaw) : null } catch { reconcile = reconcileRaw }

  return NextResponse.json({
    total, active, observed,
    fulfillment: { unfulfilled, fulfilled, partially, cancelled },
    financial:   { paid, pending },
    incrementalCursor: await setting('oms_mirror_incremental_cursor'),
    backfill, reconcile,
  })
}
