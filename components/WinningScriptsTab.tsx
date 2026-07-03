'use client'
import { useState, useEffect } from 'react'
import type { Market } from '@/lib/accounts'
import { MARKETS } from '@/lib/accounts'
import { loadDB, CURRENCIES, type BrandDB, type Offer, type Product, type FounderPose } from '@/lib/brandData'
import { matchOffersToAd, type OfferMatch } from '@/lib/productMatcher'
import { cacheScript } from '@/lib/scriptsCache'

const CAC_LIMITS: Record<Market, number> = {
  pakistan: 350, uae: 4.5, bangladesh: 500,
}

interface Creative {
  id: string; name: string; platform: string
  primaryCac: number; totalPurchases: number
  thumbnailUrl?: string
}

interface Hook {
  text: string
  category: 'Visual'|'Pain'|'Disbelief'|'Comparison'|'Challenge'|'Personal'|'Social Proof'|'Gift'
  score: number
}

interface VideoIdea { title: string; concept: string }
interface Script    { angle: string; script: string }

interface FrameInventory {
  people: {
    count: number
    visibility: string
    pose: string
    expressionOrEmotion: string
    faceDetails: string
  }
  objectsAndProps: string[]
  product: { visible: boolean; timing: string; role: string }
  backgroundLocation: { setting: string; visibleCues: string[]; locationSignal: string }
  lightingAndMood: { lighting: string; mood: string }
  textOverlay: { visible: boolean; readableText: string[] }
  unusualElements: string[]
}

interface ViewerReaction {
  firstQuestion: string
  scrollStopStrength: number
  reason: string
}

interface TopScrollStopCue {
  rank: number
  element: string
  category: string
  strength: number
}

interface Scores {
  scrollStop: number; founderTrust: number
  offerClarity: number; proof: number; replicability: number
}

interface DeepAnalysis {
  spokenHook: string; visualHook: string
  problem: string; promise: string; proof: string
  offer: string; guarantee: string; cta: string
  powerWords: string[]; buyerPsychology: string
}

interface ImageBrief {
  type: 'conversion' | 'curiosity'
  visualConcept: string
  headline: string
  subheadline: string
  offerStrip: string
  cta: string
  designNotes: string
  dallePrompt: string
}

interface AnalyseResult {
  adTitle: string; adText: string; transcript: string
  thumbnailAnalysed: boolean; transcriptUsed: boolean
  frameInventory: FrameInventory | null
  viewerReaction: ViewerReaction | null
  topScrollStopCues: TopScrollStopCue[]
  attentionReason: string
  trustReason: string
  conversionReason: string
  winningMechanism: string
  whyItWorked: string
  hooks: Hook[]
  videoIdeas: VideoIdea[]
  scripts: Script[]
  scores: Scores | null
  imageBriefs: ImageBrief[]
  deepAnalysis: DeepAnalysis | null
  error?: string
}

const CATEGORY_STYLE: Record<string, string> = {
  'Visual':       'bg-indigo-50  text-indigo-700  border-indigo-200',
  'Pain':         'bg-red-50     text-red-700     border-red-200',
  'Disbelief':    'bg-purple-50  text-purple-700  border-purple-200',
  'Comparison':   'bg-blue-50    text-blue-700    border-blue-200',
  'Challenge':    'bg-orange-50  text-orange-700  border-orange-200',
  'Personal':     'bg-pink-50    text-pink-700    border-pink-200',
  'Social Proof': 'bg-green-50   text-green-700   border-green-200',
  'Gift':         'bg-yellow-50  text-yellow-700  border-yellow-200',
}

const SCRIPT_STYLE: Record<string, string> = {
  'Pain':              'border-red-200    bg-red-50',
  'Price Comparison':  'border-blue-200   bg-blue-50',
  'Trust & Guarantee': 'border-green-200  bg-green-50',
}

const SCORE_CONFIG = [
  { key: 'scrollStop',    label: 'Scroll Stop', ring: 'ring-red-400',    text: 'text-red-700',    bg: 'bg-red-50'    },
  { key: 'founderTrust',  label: 'Trust',       ring: 'ring-blue-400',   text: 'text-blue-700',   bg: 'bg-blue-50'   },
  { key: 'offerClarity',  label: 'Offer',       ring: 'ring-green-400',  text: 'text-green-700',  bg: 'bg-green-50'  },
  { key: 'proof',         label: 'Proof',       ring: 'ring-purple-400', text: 'text-purple-700', bg: 'bg-purple-50' },
  { key: 'replicability', label: 'Replicate',   ring: 'ring-orange-400', text: 'text-orange-700', bg: 'bg-orange-50' },
] as const

const CUE_CATEGORY_COLOR: Record<string, string> = {
  'Pattern interrupt': 'bg-red-50 border-red-200 text-red-700',
  'Curiosity gap':     'bg-purple-50 border-purple-200 text-purple-700',
  'Trust':             'bg-blue-50 border-blue-200 text-blue-700',
  'Proof':             'bg-green-50 border-green-200 text-green-700',
  'Raw authenticity':  'bg-orange-50 border-orange-200 text-orange-700',
  'Location/status':   'bg-amber-50 border-amber-200 text-amber-700',
  'Product desire':    'bg-pink-50 border-pink-200 text-pink-700',
  'Demonstration':     'bg-teal-50 border-teal-200 text-teal-700',
  'Scroll stop':       'bg-gray-100 border-gray-300 text-gray-700',
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy}
      className="text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-500 hover:text-gray-800 transition-colors shrink-0">
      {copied ? '✓' : label}
    </button>
  )
}

function FrameInventoryBlock({ fi, vr }: { fi: FrameInventory; vr: ViewerReaction | null }) {
  const hasUnusual = fi.unusualElements.length > 0 &&
    !fi.unusualElements[0].toLowerCase().includes('standard')

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 px-3 py-2 border-b border-gray-200 bg-white">
          Visual Evidence
        </p>
        <div className="px-3 py-2.5 space-y-2 text-xs text-gray-700">

          {/* People row */}
          {fi.people.count > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div><span className="font-semibold text-gray-500">Pose</span><span className="ml-1.5">{fi.people.pose}</span></div>
              <div>
                <span className="font-semibold text-gray-500">Product</span>
                <span className={`ml-1.5 font-medium ${fi.product.visible ? 'text-green-600' : 'text-orange-600'}`}>
                  {fi.product.visible ? 'visible' : 'not shown'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="font-semibold text-gray-500">Face</span>
                <span className="ml-1.5">{fi.people.faceDetails}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-500">Setting</span>
                <span className="ml-1.5">{fi.backgroundLocation.setting}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-500">Mood</span>
                <span className="ml-1.5">{fi.lightingAndMood.mood}</span>
              </div>
              {fi.backgroundLocation.locationSignal && fi.backgroundLocation.locationSignal !== 'background unclear' && (
                <div className="col-span-2">
                  <span className="font-semibold text-gray-500">Location</span>
                  <span className="ml-1.5">{fi.backgroundLocation.locationSignal}</span>
                </div>
              )}
              {fi.objectsAndProps.length > 0 && (
                <div className="col-span-2 text-gray-500">
                  <span className="font-semibold text-gray-500">Props</span>
                  <span className="ml-1.5">{fi.objectsAndProps.join(' · ')}</span>
                </div>
              )}
            </div>
          )}

          {/* Unusual elements */}
          {hasUnusual && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
              {fi.unusualElements.map((el, i) => (
                <span key={i} className="text-[10px] bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded-full">
                  ⚡ {el}
                </span>
              ))}
            </div>
          )}

          {/* Viewer first question */}
          {vr?.firstQuestion && (
            <div className="text-gray-400 italic text-[11px] pt-1 border-t border-gray-100">
              &ldquo;{vr.firstQuestion}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Image Brief Card — copy + brief only (image generation is in Creative Studio tab)

function ImageBriefCard({ brief, market, confirmedOffer, db }: {
  brief: ImageBrief; market: Market; confirmedOffer: Offer | null; db: BrandDB
}) {
  const isConversion = brief.type === 'conversion'
  const borderColor  = isConversion ? 'border-green-200' : 'border-indigo-200'
  const labelColor   = isConversion ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'
  const currency     = CURRENCIES[market as keyof typeof CURRENCIES] ?? MARKETS[market].primaryCurrency

  const offerProducts: Product[] = confirmedOffer
    ? confirmedOffer.items.map(i => db.products.find(p => p.id === i.productId)!).filter(Boolean)
    : []

  let offerStripText = brief.offerStrip
  let ctaText        = brief.cta
  if (confirmedOffer) {
    const names = offerProducts.map(p => p.shortName || p.name).join(' + ')
    offerStripText = `${names} | ${currency} ${confirmedOffer.bundlePrice}${confirmedOffer.savings > 0 ? ` (Save ${confirmedOffer.savings})` : ''} | ${confirmedOffer.guaranteeText}`
    ctaText        = confirmedOffer.cta || brief.cta
  }

  const allText = [brief.headline, brief.subheadline, offerStripText].join('\n')

  return (
    <div className={`rounded-xl border-2 ${borderColor} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${labelColor}`}>
          {isConversion ? 'CONVERSION' : 'CURIOSITY'}
        </span>
        <span className="text-xs text-gray-500">{isConversion ? 'Direct response — offer first' : 'Pattern interrupt — stop the scroll'}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Ad copy */}
        <div className="bg-gray-900 text-white rounded-xl p-3 space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
            Ad Copy {confirmedOffer ? '— real offer pricing' : ''}
          </p>
          <p className="text-sm font-bold leading-tight">{brief.headline}</p>
          {brief.subheadline && <p className="text-xs text-gray-300">{brief.subheadline}</p>}
          <div className="border-t border-gray-700 pt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-400 flex-1 leading-snug">{offerStripText}</p>
            <span className="text-[11px] font-bold bg-white text-gray-900 px-2 py-0.5 rounded shrink-0">{ctaText}</span>
          </div>
        </div>

        {/* Visual concept / scene description */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Visual concept</p>
          <p className="text-xs text-gray-600 leading-snug">{brief.visualConcept}</p>
        </div>

        {/* Design notes */}
        {brief.designNotes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold text-amber-700 mb-0.5">For photographer / designer</p>
            <p className="text-xs text-amber-800">{brief.designNotes}</p>
          </div>
        )}

        {/* Pointer to Creative Studio */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 text-[11px] text-indigo-600">
          To create the image, go to the <strong>Creative Studio</strong> tab and choose a concept template (Warning, This Is Not, Us vs Them, News).
        </div>

        <CopyBtn text={allText} label="Copy ad copy" />
      </div>
    </div>
  )
}

function OfferDetectionRow({ matches, confirmedOffer, offers, onConfirm }: {
  matches: OfferMatch[]; confirmedOffer: Offer | null
  offers: Offer[]; onConfirm: (o: Offer | null) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const top = matches[0]

  const confidenceColor = (c: number) =>
    c >= 70 ? 'text-green-700 bg-green-100' : c >= 40 ? 'text-amber-700 bg-amber-100' : 'text-gray-600 bg-gray-100'

  if (!top && !confirmedOffer && offers.length === 0) return null

  return (
    <div className="px-4 py-3 border-b border-gray-100 bg-blue-50">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-1">Detected Offer</p>
          {confirmedOffer ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{confirmedOffer.name}</span>
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">✓ Confirmed</span>
            </div>
          ) : top ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{top.offer.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${confidenceColor(top.confidence)}`}>
                  {top.confidence}% match
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">{top.reasons.join(' · ')}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No offer detected — select manually to enable image generation</p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          {!confirmedOffer && top && (
            <button onClick={() => onConfirm(top.offer)}
              className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              Confirm
            </button>
          )}
          <button onClick={() => setShowPicker(v => !v)}
            className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-100 transition-colors">
            {confirmedOffer ? 'Change' : 'Select'}
          </button>
          {confirmedOffer && (
            <button onClick={() => onConfirm(null)}
              className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-red-600 transition-colors">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Other matches */}
      {!confirmedOffer && matches.length > 1 && (
        <div className="flex gap-2 mt-2">
          {matches.slice(1).map(m => (
            <button key={m.offer.id} onClick={() => onConfirm(m.offer)}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${confidenceColor(m.confidence)} border-current opacity-70 hover:opacity-100`}>
              {m.offer.name} {m.confidence}%
            </button>
          ))}
        </div>
      )}

      {/* Manual offer picker */}
      {showPicker && (
        <div className="mt-2 bg-white border border-blue-200 rounded-lg divide-y divide-gray-100 shadow-sm">
          {offers.length === 0 ? (
            <p className="text-xs text-gray-400 p-3">No offers in database. Add them in the Setup tab first.</p>
          ) : (
            offers.map(o => (
              <button key={o.id} onClick={() => { onConfirm(o); setShowPicker(false) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors flex items-center justify-between">
                <span className="font-medium text-gray-900">{o.name}</span>
                <span className="text-gray-400">{CURRENCIES[o.market]} {o.bundlePrice}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ResultView({ r, cac, purchases, market, db, detectedMatches, confirmedOffer, onConfirmOffer }: {
  r: AnalyseResult; cac: number; purchases: number; market: Market
  db: BrandDB; detectedMatches: OfferMatch[]; confirmedOffer: Offer | null
  onConfirmOffer: (o: Offer | null) => void
}) {
  const [showDeep, setShowDeep] = useState(false)
  const cfg = MARKETS[market]

  if (r.error) return <p className="text-xs text-red-500 px-4 pb-4">{r.error}</p>

  const visualHooks = r.hooks.filter(h => h.category === 'Visual')
  const otherHooks  = r.hooks.filter(h => h.category !== 'Visual')

  return (
    <div className="border-t border-gray-100 divide-y divide-gray-50">

      {/* ── Offer detection ──────────────────────────────────── */}
      <OfferDetectionRow
        matches={detectedMatches}
        confirmedOffer={confirmedOffer}
        offers={db.offers.filter(o => o.market === market as unknown)}
        onConfirm={onConfirmOffer}
      />

      {/* ── Top 3 Scroll-Stop Cues ───────────────────────────── */}
      {r.topScrollStopCues?.length > 0 && (
        <div className="px-4 py-3 bg-gray-900 text-white">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">
            Top Scroll-Stop Cues
          </p>
          <div className="space-y-2">
            {r.topScrollStopCues.map(cue => {
              const catColor = CUE_CATEGORY_COLOR[cue.category] ?? 'bg-gray-100 border-gray-300 text-gray-700'
              return (
                <div key={cue.rank} className="flex items-center gap-2.5">
                  <span className="text-[10px] text-gray-500 w-3 shrink-0 font-bold">{cue.rank}.</span>
                  <span className="text-sm font-medium flex-1 leading-snug">{cue.element}</span>
                  <span className={`text-[9px] border px-1.5 py-0.5 rounded-full shrink-0 font-medium ${catColor}`}>
                    {cue.category}
                  </span>
                  <div className="flex gap-0.5 shrink-0">
                    {Array.from({ length: 10 }, (_, i) => (
                      <div key={i} className={`w-1 h-2.5 rounded-sm ${i < cue.strength ? 'bg-white' : 'bg-gray-700'}`} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {r.viewerReaction?.firstQuestion && (
            <p className="text-[10px] text-gray-400 italic mt-2.5 pt-2 border-t border-gray-800">
              &ldquo;{r.viewerReaction.firstQuestion}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* ── Visual Evidence ──────────────────────────────────── */}
      {r.frameInventory && (
        <FrameInventoryBlock fi={r.frameInventory} vr={r.viewerReaction ?? null} />
      )}

      {/* ── Trust + Conversion row ───────────────────────────── */}
      {(r.trustReason || r.conversionReason) && (
        <div className="grid grid-cols-2 divide-x divide-gray-100">
          <div className="px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-blue-500 mb-1">Created trust</p>
            <p className="text-xs text-gray-700 leading-snug">{r.trustReason || '—'}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-green-600 mb-1">Triggered order</p>
            <p className="text-xs text-gray-700 leading-snug">{r.conversionReason || '—'}</p>
          </div>
        </div>
      )}

      {/* ── Scores ───────────────────────────────────────────── */}
      {r.scores && (
        <div className="px-4 py-3 bg-gray-50">
          <div className="flex gap-2">
            {SCORE_CONFIG.map(({ key, label, ring, text, bg }) => (
              <div key={key} className={`flex-1 flex flex-col items-center py-2 rounded-xl ring-1 ${ring} ${bg}`}>
                <span className={`text-base font-bold leading-none ${text}`}>{r.scores![key]}</span>
                <span className={`text-[8px] font-semibold mt-0.5 ${text} opacity-70`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Data quality badges + formula ────────────────────── */}
      <div className="px-4 py-2.5 bg-gray-50 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
          CAC {cfg.primaryCurrency} {cac.toFixed(0)}
        </span>
        <span className="text-xs text-gray-400">{purchases} purchases</span>
        {r.thumbnailAnalysed && (
          <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">✓ Visual</span>
        )}
        {r.transcriptUsed ? (
          <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ Transcript</span>
        ) : (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">⚠ Caption only</span>
        )}
        {r.winningMechanism && (
          <p className="w-full text-[11px] text-gray-500 mt-0.5 leading-snug">
            <span className="font-semibold text-gray-700">Formula: </span>{r.winningMechanism}
          </p>
        )}
      </div>

      {/* ── Why it worked ────────────────────────────────────── */}
      <div className="px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Why This Ad Worked</p>
        <p className="text-sm text-gray-800 leading-relaxed">{r.whyItWorked}</p>
      </div>

      {/* ── Visual hooks (if any) ─────────────────────────────── */}
      {visualHooks.length > 0 && (
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600">
              Visual Hooks — use the pattern interrupt ({visualHooks.length})
            </p>
            <CopyBtn text={visualHooks.map((h, i) => `${i + 1}. ${h.text}`).join('\n')} label="Copy all" />
          </div>
          <div className="space-y-2">
            {visualHooks.map((h, i) => (
              <HookRow key={i} h={h} index={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* ── Other hooks ──────────────────────────────────────── */}
      {otherHooks.length > 0 && (
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
              {visualHooks.length > 0 ? 'Offer & Pain Hooks' : 'Shoot These Hooks Next'} ({otherHooks.length})
            </p>
            <CopyBtn text={otherHooks.map((h, i) => `${i + 1}. ${h.text}`).join('\n')} label="Copy all" />
          </div>
          <div className="space-y-2">
            {otherHooks.map((h, i) => (
              <HookRow key={i} h={h} index={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* ── Video Concepts ───────────────────────────────────── */}
      {r.videoIdeas.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">Make These Videos</p>
          <div className="space-y-2">
            {r.videoIdeas.map((v, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="font-semibold text-gray-900">{v.title}</span>
                  <span className="text-gray-500"> — {v.concept}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scripts ──────────────────────────────────────────── */}
      {r.scripts.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">3 Ready Scripts (shoot now)</p>
          <div className="space-y-3">
            {r.scripts.map((s, i) => (
              <div key={i} className={`rounded-xl border p-3 ${SCRIPT_STYLE[s.angle] ?? 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-700">Script {i + 1} — {s.angle}</span>
                  <CopyBtn text={s.script} />
                </div>
                <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{s.script}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Image Ad Briefs ──────────────────────────────────── */}
      {r.imageBriefs?.length > 0 && (
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Image Ad Briefs</p>
            <span className="text-[10px] text-gray-300">— 2 variations from this winner</span>
          </div>
          {!confirmedOffer && (
            <p className="text-[11px] text-amber-600 mb-3">
              ⚠ Confirm the offer above to use real pricing and product assets in image generation.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {r.imageBriefs.map((brief, i) => (
              <ImageBriefCard key={i} brief={brief} market={market} confirmedOffer={confirmedOffer} db={db} />
            ))}
          </div>
        </div>
      )}

      {/* ── Deep Analysis (collapsed) ─────────────────────────── */}
      {r.deepAnalysis && (
        <div className="px-4 py-3">
          <button onClick={() => setShowDeep(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            {showDeep ? '▼' : '▶'} Full analysis
          </button>
          {showDeep && (
            <div className="mt-3 space-y-3 text-sm text-gray-700">
              {r.deepAnalysis.spokenHook     && <p><span className="font-semibold">Spoken Hook:</span> {r.deepAnalysis.spokenHook}</p>}
              {r.deepAnalysis.visualHook     && <p><span className="font-semibold">Visual Hook:</span> {r.deepAnalysis.visualHook}</p>}
              {r.deepAnalysis.problem        && <p><span className="font-semibold">Problem:</span> {r.deepAnalysis.problem}</p>}
              {r.deepAnalysis.promise        && <p><span className="font-semibold">Promise:</span> {r.deepAnalysis.promise}</p>}
              {r.deepAnalysis.proof          && <p><span className="font-semibold">Proof:</span> {r.deepAnalysis.proof}</p>}
              {r.deepAnalysis.offer          && <p><span className="font-semibold">Offer:</span> {r.deepAnalysis.offer}</p>}
              {r.deepAnalysis.guarantee      && <p><span className="font-semibold">Guarantee:</span> {r.deepAnalysis.guarantee}</p>}
              {r.deepAnalysis.buyerPsychology && <p><span className="font-semibold">Psychology:</span> {r.deepAnalysis.buyerPsychology}</p>}
              {r.deepAnalysis.powerWords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.deepAnalysis.powerWords.map((w, i) => (
                    <span key={i} className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">{w}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HookRow({ h, index }: { h: Hook; index: number }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${CATEGORY_STYLE[h.category] ?? 'bg-gray-50 border-gray-200 text-gray-700'}`}>
      <span className="text-[10px] font-bold mt-0.5 opacity-50 shrink-0 w-4">{index}</span>
      <p className="flex-1 text-sm leading-snug">{h.text}</p>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_STYLE[h.category] ?? ''} opacity-70`}>
          {h.category}
        </span>
        <span className="text-[11px] font-bold opacity-60">{h.score}/10</span>
        <CopyBtn text={h.text} />
      </div>
    </div>
  )
}

function AdCard({ creative, market, result, analysing, onAnalyse, db, detectedMatches, confirmedOffer, onConfirmOffer }: {
  creative: Creative; market: Market
  result: AnalyseResult | null; analysing: boolean
  onAnalyse: (id: string) => void
  db: BrandDB; detectedMatches: OfferMatch[]; confirmedOffer: Offer | null
  onConfirmOffer: (o: Offer | null) => void
}) {
  const cfg = MARKETS[market]
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        {creative.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creative.thumbnailUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-100" />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-xl shrink-0">🎬</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{creative.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            CAC: <span className="font-semibold text-green-700">{cfg.primaryCurrency} {creative.primaryCac.toFixed(0)}</span>
            {' · '}{creative.totalPurchases} purchases
            {' · '}<span className="font-mono text-[10px] text-gray-300 select-all">{creative.id.replace('facebook:','')}</span>
          </p>
        </div>
        <button onClick={() => onAnalyse(creative.id)} disabled={analysing}
          className="shrink-0 px-4 py-2 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors min-w-[110px] text-center">
          {analysing ? (
            <span className="flex items-center gap-1.5 justify-center">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Analysing…
            </span>
          ) : result ? '↻ Re-analyse' : '✦ Analyse'}
        </button>
      </div>
      {result && (
        <ResultView
          r={result} cac={creative.primaryCac} purchases={creative.totalPurchases} market={market}
          db={db} detectedMatches={detectedMatches} confirmedOffer={confirmedOffer} onConfirmOffer={onConfirmOffer}
        />
      )}
    </div>
  )
}

export default function WinningScriptsTab() {
  const [market,          setMarket]          = useState<Market>('pakistan')
  const [creatives,       setCreatives]       = useState<Creative[]>([])
  const [loading,         setLoading]         = useState(false)
  const [analysing,       setAnalysing]       = useState<string | null>(null)
  const [results,         setResults]         = useState<Record<string, AnalyseResult>>({})
  const [db,              setDb]              = useState<BrandDB>(() => loadDB())
  const [detectedMatches, setDetectedMatches] = useState<Record<string, OfferMatch[]>>({})
  const [confirmedOffers, setConfirmedOffers] = useState<Record<string, Offer | null>>({})

  async function fetchWinners(mkt: Market) {
    setLoading(true); setCreatives([])
    try {
      const res  = await fetch(`/api/creatives?market=${mkt}`)
      const data = await res.json()
      const limit = CAC_LIMITS[mkt]
      const winners = (data.creatives as Creative[])
        .filter(c => c.platform === 'facebook' && c.primaryCac > 0 && c.primaryCac < limit)
        .sort((a, b) => a.primaryCac - b.primaryCac)
      setCreatives(winners)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchWinners(market) }, [market])

  async function handleAnalyse(creativeId: string) {
    const adId = creativeId.replace('facebook:', '')
    setAnalysing(creativeId)
    try {
      const res  = await fetch(`/api/analyse?adId=${adId}&market=${market}`)
      let data: AnalyseResult
      try {
        data = await res.json()
      } catch {
        data = { error: `Server error (HTTP ${res.status}) — check Vercel logs` } as AnalyseResult
      }
      setResults(prev => ({ ...prev, [creativeId]: data }))

      // Populate scripts cache so Creative Studio can pre-fill from this winner
      const imageBrief = data.imageBriefs?.[0]
      const creative   = creatives.find(c => c.id === creativeId)
      if (imageBrief && creative) {
        const topHook = [...(data.hooks ?? [])].sort((a, b) => b.score - a.score)[0]?.text ?? ''
        cacheScript({
          market,
          adId:            creative.id.replace('facebook:', ''),
          adName:          creative.name,
          cac:             creative.primaryCac,
          headline:        imageBrief.headline,
          subline:         imageBrief.subheadline ?? '',
          offerText:       imageBrief.offerStrip,
          cta:             imageBrief.cta,
          topHook,
          angle:           data.scripts?.[0]?.angle ?? '',
          visualHook:      data.deepAnalysis?.visualHook ?? '',
          buyerPsychology: data.deepAnalysis?.buyerPsychology ?? '',
        })
      }

      // Client-side offer matching using ad content
      const freshDb = loadDB()
      setDb(freshDb)
      const matches = matchOffersToAd(
        { title: data.adTitle, text: data.adText, transcript: data.transcript },
        freshDb,
        market as unknown as import('@/lib/brandData').DbMarket,
      )
      setDetectedMatches(prev => ({ ...prev, [creativeId]: matches }))
      // Auto-confirm if single high-confidence match
      if (matches.length === 1 && matches[0].confidence >= 70) {
        setConfirmedOffers(prev => ({ ...prev, [creativeId]: matches[0].offer }))
      }
    } finally { setAnalysing(null) }
  }

  function handleConfirmOffer(creativeId: string, offer: Offer | null) {
    setConfirmedOffers(prev => ({ ...prev, [creativeId]: offer }))
  }

  const cfg   = MARKETS[market]
  const limit = CAC_LIMITS[market]

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex gap-2 mb-2">
        {(['pakistan', 'uae', 'bangladesh'] as Market[]).map(m => (
          <button key={m} onClick={() => setMarket(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              market === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {MARKETS[m].flag} {MARKETS[m].name}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-5">
        Facebook ads with 4-day CAC under {cfg.primaryCurrency} {limit} — cheapest first
      </p>

      {loading && <div className="text-center py-16 text-gray-400 text-sm">Loading winning ads…</div>}
      {!loading && creatives.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🏆</p>
          <p className="text-sm">No ads below {cfg.primaryCurrency} {limit} CAC in the last 4 days</p>
        </div>
      )}

      <div className="space-y-4">
        {creatives.map(c => (
          <AdCard key={c.id} creative={c} market={market}
            result={results[c.id] ?? null}
            analysing={analysing === c.id}
            onAnalyse={handleAnalyse}
            db={db}
            detectedMatches={detectedMatches[c.id] ?? []}
            confirmedOffer={confirmedOffers[c.id] ?? null}
            onConfirmOffer={o => handleConfirmOffer(c.id, o)}
          />
        ))}
      </div>
    </div>
  )
}
