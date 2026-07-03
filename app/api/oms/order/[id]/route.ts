import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { getRtoProfile } from '@/lib/oms/rto'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// GET — full order record + audit timeline + live RTO profile + payment accounts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardModule('oms'); if (g) return g
  const { id } = await params
  const { data: order, error } = await supabaseAdmin.from('oms_orders').select('*').eq('id', id).single()
  if (error || !order) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Events + RTO profile + payment accounts in parallel. (The WhatsApp-thread
  // ILIKE was dropped — this view never rendered it and it was the slow query.)
  const phone = order.phone as string | null
  const [events, rtoProfile, paymentAccounts] = await Promise.all([
    supabaseAdmin.from('oms_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(60)
      .then(r => r.data ?? []),
    getRtoProfile(phone),
    supabaseAdmin.from('site_settings').select('value').eq('key', 'oms_pay_accounts').maybeSingle()
      .then(r => { try { return r.data?.value ? JSON.parse(r.data.value) : null } catch { return null } }),
  ])

  return NextResponse.json({ order, events, rtoProfile, paymentAccounts, messages: [] })
}
