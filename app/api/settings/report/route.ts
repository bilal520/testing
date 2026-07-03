import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('user_report_settings')
    .select('*')
    .eq('user_id', userId)
    .single()

  return NextResponse.json(data ?? { whatsapp_number: '', daily_report_enabled: false })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { whatsapp_number, daily_report_enabled, report_time } = await req.json()

  await supabaseAdmin.from('user_report_settings').upsert(
    { user_id: userId, whatsapp_number, daily_report_enabled, report_time: report_time ?? '10:00', updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  return NextResponse.json({ ok: true })
}
