import { supabaseAdmin } from '@/lib/hub/supabase'
import { MARKETS } from '@/lib/accounts'
import { getFacebookData, getFbThumbnails } from '@/lib/facebook'

// ════════════════════════════════════════════════════════════════════════════
// CF reference set — the OFFICIAL Elyscents assets impostors are matched against:
// our ad creatives (auto-pulled FB ad thumbnails), our logo, and founder faces.
// See docs/COUNTERFEIT_HUNTER_SPEC.md §4.
// ════════════════════════════════════════════════════════════════════════════

const LOGO_URL = 'https://elyscentsads.core47.ai/elyscents-logo.png'

export interface CfRefs { creatives: string[]; logos: string[]; faces: string[] }
export type RefKind = 'creative' | 'logo' | 'face'

export async function getReferences(): Promise<CfRefs> {
  const refs: CfRefs = { creatives: [], logos: [], faces: [] }
  try {
    const { data } = await supabaseAdmin.from('cf_reference').select('kind, url')
    for (const r of (data ?? []) as Array<{ kind: string; url: string }>) {
      if (r.kind === 'creative') refs.creatives.push(r.url)
      else if (r.kind === 'logo') refs.logos.push(r.url)
      else if (r.kind === 'face') refs.faces.push(r.url)
    }
  } catch { /* table may not exist yet */ }
  if (!refs.logos.length) refs.logos.push(LOGO_URL) // always protect the logo
  return refs
}

export async function listReferences(): Promise<Array<{ id: number; kind: string; url: string; label: string | null }>> {
  const { data } = await supabaseAdmin.from('cf_reference').select('id, kind, url, label').order('id', { ascending: false })
  return (data ?? []) as Array<{ id: number; kind: string; url: string; label: string | null }>
}
export async function addReference(kind: RefKind, url: string, label?: string) {
  await supabaseAdmin.from('cf_reference').insert({ kind, url, label: label ?? null })
}
export async function removeReference(id: number) {
  await supabaseAdmin.from('cf_reference').delete().eq('id', id)
}

/** Pull our own recent FB ad thumbnails (image + video posters) as the
 *  reference-creative set. Refreshed on a schedule. */
export async function refreshCreatives(): Promise<number> {
  const accountIds = Object.values(MARKETS).flatMap(m => m.accounts.filter(a => a.platform === 'facebook').map(a => a.id))
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  let adIds: string[] = []
  try {
    const rows = await getFacebookData(accountIds, from, to)
    adIds = [...new Set(rows.map(r => String(r.ad_id)).filter(Boolean))].slice(0, 150)
  } catch { return 0 }
  if (!adIds.length) return 0
  const thumbs = await getFbThumbnails(adIds)
  const urls = [...new Set(Object.values(thumbs).filter(Boolean))]
  if (!urls.length) return 0
  await supabaseAdmin.from('cf_reference').delete().eq('kind', 'creative')
  await supabaseAdmin.from('cf_reference').insert(urls.map(u => ({ kind: 'creative', url: u, label: 'fb-ad' })))
  return urls.length
}
