'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface WOrder {
  id: number; order_number: string; customer_name: string; phone: string | null
  city: string; cod_amount: number; items: Array<{ name: string; qty: number; sku?: string }>
  courier: string | null; tracking_number: string | null; label_url: string | null; state: string
}
type Stage = 'ready_to_dispatch' | 'booked' | 'cn_printed' | 'packed' | 'picked_up'
interface Data { stages: Record<Stage, WOrder[]>; counts: Record<Stage, number>; bookingApi?: { enabled: boolean; leopardsCitiesCached: number } }

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'ready_to_dispatch', label: '📋 Booking' },
  { id: 'booked',            label: '🖨 Print CNs' },
  { id: 'cn_printed',        label: '📦 Pack / Scan' },
  { id: 'packed',            label: '🤝 Handover' },
  { id: 'picked_up',         label: '🚚 Picked by courier' },
]
const PKR = (n: number) => `PKR ${Math.round(n || 0).toLocaleString('en-PK')}`

interface RetLookup { order: WOrder; courierStatus: string | null; alreadyReceived: { received_at: string } | null }

export default function OmsWarehouseTab() {
  const [data, setData]     = useState<Data | null>(null)
  const [stage, setStage]   = useState<Stage | 'returns'>('ready_to_dispatch')
  const [msg, setMsg]       = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)
  // booking inputs per order
  const [bk, setBk]         = useState<Record<number, { courier: string; cn: string }>>({})
  // scan-to-pack
  const [scan, setScan]     = useState('')
  const [lastScan, setLastScan] = useState<{ ok: boolean; text: string; order?: WOrder } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  // returns receiving
  const [retScan, setRetScan] = useState('')
  const [retResult, setRetResult] = useState<RetLookup | null>(null)
  const [retCond, setRetCond] = useState<'good' | 'damaged' | 'mixed'>('good')
  const [retNotes, setRetNotes] = useState('')
  const retRef = useRef<HTMLInputElement>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => { fetch('/api/me/access').then(r => r.json()).then(a => setIsAdmin(!!a.isAdmin)).catch(() => {}) }, [])
  // bulk selection (Booking + Print stages)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [bulkCourier, setBulkCourier] = useState<'leopards' | 'postex'>('postex')
  useEffect(() => { setSel(new Set()) }, [stage])

  const load = useCallback(() => {
    fetch('/api/oms/warehouse', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setMsg(d.error); else setData(d) }).catch(e => setMsg(String(e)))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(load, 25_000); return () => clearInterval(id) }, [load])
  useEffect(() => { if (stage === 'cn_printed') scanRef.current?.focus() }, [stage])

  async function act(payload: Record<string, unknown>) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/oms/warehouse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'warehouse', ...payload }) })
      const d = await res.json(); if (d.error) { setMsg(d.error); return d }
      load(); return d
    } finally { setBusy(false) }
  }

  const orders = stage === 'returns' ? [] : (data?.stages[stage] ?? [])

  async function retLookup(cn: string) {
    if (!cn.trim()) return
    setRetScan('')
    const d = await act({ action: 'lookup_return', cn: cn.trim() })
    if (d?.ok) setRetResult(d as RetLookup); else { setRetResult(null); setMsg(d?.error ?? 'not found') }
    retRef.current?.focus()
  }
  async function retReceive() {
    if (!retResult?.order) return
    const d = await act({ action: 'receive_return', cn: retResult.order.tracking_number, condition: retCond, notes: retNotes.trim() || undefined })
    if (d?.ok) { setMsg(`✓ Received ${d.order_number} (${d.condition})`); setRetResult(null); setRetNotes(''); setRetCond('good'); retRef.current?.focus() }
  }

  const apiOn = !!data?.bookingApi?.enabled
  async function book(o: WOrder) {
    const b = bk[o.id] ?? { courier: 'leopards', cn: '' }
    if (!apiOn && !b.cn.trim()) { setMsg(`Enter the CN for ${o.order_number} (or enable auto-booking)`); return }
    const d = await act({ action: 'book', orderId: o.id, courier: b.courier || 'leopards', cn: b.cn.trim() || undefined })
    if (d?.ok) { setMsg(`✓ ${o.order_number} booked with ${b.courier || 'leopards'}${d.cn ? ` — CN ${d.cn}` : ''}`); setBk(p => ({ ...p, [o.id]: { courier: b.courier || 'leopards', cn: '' } })) }
  }
  async function toggleApi() {
    const d = await act({ action: 'set_booking_api', enabled: !apiOn })
    if (d?.ok) setMsg(`Auto-booking ${d.enabled ? 'ENABLED — the Book button now creates real consignments' : 'disabled (manual CN)'}`)
  }
  async function refreshCities() {
    setMsg('Fetching Leopards cities… this can take a minute.')
    const d = await act({ action: 'refresh_leopards_cities' })
    if (d?.ok) setMsg(`✓ Cached ${d.cities} Leopards cities — Leopards auto-booking is now available.`)
    else if (d?.error) setMsg(`Leopards cities: ${d.error}`)
  }

  // bulk selection helpers
  const toggle = (id: number) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSel = orders.length > 0 && orders.every(o => sel.has(o.id))
  const toggleAll = () => setSel(allSel ? new Set() : new Set(orders.map(o => o.id)))

  async function bulkBook() {
    if (!sel.size) { setMsg('Select orders to book.'); return }
    const d = await act({ action: 'book_bulk', orderIds: [...sel], courier: bulkCourier })
    if (d?.ok) { setMsg(`✓ Booked ${d.booked} to ${bulkCourier}${d.failed ? ` · ${d.failed} failed: ${(d.errors ?? []).join('; ')}` : ''}`); setSel(new Set()) }
  }
  // Open PostEx labels (combined PDF) + Leopards slips for the given orders.
  function printLabels(list: WOrder[]) {
    const cns = list.filter(o => o.courier === 'postex' && o.tracking_number).map(o => o.tracking_number!)
    const leo = list.filter(o => o.courier === 'leopards' && o.label_url)
    if (cns.length) window.open(`/api/oms/label?cns=${encodeURIComponent(cns.join(','))}`, '_blank')
    leo.forEach(o => window.open(o.label_url!, '_blank'))
    if (!cns.length && !leo.length) setMsg('No printable labels in selection (PostEx auto-booked orders + Leopards slips only).')
  }
  const bulkPrint = () => { if (!sel.size) { setMsg('Select orders to print.'); return } printLabels(orders.filter(o => sel.has(o.id))) }
  async function markSelectedPrinted() {
    if (!sel.size) return
    const d = await act({ action: 'print', orderIds: [...sel] }); if (d?.ok) { setMsg(`✓ Marked ${d.printed} printed`); setSel(new Set()) }
  }
  async function doScan(cn: string) {
    if (!cn.trim()) return
    setScan('')
    const d = await act({ action: 'scan_pack', cn: cn.trim() })
    if (d?.ok) setLastScan({ ok: true, text: `✓ Packed ${d.order?.order_number ?? ''}${d.already ? ' (already packed)' : ''}`, order: d.order })
    else setLastScan({ ok: false, text: d?.error ?? 'scan failed' })
    scanRef.current?.focus()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">🏭 Warehouse</h2>
          <p className="text-xs text-slate-400 mt-0.5">Book → print CNs → scan-to-pack → hand to courier. Booking is manual CN for now (API booking coming after a supervised test).</p>
        </div>
        <button onClick={load} className="text-xs text-blue-600">↻ refresh</button>
      </div>

      {msg && <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-xs text-slate-600">{msg}</div>}

      {/* Stage tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl px-1 py-1 mb-4 w-fit">
        {STAGES.map(s => (
          <button key={s.id} onClick={() => setStage(s.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${stage === s.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
            {s.label} <span className="ml-1 text-slate-400">{data?.counts[s.id] ?? 0}</span>
          </button>
        ))}
        <button onClick={() => { setStage('returns'); setTimeout(() => retRef.current?.focus(), 50) }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${stage === 'returns' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
          📥 Returns In
        </button>
      </div>

      {/* Returns Receiving station */}
      {stage === 'returns' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Scan a returned parcel</p>
          <input ref={retRef} value={retScan} onChange={e => setRetScan(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') retLookup(retScan) }}
            placeholder="Scan the CN on the returned parcel…" autoFocus
            className="w-full text-sm border-2 border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 outline-none" />
          {retResult && (
            <div className="mt-3 border border-slate-200 rounded-lg p-3 text-xs">
              <p className="font-bold text-slate-800">{retResult.order.order_number} · {retResult.order.customer_name} · {retResult.order.city}</p>
              <p className="text-slate-500 mt-0.5">Items: {retResult.order.items?.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
              <p className="text-slate-400 mt-0.5">
                courier: {retResult.order.courier ?? '—'} · courier status: {retResult.courierStatus ?? 'unknown'}
                {retResult.courierStatus && retResult.courierStatus !== 'returned' && <span className="text-amber-600"> ⚠ courier does not show this as returned yet</span>}
                {retResult.alreadyReceived && <span className="text-rose-600"> · already received {new Date(retResult.alreadyReceived.received_at).toLocaleString()}</span>}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <select value={retCond} onChange={e => setRetCond(e.target.value as 'good' | 'damaged' | 'mixed')} className="text-[11px] border border-slate-200 rounded px-1.5 py-1">
                  <option value="good">Good (restock)</option>
                  <option value="damaged">Damaged</option>
                  <option value="mixed">Mixed</option>
                </select>
                <input value={retNotes} onChange={e => setRetNotes(e.target.value)} placeholder="notes (optional)" className="text-[11px] border border-slate-200 rounded px-2 py-1 w-48" />
                <button disabled={busy} onClick={retReceive} className="text-[11px] bg-emerald-600 text-white px-2.5 py-1 rounded hover:bg-emerald-700 disabled:opacity-40">✓ Receive</button>
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-2">Received returns are logged for the report; nothing is written back to Shopify. Restock is condition &quot;good&quot;.</p>
        </div>
      )}

      {/* Auto-booking status (Booking stage) */}
      {stage === 'ready_to_dispatch' && data?.bookingApi && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-xs">
          <div>
            <span className="font-semibold text-slate-700">Auto-booking (courier API): </span>
            {apiOn ? <span className="text-emerald-700 font-bold">ON</span> : <span className="text-slate-400 font-bold">OFF — manual CN</span>}
            {apiOn && <span className="text-slate-400"> · leave the CN blank to auto-create the consignment</span>}
            {data.bookingApi.leopardsCitiesCached === 0 && <span className="text-amber-600"> · Leopards: manual only (cities not cached)</span>}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {data.bookingApi.leopardsCitiesCached === 0 && <button onClick={refreshCities} disabled={busy} className="text-[11px] border border-slate-200 px-2 py-1 rounded hover:border-slate-400 disabled:opacity-40">Refresh Leopards cities</button>}
              <button onClick={toggleApi} disabled={busy} className={`text-[11px] px-2.5 py-1 rounded text-white disabled:opacity-40 ${apiOn ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{apiOn ? 'Turn OFF' : 'Enable auto-booking'}</button>
            </div>
          )}
        </div>
      )}

      {/* Scan box (pack stage) */}
      {stage === 'cn_printed' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Scan to pack</p>
          <input ref={scanRef} value={scan} onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doScan(scan) }}
            placeholder="Scan the CN barcode on the label…" autoFocus
            className="w-full text-sm border-2 border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 outline-none" />
          {lastScan && (
            <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${lastScan.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              <p className="font-bold">{lastScan.text}</p>
              {lastScan.order && (
                <p className="mt-0.5">{lastScan.order.customer_name} · {lastScan.order.city} — pack: {lastScan.order.items?.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk bars */}
      {stage === 'ready_to_dispatch' && apiOn && orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={allSel} onChange={toggleAll} /> select all</label>
          <span className="text-slate-500">{sel.size} selected</span>
          <span className="flex-1" />
          <select value={bulkCourier} onChange={e => setBulkCourier(e.target.value as 'leopards' | 'postex')} className="border border-slate-200 rounded px-1.5 py-1">
            <option value="postex">PostEx</option>
            <option value="leopards">Leopards</option>
          </select>
          <button disabled={busy || !sel.size} onClick={bulkBook} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40">📦 Book {sel.size || ''} to {bulkCourier}</button>
        </div>
      )}
      {stage === 'booked' && orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={allSel} onChange={toggleAll} /> select all</label>
          <span className="text-slate-500">{sel.size} selected</span>
          <span className="flex-1" />
          <button disabled={!sel.size} onClick={bulkPrint} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40">🖨 Print {sel.size || ''} label{sel.size === 1 ? '' : 's'} (PDF)</button>
          <button disabled={busy || !sel.size} onClick={markSelectedPrinted} className="border border-slate-300 text-slate-600 px-3 py-1.5 rounded-lg hover:border-slate-400 disabled:opacity-40">✓ Mark printed</button>
          <button disabled={busy} onClick={() => act({ action: 'print', orderIds: orders.map(o => o.id) })} className="text-slate-400">mark all printed</button>
        </div>
      )}
      {stage === 'packed' && orders.length > 0 && (
        <button disabled={busy} onClick={() => { if (confirm(`Hand ${orders.length} parcel(s) to the courier? This fulfills them in Shopify.`)) act({ action: 'handover', orderIds: orders.map(o => o.id) }) }}
          className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 mb-3 disabled:opacity-40">🤝 Hand all to courier ({orders.length})</button>
      )}

      {/* Order list */}
      {stage !== 'returns' && (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {orders.length === 0 ? <p className="text-sm text-slate-400 text-center py-10">Nothing in this stage.</p> : (
          <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto">
            {orders.map(o => (
              <div key={o.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {(stage === 'ready_to_dispatch' || stage === 'booked') && (
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="shrink-0" />
                  )}
                  <div className="flex-1 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-800">{o.order_number} · {o.customer_name}</p>
                    <p className="text-xs font-bold text-slate-700">{PKR(o.cod_amount)}</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">{o.city}{o.courier ? ` · ${o.courier}` : ''}{o.tracking_number ? ` · CN ${o.tracking_number}` : ''} · {o.items?.reduce((s, i) => s + (i.qty || 1), 0)} item(s)</p>

                {/* Booking controls */}
                {stage === 'ready_to_dispatch' && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <select value={bk[o.id]?.courier ?? 'leopards'} onChange={e => setBk(p => ({ ...p, [o.id]: { courier: e.target.value, cn: p[o.id]?.cn ?? '' } }))}
                      className="text-[11px] border border-slate-200 rounded px-1.5 py-1">
                      <option value="leopards">Leopards</option>
                      <option value="postex">PostEx</option>
                    </select>
                    <input value={bk[o.id]?.cn ?? ''} onChange={e => setBk(p => ({ ...p, [o.id]: { courier: p[o.id]?.courier ?? 'leopards', cn: e.target.value } }))}
                      placeholder="paste CN / tracking #" className="text-[11px] border border-slate-200 rounded px-2 py-1 w-40" />
                    <button disabled={busy} onClick={() => book(o)} className="text-[11px] bg-slate-900 text-white px-2.5 py-1 rounded hover:bg-slate-700 disabled:opacity-40">Book</button>
                  </div>
                )}
                {stage === 'booked' && (
                  <div className="flex gap-3 mt-1">
                    <button onClick={() => printLabels([o])} className="text-[11px] text-blue-600">🖨 print label</button>
                    <button disabled={busy} onClick={() => act({ action: 'print', orderId: o.id })} className="text-[11px] text-slate-500">mark printed</button>
                  </div>
                )}
                {stage === 'packed' && (
                  <button disabled={busy} onClick={() => act({ action: 'handover', orderId: o.id })} className="text-[11px] text-emerald-600 mt-1">hand to courier</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
