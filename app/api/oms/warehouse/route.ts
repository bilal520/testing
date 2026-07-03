import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { canTransition, WAREHOUSE_STAGES, type OmsState } from '@/lib/oms/state'
import { logOmsEvent } from '@/lib/oms/events'
import { shopifySync } from '@/lib/shopify-sync'
import { guardModule, getAccess } from '@/lib/rbac'
import { bookOrder, isBookingApiEnabled, refreshLeopardsCities, type BookableOrder } from '@/lib/courier-booking'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// ── GET: orders grouped by warehouse stage ──────────────────────────────────
export async function GET() {
  const g = await guardModule('oms'); if (g) return g
  const { data, error } = await supabaseAdmin
    .from('oms_orders')
    .select('id, order_number, customer_name, phone, city, cod_amount, items, courier, tracking_number, label_url, state, risk_level, updated_at')
    .in('state', WAREHOUSE_STAGES)
    .order('updated_at', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stages: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const s of WAREHOUSE_STAGES) { stages[s] = []; counts[s] = 0 }
  for (const o of data ?? []) { const s = o.state as string; if (stages[s]) { stages[s].push(o); counts[s]++ } }

  const [apiEnabled, lc] = await Promise.all([
    isBookingApiEnabled(),
    supabaseAdmin.from('site_settings').select('value').eq('key', 'oms_leopards_cities').maybeSingle().then(r => { try { return Object.keys(JSON.parse(r.data?.value ?? '{}')).length } catch { return 0 } }),
  ])
  return NextResponse.json({ stages, counts, bookingApi: { enabled: apiEnabled, leopardsCitiesCached: lc } })
}

// ── POST: warehouse actions ─────────────────────────────────────────────────
interface Body {
  action: 'book' | 'book_bulk' | 'print' | 'scan_pack' | 'handover' | 'lookup_return' | 'receive_return'
        | 'set_booking_api' | 'refresh_leopards_cities' | 'save_leopards_shipper'
  orderId?: number
  orderIds?: number[]
  courier?: 'leopards' | 'postex'
  cn?: string
  agent?: string
  condition?: 'good' | 'damaged' | 'mixed'
  notes?: string
  enabled?: boolean
  shipper?: { name: string; phone: string; address: string; originCityId: number }
}

export async function POST(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const body = await req.json().catch(() => null) as Body | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })
  const actor = body.agent ? `agent:${body.agent}` : 'warehouse'
  const now = new Date().toISOString()

  // ── book: ready_to_dispatch → booked. Manual CN, or API booking when the CN
  //    is left blank AND API booking is enabled (creates a REAL consignment). ──
  if (body.action === 'book') {
    if (!body.orderId || !body.courier || !['leopards', 'postex'].includes(body.courier))
      return NextResponse.json({ error: 'orderId + courier required' }, { status: 400 })
    const { data: o } = await supabaseAdmin.from('oms_orders')
      .select('id, state, shopify_order_id, order_number, customer_name, phone, address_raw, city, cod_amount, items').eq('id', body.orderId).single()
    if (!o) return NextResponse.json({ error: 'order not found' }, { status: 404 })
    if (!canTransition(o.state as OmsState, 'booked'))
      return NextResponse.json({ error: `cannot book from ${o.state}` }, { status: 409 })

    let cn = (body.cn ?? '').trim()
    let labelUrl: string | null = null
    if (!cn) {
      if (!(await isBookingApiEnabled()))
        return NextResponse.json({ error: 'Enter a CN — API booking is off.' }, { status: 400 })
      try {
        const res = await bookOrder(o as unknown as BookableOrder, body.courier)
        cn = res.cn; labelUrl = res.labelUrl
      } catch (e) {
        return NextResponse.json({ error: `API booking failed: ${String(e).replace(/^Error:\s*/, '').slice(0, 180)} — you can paste a CN manually.` }, { status: 502 })
      }
    }
    await supabaseAdmin.from('oms_orders').update({ state: 'booked', courier: body.courier, tracking_number: cn, label_url: labelUrl, updated_at: now }).eq('id', o.id)
    await logOmsEvent(o.id as number, { type: 'booked', actor, channel: 'system', from: o.state as string, to: 'booked', detail: `${body.courier} CN ${cn}${labelUrl ? ' (API)' : ''}` })
    await shopifySync(o.id as number, o.shopify_order_id as string, { kind: 'state_tag', state: 'booked' })
    return NextResponse.json({ ok: true, state: 'booked', cn, labelUrl })
  }

  // ── book_bulk: API-book many orders at once (auto CN) ─────────────────────
  if (body.action === 'book_bulk') {
    if (!body.courier || !['leopards', 'postex'].includes(body.courier))
      return NextResponse.json({ error: 'courier required' }, { status: 400 })
    if (!(await isBookingApiEnabled()))
      return NextResponse.json({ error: 'Bulk booking needs auto-booking ON.' }, { status: 400 })
    const ids = body.orderIds ?? []
    if (!ids.length) return NextResponse.json({ error: 'select orders to book' }, { status: 400 })
    let booked = 0; const errors: string[] = []
    for (const id of ids) {
      const { data: o } = await supabaseAdmin.from('oms_orders')
        .select('id, state, shopify_order_id, order_number, customer_name, phone, address_raw, city, cod_amount, items').eq('id', id).single()
      if (!o || !canTransition(o.state as OmsState, 'booked')) continue
      try {
        const res = await bookOrder(o as unknown as BookableOrder, body.courier)
        await supabaseAdmin.from('oms_orders').update({ state: 'booked', courier: body.courier, tracking_number: res.cn, label_url: res.labelUrl, updated_at: now }).eq('id', id)
        await logOmsEvent(id, { type: 'booked', actor, channel: 'system', from: o.state as string, to: 'booked', detail: `${body.courier} CN ${res.cn} (bulk API)` })
        await shopifySync(id, o.shopify_order_id as string, { kind: 'state_tag', state: 'booked' })
        booked++
      } catch (e) { errors.push(`${o.order_number}: ${String(e).replace(/^Error:\s*/, '').slice(0, 80)}`) }
    }
    return NextResponse.json({ ok: true, booked, failed: errors.length, errors: errors.slice(0, 10) })
  }

  // ── admin: booking-API config ─────────────────────────────────────────────
  if (body.action === 'set_booking_api' || body.action === 'refresh_leopards_cities' || body.action === 'save_leopards_shipper') {
    if (!(await getAccess()).isAdmin) return NextResponse.json({ error: 'admin only' }, { status: 403 })
    if (body.action === 'set_booking_api') {
      await supabaseAdmin.from('site_settings').upsert({ key: 'oms_booking_api_enabled', value: body.enabled ? 'true' : 'false', updated_at: now }, { onConflict: 'key' })
      return NextResponse.json({ ok: true, enabled: !!body.enabled })
    }
    if (body.action === 'refresh_leopards_cities') {
      try { const n = await refreshLeopardsCities(); return NextResponse.json({ ok: true, cities: n }) }
      catch (e) { return NextResponse.json({ error: String(e).replace(/^Error:\s*/, '').slice(0, 180) }, { status: 502 }) }
    }
    // save_leopards_shipper
    if (!body.shipper?.name || !body.shipper?.originCityId) return NextResponse.json({ error: 'shipper name + originCityId required' }, { status: 400 })
    await supabaseAdmin.from('site_settings').upsert({ key: 'oms_leopards_shipper', value: JSON.stringify(body.shipper), updated_at: now }, { onConflict: 'key' })
    return NextResponse.json({ ok: true })
  }

  // ── print: booked → cn_printed (bulk) ─────────────────────────────────────
  if (body.action === 'print') {
    const ids = body.orderIds ?? (body.orderId ? [body.orderId] : [])
    if (!ids.length) return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
    let printed = 0
    for (const id of ids) {
      const { data: o } = await supabaseAdmin.from('oms_orders').select('id, state').eq('id', id).single()
      if (!o || !canTransition(o.state as OmsState, 'cn_printed')) continue
      await supabaseAdmin.from('oms_orders').update({ state: 'cn_printed', updated_at: now }).eq('id', id)
      await logOmsEvent(id, { type: 'state_change', actor, channel: 'system', from: o.state as string, to: 'cn_printed', detail: 'CN printed' })
      printed++
    }
    return NextResponse.json({ ok: true, printed })
  }

  // ── scan_pack: scan a CN → verify it's a printed parcel → packed ──────────
  // Returns the order + pick-list so the packer packs the RIGHT items.
  if (body.action === 'scan_pack') {
    const cn = (body.cn ?? '').trim()
    if (!cn) return NextResponse.json({ error: 'scan a CN' }, { status: 400 })
    const { data: o } = await supabaseAdmin.from('oms_orders')
      .select('id, order_number, customer_name, city, items, courier, tracking_number, state')
      .eq('tracking_number', cn).maybeSingle()
    if (!o) return NextResponse.json({ error: `CN ${cn} not found`, beep: 'error' }, { status: 404 })
    if (o.state === 'packed') return NextResponse.json({ ok: true, already: true, order: o, beep: 'warn' })
    if (!canTransition(o.state as OmsState, 'packed'))
      return NextResponse.json({ error: `CN ${cn} is ${o.state}, not ready to pack`, beep: 'error' }, { status: 409 })
    await supabaseAdmin.from('oms_orders').update({ state: 'packed', assigned_agent: body.agent ?? undefined, updated_at: now }).eq('id', o.id)
    await logOmsEvent(o.id as number, { type: 'state_change', actor, channel: 'system', from: o.state as string, to: 'packed', detail: `scanned + packed (${cn})` })
    return NextResponse.json({ ok: true, order: o, beep: 'ok' })
  }

  // ── handover: packed → picked_up (courier collected) + Shopify fulfillment ─
  if (body.action === 'handover') {
    const ids = body.orderIds ?? (body.orderId ? [body.orderId] : [])
    if (!ids.length) return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
    let handed = 0
    for (const id of ids) {
      const { data: o } = await supabaseAdmin.from('oms_orders').select('id, state, shopify_order_id, courier, tracking_number').eq('id', id).single()
      if (!o || !canTransition(o.state as OmsState, 'picked_up')) continue
      await supabaseAdmin.from('oms_orders').update({ state: 'picked_up', dispatched_at: now, updated_at: now }).eq('id', id)
      await logOmsEvent(id, { type: 'state_change', actor, channel: 'system', from: o.state as string, to: 'picked_up', detail: 'handed to courier' })
      // Real Shopify fulfillment (tracking flows to the customer). Gated by the writeback kill-switch.
      if (o.courier && o.tracking_number) {
        await shopifySync(id, o.shopify_order_id as string, { kind: 'fulfillment', trackingNumber: o.tracking_number as string, courier: o.courier as string })
      }
      handed++
    }
    return NextResponse.json({ ok: true, handed })
  }

  // ── lookup_return: scan a returned CN → identify the order + its items ────
  if (body.action === 'lookup_return') {
    const cn = (body.cn ?? '').trim()
    if (!cn) return NextResponse.json({ error: 'scan a CN' }, { status: 400 })
    const { data: o } = await supabaseAdmin.from('oms_orders')
      .select('id, order_number, customer_name, city, items, courier, tracking_number, shopify_order_id')
      .eq('tracking_number', cn).maybeSingle()
    if (!o) return NextResponse.json({ error: `CN ${cn} not found in orders`, beep: 'error' }, { status: 404 })
    // Is the courier actually showing this as returned? (helps catch mis-scans)
    const { data: co } = await supabaseAdmin.from('courier_orders').select('norm_status').eq('tracking_number', cn).maybeSingle()
    // Already received?
    const { data: prev } = await supabaseAdmin.from('oms_returns_received').select('id, received_at').eq('tracking_number', cn).maybeSingle()
    return NextResponse.json({ ok: true, order: o, courierStatus: co?.norm_status ?? null, alreadyReceived: prev ?? null, beep: 'ok' })
  }

  // ── receive_return: record the physical return + condition ────────────────
  if (body.action === 'receive_return') {
    const cn = (body.cn ?? '').trim()
    if (!cn) return NextResponse.json({ error: 'CN required' }, { status: 400 })
    const cond = body.condition ?? 'good'
    const { data: o } = await supabaseAdmin.from('oms_orders')
      .select('id, order_number, items, courier, shopify_order_id, tracking_number').eq('tracking_number', cn).maybeSingle()
    if (!o) return NextResponse.json({ error: `CN ${cn} not found` }, { status: 404 })
    const { error: insErr } = await supabaseAdmin.from('oms_returns_received').insert({
      order_id: o.id, shopify_order_id: o.shopify_order_id, order_number: o.order_number,
      tracking_number: cn, courier: o.courier, condition: cond, items: o.items,
      received_by: body.agent ?? 'warehouse', notes: body.notes ?? null,
    })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    await logOmsEvent(o.id as number, { type: 'return_received', actor, channel: 'system', detail: `return received (${cond})${body.notes ? ': ' + body.notes : ''}` })
    return NextResponse.json({ ok: true, order_number: o.order_number, condition: cond })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
