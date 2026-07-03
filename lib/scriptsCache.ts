// ── Scripts cache ─────────────────────────────────────────────────────────────
// Populated by WinningScriptsTab after each ad is analysed.
// Read by CreativeStudioTab to pre-fill text fields from proven winners.

const CACHE_KEY = 'elyscents_scripts_cache_v1'
const MAX = 50

export interface CachedScript {
  id:              string
  market:          string
  adId:            string
  adName:          string
  cac:             number
  analysedAt:      string
  headline:        string
  subline:         string
  offerText:       string
  cta:             string
  topHook:         string
  angle:           string
  visualHook:      string
  buyerPsychology: string
}

function load(): CachedScript[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') }
  catch { return [] }
}

function persist(items: CachedScript[]) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(items.slice(0, MAX)))
}

export function cacheScript(entry: Omit<CachedScript, 'id' | 'analysedAt'>) {
  const existing = load().filter(e => e.adId !== entry.adId)
  persist([
    { ...entry, id: Math.random().toString(36).slice(2, 10), analysedAt: new Date().toISOString() },
    ...existing,
  ])
}

export function getBestScriptForMarket(market: string): CachedScript | null {
  const all = load().filter(s => s.market === market)
  if (!all.length) return null
  return all.sort((a, b) => a.cac - b.cac)[0]
}

export function getAllScriptsForMarket(market: string): CachedScript[] {
  return load().filter(s => s.market === market).sort((a, b) => a.cac - b.cac)
}
