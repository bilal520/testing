import { NextRequest, NextResponse } from 'next/server'
import { guardModule } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

const PB = 'https://api.postex.pk/services/integration/api/order'

// GET ?cns=cn1,cn2,... — streams the PostEx airway-bill PDF (single or combined)
// for the given CNs. Opened in a new tab from the warehouse Print CNs stage.
export async function GET(req: NextRequest) {
  const g = await guardModule('oms'); if (g) return g
  const cns = (req.nextUrl.searchParams.get('cns') ?? '').trim()
  if (!cns) return NextResponse.json({ error: 'cns required' }, { status: 400 })
  const token = process.env.POSTEX_TOKEN
  if (!token) return NextResponse.json({ error: 'POSTEX_TOKEN not configured' }, { status: 500 })

  const r = await fetch(`${PB}/v1/get-invoice?trackingNumbers=${encodeURIComponent(cns)}`, { headers: { token } })
  if (!r.ok) {
    const t = await r.text()
    return NextResponse.json({ error: `PostEx label ${r.status}: ${t.slice(0, 140)}` }, { status: 502 })
  }
  const pdf = await r.arrayBuffer()
  return new NextResponse(pdf, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="postex-labels.pdf"' },
  })
}
