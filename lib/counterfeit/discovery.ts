import { supabaseAdmin } from '@/lib/hub/supabase'

// ════════════════════════════════════════════════════════════════════════════
// CF discovery — wide-net candidate sweeps of the FB Ad Library (ads_archive).
// Meta has no reverse-image search, so we enumerate by typosquat + offer-script
// + product terms + a watchlist, then hand candidates to the detector.
// See docs/COUNTERFEIT_HUNTER_SPEC.md §2.
// ════════════════════════════════════════════════════════════════════════════

const FB_BASE = 'https://graph.facebook.com/v19.0'

// The Ad Library API rejects SYSTEM_USER tokens — it needs a regular USER token
// from an identity-confirmed account. Resolve DB-first (pasted in the Brand Guard
// UI) → env → the general FB token (last resort).
export async function adLibToken(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'cf_ads_library_token').single()
    if (data?.value) return data.value
  } catch { /* none */ }
  return process.env.FACEBOOK_ADS_LIBRARY_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN ?? ''
}

// Official Elyscents pages — never flag.
export const OFFICIAL_IDS = new Set(['234243899763868'])

export interface CandidateAd {
  ad_id: string; snapshot_url: string; body: string; start_time: string
  image_url: string | null; video_poster: string | null; link_url: string | null
}
export interface CandidatePage {
  page_id: string; page_name: string; profile_pic_url: string | null
  ads: CandidateAd[]; domains: string[]; found_via: string[]
}

// The Ad Library keyword search can't match (typo'd) brand names, but BROAD
// generic terms return the whole PK perfume-COD field (hundreds of ads across
// ~80 pages). We pull that wide net, then the VISION match finds the ones reusing
// our creatives/logo/face. A couple brand terms also catch blatant direct copies.
function sweepTerms(): string[] {
  return [
    'perfumes', 'perfume deal', 'any 2 perfumes', '2 perfumes', 'buy 2 perfume',
    '2,999', 'perfume 2999', 'khushbu', 'attar perfume', 'perfume cash on delivery',
    'perfume money back', 'long lasting perfume', 'imported perfume pakistan',
    'Elyscents', 'Royal Oud',
  ]
}

async function overrideTerms(): Promise<string[] | null> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'cf_search_terms').single()
    if (data?.value) { const a = JSON.parse(data.value); return Array.isArray(a) ? a : null }
  } catch { /* none */ }
  return null
}

const DOMAIN_RE = /https?:\/\/([^/\s"']+)/gi
function extractDomains(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const t of texts) { if (!t) continue; let m; while ((m = DOMAIN_RE.exec(t))) out.add(m[1].toLowerCase().replace(/^www\./, '')) }
  return [...out]
}

const SNAP = 'snapshot{images{original_image_url,resized_image_url},videos{video_preview_image_url,video_hd_url},link_url,page_profile_picture_url}'
async function searchAds(term: string, country: string, token: string): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`${FB_BASE}/ads_archive`)
  url.searchParams.set('search_terms', term)
  url.searchParams.set('ad_reached_countries', JSON.stringify([country]))
  url.searchParams.set('ad_active_status', 'ACTIVE')
  url.searchParams.set('ad_type', 'ALL')
  url.searchParams.set('fields', `id,page_id,page_name,ad_snapshot_url,ad_creative_bodies,ad_delivery_start_time,ad_reached_countries,${SNAP}`)
  url.searchParams.set('limit', '100')
  url.searchParams.set('access_token', token)
  try {
    const r = await fetch(url.toString(), { cache: 'no-store' })
    const j = await r.json()
    if (j.error) { console.error('ads_archive', term, j.error.message); return [] }
    return (j.data ?? []) as Array<Record<string, unknown>>
  } catch { return [] }
}

async function pageProfilePic(pageId: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(`${FB_BASE}/${pageId}/picture?type=large&redirect=false&access_token=${token}`, { cache: 'no-store' })
    const j = await r.json()
    return j?.data?.url ?? null
  } catch { return null }
}

function toAd(ad: Record<string, unknown>): CandidateAd {
  const snap = ad.snapshot as Record<string, unknown> | undefined
  const images = (snap?.images as Record<string, string>[] | undefined) ?? []
  const videos = (snap?.videos as Record<string, string>[] | undefined) ?? []
  return {
    ad_id: String(ad.id),
    snapshot_url: String(ad.ad_snapshot_url ?? ''),
    body: (ad.ad_creative_bodies as string[] | undefined)?.[0] ?? '',
    start_time: String(ad.ad_delivery_start_time ?? ''),
    image_url: images[0]?.original_image_url ?? images[0]?.resized_image_url ?? null,
    video_poster: videos[0]?.video_preview_image_url ?? null,
    link_url: (snap?.link_url as string) ?? null,
  }
}

/** Run all sweeps + watchlist → deduped candidate pages (excl. official). */
export async function discover(country = 'PK'): Promise<CandidatePage[]> {
  const token = await adLibToken()
  const terms = (await overrideTerms()) ?? sweepTerms()
  const byPage = new Map<string, CandidatePage>()

  const ingest = (ads: Array<Record<string, unknown>>, via: string) => {
    for (const raw of ads) {
      const pid = String(raw.page_id ?? '')
      if (!pid || OFFICIAL_IDS.has(pid)) continue
      const reached = raw.ad_reached_countries as string[] | undefined
      if (reached && !reached.includes(country)) continue
      const ad = toAd(raw)
      const snap = raw.snapshot as Record<string, unknown> | undefined
      let page = byPage.get(pid)
      if (!page) {
        page = {
          page_id: pid, page_name: String(raw.page_name ?? 'Unknown'),
          profile_pic_url: (snap?.page_profile_picture_url as string) ?? null,
          ads: [], domains: [], found_via: [],
        }
        byPage.set(pid, page)
      }
      if (page.ads.length < 6) page.ads.push(ad)
      if (!page.found_via.includes(via)) page.found_via.push(via)
      for (const d of extractDomains(ad.link_url, ad.body)) if (!page.domains.includes(d)) page.domains.push(d)
    }
  }

  for (const t of terms) ingest(await searchAds(t, country, token), t)

  // watchlist — always pull + score
  try {
    const { data } = await supabaseAdmin.from('cf_watchlist').select('page_id')
    const ids = (data ?? []).map((r: { page_id: string }) => r.page_id)
    if (ids.length) {
      const url = new URL(`${FB_BASE}/ads_archive`)
      url.searchParams.set('search_page_ids', ids.join(','))
      url.searchParams.set('ad_reached_countries', JSON.stringify([country]))
      url.searchParams.set('ad_active_status', 'ALL')
      url.searchParams.set('ad_type', 'ALL')
      url.searchParams.set('fields', `id,page_id,page_name,ad_snapshot_url,ad_creative_bodies,ad_delivery_start_time,${SNAP}`)
      url.searchParams.set('limit', '50')
      url.searchParams.set('access_token', token)
      const r = await fetch(url.toString(), { cache: 'no-store' }); const j = await r.json()
      if (!j.error) ingest(j.data ?? [], 'watchlist')
    }
  } catch { /* ignore */ }

  const pages = [...byPage.values()]
  // fill missing profile pics (bounded)
  for (const p of pages.slice(0, 60)) if (!p.profile_pic_url) p.profile_pic_url = await pageProfilePic(p.page_id, token)
  return pages
}
