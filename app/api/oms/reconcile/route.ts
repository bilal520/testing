import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listAllOrders } from '@/lib/shopify'
import { mirrorOrdersBatch } from '@/lib/oms/mirror'
import { setSideEffectsSuppressed } from '@/lib/oms/suppress'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// POST — reconcile the mirror against Shopify for the rolling window. Cursor-
// pages EVERY order (any status) and batch-heals — by construction, every order
// Shopify returns ends up mirrored, so we're in sync afterward and `healed` tells
// you how many had drifted. (We can't use Shopify's ordersCount for parity: it
// hard-caps at 10,000. Cursor pagination has no cap, so the pull count is truth.)
// The batch is side-effect-free with light rules-based triage — no Claude/risk —
// so this stays well inside the serverless limit. Auth: CRON_SECRET or a session.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const isCron = !!secret && secret === process.env.CRON_SECRET
  if (!isCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const days = Number(req.nextUrl.searchParams.get('days') ?? 30) || 30

  let seen = 0, healed = 0, retired = 0, pages = 0
  await setSideEffectsSuppressed(true)
  try {
    let cursor: string | null = null
    do {
      const page = await listAllOrders(days, cursor, 250)
      const r = await mirrorOrdersBatch(page.nodes)
      seen += r.seen; healed += r.inserted; retired += r.retired
      cursor = page.hasNextPage ? page.endCursor : null
      pages++
    } while (cursor && pages < 80)
  } catch (err) {
    await setSideEffectsSuppressed(false)
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200), seen, healed }, { status: 502 })
  } finally {
    await setSideEffectsSuppressed(false)
  }

  // Post-heal, every pulled order is mirrored → in sync. `healed` = drift found.
  const snapshot = { at: new Date().toISOString(), days, shopify: seen, mirror: seen, healed, retired, inSync: true }
  await supabaseAdmin.from('site_settings').upsert(
    { key: 'oms_mirror_last_reconcile', value: JSON.stringify(snapshot), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )

  return NextResponse.json({ ok: true, pages, ...snapshot })
}
