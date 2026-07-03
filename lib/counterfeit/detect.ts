import Anthropic from '@anthropic-ai/sdk'
import type { CandidatePage, CandidateAd } from '@/lib/counterfeit/discovery'
import type { CfRefs } from '@/lib/counterfeit/reference'

// ════════════════════════════════════════════════════════════════════════════
// CF detection — score a candidate page on six impersonation signals and fuse
// them into a 0-100 scam score. Claude vision does the two visual signals
// (creative theft, identity theft); code does name/domain/copy/behavior.
// See docs/COUNTERFEIT_HUNTER_SPEC.md §3.
// ════════════════════════════════════════════════════════════════════════════

let _c: Anthropic | null = null
const claude = () => (_c ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

// ── text signals ────────────────────────────────────────────────────────────
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}
function nameScore(name: string): number {
  const n = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  if (!n) return 0
  const targets = ['elyscents', 'elyscent', 'elements']
  if (targets.some(t => n.includes(t))) return 100
  const best = Math.min(...['elyscents', 'elements'].map(t => lev(n, t) / Math.max(n.length, t.length)))
  return best <= 0.25 ? 90 : best <= 0.4 ? 60 : best <= 0.55 ? 30 : 0
}
function domainScore(domains: string[]): number {
  let s = 0
  for (const d of domains) {
    const x = d.toLowerCase()
    if (/(elyscent|royaloud|salsaspirit|zarak)/.test(x)) s = Math.max(s, 100)
    else if (/(oud|salsa|zarak|attar)/.test(x)) s = Math.max(s, 55)
    else if (x.endsWith('.myshopify.com')) s = Math.max(s, 45)
  }
  return s
}
const COPY_FINGERPRINTS = [
  '2999', '3,700', '3700', 'money back', 'money-back', '8 to 10', '8-10 hour', '8–10',
  'cash on delivery', 'save 700', 'save rs 700', 'buy 2', 'any 2 perfume', 'gift pack', 'refund',
]
function copyScore(bodies: string[]): number {
  const text = bodies.join(' \n ').toLowerCase()
  const hits = COPY_FINGERPRINTS.filter(f => text.includes(f)).length
  return hits >= 4 ? 100 : hits === 3 ? 75 : hits === 2 ? 50 : hits === 1 ? 30 : 0
}
function behaviorScore(page: CandidatePage): number {
  let s = 0
  if (page.ads.some(a => a.video_poster)) s += 40
  if (page.domains.some(d => d.endsWith('.myshopify.com') || /(elyscent|royaloud)/.test(d))) s += 40
  const recent = page.ads.some(a => a.start_time && (Date.now() - new Date(a.start_time).getTime()) < 30 * 86_400_000)
  if (recent) s += 20
  return Math.min(100, s)
}

// ── vision signals (Claude) ───────────────────────────────────────────────────
const SYSTEM = `You protect the brand "Elyscents", a Pakistani perfume brand. You are shown OFFICIAL Elyscents reference images (our logo, our founder's face, and our real ad creatives), then images from an UNKNOWN Facebook page that runs perfume ads in Pakistan. Decide if the unknown page is IMPERSONATING Elyscents by (a) re-using our ad creatives/videos, or (b) using our logo or our founder's face as their profile picture. Be strict — only give a high score when the visuals are clearly OURS (allow for crops, watermarks, re-encoding, mirror flips). Return ONLY JSON.`
const img = (url: string) => ({ type: 'image' as const, source: { type: 'url' as const, url } })

async function visionScore(page: CandidatePage, refs: CfRefs): Promise<{ creative: number; identity: number; reason: string }> {
  const candImgs = page.ads.map(a => a.video_poster || a.image_url).filter(Boolean).slice(0, 3) as string[]
  if (!candImgs.length && !page.profile_pic_url) return { creative: 0, identity: 0, reason: '' }
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: 'OFFICIAL Elyscents — LOGO:' }, ...refs.logos.slice(0, 1).map(img)]
  if (refs.faces.length) { content.push({ type: 'text', text: 'OFFICIAL Elyscents — FOUNDER FACE:' }, ...refs.faces.slice(0, 2).map(img)) }
  if (refs.creatives.length) { content.push({ type: 'text', text: 'OFFICIAL Elyscents — our ad creatives:' }, ...refs.creatives.slice(0, 8).map(img)) }
  content.push({ type: 'text', text: `UNKNOWN page "${page.page_name}" — their PROFILE PICTURE:` })
  if (page.profile_pic_url) content.push(img(page.profile_pic_url))
  content.push({ type: 'text', text: 'Their AD creatives:' }, ...candImgs.map(img))
  content.push({ type: 'text', text: 'Return ONLY JSON: {"creative_theft":0-100,"identity_theft":0-100,"reason":"one short sentence"}. creative_theft = how strongly their ad visuals are copies of OUR reference creatives. identity_theft = is their profile picture actually our logo or our founder\'s face.' })
  try {
    const r = await claude().messages.create({ model: 'claude-sonnet-4-6', max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content }] })
    const t = r.content[0].type === 'text' ? r.content[0].text : '{}'
    const j = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return { creative: Math.min(100, Number(j.creative_theft) || 0), identity: Math.min(100, Number(j.identity_theft) || 0), reason: String(j.reason ?? '').slice(0, 200) }
  } catch { return { creative: 0, identity: 0, reason: '' } }
}

export interface Verdict {
  page_id: string; page_name: string; scam_score: number
  signals: { creative: number; identity: number; name: number; domain: number; copy: number; behavior: number }
  why: string; profile_pic_url: string | null; domains: string[]; ads: CandidateAd[]; found_via: string[]
}

// Cheap (no-vision) signals — used to PRIORITISE which pages get the expensive
// Claude-vision pass, so we can sweep hundreds of candidates affordably.
export function cheapComposite(page: CandidatePage): number {
  const s = { name: nameScore(page.page_name), domain: domainScore(page.domains), copy: copyScore(page.ads.map(a => a.body)), behavior: behaviorScore(page) }
  return Math.round(0.30 * s.copy + 0.30 * s.domain + 0.25 * s.behavior + 0.15 * s.name)
}

export async function scorePage(page: CandidatePage, refs: CfRefs): Promise<Verdict> {
  const vis = await visionScore(page, refs)
  const signals = {
    creative: vis.creative, identity: vis.identity,
    name: nameScore(page.page_name), domain: domainScore(page.domains),
    copy: copyScore(page.ads.map(a => a.body)), behavior: behaviorScore(page),
  }
  const scam = Math.round(0.35 * signals.creative + 0.25 * signals.identity + 0.10 * signals.name + 0.10 * signals.domain + 0.15 * signals.copy + 0.05 * signals.behavior)
  const flags = Object.entries(signals).filter(([, v]) => v >= 50).map(([k]) => k)
  const why = vis.reason || (flags.length ? `Matches on: ${flags.join(', ')}.` : 'Low-signal perfume advertiser.')
  return { page_id: page.page_id, page_name: page.page_name, scam_score: scam, signals, why, profile_pic_url: page.profile_pic_url, domains: page.domains, ads: page.ads, found_via: page.found_via }
}
