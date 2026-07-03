import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { fetchTemplates } from '@/lib/oms/whatsapp'

export const dynamic = 'force-dynamic'

// Save the OMS→template mapping and/or the enabled flag.
// Guard: WhatsApp can only be ENABLED when the required templates are mapped to
// APPROVED templates — prevents turning it on with broken/unapproved sends.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    mapping?: Record<string, { name: string; language: string }>
    enabled?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  const now = new Date().toISOString()

  if (body.mapping) {
    await supabaseAdmin.from('site_settings').upsert(
      { key: 'oms_wa_templates', value: JSON.stringify(body.mapping), updated_at: now }, { onConflict: 'key' })
  }

  if (typeof body.enabled === 'boolean') {
    if (body.enabled) {
      // Verify the required templates are mapped to APPROVED templates before enabling.
      const live = await fetchTemplates()
      if (!live.connected) return NextResponse.json({ error: `cannot enable — WhatsApp not connected: ${live.error ?? ''}` }, { status: 400 })
      const approved = new Set(live.templates.filter(t => t.status === 'APPROVED').map(t => t.name))
      const mapRaw = body.mapping ?? JSON.parse((await supabaseAdmin.from('site_settings').select('value').eq('key', 'oms_wa_templates').single()).data?.value ?? '{}')
      const required = ['order_confirm', 'address_request']
      const missing = required.filter(k => !mapRaw[k]?.name || !approved.has(mapRaw[k].name))
      if (missing.length) return NextResponse.json({ error: `cannot enable — map these to APPROVED templates first: ${missing.join(', ')}` }, { status: 400 })
    }
    await supabaseAdmin.from('site_settings').upsert(
      { key: 'oms_whatsapp_enabled', value: String(body.enabled), updated_at: now }, { onConflict: 'key' })
  }

  return NextResponse.json({ ok: true })
}
