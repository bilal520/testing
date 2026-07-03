'use client'
import { useState, useEffect } from 'react'

type Country = 'pakistan' | 'uae' | 'bangladesh'

interface Competitor {
  id:   string   // numeric page ID (preferred) or slug fallback
  name: string   // real page name from Graph API
}

type CompMap = Record<Country, Competitor[]>

const COUNTRY_LABELS: Record<Country, string> = {
  pakistan:   '🇵🇰 Pakistan',
  uae:        '🇦🇪 UAE',
  bangladesh: '🇧🇩 Bangladesh',
}

const COUNTRY_CODES: Record<Country, string> = {
  pakistan: 'PK', uae: 'AE', bangladesh: 'BD',
}

const STORAGE_KEY = 'elyscents_competitors_v4'
const EMPTY_MAP: CompMap = { pakistan: [], uae: [], bangladesh: [] }

function adsLibraryUrl(comp: Competitor, countryCode: string): string {
  const p = new URLSearchParams({ active_status: 'active', ad_type: 'all', country: countryCode, media_type: 'all' })
  if (/^\d+$/.test(comp.id)) {
    p.set('view_all_page_id', comp.id)
  } else {
    p.set('q', comp.name)
    p.set('search_type', 'page_transparency_search')
  }
  return `https://www.facebook.com/ads/library/?${p.toString()}`
}

function loadMap(): CompMap {
  if (typeof window === 'undefined') return EMPTY_MAP
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? { ...EMPTY_MAP, ...JSON.parse(s) } : EMPTY_MAP
  } catch { return EMPTY_MAP }
}

function saveMap(m: CompMap) { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)) }

export default function CompetitorsTab() {
  const [country,    setCountry]    = useState<Country>('pakistan')
  const [compMap,    setCompMap]    = useState<CompMap>(EMPTY_MAP)
  const [input,      setInput]      = useState('')
  const [error,      setError]      = useState<string | null>(null)
  const [resolving,  setResolving]  = useState(false)

  useEffect(() => { setCompMap(loadMap()) }, [])

  async function handleAdd() {
    const trimmed = input.trim()
    if (!trimmed || resolving) return
    setError(null)
    setResolving(true)

    try {
      const res  = await fetch(`/api/competitors/resolve?url=${encodeURIComponent(trimmed)}`)
      const data = await res.json() as { pageId?: string; pageName?: string; error?: string }

      if (!data.pageId) {
        setError(data.error ?? 'Could not resolve this page')
        return
      }

      if (compMap[country].some(c => c.id === data.pageId)) {
        setError('Already added for this country'); return
      }

      const comp: Competitor = { id: data.pageId, name: data.pageName ?? data.pageId }
      const updated = { ...compMap, [country]: [...compMap[country], comp] }
      setCompMap(updated); saveMap(updated); setInput('')
    } catch {
      setError('Network error — please try again')
    } finally {
      setResolving(false)
    }
  }

  function handleRemove(id: string) {
    const updated = { ...compMap, [country]: compMap[country].filter(c => c.id !== id) }
    setCompMap(updated); saveMap(updated)
  }

  const comps = compMap[country]

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">

      {/* Country selector */}
      <div className="flex gap-2 mb-6">
        {(Object.keys(COUNTRY_LABELS) as Country[]).map(c => (
          <button key={c} onClick={() => setCountry(c)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              country === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {COUNTRY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Add competitor */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">Add competitor — {COUNTRY_LABELS[country]}</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Paste their Facebook page URL"
            disabled={resolving}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50"
          />
          <button onClick={handleAdd} disabled={!input.trim() || resolving}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors whitespace-nowrap min-w-[80px]">
            {resolving ? '...' : '+ Add'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        <p className="text-xs text-gray-400 mt-1">
          e.g. facebook.com/fawwahafragrances — we'll resolve the real page name automatically
        </p>
      </div>

      {/* List */}
      {comps.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-sm">No competitors added for {COUNTRY_LABELS[country]} yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {comps.map(comp => (
            <div key={comp.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{comp.name}</p>
                {/^\d+$/.test(comp.id) && (
                  <p className="text-xs text-gray-400">Page ID: {comp.id}</p>
                )}
              </div>

              <a href={adsLibraryUrl(comp, COUNTRY_CODES[country])}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0">
                View {COUNTRY_LABELS[country]} Ads →
              </a>

              <button onClick={() => handleRemove(comp.id)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
