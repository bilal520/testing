import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type')

  let query = supabaseAdmin
    .from('creative_ideas')
    .select('*')
    .order('extracted_at', { ascending: false })
    .limit(50)

  if (type && type !== 'all') query = query.eq('idea_type', type)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PATCH(req: NextRequest) {
  const { id } = await req.json()
  const { error } = await supabaseAdmin
    .from('creative_ideas')
    .update({ used: true })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
