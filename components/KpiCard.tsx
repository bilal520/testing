'use client'

import { useState } from 'react'
import { CAC_STYLES, fmt, fmtRoas } from '@/lib/utils'
import type { CacRating } from '@/lib/accounts'

interface DayData {
  spend: number; purchases: number; cac: number; roas: number; aov: number; revenue: number
}

interface KpiCardProps {
  label: string
  metric: 'cac' | 'roas' | 'aov' | 'spend' | 'orders' | 'revenue'
  days: string[]
  data: Record<string, DayData>
  currency: string
  cacRatingFn?: (cac: number) => CacRating
}

// For these metrics, a higher value is better (green ↑ / red ↓)
const HIGHER_IS_BETTER = new Set(['roas', 'aov', 'spend', 'orders', 'revenue'])

function getRaw(d: DayData, metric: KpiCardProps['metric']): number {
  switch (metric) {
    case 'cac':     return d.cac
    case 'roas':    return d.roas
    case 'aov':     return d.aov
    case 'spend':   return d.spend
    case 'orders':  return d.purchases
    case 'revenue': return d.revenue
  }
}

export default function KpiCard({ label, metric, days, data, currency, cacRatingFn }: KpiCardProps) {
  const [activeDay, setActiveDay] = useState(0)

  const dayKey  = days[activeDay]
  const prevKey = days[activeDay + 1]
  const d    = data[dayKey]  ?? { spend: 0, purchases: 0, cac: 0, roas: 0, aov: 0, revenue: 0 }
  const prev = prevKey ? (data[prevKey] ?? null) : null

  const curr    = getRaw(d, metric)
  const prevVal = prev ? getRaw(prev, metric) : null
  const pct     = (prevVal && prevVal > 0) ? ((curr - prevVal) / prevVal) * 100 : null

  const isImprovement = pct !== null
    ? (HIGHER_IS_BETTER.has(metric) ? pct > 0 : pct < 0)
    : false

  const cacRating = metric === 'cac' && cacRatingFn ? cacRatingFn(d.cac) : null
  const style = cacRating ? CAC_STYLES[cacRating] : null

  const getDisplay = () => {
    switch (metric) {
      case 'cac':     return d.cac > 0 ? fmt(d.cac, currency) : '—'
      case 'roas':    return d.roas > 0 ? fmtRoas(d.roas) : '—'
      case 'aov':     return d.aov > 0 ? fmt(d.aov, currency) : '—'
      case 'spend':   return fmt(d.spend, currency)
      case 'orders':  return d.purchases > 0 ? d.purchases.toLocaleString() : '—'
      case 'revenue': return d.revenue > 0 ? fmt(d.revenue, currency) : '—'
    }
  }

  return (
    <div className="card p-4">
      <div className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">{label}</div>

      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-2xl font-medium text-gray-900 leading-tight">{getDisplay()}</div>
        {pct !== null && Math.abs(pct) >= 1 && (
          <span className={`text-xs font-medium ${isImprovement ? 'text-green-600' : 'text-red-500'}`}>
            {pct > 0 ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
          </span>
        )}
      </div>

      {style && (
        <span className={`badge ${style.bg} ${style.text} mb-2`}>{style.label}</span>
      )}

      {pct !== null && Math.abs(pct) >= 1 && (
        <div className="text-xs text-gray-400 mb-1">vs previous day</div>
      )}

      <div className="flex gap-1 mt-auto pt-1">
        {days.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveDay(i)}
            className={`day-btn ${activeDay === i ? 'active' : ''}`}
          >
            {i === 0 ? 'Today' : i === 1 ? 'Yday' : `-${i}d`}
          </button>
        ))}
      </div>
    </div>
  )
}
