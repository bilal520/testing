'use client'

import { useState, useMemo } from 'react'
import { CAC_STYLES, fmt, fmtRoas } from '@/lib/utils'
import { MARKETS, getCacRating } from '@/lib/accounts'
import type { Market } from '@/lib/accounts'
import type { CreativeData, CreativeDay } from './CreativeCard'

// ─── Types ────────────────────────────────────────────────────────────────────

type SortCol = 'cac' | 'roas' | 'spend' | 'orders' | 'ctr'
type SortDir = 'asc' | 'desc'
type PlatformFilter = 'all' | 'facebook' | 'tiktok' | 'google_ads'

const PLATFORM_OPTIONS: { key: PlatformFilter; label: string }[] = [
  { key: 'all',        label: 'All'      },
  { key: 'facebook',   label: 'Facebook' },
  { key: 'tiktok',     label: 'TikTok'   },
  { key: 'google_ads', label: 'Google'   },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_DAY: CreativeDay = { spend: 0, purchases: 0, cac: 0, roas: 0, revenue: 0, clicks: 0, impressions: 0, frequency: 0, ctr: 0 }

const PLATFORM_BADGE: Record<string, string> = {
  facebook:   'bg-blue-50 text-blue-700',
  tiktok:     'bg-purple-50 text-purple-700',
  google_ads: 'bg-green-50 text-green-700',
}
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', tiktok: 'TikTok', google_ads: 'Google',
}
const PLATFORM_PLACEHOLDER_BG: Record<string, string> = {
  facebook: 'bg-blue-50', tiktok: 'bg-purple-50', google_ads: 'bg-green-50',
}
const PLATFORM_PLACEHOLDER_TEXT: Record<string, string> = {
  facebook: 'text-blue-300', tiktok: 'text-purple-300', google_ads: 'text-green-300',
}

function parseCreativeAge(name: string): number | null {
  const match = name.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/)
  if (!match) return null
  const [, d, m, y] = match
  const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y)
  const launch = new Date(year, parseInt(m) - 1, parseInt(d))
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const diff = Math.floor((now.getTime() - launch.getTime()) / 86400000)
  return diff >= 0 ? diff : null
}

function getSortValue(creative: CreativeData, col: SortCol, dayKey: string, market: Market): number {
  const d = creative.days[dayKey] ?? EMPTY_DAY
  const cfg  = MARKETS[market]
  const rate = creative.currency !== cfg.primaryCurrency ? (cfg.exchangeRates[creative.currency] ?? 1) : 1
  switch (col) {
    case 'cac':    return d.cac > 0 ? d.cac * rate : Infinity  // zero CAC sorts last
    case 'roas':   return d.roas
    case 'spend':  return d.spend * rate
    case 'orders': return d.purchases
    case 'ctr':    return d.ctr
  }
}

// ─── Single creative row ──────────────────────────────────────────────────────

function CreativeRow({ creative, days, activeDay, market }: { creative: CreativeData; days: string[]; activeDay: number; market: Market }) {
  const dayKey  = days[activeDay]
  const prevKey = days[activeDay + 1]
  const d    = creative.days[dayKey]  ?? EMPTY_DAY
  const prev = prevKey ? (creative.days[prevKey] ?? null) : null

  const cacTrendPct = (d.cac > 0 && prev && prev.cac > 0)
    ? ((d.cac - prev.cac) / prev.cac) * 100
    : null

  const hasCtrData  = (creative.platform === 'facebook' || creative.platform === 'google_ads') && d.impressions > 500
  const isFatiguing = hasCtrData && d.ctr < 1.0 && d.frequency > 1.5
  const age         = parseCreativeAge(creative.name)

  // Currency conversion for non-primary-currency accounts
  const marketConfig  = MARKETS[market]
  const primaryCur    = marketConfig.primaryCurrency
  const rate          = creative.currency !== primaryCur ? (marketConfig.exchangeRates[creative.currency] ?? 1) : null
  const convertedCac  = (rate && d.cac > 0) ? d.cac * rate : null

  // Rate the badge against the day's actual primary-currency CAC (not aggregate)
  const primaryDayCac = convertedCac ?? (d.cac > 0 ? d.cac : null)
  const dayRating     = primaryDayCac !== null ? getCacRating(primaryDayCac, market) : creative.cacRating
  const style         = CAC_STYLES[dayRating]

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors">

      {/* Thumbnail */}
      <div className="relative w-10 h-10 shrink-0 group/thumb">
        {creative.thumbnailUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={creative.thumbnailUrl} alt="" className="w-10 h-10 object-cover rounded" />
            <div className="absolute left-12 top-1/2 -translate-y-1/2 z-50 hidden group-hover/thumb:block pointer-events-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={creative.thumbnailUrl} alt="" className="w-40 h-40 object-cover rounded-lg shadow-2xl border border-gray-200" />
            </div>
          </>
        ) : (
          <div className={`w-10 h-10 rounded flex items-center justify-center ${PLATFORM_PLACEHOLDER_BG[creative.platform]}`}>
            <span className={`text-sm font-bold ${PLATFORM_PLACEHOLDER_TEXT[creative.platform]}`}>
              {PLATFORM_LABEL[creative.platform].charAt(0)}
            </span>
          </div>
        )}
      </div>

      {/* Name + account + platform + age */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 truncate leading-tight" title={creative.name}>
          {creative.name}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`badge text-xs py-0 ${PLATFORM_BADGE[creative.platform]}`}>
            {PLATFORM_LABEL[creative.platform]}
          </span>
          <span className="text-xs text-gray-400 truncate">{creative.accountName}</span>
          {age !== null && <span className="text-xs text-gray-300">· D-{age}</span>}
        </div>
      </div>

      {/* CAC + trend + conversion note */}
      <div className="w-28 text-right shrink-0">
        <div>
          <span className="text-xs font-semibold text-gray-800">
            {convertedCac !== null
              ? fmt(Math.round(convertedCac), primaryCur)
              : d.cac > 0 ? fmt(d.cac, creative.currency) : '—'
            }
          </span>
          {cacTrendPct !== null && (
            <span className={`text-xs ml-1 font-medium ${cacTrendPct < 0 ? 'text-green-600' : 'text-red-500'}`}>
              {cacTrendPct < 0 ? '↓' : '↑'}{Math.abs(cacTrendPct).toFixed(0)}%
            </span>
          )}
        </div>
        {/* Show original value + rate used */}
        {convertedCac !== null && d.cac > 0 && (
          <div className="text-xs text-gray-300 leading-tight">
            {fmt(d.cac, creative.currency)} @ {rate}
          </div>
        )}
      </div>

      {/* ROAS */}
      <div className="w-16 text-right shrink-0 text-xs font-medium text-gray-700">
        {d.roas > 0 ? fmtRoas(d.roas) : '—'}
      </div>

      {/* Spend */}
      <div className="w-24 text-right shrink-0 text-xs text-gray-600">
        {fmt(d.spend, creative.currency)}
      </div>

      {/* Orders */}
      <div className="w-14 text-right shrink-0 text-xs text-gray-600">
        {d.purchases > 0 ? d.purchases.toLocaleString() : '—'}
      </div>

      {/* CTR */}
      <div className="w-12 text-right shrink-0 text-xs text-gray-500">
        {hasCtrData ? `${d.ctr.toFixed(1)}%` : <span className="text-gray-300">—</span>}
      </div>

      {/* Frequency */}
      <div className="w-12 text-right shrink-0 text-xs text-gray-500">
        {hasCtrData ? `${d.frequency.toFixed(1)}×` : <span className="text-gray-300">—</span>}
      </div>

      {/* Badges */}
      <div className="w-24 flex items-center justify-end gap-1 shrink-0">
        <span className={`badge ${style.bg} ${style.text} text-xs`}>{style.label}</span>
        {isFatiguing && <span className="badge bg-orange-100 text-orange-700 text-xs">Fatigue</span>}
      </div>
    </div>
  )
}

// ─── Sortable column header button ────────────────────────────────────────────

function ColHeader({
  label, col, active, dir, width, onClick,
}: {
  label: string; col: SortCol; active: boolean; dir: SortDir; width: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`${width} text-right shrink-0 text-xs uppercase tracking-wide flex items-center justify-end gap-0.5 hover:text-gray-700 transition-colors ${
        active ? 'text-gray-900 font-semibold' : 'text-gray-400 font-medium'
      }`}
    >
      {label}
      <span className={`text-xs ${active ? 'opacity-100' : 'opacity-0'}`}>
        {dir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface CreativesSectionProps {
  days: string[]
  creatives: CreativeData[]
  market: Market
  compact?: boolean
}

export default function CreativesSection({ days, creatives, market, compact }: CreativesSectionProps) {
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [activeDay, setActiveDay]   = useState(0)
  const [sortCol, setSortCol]       = useState<SortCol>('cac')
  const [sortDir, setSortDir]       = useState<SortDir>('asc')

  const dayKey = days[activeDay]

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'cac' ? 'asc' : 'desc') }
  }

  const sorted = useMemo(() => {
    const pool = platform === 'all' ? creatives : creatives.filter(c => c.platform === platform)
    return [...pool].sort((a, b) => {
      const av = getSortValue(a, sortCol, dayKey, market)
      const bv = getSortValue(b, sortCol, dayKey, market)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [creatives, platform, sortCol, sortDir, dayKey])

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-gray-900">Creative Performance</h2>
          <span className="badge bg-gray-100 text-gray-500 text-xs">{sorted.length} creatives</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Platform filter */}
          <div className="flex items-center gap-1">
            {PLATFORM_OPTIONS.map(p => (
              <button key={p.key} onClick={() => setPlatform(p.key)} className={`day-btn ${platform === p.key ? 'active' : ''}`}>
                {p.label}
              </button>
            ))}
          </div>

          <span className="w-px h-4 bg-gray-200" />

          {/* Day switcher — global for the whole table */}
          <div className="flex items-center gap-1">
            {days.map((_, i) => (
              <button key={i} onClick={() => setActiveDay(i)} className={`day-btn ${activeDay === i ? 'active' : ''}`}>
                {i === 0 ? 'Today' : i === 1 ? 'Yday' : `-${i}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-8">No creatives found for this filter</div>
      ) : (
        <>
          {/* Column headers — clicking sorts */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200">
            <div className="w-10 shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-gray-400 uppercase tracking-wide font-medium">Creative</div>
            <ColHeader label="CAC"    col="cac"    active={sortCol==='cac'}    dir={sortDir} width="w-28" onClick={() => handleSort('cac')}    />
            <ColHeader label="ROAS"   col="roas"   active={sortCol==='roas'}   dir={sortDir} width="w-16" onClick={() => handleSort('roas')}   />
            <ColHeader label="Spend"  col="spend"  active={sortCol==='spend'}  dir={sortDir} width="w-24" onClick={() => handleSort('spend')}  />
            <ColHeader label="Orders" col="orders" active={sortCol==='orders'} dir={sortDir} width="w-14" onClick={() => handleSort('orders')} />
            <ColHeader label="CTR"    col="ctr"    active={sortCol==='ctr'}    dir={sortDir} width="w-12" onClick={() => handleSort('ctr')}    />
            <div className="w-12 text-right shrink-0 text-xs text-gray-400 uppercase tracking-wide font-medium">Freq</div>
            <div className="w-24 shrink-0" />
          </div>

          {/* All creative rows */}
          <div>
            {sorted.map(c => (
              <CreativeRow key={c.id} creative={c} days={days} activeDay={activeDay} market={market} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
