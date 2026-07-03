import { NextResponse } from 'next/server'
import { fetchTemplates, getTemplateMap, isWhatsappEnabled } from '@/lib/oms/whatsapp'

export const dynamic = 'force-dynamic'

// Live templates from Meta + current mapping + enabled state — powers the panel.
export async function GET() {
  const [res, mapping, enabled] = await Promise.all([fetchTemplates(), getTemplateMap(), isWhatsappEnabled()])
  return NextResponse.json({ ...res, mapping, enabled })
}
