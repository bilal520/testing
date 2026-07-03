'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { loadDB, CURRENCIES, type BrandDB } from '@/lib/brandData'
import { genId, saveEntry, loadLibrary, linkFbAdId, deleteEntry, type LibraryEntry } from '@/lib/creativeLibrary'
import { getBestScriptForMarket, type CachedScript } from '@/lib/scriptsCache'
import {
  loadMeta, addMeta, updateMeta, deleteMeta, saveImage, getImage, deleteImage,
  selectBestReferences, compressRefImage, refUid,
  type RefMeta, type SelectedRef,
} from '@/lib/referenceLibrary'
import type { Market } from '@/lib/accounts'

// ─── Types ────────────────────────────────────────────────────────────────────

type AwarenessStage = 'cold' | 'warm' | 'hot'
type AspectRatio    = '1:1' | '4:5' | '9:16'
type Tab            = 'create' | 'library' | 'myads'

interface ImgData { data: string; mimeType: string }

interface VariantResult {
  index:     number
  imageData: string | null
  mimeType:  string
  loading:   boolean
  error:     string | null
}

interface RankResult { index: number; rank: number; reason: string }

const RANK_MEDAL = ['🥇', '🥈', '🥉', '4️⃣']

// ─── Image helpers ────────────────────────────────────────────────────────────

function fileToImgData(file: File, maxSide = 1200): Promise<ImgData> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const s = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.round(img.width * s), h = Math.round(img.height * s)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      resolve({ data: c.toDataURL(mime, 0.88).split(',')[1], mimeType: mime })
    }
    img.onerror = reject; img.src = url
  })
}

function dataUrlToImgData(dataUrl: string): ImgData | null {
  const ci = dataUrl.indexOf(','); if (ci === -1) return null
  const mime = dataUrl.slice(0, ci).match(/data:([^;]+)/)?.[1] ?? 'image/jpeg'
  return { data: dataUrl.slice(ci + 1), mimeType: mime }
}

async function srcToImgData(src: string): Promise<ImgData | null> {
  if (!src) return null
  if (src.startsWith('data:')) return dataUrlToImgData(src)
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(src)}`)
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]
    const blob = await res.blob()
    return new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => { const u = r.result as string; const ci = u.indexOf(','); resolve(ci === -1 ? null : { data: u.slice(ci + 1), mimeType: mime }) }
      r.onerror = () => resolve(null); r.readAsDataURL(blob)
    })
  } catch { return null }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_OPTIONS: { id: AwarenessStage; label: string; tag: string; color: string }[] = [
  { id: 'cold', label: 'Cold',  tag: 'Never heard of us', color: 'border-blue-300 bg-blue-50 text-blue-800' },
  { id: 'warm', label: 'Warm',  tag: 'Aware, not bought', color: 'border-amber-300 bg-amber-50 text-amber-800' },
  { id: 'hot',  label: 'Hot',   tag: 'Ready to buy',      color: 'border-red-300 bg-red-50 text-red-800' },
]

const CONCEPTS: { id: string; label: string; cold?: boolean; warm?: boolean; hot?: boolean }[] = [
  { id: 'warning',      label: '⚠️ Warning',       cold: true },
  { id: 'this_is_not',  label: '🚫 This Is Not',   cold: true },
  { id: 'proof',        label: '✅ Social Proof',   cold: true, warm: true },
  { id: 'news',         label: '📰 News Style',     cold: true, warm: true },
  { id: 'lifestyle',    label: '✨ Lifestyle',       warm: true },
  { id: 'us_vs_them',   label: '⚔️ Us vs Them',    warm: true, hot: true },
  { id: 'bundle_value', label: '📦 Bundle Deal',    hot: true },
]

const PROVEN_ANGLES = [
  'Long-lasting in Pakistani heat — 8+ hours',
  'Luxury feel without luxury price',
  'People stop and ask what perfume this is',
  'Customers keep reordering — proof it works',
  'Gift-worthy — the perfume people actually use',
  'Body spray is not a real perfume',
  '2-perfume bundle deal — more value',
  'No risk — money-back guarantee + COD',
]

const FORMATS: AspectRatio[] = ['1:1', '4:5', '9:16']

const CONCEPT_LABEL: Record<string, string> = {
  warning: '⚠️', this_is_not: '🚫', proof: '✅', news: '📰',
  lifestyle: '✨', us_vs_them: '⚔️', bundle_value: '📦',
}

const CONCEPT_BG_COLORS: Record<string, string> = {
  dark:      'bg-gray-800', light: 'bg-gray-100', lifestyle: 'bg-green-100',
  editorial: 'bg-gray-200', clean: 'bg-white',    outdoor:   'bg-sky-100',
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CreativeStudioTab({ market }: { market: Market }) {
  const [db,  setDb]   = useState<BrandDB | null>(null)
  const [tab,  setTab]  = useState<Tab>('create')
  const [myAds, setMyAds] = useState<LibraryEntry[]>([])

  // ── Create inputs
  const [stage,     setStage]    = useState<AwarenessStage>('cold')
  const [concept,   setConcept]  = useState('warning')
  const [linkValue, setLinkValue] = useState('')
  const [prodFile,  setProdFile]  = useState<File | null>(null)
  const [prodPreview, setProdPreview] = useState<string | null>(null)
  const [headline,  setHeadline] = useState('')
  const [offer,     setOffer]    = useState('')
  const [cta,       setCta]      = useState('Order Now')
  const [subline,   setSubline]  = useState('')
  const [bubbleText, setBubbleText] = useState('')
  const [angle,     setAngle]    = useState('')
  const [format,    setFormat]   = useState<AspectRatio>('1:1')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // ── Scripts cache
  const [cachedScript, setCachedScript]     = useState<CachedScript | null>(null)
  const [cacheDismissed, setCacheDismissed] = useState(false)

  // ── Reference selection
  const [selectedRefs,     setSelectedRefs]     = useState<SelectedRef[]>([])
  const [refsLoading,      setRefsLoading]      = useState(false)
  const [showRefPreviews,  setShowRefPreviews]  = useState(false)

  // ── Generation
  const [results,      setResults]      = useState<VariantResult[]>([])
  const [generating,   setGenerating]   = useState(false)
  const [genError,     setGenError]     = useState<string | null>(null)
  const [currentGenId, setCurrentGenId] = useState<string | null>(null)

  // ── Ranking
  const [rankings, setRankings] = useState<RankResult[] | null>(null)
  const [ranking,  setRanking]  = useState(false)

  // ── Reference library state
  const [refMeta,       setRefMeta]       = useState<RefMeta[]>([])
  const [refImages,     setRefImages]     = useState<Record<string, string>>({})
  const [uploading,     setUploading]     = useState(false)
  const [autoTagging,   setAutoTagging]   = useState<string | null>(null)
  const [refFilter,     setRefFilter]     = useState<string>('all')
  const [refScore,      setRefScore]      = useState<Record<string, number>>({})

  // ── My Ads link inputs
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({})

  // ── Init
  useEffect(() => { setDb(loadDB()); setMyAds(loadLibrary()); setRefMeta(loadMeta()) }, [])

  // ── Load thumbnails for visible ref meta
  useEffect(() => {
    if (!refMeta.length) return
    const missing = refMeta.filter(m => !refImages[m.id])
    if (!missing.length) return
    Promise.all(missing.map(async m => {
      const img = await getImage(m.id)
      if (img) setRefImages(prev => ({ ...prev, [m.id]: img }))
    }))
  }, [refMeta])

  // ── Scripts cache check
  useEffect(() => {
    const best = getBestScriptForMarket(market)
    setCachedScript(best); setCacheDismissed(false)
  }, [market])

  // ── Auto-select references when concept/stage changes
  useEffect(() => {
    if (tab !== 'create') return
    setRefsLoading(true)
    selectBestReferences(concept, stage, 4).then(refs => {
      setSelectedRefs(refs); setRefsLoading(false)
    })
  }, [concept, stage, tab, refMeta.length])

  // ── Product file preview
  useEffect(() => {
    if (!prodFile) { setProdPreview(null); return }
    const url = URL.createObjectURL(prodFile); setProdPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [prodFile])

  // ── Linked product helpers
  const currency = CURRENCIES[market as keyof typeof CURRENCIES] ?? 'PKR'
  const allOffers = db?.offers.filter(o => o.status === 'active' && o.market === market) ?? []
  const allProds  = db?.products.filter(p => p.status === 'active' && p.markets.includes(market as 'pakistan'|'uae'|'bangladesh')) ?? []

  function parsedLink() {
    if (!linkValue) return null
    const [type, id] = linkValue.split(':')
    return id ? { type: type as 'offer' | 'product', id } : null
  }
  function getLibrarySrc(): string | null {
    if (!db) return null
    const link = parsedLink(); if (!link) return null
    if (link.type === 'product') { const p = db.products.find(p => p.id === link.id); return (p?.assets.find(a => a.isPrimary) ?? p?.assets[0])?.src ?? null }
    const offer = db.offers.find(o => o.id === link.id); const prod = db.products.find(p => p.id === offer?.items[0]?.productId)
    return (prod?.assets.find(a => a.isPrimary) ?? prod?.assets[0])?.src ?? null
  }
  function getLinkedName(): string {
    if (!db) return ''; const link = parsedLink(); if (!link) return ''
    if (link.type === 'product') return db.products.find(p => p.id === link.id)?.name ?? ''
    const offer = db.offers.find(o => o.id === link.id)
    return db.products.find(p => p.id === offer?.items[0]?.productId)?.name ?? offer?.name ?? ''
  }
  function getLinkedPrice(): string {
    if (!db) return ''; const link = parsedLink(); if (!link) return ''
    if (link.type === 'product') { const pr = db.products.find(p => p.id === link.id)?.pricing[market as 'pakistan'|'uae'|'bangladesh']?.price; return pr ? `${currency} ${pr}` : '' }
    const bp = db.offers.find(o => o.id === link.id)?.bundlePrice; return bp ? `${currency} ${bp}` : ''
  }

  const libSrc = getLibrarySrc()
  const libDispSrc = libSrc?.startsWith('data:') ? libSrc : libSrc ? `/api/proxy-image?url=${encodeURIComponent(libSrc)}` : null

  function applyFromCache() {
    if (!cachedScript) return
    if (!headline) setHeadline(cachedScript.headline)
    if (!subline && cachedScript.subline) setSubline(cachedScript.subline)
    if (!offer && cachedScript.offerText) setOffer(cachedScript.offerText)
    if ((!cta || cta === 'Order Now') && cachedScript.cta) setCta(cachedScript.cta)
    if (!angle && cachedScript.angle) setAngle(cachedScript.angle)
    setCacheDismissed(true)
  }

  // ── Auto-rank
  async function triggerRanking(images: { index: number; imageData: string }[]) {
    if (images.length < 2) return
    setRanking(true)
    try {
      const res = await fetch('/api/rank-creatives', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: images.map(i => i.imageData), concept }),
      })
      const data = await res.json()
      if (data.rankings?.length) setRankings(data.rankings as RankResult[])
    } catch {}
    setRanking(false)
  }

  // ── Generate
  async function generate() {
    if (!prodFile && !linkValue) { setGenError('Upload a product image or select from library first.'); return }
    if (!headline.trim()) { setGenError('Enter a headline.'); return }
    if (!offer.trim())    { setGenError('Enter offer text.'); return }

    setGenerating(true); setGenError(null); setRankings(null)
    const newGenId = genId(); setCurrentGenId(newGenId)
    setResults(Array.from({ length: 4 }, (_, i) => ({ index: i, imageData: null, mimeType: 'image/jpeg', loading: true, error: null })))

    let prodImg: ImgData | null = null
    try {
      prodImg = prodFile ? await fileToImgData(prodFile) : await srcToImgData(libSrc ?? '')
    } catch { setGenError('Image processing failed'); setGenerating(false); return }

    // Convert reference images to ImgData
    const refImgData = selectedRefs.map(r => dataUrlToImgData(r.dataUrl)).filter(Boolean) as ImgData[]

    const collected: { index: number; imageData: string }[] = []

    await Promise.allSettled(Array.from({ length: 4 }, async (_, i) => {
      try {
        const res = await fetch('/api/openai-image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productImage:    prodImg,
            referenceImages: refImgData,
            headline, subline: subline || undefined, offer, cta,
            concept, stage, angle: angle || undefined,
            bubbleText: bubbleText || undefined,
            aspectRatio: format, variationIndex: i,
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setResults(prev => prev.map((v, j) => j === i ? { ...v, imageData: data.imageData, mimeType: data.mimeType ?? 'image/jpeg', loading: false } : v))
        collected.push({ index: i, imageData: data.imageData })
      } catch (e) {
        setResults(prev => prev.map((v, j) => j === i ? { ...v, loading: false, error: e instanceof Error ? e.message : 'Failed' } : v))
      }
    }))

    saveEntry({ genId: newGenId, createdAt: new Date().toISOString(), market, concept, angle, headline, dna: '', productName: getLinkedName() || 'Elyscents', offer, audienceStage: stage, variantCount: 4, scores: null, linkedFbAdIds: [] })
    setMyAds(loadLibrary())
    setGenerating(false)
    if (collected.length >= 2) triggerRanking(collected.sort((a, b) => a.index - b.index))
  }

  async function regenerate(i: number) {
    if (generating) return
    setResults(prev => prev.map((v, j) => j === i ? { ...v, loading: true, error: null, imageData: null } : v))
    setRankings(null)
    const prodImg = prodFile ? await fileToImgData(prodFile).catch(() => null) : await srcToImgData(libSrc ?? '')
    const refImgData = selectedRefs.map(r => dataUrlToImgData(r.dataUrl)).filter(Boolean) as ImgData[]
    try {
      const res = await fetch('/api/openai-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productImage: prodImg, referenceImages: refImgData, headline, subline: subline || undefined, offer, cta, concept, stage, angle: angle || undefined, bubbleText: bubbleText || undefined, aspectRatio: format, variationIndex: i }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(prev => prev.map((v, j) => j === i ? { ...v, imageData: data.imageData, mimeType: data.mimeType ?? 'image/jpeg', loading: false } : v))
    } catch (e) {
      setResults(prev => prev.map((v, j) => j === i ? { ...v, loading: false, error: e instanceof Error ? e.message : 'Failed' } : v))
    }
  }

  function download(v: VariantResult) {
    if (!v.imageData) return
    const a = document.createElement('a'); a.href = `data:${v.mimeType};base64,${v.imageData}`; a.download = `${currentGenId ?? 'ely'}-v${v.index + 1}.jpg`; a.click()
  }

  // ── Reference Library: upload
  const handleRefUpload = useCallback(async (files: File[]) => {
    setUploading(true)
    for (const file of files.slice(0, 20)) {
      try {
        const id      = refUid()
        const dataUrl = await compressRefImage(file)
        await saveImage(id, dataUrl)
        const meta: RefMeta = { id, addedAt: new Date().toISOString(), concept: 'unknown', stages: ['cold', 'warm'], subject: 'product_only', background: 'dark', format: 'unknown', energy: 'urgent', score: 3, autoTagged: false }
        addMeta(meta)
        setRefMeta(loadMeta())
        setRefImages(prev => ({ ...prev, [id]: dataUrl }))
        // Auto-tag in background
        autoTagRef(id, dataUrl)
      } catch {}
    }
    setUploading(false)
  }, [])

  // ── Paste to upload (active when on library tab)
  useEffect(() => {
    if (tab !== 'library') return
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? [])
      const files = items
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null)
      if (files.length) { e.preventDefault(); handleRefUpload(files) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [tab, handleRefUpload])

  async function autoTagRef(id: string, dataUrl: string) {
    setAutoTagging(id)
    try {
      const res  = await fetch('/api/auto-tag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageDataUrl: dataUrl }) })
      const data = await res.json()
      if (!data.error) {
        updateMeta(id, { concept: data.concept ?? 'unknown', stages: data.stages ?? ['cold', 'warm'], subject: data.subject ?? 'product_only', background: data.background ?? 'dark', format: data.format ?? 'unknown', energy: data.energy ?? 'urgent', patternInterrupt: data.patternInterrupt, autoTagged: true })
        setRefMeta(loadMeta())
      }
    } catch {}
    setAutoTagging(null)
  }

  async function deleteRef(id: string) {
    deleteMeta(id); await deleteImage(id)
    setRefMeta(loadMeta()); setRefImages(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const filteredMeta = refFilter === 'all' ? refMeta : refMeta.filter(m => m.concept === refFilter || m.stages.includes(refFilter))

  const aspectNum = format === '9:16' ? 9/16 : format === '4:5' ? 4/5 : 1

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <TabBtn label="✦ Create" active={tab === 'create'} onClick={() => setTab('create')} />
        <TabBtn label={`📂 Reference Library${refMeta.length > 0 ? ` (${refMeta.length})` : ''}`} active={tab === 'library'} onClick={() => setTab('library')} />
        <TabBtn label={`📁 My Ads${myAds.length > 0 ? ` (${myAds.length})` : ''}`} active={tab === 'myads'} onClick={() => setTab('myads')} />
      </div>

      {/* ── CREATE TAB ──────────────────────────────────────────────────── */}
      {tab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">

          {/* LEFT: Inputs */}
          <div className="space-y-3">

            {/* Scripts cache banner */}
            {cachedScript && !cacheDismissed && (
              <div className="border border-green-200 bg-green-50 rounded-xl px-3 py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">Winning formula available</p>
                  <p className="text-xs text-green-800 mt-0.5 line-clamp-1">"{cachedScript.headline}"</p>
                  <p className="text-[10px] text-green-500 mt-0.5">CAC {currency} {cachedScript.cac.toFixed(0)}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={applyFromCache} className="text-[11px] px-2.5 py-1 bg-green-700 text-white rounded-lg hover:bg-green-800 font-medium">Apply</button>
                  <button onClick={() => setCacheDismissed(true)} className="text-[11px] text-green-400 hover:text-green-700 px-1">✕</button>
                </div>
              </div>
            )}

            {/* Stage */}
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Audience</p>
              <div className="flex gap-2">
                {STAGE_OPTIONS.map(s => (
                  <button key={s.id} onClick={() => { setStage(s.id); setConcept(CONCEPTS.find(c => c[s.id])?.id ?? concept) }}
                    className={`flex-1 py-2 px-1 rounded-lg border text-center transition-all ${stage === s.id ? `${s.color} border-current font-semibold` : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}>
                    <p className="text-xs font-bold">{s.label}</p>
                    <p className={`text-[9px] mt-0.5 ${stage === s.id ? 'opacity-70' : 'text-gray-300'}`}>{s.tag}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Concept */}
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Concept</p>
              <div className="grid grid-cols-2 gap-1.5">
                {CONCEPTS.filter(c => c[stage]).map(c => (
                  <button key={c.id} onClick={() => setConcept(c.id)}
                    className={`px-2 py-2 rounded-lg border text-xs text-left transition-all ${concept === c.id ? 'bg-gray-900 text-white border-gray-900 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* References selected */}
            <div className="border border-gray-200 rounded-xl p-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Reference ads</p>
                <button onClick={() => setShowRefPreviews(v => !v)} className="text-[10px] text-gray-400 hover:text-gray-600">
                  {showRefPreviews ? 'Hide' : 'Preview'}
                </button>
              </div>
              {refsLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-gray-400"><Spin />Selecting…</div>
              ) : selectedRefs.length === 0 ? (
                <div className="text-[11px] text-gray-400">
                  No reference ads yet.{' '}
                  <button onClick={() => setTab('library')} className="underline text-gray-500 hover:text-gray-700">Add some →</button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-600 font-medium">{selectedRefs.length} ads selected for {CONCEPT_LABEL[concept] ?? concept} + {stage}</p>
                  {showRefPreviews && (
                    <div className="flex gap-2 mt-2">
                      {selectedRefs.map((r, i) => (
                        <div key={r.meta.id} className="flex-1 space-y-1">
                          <img src={r.dataUrl} alt="" className="w-full aspect-square object-cover rounded-lg border border-gray-200" />
                          <p className="text-[9px] text-gray-400 text-center">{r.meta.concept} · {r.meta.background}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-gray-300">These are sent to AI as visual examples</p>
                </div>
              )}
            </div>

            {/* Product */}
            <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Product</p>
              {(allOffers.length > 0 || allProds.length > 0) && (
                <select value={linkValue} onChange={e => { setLinkValue(e.target.value); setProdFile(null) }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">— Select from library —</option>
                  {allOffers.length > 0 && <optgroup label="Offers">{allOffers.map(o => <option key={o.id} value={`offer:${o.id}`}>{o.name} — {currency} {o.bundlePrice}</option>)}</optgroup>}
                  {allProds.length > 0  && <optgroup label="Products">{allProds.map(p => { const pr = p.pricing[market as 'pakistan'|'uae'|'bangladesh']?.price; return <option key={p.id} value={`product:${p.id}`}>{p.name}{pr ? ` — ${currency} ${pr}` : ''}</option> })}</optgroup>}
                </select>
              )}
              {libDispSrc && !prodFile && <div className="flex items-center gap-2.5 bg-gray-50 rounded-lg p-2"><img src={libDispSrc} alt="" className="h-10 w-10 object-contain" /><div><p className="text-xs font-medium text-gray-700">{getLinkedName()}</p><p className="text-[10px] text-green-600">✓ Sent to AI</p></div></div>}
              {prodPreview ? (
                <div className="relative"><img src={prodPreview} alt="" className="w-full rounded-lg object-contain max-h-24 bg-gray-50" /><button onClick={() => setProdFile(null)} className="absolute top-1 right-1 bg-gray-900/70 text-white text-[10px] px-2 py-0.5 rounded-full">✕</button></div>
              ) : (
                <FileZone label="Upload product image" hint="PNG transparent preferred" onFile={f => { setProdFile(f); setLinkValue('') }} />
              )}
            </div>

            {/* Ad text */}
            <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Ad text</p>

              <F label="Headline *">
                <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder='"Bhai Yeh Konsa Perfume Hai?"'
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </F>

              <F label="Offer *">
                <input value={offer} onChange={e => setOffer(e.target.value)} placeholder='"PKR 1799 | Free Delivery | COD | 7-Din Wapsi"'
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </F>

              <div className="flex items-center justify-between">
                <button onClick={() => setShowAdvanced(v => !v)} className="text-[10px] text-gray-400 hover:text-gray-600">
                  {showAdvanced ? '▼ Less' : '▶ More options'}
                </button>
                <div className="flex gap-1">
                  {FORMATS.map(f => <button key={f} onClick={() => setFormat(f)} className={`px-2 py-1 rounded text-[10px] border transition-all ${format === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>{f}</button>)}
                </div>
              </div>

              {showAdvanced && (
                <div className="space-y-3 pt-1 border-t border-gray-100">
                  <F label="CTA"><input value={cta} onChange={e => setCta(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></F>
                  <F label="Supporting line">
                    <input value={subline} onChange={e => setSubline(e.target.value)} placeholder='e.g. "Royal Oud — sirf PKR 1799"' className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </F>
                  {(concept === 'proof' || concept === 'warning') && (
                    <F label="Chat bubble text">
                      <input value={bubbleText} onChange={e => setBubbleText(e.target.value)} placeholder='"Yeh konsa perfume hai bhai?"' className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    </F>
                  )}
                  <F label="Angle">
                    <select value={angle} onChange={e => setAngle(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">— Pick angle (optional) —</option>
                      {PROVEN_ANGLES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </F>
                </div>
              )}
            </div>

            {genError && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3"><p className="text-xs text-red-600">{genError}</p></div>}

            <button onClick={generate} disabled={generating}
              className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 text-sm">
              {generating
                ? <><Spin />Generating {results.filter(v => v.imageData).length}/4…</>
                : `✦ Generate${selectedRefs.length > 0 ? ` with ${selectedRefs.length} References` : ''}`}
            </button>
          </div>

          {/* RIGHT: Results */}
          <div>
            {results.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center" style={{ minHeight: 420 }}>
                <div className="text-center space-y-3 px-8">
                  <p className="text-4xl">🖼</p>
                  <p className="text-sm font-semibold text-gray-600">Reference-driven generation</p>
                  <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                    Add reference ads to the library. When you generate, the AI studies your best-performing examples and creates ads with the same visual energy.
                  </p>
                  <button onClick={() => setTab('library')} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg">Add reference ads →</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {currentGenId && (
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-gray-400">Ad ID:</span>
                    <code className="text-[11px] font-mono text-gray-700 flex-1">{currentGenId}</code>
                    <button onClick={() => navigator.clipboard.writeText(currentGenId)} className="text-[10px] text-gray-400 hover:text-gray-700">Copy</button>
                  </div>
                )}
                {ranking && <div className="flex items-center gap-2 text-[11px] text-violet-600 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2"><Spin />GPT-4o Vision ranking these ads…</div>}
                {rankings && !ranking && <div className="text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">✓ Ranked by GPT-4o Vision — best to worst</div>}

                <div className="grid grid-cols-2 gap-3">
                  {[...results]
                    .sort((a, b) => {
                      if (!rankings) return a.index - b.index
                      return (rankings.find(r => r.index === a.index)?.rank ?? 99) - (rankings.find(r => r.index === b.index)?.rank ?? 99)
                    })
                    .map(v => {
                      const rank = rankings?.find(r => r.index === v.index)
                      return (
                        <div key={v.index} className="space-y-1.5">
                          <div className="relative rounded-xl overflow-hidden bg-gray-100 border border-gray-200" style={{ aspectRatio: aspectNum }}>
                            {v.loading && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50"><Spin size="lg" /><p className="text-xs text-gray-400">V{v.index + 1}…</p></div>}
                            {v.error && !v.loading && (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-50 p-3 text-center">
                                <div><p className="text-[11px] text-red-500 leading-snug">{v.error}</p><button onClick={() => regenerate(v.index)} className="text-[11px] underline text-red-400 mt-1">Retry</button></div>
                              </div>
                            )}
                            {v.imageData && <img src={`data:${v.mimeType};base64,${v.imageData}`} alt={`V${v.index + 1}`} className="w-full h-full object-contain" />}
                            {rank && <span className="absolute top-1.5 left-1.5 text-xl leading-none">{RANK_MEDAL[rank.rank - 1]}</span>}
                            {rank?.rank === 1 && <div className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">BEST</div>}
                          </div>
                          {rank && <p className="text-[10px] text-gray-400 leading-snug px-0.5">{rank.reason}</p>}
                          <div className="flex gap-1.5">
                            {v.imageData && <button onClick={() => download(v)} className="flex-1 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg hover:bg-gray-700">↓ V{v.index + 1}</button>}
                            <button onClick={() => regenerate(v.index)} disabled={v.loading || generating} className="px-3 py-1.5 border border-gray-200 text-gray-500 text-[11px] rounded-lg hover:text-gray-800 disabled:opacity-40">↻</button>
                          </div>
                        </div>
                      )
                    })}
                </div>

                {results.some(v => v.imageData) && (
                  <button onClick={generate} disabled={generating} className="w-full py-2.5 border border-gray-200 text-gray-500 text-sm rounded-xl hover:text-gray-900 hover:border-gray-400 disabled:opacity-40">↻ Fresh set</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── REFERENCE LIBRARY TAB ──────────────────────────────────────── */}
      {tab === 'library' && (
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-gray-900">Reference Ad Library</h2>
              <p className="text-xs text-gray-400 mt-0.5">Upload or paste (Ctrl+V) high-converting ads. AI studies these when generating. Auto-tagged by GPT-4o Vision.</p>
            </div>
            <label className={`shrink-0 px-4 py-2 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700 transition-colors cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Uploading…' : '+ Upload Ads'}
              <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={e => e.target.files && handleRefUpload(Array.from(e.target.files))} />
            </label>
          </div>

          {/* Filter bar */}
          <div className="flex gap-2 flex-wrap">
            {['all', 'warning', 'this_is_not', 'social_proof', 'news', 'lifestyle', 'us_vs_them', 'bundle_value', 'cold', 'warm', 'hot'].map(f => (
              <button key={f} onClick={() => setRefFilter(f)} className={`px-2.5 py-1 rounded-lg text-[11px] border transition-all ${refFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                {f === 'all' ? `All (${refMeta.length})` : f.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {filteredMeta.length === 0 ? (
            <div className="text-center py-16 text-gray-300">
              <p className="text-4xl mb-3">📂</p>
              <p className="text-sm">No reference ads yet.</p>
              <p className="text-xs mt-1">Upload screenshots from your ad account, Foreplay, or the Facebook Ad Library.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredMeta.map(meta => {
                const img = refImages[meta.id]
                const isTagging = autoTagging === meta.id
                return (
                  <div key={meta.id} className="group relative border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                    {/* Thumbnail */}
                    <div className="aspect-square bg-gray-100 relative">
                      {img
                        ? <img src={img} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-gray-200 text-2xl">🖼</div>
                      }
                      {isTagging && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Spin size="lg" /></div>}
                      {/* Delete button */}
                      <button onClick={() => deleteRef(meta.id)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">✕</button>
                    </div>

                    {/* Tags */}
                    <div className="p-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[8px] px-1.5 py-0.5 bg-gray-800 text-white rounded-full">{meta.concept}</span>
                        {meta.stages.slice(0, 2).map(s => <span key={s} className="text-[8px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full">{s}</span>)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[8px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">{meta.subject}</span>
                        <span className="text-[8px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">{meta.background}</span>
                      </div>
                      {meta.patternInterrupt && <p className="text-[8px] text-gray-400 leading-snug italic line-clamp-1">{meta.patternInterrupt}</p>}

                      {/* Score */}
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <button key={n} onClick={() => { updateMeta(meta.id, { score: n }); setRefMeta(loadMeta()) }}
                            className={`text-[10px] ${n <= meta.score ? 'text-amber-400' : 'text-gray-200'} hover:text-amber-400 transition-colors`}>
                            ★
                          </button>
                        ))}
                      </div>

                      {/* Re-tag button */}
                      {!isTagging && (
                        <button onClick={() => img && autoTagRef(meta.id, img)} className="text-[8px] text-gray-300 hover:text-gray-600 transition-colors">
                          {meta.autoTagged ? '↻ Re-tag' : '⚡ Auto-tag'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MY ADS TAB ──────────────────────────────────────────────────── */}
      {tab === 'myads' && (
        <div className="space-y-3">
          {myAds.length === 0
            ? <div className="text-center py-16 text-gray-400 text-sm">No generated ads yet.</div>
            : <>
              <p className="text-xs text-gray-400">Include the Ad ID in your Facebook ad name to track performance.</p>
              {myAds.map(entry => (
                <div key={entry.genId} className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleDateString()}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{CONCEPT_LABEL[entry.concept] ?? entry.concept}</span>
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{entry.audienceStage}</span>
                      </div>
                      <p className="text-sm font-bold text-gray-800 mt-1.5 line-clamp-1">"{entry.headline}"</p>
                    </div>
                    <button onClick={() => { deleteEntry(entry.genId); setMyAds(loadLibrary()) }} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <code className="text-[11px] font-mono text-gray-600 flex-1">{entry.genId}</code>
                    <button onClick={() => navigator.clipboard.writeText(entry.genId)} className="text-[10px] text-gray-400 hover:text-gray-700">Copy</button>
                  </div>
                  {entry.linkedFbAdIds.length > 0 && <div className="flex flex-wrap gap-1.5">{entry.linkedFbAdIds.map(id => <span key={id} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">FB: {id}</span>)}</div>}
                  <div className="flex gap-2">
                    <input value={linkInputs[entry.genId] ?? ''} onChange={e => setLinkInputs(p => ({ ...p, [entry.genId]: e.target.value }))} placeholder="Paste Facebook ad ID to link performance" className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs" />
                    <button onClick={() => { linkFbAdId(entry.genId, linkInputs[entry.genId] ?? ''); setLinkInputs(p => ({ ...p, [entry.genId]: '' })); setMyAds(loadLibrary()) }} className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700">Link</button>
                  </div>
                </div>
              ))}
            </>
          }
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px ${active ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  )
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>{children}</div>
}

function FileZone({ label, hint, onFile }: { label: string; hint: string; onFile: (f: File) => void }) {
  return (
    <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg py-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all">
      <span className="text-gray-300 text-base">🖼</span>
      <span className="text-xs font-medium text-gray-400 mt-0.5">{label}</span>
      <span className="text-[10px] text-gray-300">{hint}</span>
      <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </label>
  )
}

function Spin({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'
  return <svg className={`animate-spin ${s} shrink-0`} viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
}
