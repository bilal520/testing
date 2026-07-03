'use client'

import { useState, useEffect, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RateWindow { delivered: number; returned: number; total: number; rate: number }
interface WeekRow { week: string; delivered: number; returned: number; total: number; rate: number }
interface CashRow {
  courier: string
  totalPaid: number
  deliveredOrderCount: number; deliveredCashPayable: number
  allOrderCount: number; allCashPayable: number
}
interface CprRegisterRow { courier: string; label: string; cprDate: string | null; orderCount: number; totalAmount: number }
interface AgingOrder { tracking: string; courier: string; city: string; daysOld: number; status: string; codAmount: number; attempts: number; lastMovement: string | null; daysSinceMovement: number | null }
interface AgingBucket { count: number; codValue: number; orders: AgingOrder[] }
interface CourierCityStat { shipped: number; delivered: number; returned: number; returnRate: number }
interface CityCompareRow {
  city: string; shipped: number; delivered: number; returned: number; returnRate: number; codAtRisk: number
  postex: CourierCityStat | null; leopards: CourierCityStat | null; worst: 'postex' | 'leopards' | null
}
interface ReasonRow { category: string; count: number; pct: number }
interface StolenLostOrder { tracking: string; courier: string; city: string; codAmount: number; status: string; daysOld: number; daysSinceMovement: number | null; attempts: number; signal: string }

interface IntelData {
  lastSynced: string | null
  summary: { total: number; delivered: number; returned: number; inTransit: number; postex: number; leopards: number }
  cashBalance: CashRow[]
  cprRegister: CprRegisterRow[]
  returnRate: {
    overall: Record<string, RateWindow>
    postex:  Record<string, RateWindow>
    leopards: Record<string, RateWindow>
    byBookingWeek: WeekRow[]
  }
  transitAging: Record<string, AgingBucket>
  returnByCity: { windowDays: number; cities: CityCompareRow[] }
  returnReasons: { windowDays: number; overall: ReasonRow[]; postex: ReasonRow[]; leopards: ReasonRow[] }
  stolenLost: { count: number; codAtRisk: number; orders: StolenLostOrder[] }
  bookingsByDay: Record<string, { postex: number; leopards: number }>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const pct = (n: number) => `${n.toFixed(1)}%`

function rateColor(rate: number) {
  if (rate <= 20) return 'text-emerald-600'
  if (rate <= 35) return 'text-amber-600'
  return 'text-red-600'
}
function rateBg(rate: number) {
  if (rate <= 20) return 'bg-emerald-50 border-emerald-200'
  if (rate <= 35) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

function SyncBanner({ lastSynced, onSync, syncing }: { lastSynced: string | null; onSync: () => void; syncing: boolean }) {
  const ago = lastSynced ? Math.round((Date.now() - new Date(lastSynced).getTime()) / 3_600_000) : null
  return (
    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5">
      <p className="text-xs text-slate-500">
        {ago === null ? 'Never synced — click Sync to pull data from PostEx & Leopards'
          : ago === 0 ? 'Synced less than an hour ago'
          : `Last synced ${ago}h ago`}
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
      >
        {syncing ? 'Syncing…' : '↺ Sync Now'}
      </button>
    </div>
  )
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'red' | 'green' | 'amber' }) {
  const col = highlight === 'red' ? 'text-red-700' : highlight === 'green' ? 'text-emerald-700' : highlight === 'amber' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${col}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Section: Cash Balance ──────────────────────────────────────────────────────

function CashBalanceSection({ data }: { data: IntelData }) {
  const totalDelivered = data.cashBalance.reduce((s, r) => s + r.deliveredCashPayable, 0)
  const totalAll       = data.cashBalance.reduce((s, r) => s + r.allCashPayable, 0)

  return (
    <div className="space-y-4">

      {/* Summary totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
          <p className="text-[11px] text-red-400 font-semibold uppercase tracking-wide mb-1">Delivered Cash Payable</p>
          <p className="text-xl font-bold text-red-700">{PKR(totalDelivered)}</p>
          <p className="text-[10px] text-red-400 mt-0.5">COD courier holds for you</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
          <p className="text-[11px] text-orange-400 font-semibold uppercase tracking-wide mb-1">All Cash Payable</p>
          <p className="text-xl font-bold text-orange-700">{PKR(totalAll)}</p>
          <p className="text-[10px] text-orange-400 mt-0.5">incl. in-transit orders</p>
        </div>
      </div>

      {/* Per-courier cards */}
      {data.cashBalance.map(row => (
        <div key={row.courier} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-slate-800 capitalize">{row.courier}</span>
            <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
              {PKR(row.totalPaid)} received
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide mb-1">Delivered Payable</p>
              <p className="text-base font-bold text-red-700">{PKR(row.deliveredCashPayable)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{row.deliveredOrderCount} delivered orders</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3">
              <p className="text-[10px] text-orange-400 font-semibold uppercase tracking-wide mb-1">All Payable</p>
              <p className="text-base font-bold text-orange-700">{PKR(row.allCashPayable)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{row.allOrderCount} active orders</p>
            </div>
          </div>
        </div>
      ))}

      {/* Module 6 — CPR Register (settlement batches) */}
      {data.cprRegister.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CPR Register — settlement batches</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Each batch the courier paid you. PostEx has no CPR number, so batches are keyed by settlement date.</p>
          </div>
          <div className="grid grid-cols-4 px-4 py-2 border-b border-slate-100">
            {['CPR / Date', 'Courier', 'Parcels', 'Amount'].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase">{h}</p>
            ))}
          </div>
          <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
            {data.cprRegister.map((c, i) => (
              <div key={`${c.courier}-${c.label}-${i}`} className="grid grid-cols-4 px-4 py-2 items-center">
                <p className="text-xs font-mono font-semibold text-slate-700 truncate">{c.label}</p>
                <p className="text-xs text-slate-500 capitalize">{c.courier}</p>
                <p className="text-xs text-slate-700">{c.orderCount}</p>
                <p className="text-xs font-bold text-emerald-700">{PKR(c.totalAmount)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Outstanding = delivered orders not yet settled. 90-day window by booking date. PostEx auto-settles via its payment API; upload Leopards CPRs via the Upload CPR tab.
      </p>
    </div>
  )
}

// ── Section: Return Rate ───────────────────────────────────────────────────────

function ReturnRateSection({ data }: { data: IntelData }) {
  const [window, setWindow] = useState<'7d' | '14d' | '30d'>('14d')

  const WINDOWS = ['7d', '14d', '30d'] as const
  const overall  = data.returnRate.overall[window]
  const postex   = data.returnRate.postex[window]
  const leopards = data.returnRate.leopards[window]

  function RateCard({ label, row }: { label: string; row: RateWindow }) {
    return (
      <div className={`rounded-xl border p-4 ${rateBg(row.rate)}`}>
        <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{label}</p>
        <p className={`text-3xl font-bold ${rateColor(row.rate)}`}>{pct(row.rate)}</p>
        <p className="text-xs text-slate-500 mt-1">
          {row.returned} returned / {row.total} closed
        </p>
        <p className="text-xs text-slate-400">{row.delivered} delivered</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Return Rate</h3>
          <p className="text-xs text-slate-400 mt-0.5">Closed parcels only (Delivered + Returned) — excludes in-transit</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg px-1 py-1">
          {WINDOWS.map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${window === w ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <RateCard label="Overall"  row={overall}  />
        <RateCard label="PostEx"   row={postex}   />
        <RateCard label="Leopards" row={leopards} />
      </div>

      {/* By booking-week cohort — shows the aging pattern */}
      {data.returnRate.byBookingWeek.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">By Booking Week (closed parcels)</p>
          </div>
          <div className="grid grid-cols-5 gap-0 px-4 py-2 border-b border-slate-100">
            {['Week', 'Delivered', 'Returned', 'Closed', 'Rate'].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase">{h}</p>
            ))}
          </div>
          <div className="divide-y divide-slate-50">
            {data.returnRate.byBookingWeek.map(w => (
              <div key={w.week} className="grid grid-cols-5 gap-0 px-4 py-2 items-center">
                <p className="text-xs font-mono text-slate-600">{w.week}</p>
                <p className="text-xs text-emerald-700 font-medium">{w.delivered}</p>
                <p className="text-xs text-red-700 font-medium">{w.returned}</p>
                <p className="text-xs text-slate-600">{w.total}</p>
                <p className={`text-xs font-bold ${rateColor(w.rate)}`}>{pct(w.rate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold text-emerald-700">Good: &lt;20%</span>
          &nbsp;·&nbsp;
          <span className="font-semibold text-amber-600">Watch: 20–35%</span>
          &nbsp;·&nbsp;
          <span className="font-semibold text-red-600">Bad: &gt;35%</span>
          &nbsp;— Pakistan D2C COD average is 25–35%. Target below 25%.
        </p>
      </div>
    </div>
  )
}

// ── Section: Transit Aging ─────────────────────────────────────────────────────

function TransitAgingSection({ data }: { data: IntelData }) {
  const [drill, setDrill] = useState<string | null>(null)
  const aging = data.transitAging

  const BUCKETS = [
    { key: 'fresh',    label: '1–3 days',  color: 'bg-emerald-100 text-emerald-800 border-emerald-200', badge: 'bg-emerald-500' },
    { key: 'watching', label: '4–5 days',  color: 'bg-amber-50 text-amber-800 border-amber-200',       badge: 'bg-amber-400'   },
    { key: 'stuck',    label: '6–7 days',  color: 'bg-orange-50 text-orange-800 border-orange-200',    badge: 'bg-orange-500'  },
    { key: 'critical', label: '8–10 days', color: 'bg-red-50 text-red-800 border-red-200',             badge: 'bg-red-500'     },
    { key: 'dead',     label: '11+ days',  color: 'bg-red-100 text-red-900 border-red-300',            badge: 'bg-red-700'     },
  ]

  const totalInTransit = Object.values(aging).reduce((s, b) => s + b.count, 0)
  const totalCOD       = Object.values(aging).reduce((s, b) => s + b.codValue, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">In-Transit Aging</h3>
          <p className="text-xs text-slate-400 mt-0.5">{totalInTransit} parcels · {PKR(totalCOD)} COD at risk</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-4">
        {BUCKETS.map(b => {
          const bucket = aging[b.key]
          return (
            <button
              key={b.key}
              onClick={() => bucket?.orders.length > 0 ? setDrill(drill === b.key ? null : b.key) : undefined}
              className={`rounded-xl border p-3 text-left transition-all ${b.color} ${bucket?.orders.length > 0 ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} ${drill === b.key ? 'ring-2 ring-slate-400' : ''}`}
            >
              <p className="text-[10px] font-bold mb-1">{b.label}</p>
              <p className="text-2xl font-bold">{bucket?.count ?? 0}</p>
              <p className="text-[10px] mt-1 opacity-70">{PKR(bucket?.codValue ?? 0)}</p>
              {bucket?.orders.length > 0 && <p className="text-[10px] mt-1 opacity-60">click to expand</p>}
            </button>
          )
        })}
      </div>

      {drill && aging[drill]?.orders.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">
              {BUCKETS.find(b => b.key === drill)?.label} — {aging[drill].orders.length} parcels shown
            </p>
            <button onClick={() => setDrill(null)} className="text-xs text-slate-400 hover:text-slate-700">✕ close</button>
          </div>
          <div className="divide-y divide-slate-50">
            {aging[drill].orders.map(o => (
              <div key={o.tracking} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-bold text-slate-700">{o.tracking}</p>
                  <p className="text-[11px] text-slate-400 truncate">{o.courier} · {o.city} · {o.status}</p>
                  <p className="text-[11px] text-slate-400">
                    {o.attempts > 0 && <span className="text-amber-600 font-semibold">{o.attempts} attempt{o.attempts > 1 ? 's' : ''}</span>}
                    {o.attempts > 0 && o.daysSinceMovement != null && ' · '}
                    {o.daysSinceMovement != null && <span className={o.daysSinceMovement > 10 ? 'text-red-600 font-semibold' : ''}>no movement {o.daysSinceMovement}d</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-800">{PKR(o.codAmount)}</p>
                  <p className="text-[11px] text-slate-400">{o.daysOld}d old</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section: Return by City ────────────────────────────────────────────────────

function CourierCityCell({ stat, worst }: { stat: CourierCityStat | null; worst: boolean }) {
  if (!stat) return <p className="text-xs text-slate-300">—</p>
  return (
    <div className={`text-xs ${worst ? 'font-bold' : ''}`}>
      <span className={rateColor(stat.returnRate)}>{pct(stat.returnRate)}</span>
      <span className="text-slate-400"> · {stat.shipped}</span>
      {worst && <span className="ml-1 text-[9px] text-red-600 font-bold align-middle">WORSE</span>}
    </div>
  )
}

function ReturnByCitySection({ data }: { data: IntelData }) {
  const [sort,  setSort]  = useState<'shipped' | 'returnRate' | 'codAtRisk'>('shipped')
  const [query, setQuery] = useState('')

  const all  = data.returnByCity.cities ?? []
  const rows = all
    .filter(r => r.city.toLowerCase().includes(query.trim().toLowerCase()))
    .slice()
    .sort((a, b) => b[sort] - a[sort])
  const maxShipped = Math.max(1, ...all.map(r => r.shipped))

  const SORTS = [
    { id: 'shipped',    label: 'Volume'      },
    { id: 'returnRate', label: 'Return rate' },
    { id: 'codAtRisk',  label: 'COD at risk' },
  ] as const
  const GRID = 'grid grid-cols-[1.6fr_0.7fr_0.8fr_1fr_1fr_1fr] gap-0'

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Return Rate by City</h3>
          <p className="text-xs text-slate-400 mt-0.5">Last {data.returnByCity.windowDays} days by ship date · closed parcels · min 3 shipped · PostEx vs Leopards</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg px-1 py-1">
          {SORTS.map(s => (
            <button key={s.id} onClick={() => setSort(s.id)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${sort === s.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search city…"
        className="w-full mb-3 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-200"
      />

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{all.length === 0 ? 'No city data yet — sync first' : 'No cities match your search'}</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className={`${GRID} px-4 py-2 bg-slate-50 border-b border-slate-200`}>
            {['City', 'Shipped', 'Return %', 'PostEx %·n', 'Leopards %·n', 'COD at Risk'].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase">{h}</p>
            ))}
          </div>
          <div className="divide-y divide-slate-50 max-h-[32rem] overflow-y-auto">
            {rows.map(row => (
              <div key={row.city} className={`${GRID} px-4 py-2.5 hover:bg-slate-50 items-center`}>
                <div className="min-w-0 pr-2">
                  <p className="text-sm font-medium text-slate-800 truncate">{row.city}</p>
                  <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-400 rounded-full" style={{ width: `${Math.round((row.shipped / maxShipped) * 100)}%` }} />
                  </div>
                </div>
                <p className="text-sm text-slate-700">{row.shipped}</p>
                <p className={`text-sm font-bold ${rateColor(row.returnRate)}`}>{pct(row.returnRate)}</p>
                <CourierCityCell stat={row.postex}   worst={row.worst === 'postex'} />
                <CourierCityCell stat={row.leopards} worst={row.worst === 'leopards'} />
                <p className="text-xs text-slate-600">{row.codAtRisk > 0 ? PKR(row.codAtRisk) : '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3">
        Each courier cell = <span className="font-semibold">return% · parcels shipped</span>.{' '}
        <span className="text-red-600 font-bold">WORSE</span> flags the courier with a materially higher
        return rate (≥10 pts) in that city, where both shipped enough to compare fairly — a signal to route
        that city&apos;s orders to the other courier.
      </p>
    </div>
  )
}

// ── Section: Return Reasons ────────────────────────────────────────────────────

function ReturnReasonsSection({ data }: { data: IntelData }) {
  const [courier, setCourier] = useState<'overall' | 'postex' | 'leopards'>('overall')
  const rows     = data.returnReasons[courier] ?? []
  const maxCount = rows[0]?.count ?? 1
  const total    = rows.reduce((s, r) => s + r.count, 0)

  const COLOR_MAP: Record<string, string> = {
    'Not Reachable':       'bg-amber-400',
    'Customer Refused':    'bg-red-500',
    'Address Issue':       'bg-orange-400',
    'Not Available':       'bg-yellow-400',
    'Wants to Open First': 'bg-pink-500',
    'Payment Not Ready':   'bg-rose-400',
    'Rescheduled / Hold':  'bg-teal-400',
    'Damaged':             'bg-purple-500',
    'Courier Fault':       'bg-blue-500',
    'No Reason Given':     'bg-slate-300',
    'Other':               'bg-slate-400',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Return Reasons</h3>
          <p className="text-xs text-slate-400 mt-0.5">Last {data.returnReasons.windowDays} days · {total} returns · auto-classified from courier tracking</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg px-1 py-1">
          {(['overall', 'postex', 'leopards'] as const).map(c => (
            <button key={c} onClick={() => setCourier(c)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md capitalize transition-colors ${courier === c ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No return reason data yet</p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.category} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-medium text-slate-800">{row.category}</p>
                  <p className="text-sm font-bold text-slate-700">{row.count} <span className="text-xs text-slate-400 font-normal">({pct(row.pct)})</span></p>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${COLOR_MAP[row.category] ?? 'bg-slate-400'}`}
                    style={{ width: `${Math.round((row.count / maxCount) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && rows.find(r => r.category === 'No Reason Given') && (
        <p className="text-[11px] text-slate-400 mt-3">
          &quot;No Reason Given&quot; = the courier returned the parcel without a real failure reason
          (Leopards often records only who took the handover, e.g. &quot;SELF&quot;). A high share here is
          itself a courier-negligence signal — Leopards rarely tells us <em>why</em> a parcel failed, so
          check PostEx for the true reason mix.
        </p>
      )}
    </div>
  )
}

// ── Section: Stolen / Lost ─────────────────────────────────────────────────────

function StolenLostSection({ data }: { data: IntelData }) {
  const { count, codAtRisk, orders } = data.stolenLost
  const [copied, setCopied] = useState(false)

  function copyTrackings() {
    navigator.clipboard.writeText(orders.map(o => o.tracking).join('\n')).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Stolen / Lost — Escalation Required</h3>
          <p className="text-xs text-slate-400 mt-0.5">{count} parcels · {PKR(codAtRisk)} COD at risk</p>
        </div>
        {orders.length > 0 && (
          <button onClick={copyTrackings} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors">
            {copied ? '✓ Copied' : 'Copy tracking #s'}
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <p className="text-sm text-emerald-700 font-medium">✓ Nothing flagged — no stuck, expired, or unpaid-delivered parcels.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-50">
            {orders.map(o => (
              <div key={o.tracking} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-bold text-slate-700">{o.tracking}</p>
                  <p className="text-[11px] text-slate-400 truncate">{o.courier} · {o.city} · {o.status}</p>
                  <p className="text-[11px] text-red-600 font-semibold">{o.signal}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-800">{PKR(o.codAmount)}</p>
                  <p className="text-[11px] text-slate-400">{o.daysOld}d old{o.attempts > 0 ? ` · ${o.attempts} att` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section: Dispatch Reconciliation ──────────────────────────────────────────

interface DispatchRow { date: string; courier: string; dispatched: number | null; booked: number; variance: number | null }

function DispatchSection() {
  const today = new Date().toISOString().slice(0, 10)
  const [rows,    setRows]    = useState<DispatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [date,    setDate]    = useState(today)
  const [courier, setCourier] = useState<'postex' | 'leopards'>('postex')
  const [count,   setCount]   = useState('')
  const [saving,  setSaving]  = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/courier/dispatch?days=14')
      .then(r => r.json())
      .then(d => setRows(d.rows ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function save() {
    if (count === '' || isNaN(Number(count))) return
    setSaving(true)
    try {
      await fetch('/api/courier/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, courier, count: Number(count) }),
      })
      setCount('')
      load()
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-800">Dispatch Reconciliation</h3>
        <p className="text-xs text-slate-400 mt-0.5">Enter parcels handed to the rider each day. Variance = dispatched − booked-in-system (leakage).</p>
      </div>

      {/* Manual input */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Date</label>
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Courier</label>
          <select value={courier} onChange={e => setCourier(e.target.value as 'postex' | 'leopards')}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 capitalize">
            <option value="postex">PostEx</option>
            <option value="leopards">Leopards</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Dispatched count</label>
          <input type="number" min={0} value={count} onChange={e => setCount(e.target.value)} placeholder="e.g. 120"
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28" />
        </div>
        <button onClick={save} disabled={saving || count === ''}
          className="text-xs bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No dispatch data yet — enter today&apos;s count above.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-5 px-4 py-2 bg-slate-50 border-b border-slate-200">
            {['Date', 'Courier', 'Dispatched', 'Booked', 'Variance'].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase">{h}</p>
            ))}
          </div>
          <div className="divide-y divide-slate-50">
            {rows.map(r => {
              const flag = r.variance != null && Math.abs(r.variance) > 2
              return (
                <div key={`${r.date}:${r.courier}`} className="grid grid-cols-5 px-4 py-2.5 hover:bg-slate-50 items-center">
                  <p className="text-xs text-slate-600">{r.date}</p>
                  <p className="text-xs font-medium text-slate-800 capitalize">{r.courier}</p>
                  <p className="text-xs text-slate-700">{r.dispatched ?? '—'}</p>
                  <p className="text-xs text-slate-700">{r.booked}</p>
                  <p className={`text-xs font-bold ${r.variance == null ? 'text-slate-300' : flag ? 'text-red-600' : 'text-emerald-600'}`}>
                    {r.variance == null ? '—' : r.variance > 0 ? `+${r.variance}` : r.variance}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-3">A positive variance means more parcels were handed over than entered in the courier system — flag red if &gt; 2 (courier may claim they never received them).</p>
    </div>
  )
}

// ── Section: CPR Upload ────────────────────────────────────────────────────────

interface UploadResult {
  found:     number
  settled:   number
  cprNumber: string | null
  cprDate:   string | null
  message:   string
  error?:    string
}

interface CprHistoryRow {
  courier:       string
  cprNumber:     string
  cprDate:       string | null
  ordersSettled: number
}

function CprUploadSection({ onSettled }: { onSettled: () => void }) {
  const [courier,   setCourier]   = useState<'postex' | 'leopards'>('postex')
  const [file,      setFile]      = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result,    setResult]    = useState<UploadResult | null>(null)
  const [history,   setHistory]   = useState<CprHistoryRow[]>([])
  const [histLoading, setHistLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  function loadHistory() {
    setHistLoading(true)
    fetch('/api/courier/cpr-upload')
      .then(r => r.json())
      .then(d => setHistory(d.history ?? []))
      .catch(() => {})
      .finally(() => setHistLoading(false))
  }

  useEffect(() => { loadHistory() }, [])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('courier', courier)
    try {
      const res = await fetch('/api/courier/cpr-upload', { method: 'POST', body: fd })
      const data = await res.json() as UploadResult
      setResult(data)
      if (data.settled > 0) {
        onSettled()
        loadHistory()
      }
    } catch (e) {
      setResult({ error: String(e), found: 0, settled: 0, cprNumber: null, cprDate: null, message: '' })
    } finally {
      setUploading(false)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const courierLabel = courier === 'postex' ? 'PostEx' : 'Leopards'

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Upload CPR</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Upload a CPR PDF from PostEx or Leopards. Orders found in the PDF are marked as settled and removed from the outstanding balance.
        </p>
      </div>

      {/* Courier selector */}
      <div className="flex gap-2">
        {(['postex', 'leopards'] as const).map(c => (
          <button
            key={c}
            onClick={() => { setCourier(c); setResult(null) }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors capitalize ${
              courier === c
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            {c === 'postex' ? 'PostEx' : 'Leopards'}
          </button>
        ))}
      </div>

      {/* File picker */}
      <label
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
          file
            ? 'border-emerald-400 bg-emerald-50'
            : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
        />
        {file ? (
          <>
            <p className="text-2xl">📄</p>
            <p className="text-sm font-semibold text-emerald-700 text-center break-all">{file.name}</p>
            <p className="text-xs text-emerald-500">{(file.size / 1024).toFixed(0)} KB · click to change</p>
          </>
        ) : (
          <>
            <p className="text-2xl">📄</p>
            <p className="text-sm font-medium text-slate-600">Click to select {courierLabel} CPR PDF</p>
            <p className="text-xs text-slate-400">PDF files only</p>
          </>
        )}
      </label>

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="w-full bg-slate-900 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-700 disabled:opacity-40 transition-colors"
      >
        {uploading ? 'Processing PDF…' : `Process ${courierLabel} CPR`}
      </button>

      {/* Result */}
      {result && (
        <div className={`rounded-xl border p-4 ${
          result.error ? 'bg-red-50 border-red-200'
            : result.settled === 0 ? 'bg-amber-50 border-amber-200'
            : 'bg-emerald-50 border-emerald-200'
        }`}>
          {result.error ? (
            <p className="text-sm text-red-700">{result.error}</p>
          ) : (
            <>
              <p className={`text-sm font-semibold ${result.settled > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {result.message}
              </p>
              {(result.cprNumber || result.cprDate) && (
                <p className="text-xs text-slate-500 mt-1.5">
                  {result.cprNumber && <><span className="font-semibold">CPR:</span> <span className="font-mono">{result.cprNumber}</span></>}
                  {result.cprNumber && result.cprDate && ' · '}
                  {result.cprDate && <><span className="font-semibold">Date:</span> {result.cprDate}</>}
                </p>
              )}
              {result.settled > 0 && (
                <p className="text-xs text-emerald-600 mt-1.5">
                  Cash balance refreshed automatically.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Persistent CPR upload history */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Upload History</p>
        {histLoading ? (
          <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No CPRs uploaded yet</p>
        ) : (
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono font-bold text-slate-700">{h.cprNumber}</p>
                  <p className="text-[11px] text-slate-400 capitalize">{h.courier} · {h.cprDate ?? 'No date'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-700">{h.ordersSettled} orders</p>
                  <p className="text-[11px] text-slate-400">settled</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">How it works</p>
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">PostEx</span> — upload the PDF from the CPR email (e.g. CPR-GY8H9505444.pdf). Tracking numbers (14-digit) are extracted and matched. PostEx sends CPRs twice weekly (Tue / Fri).
        </p>
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Leopards</span> — upload the CASH invoice PDF (e.g. CASH3229259). CN numbers (e.g. KI7534780976) are extracted and matched. Leopards issues these irregularly.
        </p>
        <p className="text-xs text-slate-400 pt-1">
          Outstanding balance = delivered orders in last 90 days not yet in any uploaded CPR.
        </p>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type SectionId = 'cash' | 'returns' | 'aging' | 'cities' | 'reasons' | 'dispatch' | 'cpr' | 'stolen'

export default function CourierIntelligenceTab() {
  const [data,    setData]    = useState<IntelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [section, setSection] = useState<SectionId>('cash')

  function loadData() {
    setLoading(true)
    setError(null)
    fetch('/api/courier/intelligence')
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      // Trigger via the kick endpoint (which adds the auth header server-side)
      const res = await fetch('/api/courier/kick-sync', { method: 'POST' })
      const d   = await res.json()
      if (d.ok) loadData()
      else setError(d.error ?? JSON.stringify(d))
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }

  const SECTIONS: Array<{ id: SectionId; label: string }> = [
    { id: 'cash',     label: '💰 Cash Balance' },
    { id: 'cpr',      label: '📋 Upload CPR'   },
    { id: 'returns',  label: '📉 Return Rate'  },
    { id: 'aging',    label: '⏱ Transit Aging' },
    { id: 'cities',   label: '🗺 By City'       },
    { id: 'reasons',  label: '❓ Reasons'       },
    { id: 'stolen',   label: '🚨 Stolen/Lost'  },
    { id: 'dispatch', label: '📦 Dispatch'      },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">🇵🇰 Courier Intelligence</h2>
          <p className="text-xs text-slate-400 mt-0.5">PostEx + Leopards · Cash, returns, transit, leakage</p>
        </div>
      </div>

      {/* Sync banner */}
      <SyncBanner lastSynced={data?.lastSynced ?? null} onSync={handleSync} syncing={syncing} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
          <p className="text-sm font-semibold text-red-700 mb-1">Error</p>
          <p className="text-xs text-red-600 break-all">{error}</p>
          {error.includes('not configured') && (
            <p className="text-xs text-red-500 mt-2">
              Add <code className="bg-red-100 px-1 rounded">POSTEX_TOKEN</code>,{' '}
              <code className="bg-red-100 px-1 rounded">LEOPARDS_API_KEY</code>, and{' '}
              <code className="bg-red-100 px-1 rounded">LEOPARDS_API_PASSWORD</code> to your environment variables.
            </p>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading courier data…</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
            <StatCard label="Total (75d)"  value={data.summary.total.toLocaleString()} />
            <StatCard label="Delivered"    value={data.summary.delivered.toLocaleString()} highlight="green" />
            <StatCard label="Returned"     value={data.summary.returned.toLocaleString()} highlight="red" />
            <StatCard label="In Transit"   value={data.summary.inTransit.toLocaleString()} highlight="amber" />
            <StatCard label="PostEx"       value={data.summary.postex.toLocaleString()} />
            <StatCard label="Leopards"     value={data.summary.leopards.toLocaleString()} />
          </div>

          {/* Section tabs */}
          <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl px-1 py-1 mb-5 w-fit">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${section === s.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Section content */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-4">
                <div className="w-3 h-3 border border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                Refreshing…
              </div>
            )}
            {section === 'cash'     && <CashBalanceSection     data={data} />}
            {section === 'cpr'      && <CprUploadSection       onSettled={loadData} />}
            {section === 'returns'  && <ReturnRateSection      data={data} />}
            {section === 'aging'    && <TransitAgingSection    data={data} />}
            {section === 'cities'   && <ReturnByCitySection    data={data} />}
            {section === 'reasons'  && <ReturnReasonsSection   data={data} />}
            {section === 'stolen'   && <StolenLostSection      data={data} />}
            {section === 'dispatch' && <DispatchSection />}
          </div>
        </>
      )}
    </div>
  )
}
