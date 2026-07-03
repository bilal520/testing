import { NextRequest, NextResponse } from 'next/server'

const FB_TOKEN = process.env.FACEBOOK_ADS_LIBRARY_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN!
const FB_BASE  = 'https://graph.facebook.com/v19.0'

const cache    = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 60 * 60 * 1000

const FIELDS = [
  'id', 'page_name', 'page_id', 'ad_snapshot_url', 'ad_delivery_start_time',
  'ad_creative_bodies', 'ad_creative_link_titles', 'media_type',
  'snapshot{body,title,images{original_image_url,resized_image_url},videos{video_hd_url,video_sd_url,video_preview_image_url},link_url,cta_text}',
].join(',')

function mapAd(ad: Record<string, unknown>) {
  const snap   = ad.snapshot as Record<string, unknown> | undefined
  const images = (snap?.images as Record<string, string>[] | undefined) ?? []
  const videos = (snap?.videos as Record<string, string>[] | undefined) ?? []
  return {
    id:          ad.id,
    pageName:    ad.page_name,
    pageId:      String(ad.page_id),
    snapshotUrl: ad.ad_snapshot_url,
    startDate:   ad.ad_delivery_start_time,
    body:        (ad.ad_creative_bodies as string[] | undefined)?.[0] ?? snap?.body ?? '',
    title:       (ad.ad_creative_link_titles as string[] | undefined)?.[0] ?? snap?.title ?? '',
    mediaType:   ad.media_type ?? 'IMAGE',
    imageUrl:    images[0]?.original_image_url ?? images[0]?.resized_image_url ?? null,
    videoHdUrl:  videos[0]?.video_hd_url ?? null,
    videoSdUrl:  videos[0]?.video_sd_url ?? null,
    videoPoster: videos[0]?.video_preview_image_url ?? null,
    ctaText:     snap?.cta_text ?? null,
    linkUrl:     snap?.link_url ?? null,
  }
}

async function fetchByPageIds(ids: string[], country: string) {
  // Try search_page_ids — works if personal token has Ads Library access
  const url = new URL(`${FB_BASE}/ads_archive`)
  url.searchParams.set('search_page_ids', ids.join(','))
  url.searchParams.set('ad_reached_countries', country)
  url.searchParams.set('ad_active_status', 'ACTIVE')
  url.searchParams.set('ad_type', 'ALL')
  url.searchParams.set('fields', FIELDS)
  url.searchParams.set('limit', '50')
  url.searchParams.set('access_token', FB_TOKEN)

  const res  = await fetch(url.toString(), { cache: 'no-store' })
  const json = await res.json()
  if (json.error) return null          // caller will try fallback
  return (json.data ?? []).map(mapAd)
}

async function fetchBySearchTerms(pageId: string, pageName: string, country: string) {
  // Fallback: search by page name (API matches page names), filter by page_id
  const isNumericName = /^\d+$/.test(pageName)
  const term = isNumericName ? 'perfume fragrance shop' : pageName

  const url = new URL(`${FB_BASE}/ads_archive`)
  url.searchParams.set('search_terms', term)
  url.searchParams.set('ad_reached_countries', country)
  url.searchParams.set('ad_active_status', 'ACTIVE')
  url.searchParams.set('ad_type', 'ALL')
  url.searchParams.set('fields', FIELDS)
  url.searchParams.set('limit', '50')
  url.searchParams.set('access_token', FB_TOKEN)

  const res  = await fetch(url.toString(), { cache: 'no-store' })
  const json = await res.json()
  if (json.error) { console.error('Ads search error:', json.error.message); return [] }
  return (json.data ?? [])
    .filter((ad: Record<string, unknown>) => String(ad.page_id) === pageId)
    .map(mapAd)
}

export async function GET(req: NextRequest) {
  const pageIds   = req.nextUrl.searchParams.get('pageIds')   ?? ''
  const pageNames = req.nextUrl.searchParams.get('pageNames') ?? ''
  const country   = req.nextUrl.searchParams.get('country')   ?? 'PK'

  if (!pageIds) return NextResponse.json({ ads: [] })

  const ids   = pageIds.split(',').map(s => s.trim()).filter(Boolean)
  const names = pageNames.split(',').map(s => decodeURIComponent(s.trim()))

  const cacheKey = `${pageIds}:${country}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return NextResponse.json(hit.data)

  try {
    // First attempt: search_page_ids (precise, requires Ads Library access)
    const byId = await fetchByPageIds(ids, country)
    if (byId !== null) {
      const result = { ads: byId, fetchedAt: new Date().toISOString() }
      cache.set(cacheKey, { data: result, ts: Date.now() })
      return NextResponse.json(result)
    }

    // Fallback: per-competitor search_terms + server-side filter
    const results = await Promise.all(
      ids.map((id, i) => fetchBySearchTerms(id, names[i] ?? id, country))
    )
    const ads = results.flat()
    const result = { ads, fetchedAt: new Date().toISOString() }
    cache.set(cacheKey, { data: result, ts: Date.now() })
    return NextResponse.json(result)
  } catch (e) {
    console.error('Competitor fetch failed:', e)
    return NextResponse.json({ ads: [], error: 'Fetch failed' })
  }
}
