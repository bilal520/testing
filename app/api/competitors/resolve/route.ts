import { NextRequest, NextResponse } from 'next/server'

const SYS_TOKEN  = process.env.FACEBOOK_ACCESS_TOKEN ?? ''
const USER_TOKEN = process.env.FACEBOOK_ADS_LIBRARY_TOKEN ?? ''
const FB_BASE    = 'https://graph.facebook.com/v19.0'

function extractSlug(raw: string): { slug: string; fbUrl: string } {
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (url.hostname.includes('facebook.com')) {
      if (url.pathname.includes('profile.php')) {
        const id = url.searchParams.get('id')
        if (id) return { slug: id, fbUrl: `https://www.facebook.com/profile.php?id=${id}` }
      }
      const slug = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0]
      if (slug && slug !== 'pages') {
        return { slug, fbUrl: `https://www.facebook.com/${slug}/` }
      }
    }
  } catch { /* not a URL */ }
  const slug = raw.trim()
  return { slug, fbUrl: `https://www.facebook.com/${slug}/` }
}

async function graphLookup(slug: string, token: string): Promise<{ pageId: string; pageName: string } | null> {
  if (!token) return null
  try {
    const url = new URL(`${FB_BASE}/${encodeURIComponent(slug)}`)
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', token)
    const res  = await fetch(url.toString(), { cache: 'no-store' })
    const json = await res.json()
    if (!json.error && json.id && json.name) {
      return { pageId: String(json.id), pageName: String(json.name) }
    }
  } catch { /* fall through */ }
  return null
}

async function graphSearch(slug: string, token: string): Promise<{ pageId: string; pageName: string } | null> {
  if (!token) return null
  try {
    const url = new URL(`${FB_BASE}/search`)
    url.searchParams.set('q', slug)
    url.searchParams.set('type', 'page')
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('limit', '10')
    url.searchParams.set('access_token', token)
    const res  = await fetch(url.toString(), { cache: 'no-store' })
    const json = await res.json()
    if (json.error || !json.data?.length) return null

    const pages  = json.data as Array<{ id: string; name: string }>
    const normIn = slug.toLowerCase().replace(/[^a-z0-9]/g, '')
    const match  = pages.find(p => {
      const norm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      return normIn.includes(norm) || norm.includes(normIn)
    }) ?? pages[0]

    return { pageId: String(match.id), pageName: match.name }
  } catch { /* fall through */ }
  return null
}

// Fetch the public Facebook page and parse its og:title — no token required
async function ogScrape(fbUrl: string, slug: string): Promise<string | null> {
  try {
    const res = await fetch(fbUrl, {
      headers: {
        // Use Facebook's own crawler UA so the page returns pre-rendered OG tags
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const html = await res.text()

    // og:title is the most reliable field (exact page display name)
    const m =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)

    if (!m) return null
    const name = m[1].replace(/\s*\|.*$/i, '').replace(/\s*-\s*Facebook.*$/i, '').trim()
    // Sanity: reject if we just got the slug back or something generic
    if (!name || name.toLowerCase() === slug.toLowerCase() || name === 'Facebook') return null
    return name
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('url') ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'No URL provided' }, { status: 400 })

  const { slug, fbUrl } = extractSlug(raw)

  // Already a numeric page ID
  if (/^\d+$/.test(slug)) return NextResponse.json({ pageId: slug, pageName: slug })

  // Try all resolution methods in priority order
  const byGraph =
    (await graphLookup(slug, SYS_TOKEN))  ||
    (await graphLookup(slug, USER_TOKEN)) ||
    (await graphSearch(slug, SYS_TOKEN))  ||
    (await graphSearch(slug, USER_TOKEN))

  if (byGraph) return NextResponse.json(byGraph)

  // Fallback: scrape the public Facebook page for its display name
  const ogName = await ogScrape(fbUrl, slug)
  if (ogName) {
    // We have the real name but not the numeric ID — use name-based Ads Library search
    return NextResponse.json({ pageId: slug, pageName: ogName })
  }

  // Last resort: return slug (Ads Library keyword search)
  return NextResponse.json({ pageId: slug, pageName: slug })
}
