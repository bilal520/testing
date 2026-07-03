'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Row {
  id: number; order_number: string; order_date: string; customer_name: string
  phone: string | null; city: string; total: number; currency: string
  financial_status: string; fulfillment_status: string; cancelled: boolean
  tags: string[]; items_count: number; state: string; lifecycle: 'active' | 'observed'
}
interface Stats {
  total: number; active: number; observed: number
  fulfillment: { unfulfilled: number; fulfilled: number; partially: number; cancelled: number }
  financial: { paid: number; pending: number }
  incrementalCursor: string | null
  backfill: { status?: string; at?: string; created?: number; seen?: number } | null
  reconcile: { at?: string; shopify?: number; mirror?: number; healed?: number; inSync?: boolean } | null
}
interface Detail {
  order: Record<string, unknown> & { id: number; order_number: string; customer_name: string; phone: string | null; city: string; address_raw: string; cod_amount: number; state: string; items: Array<{ name: string; qty: number }> }
  events: Array<{ id: number; event_type: string; actor: string; detail: string; created_at: string; from_state?: string; to_state?: string }>
}

const money = (n: number, c: string) => `${c === 'PKR' ? 'PKR' : c} ${Math.round(n || 0).toLocaleString()}`
const dt = (s: string) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const FF = (s: string) => ({ FULFILLED: 'bg-emerald-50 text-emerald-700', UNFULFILLED: 'bg-amber-50 text-amber-700', PARTIALLY_FULFILLED: 'bg-blue-50 text-blue-700', RESTOCKED: 'bg-slate-100 text-slate-600' } as Record<string, string>)[s] ?? 'bg-slate-100 text-slate-500'
const FIN = (s: string) => ({ PAID: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', REFUNDED: 'bg-rose-50 text-rose-700', PARTIALLY_REFUNDED: 'bg-rose-50 text-rose-700', VOIDED: 'bg-slate-100 text-slate-500', AUTHORIZED: 'bg-blue-50 text-blue-700' } as Record<string, string>)[s] ?? 'bg-slate-100 text-slate-500'

const FF_OPTS  = ['', 'UNFULFILLED', 'FULFILLED', 'PARTIALLY_FULFILLED', 'RESTOCKED']
const FIN_OPTS = ['', 'PAID', 'PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED']

export default function OmsAllOrders() {
  const [rows, setRows]           = useState<Row[]>([])
  const [stats, setStats]         = useState<Stats | null>(null)
  const [page, setPage]           = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]         = useState(0)
  const [fulfillment, setFulfillment] = useState('')
  const [financial, setFinancial] = useState('')
  const [lifecycle, setLifecycle] = useState('')
  const [q, setQ]                 = useState('')
  const [loading, setLoading]     = useState(false)
  const [syncing, setSyncing]     = useState(false)
  const [msg, setMsg]             = useState<string | null>(null)
  const [detail, setDetail]       = useState<Detail | null>(null)

  // `silent` refreshes (used by the auto-refresh interval) don't toggle the
  // loading spinner, so the table never flickers under the viewer.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    const p = new URLSearchParams({ page: String(page), pageSize: '40' })
    if (fulfillment) p.set('fulfillment', fulfillment)
    if (financial)   p.set('financial', financial)
    if (lifecycle)   p.set('lifecycle', lifecycle)
    if (q)           p.set('q', q)
    fetch(`/api/oms/orders?${p}`, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setMsg(d.error); else { setRows(d.rows); setTotalPages(d.totalPages); setTotal(d.total) } })
      .catch(e => setMsg(String(e))).finally(() => { if (!silent) setLoading(false) })
  }, [page, fulfillment, financial, lifecycle, q])

  const loadStats = useCallback(() => {
    fetch('/api/oms/orders/stats', { cache: 'no-store' }).then(r => r.json()).then(d => { if (!d.error) setStats(d) }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { setPage(1) }, [fulfillment, financial, lifecycle, q])

  // Quiet auto-refresh (~25s) — keeps the monitoring view current without a
  // spinner, preserving the current page/filters and any open detail drawer.
  useEffect(() => {
    const id = setInterval(() => { load(true); loadStats() }, 25_000)
    return () => clearInterval(id)
  }, [load, loadStats])

  async function resync() {
    setSyncing(true); setMsg(null)
    try {
      const r = await fetch('/api/oms/reconcile', { method: 'POST' })
      const d = await r.json()
      setMsg(d.error ? `Sync failed: ${d.error}` : `✓ Reconciled — Shopify ${d.shopify ?? '?'}, mirror ${d.mirror ?? '?'}${d.healed ? `, healed ${d.healed}` : ''}.`)
      load(); loadStats()
    } catch (e) { setMsg(String(e)) } finally { setSyncing(false) }
  }

  function openOrder(id: number) {
    setDetail(null)
    fetch(`/api/oms/order/${id}`).then(r => r.json()).then(d => { if (!d.error) setDetail(d) }).catch(() => {})
  }

  // Sync badge: prefer the reconcile result; fall back to backfill status.
  const rec = stats?.reconcile
  const inSync = rec ? (rec.inSync ?? (Math.abs((rec.shopify ?? 0) - (rec.mirror ?? 0)) <= 1)) : null
  const behind = rec && rec.shopify != null && rec.mirror != null ? rec.shopify - rec.mirror : null

  return (
    <div>
      {/* Sync-status header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-bold text-slate-800">{total.toLocaleString()} orders</span>
          {stats && <>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">active <b className="text-slate-700">{stats.active}</b></span>
            <span className="text-slate-500">observed <b className="text-slate-700">{stats.observed}</b></span>
            <span className="text-slate-400">·</span>
            <span className="text-emerald-600">fulfilled {stats.fulfillment.fulfilled}</span>
            <span className="text-amber-600">unfulfilled {stats.fulfillment.unfulfilled}</span>
            {stats.fulfillment.cancelled > 0 && <span className="text-rose-600">cancelled {stats.fulfillment.cancelled}</span>}
          </>}
          {inSync !== null && (
            <span className={`ml-1 px-2 py-0.5 rounded-full font-semibold ${inSync ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {inSync ? '✅ in sync' : `⚠️ ${Math.abs(behind ?? 0)} behind`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rec?.at && <span className="text-[10px] text-slate-400">reconciled {new Date(rec.at).toLocaleString()}</span>}
          <button onClick={resync} disabled={syncing}
            className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40">
            {syncing ? 'Syncing…' : '↻ Reconcile now'}
          </button>
        </div>
      </div>

      {msg && <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-slate-600">{msg}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search order # / phone / name"
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-56" />
        <select value={fulfillment} onChange={e => setFulfillment(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5">
          {FF_OPTS.map(o => <option key={o} value={o}>{o ? o.replace(/_/g, ' ').toLowerCase() : 'all fulfillment'}</option>)}
        </select>
        <select value={financial} onChange={e => setFinancial(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5">
          {FIN_OPTS.map(o => <option key={o} value={o}>{o ? o.replace(/_/g, ' ').toLowerCase() : 'all payment'}</option>)}
        </select>
        <select value={lifecycle} onChange={e => setLifecycle(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5">
          <option value="">all orders</option>
          <option value="active">active (workflow)</option>
          <option value="observed">observed (mirror)</option>
        </select>
        {(fulfillment || financial || lifecycle || q) &&
          <button onClick={() => { setFulfillment(''); setFinancial(''); setLifecycle(''); setQ('') }} className="text-[11px] text-blue-600">clear</button>}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-bold">Order</th>
                <th className="text-left px-3 py-2 font-bold">Date</th>
                <th className="text-left px-3 py-2 font-bold">Customer</th>
                <th className="text-left px-3 py-2 font-bold">City</th>
                <th className="text-right px-3 py-2 font-bold">Total</th>
                <th className="text-left px-3 py-2 font-bold">Payment</th>
                <th className="text-left px-3 py-2 font-bold">Fulfillment</th>
                <th className="text-left px-3 py-2 font-bold">OMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">No orders match.</td></tr>
                : rows.map(o => (
                  <tr key={o.id} onClick={() => openOrder(o.id)} className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2 font-bold text-slate-800">{o.order_number}</td>
                    <td className="px-3 py-2 text-slate-500">{dt(o.order_date)}</td>
                    <td className="px-3 py-2 text-slate-700">{o.customer_name}<span className="text-slate-400"> · {o.items_count} item{o.items_count === 1 ? '' : 's'}</span></td>
                    <td className="px-3 py-2 text-slate-500">{o.city}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700">{money(o.total, o.currency)}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded ${FIN(o.financial_status)}`}>{o.financial_status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="px-3 py-2">
                      {o.cancelled
                        ? <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">cancelled</span>
                        : <span className={`px-1.5 py-0.5 rounded ${FF(o.fulfillment_status)}`}>{o.fulfillment_status.replace(/_/g, ' ').toLowerCase()}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {o.lifecycle === 'observed'
                        ? <span className="text-slate-400">mirror</span>
                        : <span className="text-slate-700 capitalize">{o.state.replace(/_/g, ' ')}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
        <span>Page {page} of {totalPages} · {total.toLocaleString()} orders</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:border-slate-400">← Prev</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:border-slate-400">Next →</button>
        </div>
      </div>

      {/* Detail drawer (read-only mirror view) */}
      {detail && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">{detail.order.order_number} · {detail.order.customer_name}</h3>
              <button onClick={() => setDetail(null)} className="text-xs text-slate-400 hover:text-slate-700">✕ close</button>
            </div>
            <div className="text-xs text-slate-600 space-y-1.5">
              <p><span className="font-semibold">State:</span> <span className="capitalize">{String(detail.order.state).replace(/_/g, ' ')}</span></p>
              <p><span className="font-semibold">Phone:</span> {detail.order.phone ?? '—'}</p>
              <p><span className="font-semibold">Address:</span> {detail.order.address_raw || '—'} · {detail.order.city}</p>
              <p><span className="font-semibold">Items:</span> {detail.order.items?.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
              <p><span className="font-semibold">COD:</span> PKR {Math.round(detail.order.cod_amount || 0).toLocaleString()}</p>
            </div>
            <div className="pt-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Timeline</p>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {detail.events.map(e => (
                  <div key={e.id} className="text-[11px] text-slate-500">
                    <span className="text-slate-300">{new Date(e.created_at).toLocaleString()}</span> · {e.actor} · {e.detail || e.event_type}
                    {e.from_state && e.to_state && <span className="text-slate-400"> ({e.from_state}→{e.to_state})</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
