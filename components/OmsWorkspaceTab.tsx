'use client'

import { useState, useEffect } from 'react'
import OmsWhatsappPanel from './OmsWhatsappPanel'
import OmsAllOrders from './OmsAllOrders'
import OmsWarehouseTab from './OmsWarehouseTab'

// ── Types ──────────────────────────────────────────────────────────────────
interface QueueOrder {
  id: number; order_number: string; customer_name: string; phone: string | null
  city: string; cod_amount: number; state: string; is_duplicate: boolean
  risk_level: string; address_complete: boolean; address_score: number
  items: Array<{ name: string; qty: number }>; created_at: string
  confirmation_attempts: number; flags: string[]
  rto_return_count?: number; payment_state?: string | null
}
type QueueId = 'rto' | 'payments' | 'pending' | 'no_answer' | 'incomplete_address' | 'duplicates' | 'high_risk' | 'ready'
interface QueuesData { counts: Record<QueueId, number>; queues: Record<QueueId, QueueOrder[]> }
interface RtoProfile { returnCount: number; lastReturnAt: string | null; reasons: string[]; cities: string[]; couriers: string[]; tier: 'none' | 'caution' | 'high' }
interface PayAccounts { jazzcash?: string; easypaisa?: string; bank?: string }
interface OrderDetail {
  order: Record<string, unknown> & { id: number; order_number: string; customer_name: string; phone: string | null; city: string; address_raw: string; cod_amount: number; state: string; items: Array<{ name: string; qty: number; sku?: string }>; risk_level: string; is_duplicate: boolean; address_complete: boolean; address_score: number; cancel_reason?: string; payment_state?: string | null; payment_method?: string | null; payment_amount?: number | null }
  events: Array<{ id: number; event_type: string; actor: string; detail: string; created_at: string; from_state?: string; to_state?: string }>
  messages: Array<{ id: string; content: string; source: string; received_at: string }>
  rtoProfile?: RtoProfile
  paymentAccounts?: PayAccounts | null
}

const PKR = (n: number) => `PKR ${Math.round(n || 0).toLocaleString('en-PK')}`
const QUEUES: Array<{ id: QueueId; label: string; color: string }> = [
  { id: 'rto',                label: '🚫 RTO Customer',  color: 'text-rose-700' },
  { id: 'payments',           label: '💳 Online Payments', color: 'text-indigo-600' },
  { id: 'pending',            label: '🔴 Pending',       color: 'text-red-600' },
  { id: 'no_answer',          label: '📵 No Answer',      color: 'text-orange-600' },
  { id: 'incomplete_address', label: '🏠 Incomplete Addr', color: 'text-amber-600' },
  { id: 'duplicates',         label: '👥 Duplicates',     color: 'text-purple-600' },
  { id: 'high_risk',          label: '⚠️ High Risk',      color: 'text-rose-600' },
  { id: 'ready',              label: '📦 Ready to Dispatch', color: 'text-emerald-600' },
]
const MOVE_TARGET_LABELS: Array<{ id: string; label: string }> = [
  { id: 'pending_confirmation', label: 'Pending' },
  { id: 'no_answer',            label: 'No Answer' },
  { id: 'incomplete_address',   label: 'Incomplete Address' },
  { id: 'review_hold',          label: 'Review Hold' },
  { id: 'rto_hold',             label: 'RTO Customer' },
  { id: 'awaiting_payment',     label: 'Online Payments' },
  { id: 'confirmed',            label: 'Confirmed' },
  { id: 'ready_to_dispatch',    label: 'Ready to Dispatch' },
]

interface Analytics {
  total: number; confirmationRate: number; medianTimeToConfirmMin: number
  preDispatchCancels: number; codValueCancelled: number; dispatched: number
  incompleteAddressRate: number; duplicateRate: number; highRiskRate: number; ndrOpen: number
}

export default function OmsWorkspaceTab() {
  const [data, setData]         = useState<QueuesData | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [queue, setQueue]       = useState<QueueId>('pending')
  const [selected, setSelected] = useState<OrderDetail | null>(null)
  const [loading, setLoading]   = useState(false)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg]           = useState<string | null>(null)
  const [showWa, setShowWa]     = useState(false)
  const [view, setView]         = useState<'queues' | 'all' | 'warehouse'>('queues')
  const [syncing, setSyncing]   = useState(false)
  const [live, setLive]         = useState<QueuesData | null>(null)   // latest counts from background poll
  const [noteInput, setNoteInput] = useState('')
  const [moveTo, setMoveTo]     = useState('')
  const [payMethod, setPayMethod] = useState<'jazzcash' | 'easypaisa' | 'bank'>('jazzcash')
  const [payAmount, setPayAmount] = useState('')
  const [payRef, setPayRef]     = useState('')

  function loadQueues() {
    setLoading(true)
    fetch('/api/oms/queues', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setMsg(d.error); else { setData(d); setLive(d) } })  // displayed + live in sync on explicit load
      .catch(e => setMsg(String(e)))
      .finally(() => setLoading(false))
    fetch('/api/oms/analytics', { cache: 'no-store' }).then(r => r.json()).then(d => { if (!d.error) setAnalytics(d) }).catch(() => {})
  }
  useEffect(() => { loadQueues() }, [])

  // Background poll (~25s): refresh COUNTS only (into `live`). Never touches the
  // displayed list or the agent's open order — new work surfaces as a count tick
  // + an opt-in "N new" pill the agent loads when they're ready.
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/oms/queues', { cache: 'no-store' }).then(r => r.json()).then(d => { if (!d.error) setLive(d) }).catch(() => {})
    }, 25_000)
    return () => clearInterval(id)
  }, [])

  // Instant open: render the detail from the list row we already have, then
  // hydrate the full detail (events, RTO profile, WhatsApp thread) in the
  // background. Guarded so a late response can't overwrite a newer selection.
  function selectOrder(row: QueueOrder) {
    setNoteInput(''); setMoveTo(''); setPayAmount(''); setPayRef('')
    setSelected({
      order: { id: row.id, order_number: row.order_number, customer_name: row.customer_name, phone: row.phone, city: row.city, address_raw: '', cod_amount: row.cod_amount, state: row.state, items: row.items ?? [], risk_level: row.risk_level, is_duplicate: row.is_duplicate, address_complete: row.address_complete, address_score: row.address_score, payment_state: row.payment_state ?? null },
      events: [], messages: [], rtoProfile: undefined, paymentAccounts: null,
    })
    fetch(`/api/oms/order/${row.id}`, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (!d.error) setSelected(prev => (prev && prev.order.id === row.id ? d : prev)) }).catch(() => {})
  }

  async function post(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return
    const res = await fetch('/api/oms/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: selected.order.id, action, agent: 'agent', ...extra }) })
    const d = await res.json()
    if (d.error) { setMsg(d.error); return }
    setSelected(null); loadQueues()
  }
  // Notes append locally (no refetch, no blanking) — instant.
  async function doAddNote() {
    if (!selected) return
    const n = noteInput.trim(); if (!n) { setMsg('A note is required.'); return }
    const oid = selected.order.id
    setSelected(prev => prev && prev.order.id === oid
      ? { ...prev, events: [{ id: Date.now(), event_type: 'note', actor: 'agent', detail: n, created_at: new Date().toISOString() }, ...prev.events] }
      : prev)
    setNoteInput('')
    const res = await fetch('/api/oms/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: oid, action: 'add_note', agent: 'agent', note: n }) })
    const d = await res.json().catch(() => ({}))
    if (d.error) setMsg(d.error)
  }
  const doMove = () => { if (!moveTo) { setMsg('Pick a destination tab.'); return } const n = noteInput.trim(); if (!n) { setMsg('A note is required to move.'); return } post('move', { to: moveTo, note: n }) }
  const doPrepaid = () => { const n = noteInput.trim() || (prompt('Why require prepaid? (required)') ?? '').trim(); if (!n) { setMsg('A note is required.'); return } post('require_prepaid', { note: n }) }
  const doMarkPaid = () => { const amt = Number(payAmount); if (!amt || amt <= 0) { setMsg('Enter the paid amount.'); return } post('mark_paid', { method: payMethod, amount: amt, ref: payRef.trim() || undefined, note: `paid via ${payMethod} ${amt}${payRef ? ' ref ' + payRef : ''}` }) }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return
    const res = await fetch('/api/oms/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: selected.order.id, action, agent: 'agent', ...extra }),
    })
    const d = await res.json()
    if (d.error) { setMsg(d.error); return }
    setSelected(null); loadQueues()
  }

  async function importOrders() {
    setImporting(true); setMsg(null)
    try {
      const res = await fetch('/api/oms/backfill', { method: 'POST' })
      const d = await res.json()
      setMsg(d.error ? `Import failed: ${d.error}` : `Imported ${d.created} new (${d.duplicates} duplicates), ${d.skipped} already present. Write-back: ${d.writeback}.`)
      loadQueues()
    } catch (e) { setMsg(String(e)) } finally { setImporting(false) }
  }

  // Full-mirror backfill: pull ALL Shopify orders (any status) from the last 30
  // days into the dashboard. Side-effect-free (suppression on during the run).
  async function syncAllOrders() {
    setSyncing(true); setMsg(null)
    try {
      const res = await fetch('/api/oms/mirror-backfill', { method: 'POST' })
      const d = await res.json()
      setMsg(d.error ? `Sync failed: ${d.error}`
        : `✓ Mirrored ${d.seen} orders (${d.observed} observed, ${d.active} active). The dashboard now matches Shopify for the last 30 days.`)
      if (view === 'queues') loadQueues()
    } catch (e) { setMsg(String(e)) } finally { setSyncing(false) }
  }

  const rows = data?.queues[queue] ?? []
  // Live counts (from the background poll) drive the tab badges; the pill counts
  // how many NEW orders have arrived across all queues since the displayed load.
  const counts = live?.counts ?? data?.counts
  const newTotal = (live && data)
    ? (Object.keys(data.counts) as QueueId[]).reduce((s, k) => s + Math.max(0, (live.counts[k] || 0) - (data.counts[k] || 0)), 0)
    : 0

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">📦 Order Management (OMS)</h2>
          <p className="text-xs text-slate-400 mt-0.5">Confirm every order before dispatch — cut the return rate. Shopify write-back runs in <span className="font-semibold">shadow mode</span> (safe).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowWa(v => !v)}
            className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg hover:border-slate-400">
            📲 WhatsApp Setup
          </button>
          <button onClick={syncAllOrders} disabled={syncing}
            className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg hover:border-slate-400 disabled:opacity-40">
            {syncing ? 'Syncing…' : '⇅ Sync all orders (30d)'}
          </button>
          {view === 'queues' && (
            <button onClick={importOrders} disabled={importing}
              className="text-xs bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-40">
              {importing ? 'Importing…' : '↓ Import unfulfilled orders'}
            </button>
          )}
        </div>
      </div>

      {/* View switch: agent Queues vs the full-mirror All Orders */}
      <div className="flex gap-1 bg-slate-100 rounded-xl px-1 py-1 mb-4 w-fit">
        {([['queues', '🗂 Queues'], ['warehouse', '🏭 Warehouse'], ['all', '📋 All Orders']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); setSelected(null) }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${view === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {showWa && <OmsWhatsappPanel onClose={() => setShowWa(false)} />}

      {msg && <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 mb-4 text-xs text-slate-600">{msg}</div>}

      {view === 'all' ? <OmsAllOrders /> : view === 'warehouse' ? <OmsWarehouseTab /> : (
      <>
      {/* ── Queues view ────────────────────────────────────────────────── */}

      {/* KPI strip */}
      {analytics && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          {[
            { label: 'Orders',          value: analytics.total.toLocaleString() },
            { label: 'Confirm rate',    value: `${analytics.confirmationRate}%`, hl: analytics.confirmationRate >= 85 ? 'green' : 'amber' },
            { label: 'Median confirm',  value: analytics.medianTimeToConfirmMin ? `${analytics.medianTimeToConfirmMin}m` : '—' },
            { label: 'Pre-dispatch cancels', value: analytics.preDispatchCancels.toLocaleString(), sub: `PKR ${analytics.codValueCancelled.toLocaleString()}` },
            { label: 'Dispatched',      value: analytics.dispatched.toLocaleString() },
            { label: 'NDR open',        value: analytics.ndrOpen.toLocaleString(), hl: analytics.ndrOpen > 0 ? 'amber' : undefined },
          ].map(k => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-2.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{k.label}</p>
              <p className={`text-base font-bold ${k.hl === 'green' ? 'text-emerald-700' : k.hl === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{k.value}</p>
              {k.sub && <p className="text-[9px] text-slate-400">{k.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Queue tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl px-1 py-1 mb-4 w-fit">
        {QUEUES.map(q => (
          <button key={q.id} onClick={() => { setQueue(q.id); setSelected(null) }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${queue === q.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
            {q.label} <span className={`ml-1 ${q.color}`}>{counts?.[q.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Opt-in "new orders" pill — surfaces fresh work without disturbing the
          agent's current list or open order. Clicking loads the latest snapshot. */}
      {newTotal > 0 && (
        <button onClick={() => { if (live) setData(live) }}
          className="flex items-center gap-2 text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-full hover:bg-blue-700 mb-4 shadow-sm animate-pulse">
          ▲ {newTotal} new order{newTotal === 1 ? '' : 's'} — click to load
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Order list */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
            : rows.length === 0 ? <p className="text-sm text-slate-400 text-center py-10">Queue empty. Import orders to start.</p>
            : (
            <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
              {rows.map(o => (
                <button key={o.id} onClick={() => selectOrder(o)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selected?.order.id === o.id ? 'bg-slate-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-800">{o.order_number} · {o.customer_name}</p>
                    <p className="text-xs font-bold text-slate-700">{PKR(o.cod_amount)}</p>
                  </div>
                  <p className="text-[11px] text-slate-400">{o.phone ?? 'no phone'} · {o.city}</p>
                  {o.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {o.flags.map((f, i) => <span key={i} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">{f}</span>)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Order detail */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          {!selected ? <p className="text-sm text-slate-400 text-center py-10">Select an order to work it.</p> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">{selected.order.order_number} · {selected.order.customer_name}</p>
                  <p className="text-[11px] text-slate-400 capitalize">state: {selected.order.state.replace(/_/g, ' ')}</p>
                </div>
                <p className="text-base font-bold text-slate-800">{PKR(selected.order.cod_amount)}</p>
              </div>

              {/* RTO profile — repeat-returner warning */}
              {selected.rtoProfile && selected.rtoProfile.returnCount > 0 && (
                <div className={`rounded-lg px-3 py-2 text-xs border ${selected.rtoProfile.tier === 'high' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  <p className="font-bold">🚫 Repeat returner — {selected.rtoProfile.returnCount} past return{selected.rtoProfile.returnCount === 1 ? '' : 's'} · {selected.rtoProfile.tier}</p>
                  {selected.rtoProfile.reasons.length > 0 && <p className="mt-0.5">Reasons: {selected.rtoProfile.reasons.join('; ')}</p>}
                  {selected.rtoProfile.cities.length > 0 && <p>Cities: {selected.rtoProfile.cities.join(', ')}</p>}
                  {selected.rtoProfile.lastReturnAt && <p className="text-[10px] opacity-70 mt-0.5">Last return: {selected.rtoProfile.lastReturnAt}</p>}
                </div>
              )}

              {/* Prepaid panel — Online Payments tab */}
              {selected.order.state === 'awaiting_payment' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs space-y-2">
                  <p className="font-bold text-indigo-800">💳 Awaiting prepaid {selected.order.payment_state === 'paid' && <span className="text-emerald-700">(paid)</span>}</p>
                  <div className="text-slate-700 space-y-0.5">
                    {selected.paymentAccounts?.jazzcash && <p>JazzCash: <b>{selected.paymentAccounts.jazzcash}</b></p>}
                    {selected.paymentAccounts?.easypaisa && <p>Easypaisa: <b>{selected.paymentAccounts.easypaisa}</b></p>}
                    {selected.paymentAccounts?.bank && <p>Bank: <b>{selected.paymentAccounts.bank}</b></p>}
                    {!selected.paymentAccounts && <p className="text-slate-400">Set payment accounts in Setup → site_settings.oms_pay_accounts.</p>}
                    <p className="text-[10px] text-slate-400">Payment reference: {selected.order.order_number}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <select value={payMethod} onChange={e => setPayMethod(e.target.value as 'jazzcash' | 'easypaisa' | 'bank')} className="border border-slate-200 rounded px-1.5 py-1 text-[11px]">
                      <option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="bank">Bank</option>
                    </select>
                    <input value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="amount" inputMode="numeric" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] w-20" />
                    <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="ref/txn (opt)" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] w-24" />
                    <button onClick={doMarkPaid} className="bg-emerald-600 text-white px-2.5 py-1 rounded text-[11px] hover:bg-emerald-700">✓ Mark paid</button>
                  </div>
                </div>
              )}

              <div className="text-xs text-slate-600 space-y-1">
                <p><span className="font-semibold">Phone:</span> {selected.order.phone ?? '— missing —'}
                  {selected.order.phone && <> · <a className="text-blue-600" href={`tel:${selected.order.phone}`}>call</a> · <a className="text-emerald-600" href={`https://wa.me/92${selected.order.phone.replace(/^0/, '')}`} target="_blank" rel="noreferrer">whatsapp</a></>}
                </p>
                <p><span className="font-semibold">Address:</span> {selected.order.address_raw || '—'} · {selected.order.city}
                  {!selected.order.address_complete && <span className="text-amber-600 font-semibold"> (incomplete {selected.order.address_score}/100)</span>}
                </p>
                <p><span className="font-semibold">Items:</span> {selected.order.items?.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                {selected.order.is_duplicate && <p className="text-purple-600 font-semibold">⚠ Flagged as duplicate</p>}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {(selected.order.state === 'ready_to_dispatch' || selected.order.state === 'confirmed') && (
                  <button onClick={async () => {
                    const courier = (prompt('Courier — type "leopards" (recommended, lower returns) or "postex":', 'leopards') || '').trim().toLowerCase()
                    if (!['leopards', 'postex'].includes(courier)) return
                    const tn = prompt(`Book the parcel in the ${courier} portal, then paste the CN / tracking number here:`)
                    if (!tn || !tn.trim()) return
                    const res = await fetch('/api/oms/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: selected.order.id, courier, trackingNumber: tn.trim() }) })
                    const d = await res.json(); if (d.error) { setMsg(d.error); return }
                    setSelected(null); loadQueues()
                  }} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700">📦 Book to courier</button>
                )}
                <button onClick={() => act('confirm')} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700">✅ Confirm</button>
                <button onClick={() => act('no_answer')} className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600">📵 No Answer</button>
                <button onClick={() => { const r = prompt('Cancel reason? (required — leave blank to abort)'); if (r && r.trim()) { act('cancel', { reason: r.trim() }) } }} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700">❌ Cancel</button>
                {selected.order.state !== 'awaiting_payment' && selected.order.state !== 'ready_to_dispatch' && selected.order.state !== 'dispatched' && (
                  <button onClick={doPrepaid} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">💳 Require prepaid</button>
                )}
                {!selected.order.address_complete && (
                  <button onClick={() => { const a = prompt('Corrected address:'); if (a) act('fix_address', { address: { address1: a, city: String(selected.order.city) } }) }} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600">🏠 Fix Address</button>
                )}
                {selected.order.is_duplicate && (
                  <>
                    <button onClick={() => act('release')} className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700">Keep (not duplicate)</button>
                    <button onClick={() => { if (confirm('Cancel this order as a duplicate (ship only the other one)?')) act('merge') }} className="text-xs bg-purple-800 text-white px-3 py-1.5 rounded-lg hover:bg-purple-900">Merge (cancel dup)</button>
                  </>
                )}
              </div>

              {/* Move between tabs + mandatory note */}
              <div className="border-t border-slate-100 pt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-500">Move to</span>
                  <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className="border border-slate-200 rounded px-1.5 py-1 text-[11px]">
                    <option value="">— pick tab —</option>
                    {MOVE_TARGET_LABELS.filter(m => m.id !== selected.order.state).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <button onClick={doMove} className="text-[11px] bg-slate-800 text-white px-2.5 py-1 rounded hover:bg-slate-700">Move</button>
                  <span className="text-[10px] text-slate-400">note required</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Note (required for moves / prepaid; used as the reason)…" rows={2}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-[11px]" />
                  <button onClick={doAddNote} className="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-1 rounded hover:bg-slate-200 border border-slate-200">+ Note</button>
                </div>
              </div>

              {/* Timeline */}
              <div className="pt-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Timeline &amp; notes</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {selected.events.map(e => (
                    <div key={e.id} className="text-[11px] text-slate-500">
                      <span className="text-slate-300">{new Date(e.created_at).toLocaleString()}</span> · {e.actor} · {e.detail || e.event_type}
                      {e.from_state && e.to_state && <span className="text-slate-400"> ({e.from_state}→{e.to_state})</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  )
}
