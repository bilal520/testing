'use client'

import { useState, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

type Period  = 'today' | 'yesterday' | '7d' | '30d'
type Section = 'products' | 'geography' | 'discounts' | 'bundles' | 'pages'

interface SkuRow    { title: string; sku: string; qty: number; revenue: number; orderCount: number }
interface CityRow   { city: string; orders: number; revenue: number }
interface DiscRow   { code: string; uses: number; revenue: number; saved: number }
interface BundleRow { combo: string; count: number }
interface LandRow   { path: string; count: number }

interface IntelData {
  period: string
  totalOrders: number; totalRevenue: number; totalCustomers: number
  avgOrderValue: number
  // Shopify Analytics exact numbers
  grossRevenue?: number
  returningCustomers?: number; returningCustomerRate?: number
  sessions?: number; conversionRate?: number
  // Legacy / fallback
  repeatBuyers: number; repeatRate: number
  multiItemOrders: number; bundleRate: number
  topSKUsByQty: SkuRow[]; topSKUsByRevenue: SkuRow[]
  topCitiesByOrders: CityRow[]; topCitiesByRevenue: CityRow[]
  topDiscounts: DiscRow[]
  topBundles: BundleRow[]
  repeatProducts: SkuRow[]
  topLanding: LandRow[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const compact = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(0)}k` : String(Math.round(n))

function Bar({ value, max, color = 'bg-slate-800' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-400 w-7 text-right shrink-0">{pct}%</span>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function SectionTab({ id, label, active, onClick }: { id: Section; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}>
      {label}
    </button>
  )
}

function RankRow({ rank, label, sub, value, valueSub, bar, barMax, barColor }:
  { rank: number; label: string; sub?: string; value: string; valueSub?: string; bar: number; barMax: number; barColor?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-[11px] font-bold text-slate-300 w-5 shrink-0 pt-0.5">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{label}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
        <div className="mt-1.5">
          <Bar value={bar} max={barMax} color={barColor} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-slate-900">{value}</p>
        {valueSub && <p className="text-[11px] text-slate-400">{valueSub}</p>}
      </div>
    </div>
  )
}

// ── Section panels ─────────────────────────────────────────────────────────────

function ProductsPanel({ data }: { data: IntelData }) {
  const [sort, setSort] = useState<'qty' | 'revenue'>('qty')
  const rows = sort === 'qty' ? data.topSKUsByQty : data.topSKUsByRevenue
  const maxQ = rows[0]?.qty ?? 1
  const maxR = rows[0]?.revenue ?? 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Top Products</h3>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button onClick={() => setSort('qty')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${sort === 'qty' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            By Units
          </button>
          <button onClick={() => setSort('revenue')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${sort === 'revenue' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            By Revenue
          </button>
        </div>
      </div>
      <div>
        {rows.map((r, i) => (
          <RankRow key={r.sku || r.title} rank={i + 1}
            label={r.title}
            sub={r.sku ? `SKU: ${r.sku}` : undefined}
            value={sort === 'qty' ? `${r.qty} units` : `PKR ${compact(r.revenue)}`}
            valueSub={sort === 'qty' ? `PKR ${compact(r.revenue)}` : `${r.qty} units`}
            bar={sort === 'qty' ? r.qty : r.revenue}
            barMax={sort === 'qty' ? maxQ : maxR}
            barColor="bg-slate-700"
          />
        ))}
      </div>

      {data.repeatProducts.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-slate-700 mb-1">Repeat-Order Products</h3>
          <p className="text-xs text-slate-400 mb-3">Products ordered by customers who have purchased more than once</p>
          <div>
            {data.repeatProducts.map((r, i) => (
              <RankRow key={r.sku || r.title} rank={i + 1}
                label={r.title}
                value={`${r.orderCount} orders`}
                valueSub={`${r.qty} units`}
                bar={r.orderCount}
                barMax={data.repeatProducts[0]?.orderCount ?? 1}
                barColor="bg-green-500"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GeographyPanel({ data }: { data: IntelData }) {
  const [sort, setSort] = useState<'orders' | 'revenue'>('orders')
  const rows  = sort === 'orders' ? data.topCitiesByOrders : data.topCitiesByRevenue
  const maxO  = data.topCitiesByOrders[0]?.orders ?? 1
  const maxR  = data.topCitiesByRevenue[0]?.revenue ?? 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Top Cities</h3>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button onClick={() => setSort('orders')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${sort === 'orders' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            By Orders
          </button>
          <button onClick={() => setSort('revenue')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${sort === 'revenue' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            By Revenue
          </button>
        </div>
      </div>
      <div>
        {rows.map((r, i) => (
          <RankRow key={r.city} rank={i + 1}
            label={r.city}
            value={sort === 'orders' ? `${r.orders} orders` : `PKR ${compact(r.revenue)}`}
            valueSub={sort === 'orders' ? `PKR ${compact(r.revenue)}` : `${r.orders} orders`}
            bar={sort === 'orders' ? r.orders : r.revenue}
            barMax={sort === 'orders' ? maxO : maxR}
            barColor="bg-blue-500"
          />
        ))}
      </div>
    </div>
  )
}

function DiscountsPanel({ data }: { data: IntelData }) {
  const max = data.topDiscounts[0]?.uses ?? 1
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Discount Code Performance</h3>
        <span className="text-xs text-slate-400">{data.topDiscounts.length} codes used</span>
      </div>
      {data.topDiscounts.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No discount codes used in this period</p>
      ) : (
        <div>
          {data.topDiscounts.map((r, i) => (
            <RankRow key={r.code} rank={i + 1}
              label={r.code}
              sub={`Avg discount: PKR ${Math.round(r.uses > 0 ? r.saved / r.uses : 0).toLocaleString()}`}
              value={`${r.uses} uses`}
              valueSub={`PKR ${compact(r.revenue)} rev`}
              bar={r.uses} barMax={max}
              barColor="bg-amber-500"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BundlesPanel({ data }: { data: IntelData }) {
  const max = data.topBundles[0]?.count ?? 1
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Frequently Bought Together</h3>
        <span className="text-xs text-slate-400">
          {data.multiItemOrders} multi-product orders ({Math.round(data.bundleRate * 100)}%)
        </span>
      </div>
      {data.topBundles.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No multi-product orders in this period</p>
      ) : (
        <div>
          {data.topBundles.map((r, i) => {
            const [a, b] = r.combo.split(' + ')
            return (
              <div key={r.combo} className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <span className="text-[11px] font-bold text-slate-300 w-5 shrink-0 pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-block text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{a}</span>
                    <span className="text-slate-300 text-xs">+</span>
                    <span className="inline-block text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{b}</span>
                  </div>
                  <div className="mt-1.5">
                    <Bar value={r.count} max={max} color="bg-purple-500" />
                  </div>
                </div>
                <span className="text-sm font-bold text-slate-900 shrink-0">{r.count}×</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PagesPanel({ data }: { data: IntelData }) {
  const max = data.topLanding[0]?.count ?? 1
  const label = (path: string) => {
    if (path.includes('/products/')) return path.replace('/products/', '').replace(/-/g, ' ')
    if (path.includes('/collections/')) return `Collection: ${path.replace('/collections/', '').replace(/-/g, ' ')}`
    return path
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Top Landing Pages</h3>
        <span className="text-xs text-slate-400">by order conversions</span>
      </div>
      {data.topLanding.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No landing page data available for this period</p>
      ) : (
        <div>
          {data.topLanding.map((r, i) => (
            <RankRow key={r.path} rank={i + 1}
              label={label(r.path)}
              sub={r.path}
              value={`${r.count} orders`}
              bar={r.count} barMax={max}
              barColor="bg-indigo-500"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ShopifyIntelligenceTab() {
  const [period,  setPeriod]  = useState<Period>('7d')
  const [section, setSection] = useState<Section>('products')
  const [data,    setData]    = useState<IntelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/shopify/intelligence?period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [period])

  const PERIODS: { id: Period; label: string }[] = [
    { id: 'today',     label: 'Today'     },
    { id: 'yesterday', label: 'Yesterday' },
    { id: '7d',        label: 'Last 7D'   },
    { id: '30d',       label: 'Last 30D'  },
  ]
  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'products',   label: 'Products'   },
    { id: 'geography',  label: 'Geography'  },
    { id: 'discounts',  label: 'Discounts'  },
    { id: 'bundles',    label: 'Bundles'    },
    { id: 'pages',      label: 'Pages'      },
  ]

  return (
    <div>
      {/* Header + period selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">🇵🇰 Elyscents.pk — Revenue Intelligence</h2>
          <p className="text-xs text-slate-400 mt-0.5">Order-level analytics from Shopify</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl px-1 py-1">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          {error?.includes('NOT_CONNECTED') ? (
            <>
              <p className="text-2xl mb-3">🛍</p>
              <p className="text-base font-semibold text-gray-800 mb-1">Shopify not connected yet</p>
              <p className="text-sm text-gray-500 mb-5">Connect your elyscents.pk store to unlock order intelligence.</p>
              <a href="/setup/shopify"
                className="inline-block bg-gray-900 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-gray-700 transition-colors">
                Connect Shopify →
              </a>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-red-700 mb-1">Connection error</p>
              <p className="text-xs text-red-500 break-all mb-4">{error}</p>
              <a href="/setup/shopify"
                className="inline-block bg-gray-900 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-gray-700">
                Reconnect →
              </a>
            </>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Fetching Shopify orders…</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <StatCard label="Orders"     value={data.totalOrders.toLocaleString()} />
            <StatCard label="Revenue"    value={`PKR ${compact(data.totalRevenue)}`} />
            <StatCard label="Avg Order"  value={`PKR ${Math.round(data.avgOrderValue).toLocaleString('en-PK')}`} />
            <StatCard label="Customers"  value={data.totalCustomers.toLocaleString()} />
            <StatCard
              label="Returning Customers"
              value={data.returningCustomerRate != null ? `${data.returningCustomerRate.toFixed(1)}%` : `${data.repeatBuyers}`}
              sub={data.returningCustomerRate != null
                ? `${data.returningCustomers ?? 0} of ${data.totalCustomers} buyers`
                : `${Math.round(data.repeatRate * 100)}% of buyers`}
            />
            <StatCard
              label="Conv. Rate"
              value={data.conversionRate ? `${data.conversionRate.toFixed(2)}%` : '—'}
              sub={data.sessions ? `${data.sessions.toLocaleString()} sessions` : 'Needs analytics access'}
            />
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl px-1 py-1 mb-5 w-fit">
            {SECTIONS.map(s => (
              <SectionTab key={s.id} id={s.id} label={s.label} active={section === s.id} onClick={() => setSection(s.id)} />
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
            {section === 'products'  && <ProductsPanel  data={data} />}
            {section === 'geography' && <GeographyPanel data={data} />}
            {section === 'discounts' && <DiscountsPanel data={data} />}
            {section === 'bundles'   && <BundlesPanel   data={data} />}
            {section === 'pages'     && <PagesPanel     data={data} />}
          </div>
        </>
      )}
    </div>
  )
}
