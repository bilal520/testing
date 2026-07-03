import { NextRequest, NextResponse } from 'next/server'
import { listAllOrders } from '@/lib/shopify'
import { mirrorOrdersBatch } from '@/lib/oms/mirror'
import { setSideEffectsSuppressed } from '@/lib/oms/suppress'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { guardModule } from '@/lib/rbac'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// POST — full-mirror backfill of ALL Shopify orders (any status) from the last
// `days` (default 30) into oms_orders. Side-effect-free: runs with the global
// suppression flag ON, so no WhatsApp / write-back fires even for active orders.
// Clerk-protected (dashboard-triggered). Idempotent + resumable via cursor.
async function setStatus(status: string, extra: Record<string, unknown> = {}) {
  await supabaseAdmin.from('site_settings').upsert(
    { key: 'oms_mirror_backfill_status', value: JSON.stringify({ status, at: new Date().toISOString(), ...extra }), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
}

export async function POST(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const days     = Number(req.nextUrl.searchParams.get('days') ?? 30) || 30
  const maxPages = Number(req.nextUrl.searchParams.get('maxPages') ?? 60) || 60

  let observed = 0, active = 0, retired = 0, pages = 0, seen = 0, upserted = 0, inserted = 0

  await setSideEffectsSuppressed(true)
  await setStatus('running', { days })
  try {
    let cursor: string | null = null
    do {
      const page = await listAllOrders(days, cursor, 250)
      const r = await mirrorOrdersBatch(page.nodes)
      seen += r.seen; upserted += r.upserted; inserted += r.inserted; observed += r.observed; active += r.active; retired += r.retired
      cursor = page.hasNextPage ? page.endCursor : null
      pages++
    } while (cursor && pages < maxPages)

    await setStatus('complete', { days, pages, seen, upserted, inserted, observed, active, retired })
  } catch (err) {
    await setStatus('error', { error: String(err).slice(0, 200) })
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200), pages, seen, upserted }, { status: 502 })
  } finally {
    await setSideEffectsSuppressed(false)   // ALWAYS re-enable side effects
  }

  return NextResponse.json({ ok: true, days, pages, seen, upserted, inserted, observed, active, retired })
}
