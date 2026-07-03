'use client'

import { fmt } from '@/lib/utils'
import type { CleanupResponse, CleanupAd, MarketCleanup } from '@/app/api/cleanup/route'

const PLATFORM_BADGE: Record<string, string> = {
  facebook:   'bg-blue-50 text-blue-700',
  tiktok:     'bg-purple-50 text-purple-700',
  google_ads: 'bg-green-50 text-green-700',
}
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', tiktok: 'TikTok', google_ads: 'Google',
}
const PLATFORM_PLACEHOLDER: Record<string, string> = {
  facebook: 'bg-blue-50 text-blue-200', tiktok: 'bg-purple-50 text-purple-200', google_ads: 'bg-green-50 text-green-200',
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Single flagged ad row ────────────────────────────────────────────────────

function CleanupRow({ ad, currency }: { ad: CleanupAd; currency: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 hover:bg-red-50/30 transition-colors">

      {/* Thumbnail */}
      <div className="relative w-10 h-10 shrink-0 group/thumb rounded overflow-hidden">
        {ad.thumbnailUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ad.thumbnailUrl} alt="" className="w-10 h-10 object-cover" />
            <div className="absolute left-12 top-1/2 -translate-y-1/2 z-50 hidden group-hover/thumb:block pointer-events-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ad.thumbnailUrl} alt="" className="w-40 h-40 object-cover rounded-lg shadow-2xl border border-gray-200" />
            </div>
          </>
        ) : (
          <div className={`w-10 h-10 flex items-center justify-center text-sm font-bold rounded ${PLATFORM_PLACEHOLDER[ad.platform]}`}>
            {PLATFORM_LABEL[ad.platform].charAt(0)}
          </div>
        )}
      </div>

      {/* Name + account */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 truncate" title={ad.name}>{ad.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`badge text-xs ${PLATFORM_BADGE[ad.platform]}`}>{PLATFORM_LABEL[ad.platform]}</span>
          <span className="text-xs text-gray-400 truncate">{ad.accountName}</span>
        </div>
      </div>

      {/* 3-day CAC cells */}
      {ad.dayData.map((day, i) => (
        <div key={day.date} className="w-20 text-right shrink-0">
          <div className="text-xs font-medium text-red-600">
            {day.purchases === 0
              ? <span className="text-red-400 italic">0 orders</span>
              : fmt(Math.round(day.primaryCac), currency)
            }
          </div>
          {i === 0 && <div className="text-xs text-gray-300">{fmtDate(day.date)}</div>}
        </div>
      ))}

      {/* 3-day wasted spend */}
      <div className="w-24 text-right shrink-0">
        <div className="text-xs font-semibold text-red-700">{fmt(Math.round(ad.wastedSpend), currency)}</div>
        <div className="text-xs text-gray-300">3d spend</div>
      </div>
    </div>
  )
}

// ─── Per-market section ───────────────────────────────────────────────────────

function MarketSection({ block, checkedDates }: { block: MarketCleanup; checkedDates: string[] }) {
  if (block.flaggedAds.length === 0) return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100">
      <span className="text-sm font-medium text-gray-700">{block.flag} {block.marketName}</span>
      <span className="badge bg-green-50 text-green-700">✓ No cleanup needed</span>
    </div>
  )

  return (
    <div className="mb-6">
      {/* Market header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{block.flag} {block.marketName}</span>
          <span className="badge bg-red-100 text-red-700">{block.flaggedAds.length} ads</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-500">Wasted over 3 days: </span>
          <span className="text-sm font-semibold text-red-700">{fmt(Math.round(block.totalWastedSpend), block.primaryCurrency)}</span>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-3 py-1 text-xs text-gray-400 uppercase tracking-wide border-b border-gray-200">
        <div className="w-10 shrink-0" />
        <div className="flex-1 min-w-0">Ad</div>
        {checkedDates.map((d, i) => (
          <div key={d} className="w-20 text-right shrink-0">
            {i === 0 ? 'Yday CAC' : i === 1 ? '-2d CAC' : '-3d CAC'}
          </div>
        ))}
        <div className="w-24 text-right shrink-0">Wasted</div>
      </div>

      {block.flaggedAds.map(ad => (
        <CleanupRow key={ad.id} ad={ad} currency={block.primaryCurrency} />
      ))}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function CleanupSection({ data }: { data: CleanupResponse }) {
  const totalWasted = data.markets.map(m => ({
    currency: m.primaryCurrency,
    amount:   m.totalWastedSpend,
    name:     m.marketName,
    flag:     m.flag,
  }))

  const anyFlagged = data.totalFlagged > 0

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">

      {/* Summary banner */}
      <div className={`rounded-xl p-4 mb-6 ${anyFlagged ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
        {anyFlagged ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-red-800">
                ⚠ {data.totalFlagged} ads flagged for cleanup — consistently bad CAC for 3 days
              </div>
              <div className="text-xs text-red-600 mt-0.5">
                Checked: {data.checkedDates.map(fmtDate).join(' · ')} — only ads active on all 3 days are included
              </div>
            </div>
            <div className="flex gap-4">
              {totalWasted.filter(m => m.amount > 0).map(m => (
                <div key={m.currency} className="text-right">
                  <div className="text-xs text-red-500">{m.flag} {m.name}</div>
                  <div className="text-sm font-bold text-red-700">{fmt(Math.round(m.amount), m.currency)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm font-medium text-green-800">
            ✓ All ads across all markets are within acceptable CAC for the past 3 days
          </div>
        )}
      </div>

      {/* Per-market sections */}
      {data.markets.map(block => (
        <MarketSection key={block.market} block={block} checkedDates={data.checkedDates} />
      ))}

      <div className="text-xs text-gray-300 text-right mt-4">
        Fetched at {new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}
