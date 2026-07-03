import { NextRequest, NextResponse } from 'next/server'
import { guardModule, getAccess } from '@/lib/rbac'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { listReferences, addReference, removeReference, refreshCreatives, type RefKind } from '@/lib/counterfeit/reference'
import { adLibToken } from '@/lib/counterfeit/discovery'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET — flagged pages + reference set + watchlist for the Brand Guard tab.
export async function GET() {
  const g = await guardModule('intelligence'); if (g) return g
  const [{ data: pages }, refs, { data: watch }] = await Promise.all([
    supabaseAdmin.from('counterfeit_pages')
      .select('page_id, page_name, page_url, scam_score, signals, claude_why, profile_pic_url, landing_domains, sample_ads, status, first_seen, last_seen, reported_at')
      .order('scam_score', { ascending: false, nullsFirst: false }).limit(200),
    listReferences().catch(() => []),
    supabaseAdmin.from('cf_watchlist').select('page_id, note'),
  ])
  const { isAdmin } = await getAccess()
  return NextResponse.json({ pages: pages ?? [], references: refs, watchlist: watch ?? [], isAdmin })
}

// POST — actions.
export async function POST(req: NextRequest) {
  const g = await guardModule('intelligence'); if (g) return g
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const now = new Date().toISOString()
  switch (body.action) {
    case 'setStatus': {
      const patch: Record<string, unknown> = { status: String(body.status) }
      if (body.status === 'reported') patch.reported_at = now
      await supabaseAdmin.from('counterfeit_pages').update(patch).eq('page_id', String(body.pageId))
      return NextResponse.json({ ok: true })
    }
    case 'watchlistAdd':
      await supabaseAdmin.from('cf_watchlist').upsert({ page_id: String(body.pageId), note: String(body.note ?? '') }, { onConflict: 'page_id' })
      return NextResponse.json({ ok: true })
    case 'watchlistRemove':
      await supabaseAdmin.from('cf_watchlist').delete().eq('page_id', String(body.pageId))
      return NextResponse.json({ ok: true })
    case 'refAdd':
      if (!body.url) return NextResponse.json({ error: 'url required' }, { status: 400 })
      await addReference((body.kind as RefKind) ?? 'face', String(body.url), body.label ? String(body.label) : undefined)
      return NextResponse.json({ ok: true })
    case 'refRemove':
      await removeReference(Number(body.id))
      return NextResponse.json({ ok: true })
    case 'refreshCreatives':
      return NextResponse.json({ ok: true, count: await refreshCreatives() })
    case 'setToken':
      await supabaseAdmin.from('site_settings').upsert({ key: 'cf_ads_library_token', value: String(body.token ?? ''), updated_at: now }, { onConflict: 'key' })
      return NextResponse.json({ ok: true })
    case 'testToken': {
      const tok = body.token ? String(body.token) : await adLibToken()
      if (!tok) return NextResponse.json({ ok: false, error: 'no token' })
      try {
        const r = await fetch(`https://graph.facebook.com/v19.0/ads_archive?search_terms=perfume&ad_reached_countries=%5B%22PK%22%5D&ad_active_status=ALL&ad_type=ALL&fields=id,page_name&limit=3&access_token=${encodeURIComponent(tok)}`, { cache: 'no-store' })
        const j = await r.json()
        if (j.error) return NextResponse.json({ ok: false, error: j.error.message })
        return NextResponse.json({ ok: true, sample: (j.data ?? []).length })
      } catch (e) { return NextResponse.json({ ok: false, error: String(e).slice(0, 120) }) }
    }
    case 'addPage': {
      // Resolve a numeric page_id from a pasted FB/Ad-Library URL or id, then
      // watchlist it so the next hunt pulls THEIR ads (search_page_ids) + matches.
      const input = String(body.url ?? body.pageId ?? '').trim()
      let pid = ''
      const mAdlib = input.match(/view_all_page_id=(\d+)/)
      const mNumUrl = input.match(/facebook\.com\/(?:profile\.php\?id=)?(\d{6,})/)
      if (mAdlib) pid = mAdlib[1]
      else if (/^\d{6,}$/.test(input)) pid = input
      else if (mNumUrl) pid = mNumUrl[1]
      else {
        const slug = input.match(/facebook\.com\/([^/?#]+)/)?.[1] ?? input
        try {
          const tok = await adLibToken()
          const r = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(slug)}?fields=id&access_token=${encodeURIComponent(tok)}`, { cache: 'no-store' })
          const j = await r.json(); if (j.id) pid = String(j.id)
        } catch { /* unresolved */ }
      }
      if (!pid) return NextResponse.json({ ok: false, error: 'Could not find the page ID — paste the Facebook page URL (or the Ad Library link for that page).' }, { status: 400 })
      const domain = body.domain ? String(body.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null
      await supabaseAdmin.from('cf_watchlist').upsert({ page_id: pid, note: String(body.name ?? '') }, { onConflict: 'page_id' })
      await supabaseAdmin.from('counterfeit_pages').upsert({
        page_id: pid, page_name: String(body.name ?? 'Watchlisted'), page_url: `https://www.facebook.com/${pid}`,
        scam_score: 50, status: 'watch', claude_why: 'Added to watchlist — click Hunt now to pull their ads + match them.',
        landing_domains: domain ? [domain] : [], first_seen: now, last_seen: now,
      }, { onConflict: 'page_id' })
      return NextResponse.json({ ok: true, page_id: pid })
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
