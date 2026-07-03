import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const FB_TOKEN = process.env.FACEBOOK_ADS_LIBRARY_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN!
const FB_BASE  = 'https://graph.facebook.com/v19.0'

// Official Elyscents pages — never flag these (facebook.com/elyscents1)
const OFFICIAL_IDS = new Set([
  '234243899763868', // Elyscents Pakistan — facebook.com/elyscents1
])

// Exact-phrase searches in PK only (wrapped in quotes for phrase match)
const SEARCHES = [
  { term: '"Elyscents"',    countries: ['PK'] },
  { term: '"Royal Oud"',    countries: ['PK'] },
  { term: '"Salsa Spirit"', countries: ['PK'] },
  { term: '"Zarak"',        countries: ['PK'] },
]

async function searchAds(term: string, country: string) {
  const url = new URL(`${FB_BASE}/ads_archive`)
  url.searchParams.set('search_terms', term)
  url.searchParams.set('ad_reached_countries', JSON.stringify([country]))
  url.searchParams.set('ad_active_status', 'ALL')
  url.searchParams.set('ad_type', 'ALL')
  url.searchParams.set('fields', 'id,page_name,page_id,ad_snapshot_url,ad_creative_bodies,ad_delivery_start_time,ad_reached_countries')
  url.searchParams.set('limit', '50')
  url.searchParams.set('access_token', FB_TOKEN)

  const res  = await fetch(url.toString(), { cache: 'no-store' })
  const json = await res.json()
  if (json.error) { console.error(`Ads Library error [${term}/${country}]:`, json.error.message); return [] }

  // Double-filter: only keep ads that actually reached the target country
  const ads = (json.data ?? []) as Record<string, unknown>[]
  return ads.filter(ad => {
    const reached = ad.ad_reached_countries as string[] | undefined
    if (!reached) return false
    return reached.includes(country)
  })
}

export async function POST() {
  try {
    // Collect all suspicious pages across all searches
    const found = new Map<string, {
      page_id: string; page_name: string; page_url: string
      search_terms: string[]; sample_ads: unknown[]
    }>()

    for (const { term, countries } of SEARCHES) {
      for (const country of countries) {
        const ads = await searchAds(term, country)
        for (const ad of ads) {
          const pid = String(ad.page_id)
          if (OFFICIAL_IDS.has(pid)) continue

          const existing = found.get(pid)
          if (existing) {
            if (!existing.search_terms.includes(term)) existing.search_terms.push(term)
            if (existing.sample_ads.length < 3) existing.sample_ads.push({
              id: ad.id,
              body: (ad.ad_creative_bodies as string[] | undefined)?.[0]?.substring(0, 200) ?? '',
              snapshot_url: ad.ad_snapshot_url,
              start_date: ad.ad_delivery_start_time,
            })
          } else {
            found.set(pid, {
              page_id: pid,
              page_name: String(ad.page_name ?? 'Unknown Page'),
              page_url: `https://www.facebook.com/${pid}`,
              search_terms: [term],
              sample_ads: [{
                id: ad.id,
                body: (ad.ad_creative_bodies as string[] | undefined)?.[0]?.substring(0, 200) ?? '',
                snapshot_url: ad.ad_snapshot_url,
                start_date: ad.ad_delivery_start_time,
              }],
            })
          }
        }
      }
    }

    // Upsert into Supabase
    let newPages = 0
    const now = new Date().toISOString()

    for (const page of found.values()) {
      const { data: existing } = await supabaseAdmin
        .from('counterfeit_pages')
        .select('id, status, ad_count')
        .eq('page_id', page.page_id)
        .single()

      if (existing) {
        if (existing.status === 'whitelisted' || existing.status === 'removed') continue
        await supabaseAdmin.from('counterfeit_pages').update({
          last_seen: now,
          ad_count: Math.max(existing.ad_count ?? 0, page.sample_ads.length),
          search_terms: page.search_terms,
          sample_ads: page.sample_ads,
        }).eq('page_id', page.page_id)
      } else {
        await supabaseAdmin.from('counterfeit_pages').insert({
          ...page,
          ad_count: page.sample_ads.length,
          status: 'active',
          first_seen: now,
          last_seen: now,
        })
        newPages++
      }
    }

    return NextResponse.json({
      ok: true,
      pages_found: found.size,
      new_pages: newPages,
      ts: now,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
