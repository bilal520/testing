import { NextRequest, NextResponse } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Authenticated server-side proxy so the client can trigger a sync
// without exposing CRON_SECRET to the browser.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  const base = req.nextUrl.origin
  try {
    const res  = await fetch(`${base}/api/courier/sync`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const text = await res.text()
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status })
    } catch {
      return NextResponse.json({ error: 'Sync returned non-JSON', detail: text.slice(0, 500) }, { status: 500 })
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
