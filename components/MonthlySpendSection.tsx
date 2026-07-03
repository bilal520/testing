import type { MonthlyData, PlatformSpend } from '@/app/api/monthly/route'
import { fmt } from '@/lib/utils'

const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', tiktok: 'TikTok', google_ads: 'Google Ads',
}
const PLATFORM_COLOR: Record<string, string> = {
  facebook:   'bg-blue-50 text-blue-700',
  tiktok:     'bg-purple-50 text-purple-700',
  google_ads: 'bg-green-50 text-green-700',
}

function pct(now: number, prev: number): number | null {
  if (prev === 0) return null
  return ((now - prev) / prev) * 100
}

function SpendRow({
  label, thisPeriod, lastPeriod, currency, badge, bold,
}: {
  label: string
  thisPeriod: number
  lastPeriod: number
  currency: string
  badge?: string
  bold?: boolean
}) {
  const change = pct(thisPeriod, lastPeriod)
  const up     = change !== null && change > 0

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 ${bold ? 'border-t border-gray-200 mt-1 pt-3' : ''}`}>
      {/* Label */}
      <div className="w-28 shrink-0 flex items-center gap-1.5">
        {badge && <span className={`badge text-xs ${badge}`}>{label}</span>}
        {!badge && <span className={`text-xs ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>}
      </div>

      {/* This period */}
      <div className="flex-1 text-right">
        <span className={`text-xs ${bold ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
          {fmt(Math.round(thisPeriod), currency)}
        </span>
      </div>

      {/* Last period */}
      <div className="flex-1 text-right">
        <span className="text-xs text-gray-400">
          {fmt(Math.round(lastPeriod), currency)}
        </span>
      </div>

      {/* Change */}
      <div className="w-16 text-right shrink-0">
        {change === null ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <span className={`text-xs font-medium ${up ? 'text-red-500' : 'text-green-600'}`}>
            {up ? '↑' : '↓'}{Math.abs(change).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  )
}

export default function MonthlySpendSection({ data }: { data: MonthlyData }) {
  const hasAny = data.total.thisPeriod > 0 || data.total.lastPeriod > 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-gray-900">Monthly Spend</h2>
        <span className="text-xs text-gray-400">all amounts in {data.currency}</span>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-0 pb-1 mb-1 border-b border-gray-200">
        <div className="w-28 shrink-0" />
        <div className="flex-1 text-right text-xs font-medium text-gray-700">{data.thisLabel}</div>
        <div className="flex-1 text-right text-xs text-gray-400">{data.lastLabel}</div>
        <div className="w-16 text-right text-xs text-gray-400 shrink-0">vs last</div>
      </div>

      {!hasAny ? (
        <div className="text-xs text-gray-400 text-center py-4">No spend data available</div>
      ) : (
        <div>
          {data.platforms.map((p: PlatformSpend) => (
            <SpendRow
              key={p.platform}
              label={PLATFORM_LABEL[p.platform]}
              thisPeriod={p.thisPeriod}
              lastPeriod={p.lastPeriod}
              currency={data.currency}
              badge={PLATFORM_COLOR[p.platform]}
            />
          ))}
          <SpendRow
            label="Total"
            thisPeriod={data.total.thisPeriod}
            lastPeriod={data.total.lastPeriod}
            currency={data.currency}
            bold
          />
        </div>
      )}
    </div>
  )
}
