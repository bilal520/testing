import { NextRequest, NextResponse } from 'next/server'
import { generateDailyReport } from '@/lib/hub/claude'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('daily_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(1)
    .single()

  if (error) return NextResponse.json({ error: 'No report yet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const date = (body.date as string | undefined) ??
    new Date().toISOString().split('T')[0]  // default: today

  try {
    const report = await generateDailyReport(date)
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
