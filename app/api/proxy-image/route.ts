// Server-side image proxy so Canvas can draw cross-origin Shopify CDN images
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url || !url.startsWith('https://')) {
    return new NextResponse('Invalid URL', { status: 400 })
  }

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type':                res.headers.get('content-type') ?? 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('Fetch failed', { status: 502 })
  }
}
