import { NextRequest, NextResponse } from 'next/server'
import { listUnfulfilledOrders } from '@/lib/shopify'
import { ingestOrder } from '@/lib/oms/ingest'
import { getOmsSettings } from '@/lib/shopify-sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// POST — pull unfulfilled Shopify orders (last N days) into the OMS.
// Protected by Clerk middleware (dashboard-triggered). Idempotent: existing
// orders are skipped by shopify_order_id.
export async function POST(req: NextRequest) {
  const settings = await getOmsSettings()
  const days = Number(req.nextUrl.searchParams.get('days') ?? 0) || settings.backfill_days

  let orders
  try {
    orders = await listUnfulfilledOrders(days, 50)
  } catch (err) {
    return NextResponse.json({ error: `Shopify pull failed: ${String(err)}` }, { status: 502 })
  }

  let created = 0, skipped = 0, duplicates = 0
  const errors: string[] = []
  for (const o of orders) {
    try {
      const r = await ingestOrder(o)
      if (r.created) { created++; if (r.isDuplicate) duplicates++ }
      else skipped++
    } catch (e) { errors.push(String(e).slice(0, 140)) }
  }

  return NextResponse.json({
    ok: true, days, pulled: orders.length, created, skipped, duplicates,
    writeback: settings.shopify_writeback_enabled ? settings.shopify_writeback_mode : 'disabled (shadow)',
    errors: errors.slice(0, 10),
  })
}
