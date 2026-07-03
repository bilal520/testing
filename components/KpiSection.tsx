'use client'

import { useState } from 'react'
import KpiCard from './KpiCard'
import { MARKETS, getCacRating, DAY_LABELS } from '@/lib/accounts'
import { fmt, fmtRoas } from '@/lib/utils'
import type { Market } from '@/lib/accounts'

interface DayData {
  spend: number; purchases: number; cac: number; roas: number; aov: number; revenue: number
}

interface AccountData {
  name: string; platform: string; currency: string
  days: Record<string, DayData>
}

interface KpiSectionProps {
  market: Market
  days: string[]
  cumulative: Record<string, DayData>
  byAccount: Record<string, AccountData>
}

export default function KpiSection({ market, days, cumulative, byAccount }: KpiSectionProps) {
  const [showAccounts, setShowAccounts] = useState(false)
  const [dayIdx, setDayIdx] = useState(0)
  const config = MARKETS[market]

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">
        Key metrics — all accounts combined
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard label="CAC" metric="cac" days={days} data={cumulative} currency={config.primaryCurrency}
          cacRatingFn={(cac) => getCacRating(cac, market)} />
        <KpiCard label="ROAS" metric="roas" days={days} data={cumulative} currency={config.primaryCurrency} />
        <KpiCard label="AOV" metric="aov" days={days} data={cumulative} currency={config.primaryCurrency} />
        <KpiCard label="Spend" metric="spend" days={days} data={cumulative} currency={config.primaryCurrency} />
        <KpiCard label="Orders" metric="orders" days={days} data={cumulative} currency={config.primaryCurrency} />
        <KpiCard label="Revenue" metric="revenue" days={days} data={cumulative} currency={config.primaryCurrency} />
      </div>

      <button
        onClick={() => setShowAccounts(v => !v)}
        className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-3"
      >
        <span>{showAccounts ? '▾' : '▸'}</span>
        {showAccounts ? 'Hide' : 'Show'} breakdown by ad account
      </button>

      {showAccounts && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            {days.map((_, i) => (
              <button
                key={i}
                onClick={() => setDayIdx(i)}
                className={`day-btn ${dayIdx === i ? 'active' : ''}`}
              >
                {i === 0 ? 'Today' : i === 1 ? 'Yday' : `-${i}d`}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left py-2 pr-4 font-medium">Account</th>
                  <th className="text-left py-2 pr-4 font-medium">Platform</th>
                  <th className="text-right py-2 pr-4 font-medium">Spend ({DAY_LABELS[dayIdx]})</th>
                  <th className="text-right py-2 pr-4 font-medium">Orders</th>
                  <th className="text-right py-2 pr-4 font-medium">CAC</th>
                  <th className="text-right py-2 font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byAccount).map(([id, acct]) => {
                  const sel = acct.days[days[dayIdx]] ?? { spend: 0, purchases: 0, cac: 0, roas: 0, aov: 0, revenue: 0 }
                  return (
                    <tr key={id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-800">{acct.name}</td>
                      <td className="py-2 pr-4">
                        <span className={`badge text-xs ${
                          acct.platform === 'facebook' ? 'bg-blue-50 text-blue-700' :
                          acct.platform === 'tiktok'   ? 'bg-purple-50 text-purple-700' :
                                                         'bg-green-50 text-green-700'
                        }`}>
                          {acct.platform === 'google_ads' ? 'Google' : acct.platform.charAt(0).toUpperCase() + acct.platform.slice(1)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-700">{fmt(sel.spend, acct.currency)}</td>
                      <td className="py-2 pr-4 text-right text-gray-700">{sel.purchases.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-gray-700">{sel.cac > 0 ? fmt(sel.cac, acct.currency) : '—'}</td>
                      <td className="py-2 text-right text-gray-700">{sel.roas > 0 ? fmtRoas(sel.roas) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
