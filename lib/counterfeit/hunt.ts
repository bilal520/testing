import { supabaseAdmin } from '@/lib/hub/supabase'
import { getReferences, refreshCreatives } from '@/lib/counterfeit/reference'
import { discover } from '@/lib/counterfeit/discovery'
import { scorePage, cheapComposite } from '@/lib/counterfeit/detect'

// ════════════════════════════════════════════════════════════════════════════
// CF hunt orchestrator — discover candidates, score each on the six signals,
// upsert into counterfeit_pages. Returns a summary + the newly-confirmed pages
// (for alerting). See docs/COUNTERFEIT_HUNTER_SPEC.md.
// ════════════════════════════════════════════════════════════════════════════

export interface HuntResult { scored: number; confirmed: number; newConfirmed: Array<{ page_name: string; scam_score: number; why: string }> }

export async function runHunt(): Promise<HuntResult> {
  let refs = await getReferences()
  if (!refs.creatives.length) { try { await refreshCreatives() } catch { /* ignore */ } refs = await getReferences() }

  const pages = await discover('PK')
  // The sweep returns the whole PK perfume field (~100+ pages). Cheap-rank them
  // (copy/domain/behaviour/name — no vision) and run the expensive Claude-vision
  // pass only on the top candidates, so it stays inside the function budget.
  const ranked = pages
    .map(p => ({ p, c: cheapComposite(p) }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 30)
    .map(x => x.p)
  const now = new Date().toISOString()
  const res: HuntResult = { scored: 0, confirmed: 0, newConfirmed: [] }

  for (const p of ranked) {
    const v = await scorePage(p, refs)
    res.scored++
    if (v.scam_score < 25) continue
    if (v.scam_score >= 60) res.confirmed++

    const sample_ads = v.ads.slice(0, 4).map(a => ({
      id: a.ad_id, snapshot_url: a.snapshot_url, body: a.body.slice(0, 200),
      image: a.image_url || a.video_poster, start: a.start_time,
    }))
    const row = {
      page_id: v.page_id, page_name: v.page_name, page_url: `https://www.facebook.com/${v.page_id}`,
      scam_score: v.scam_score, signals: v.signals, claude_why: v.why,
      profile_pic_url: v.profile_pic_url, landing_domains: v.domains,
      sample_ads, ad_count: v.ads.length, last_seen: now,
    }
    const { data: ex } = await supabaseAdmin.from('counterfeit_pages').select('status').eq('page_id', v.page_id).maybeSingle()
    if (ex) {
      if (['whitelisted', 'removed', 'reported'].includes(String(ex.status))) continue
      await supabaseAdmin.from('counterfeit_pages').update(row).eq('page_id', v.page_id)
    } else {
      await supabaseAdmin.from('counterfeit_pages').insert({ ...row, status: v.scam_score >= 60 ? 'active' : 'watch', first_seen: now })
      if (v.scam_score >= 60) res.newConfirmed.push({ page_name: v.page_name, scam_score: v.scam_score, why: v.why })
    }
  }
  return res
}
