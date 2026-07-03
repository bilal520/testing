import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const source   = searchParams.get('source')
  const category = searchParams.get('category')
  const date     = searchParams.get('date')
  const page     = parseInt(searchParams.get('page') ?? '1')
  const limit    = 50
  const offset   = (page - 1) * limit

  let query = supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (source)   query = query.eq('source', source)
  if (category) query = query.eq('category', category)
  if (date) {
    query = query
      .gte('received_at', `${date}T00:00:00.000Z`)
      .lte('received_at', `${date}T23:59:59.999Z`)
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ messages: data, total: count, page, limit })
}
