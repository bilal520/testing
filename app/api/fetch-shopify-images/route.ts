import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ShopifyImage {
  src: string
  alt: string
  position: number
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const parsed   = new URL(url)
    const parts    = parsed.pathname.split('/')
    const idx      = parts.indexOf('products')
    if (idx === -1 || !parts[idx + 1]) {
      return NextResponse.json({ error: 'URL must contain /products/handle' }, { status: 400 })
    }
    const handle   = parts[idx + 1].split('?')[0]
    const jsonUrl  = `${parsed.protocol}//${parsed.host}/products/${handle}.json`

    const res = await fetch(jsonUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Store returned ${res.status}. Is the URL correct and the store public?` },
        { status: 400 },
      )
    }

    const data    = await res.json()
    const product = data.product
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const images: ShopifyImage[] = (product.images ?? []).map((img: { src: string; alt?: string; position: number }) => ({
      src:      img.src,
      alt:      img.alt || product.title,
      position: img.position,
    }))

    return NextResponse.json({ title: product.title as string, handle: product.handle as string, images })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }
}
