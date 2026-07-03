import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get('status') ?? ''

  let query = supabaseAdmin
    .from('counterfeit_pages')
    .select('*')
    .order('last_seen', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PATCH(req: NextRequest) {
  const { id, status, notes } = await req.json()
  const { error } = await supabaseAdmin
    .from('counterfeit_pages')
    .update({ status, ...(notes !== undefined ? { notes } : {}) })
    .eq('id', id)
  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { status } = await req.json().catch(() => ({}))
  let query = supabaseAdmin.from('counterfeit_pages').delete()
  // If status provided, only delete that subset; otherwise clear all
  if (status) {
    query = query.eq('status', status)
  } else {
    query = query.neq('id', '00000000-0000-0000-0000-000000000000') // match all rows
  }
  const { error } = await query
  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}
