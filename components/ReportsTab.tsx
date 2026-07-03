'use client'

import { useState, useEffect, useCallback } from 'react'

interface Entry { key: string; count: number }
interface Staff { agent: string; total: number; confirms: number; cancels: number; packs: number; moves: number }
interface CourierRow { courier: string; total: number; delivered: number; returned: number; returnRate: number; cod: number }
interface Reports {
  range: { from: string; to: string }
  dispatch: { total: number; byCourier: Record<string, number>; byCity: Entry[]; byDay: Entry[] }
  products: Entry[]
  cancellations: { total: number; byDay: Entry[]; byAgent: Entry[]; reasons: Entry[] }
  pack: { total: number; byDay: Entry[]; byAgent: Entry[] }
  staff: Staff[]
  returns: { total: number; byCourier: Record<string, number>; byCity: Entry[]; byReason: Entry[] }
  courierSummary: CourierRow[]
  returnsReceived: { total: number; good: number; damaged: number; byDay: Entry[] }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const csv = [header.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url)
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[9px] text-slate-400">{sub}</p>}
    </div>
  )
}
function EntryTable({ title, entries, unit = '', dl }: { title: string; entries: Entry[]; unit?: string; dl?: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{title}</p>
        {dl && <button onClick={dl} className="text-[10px] text-blue-600">↓ CSV</button>}
      </div>
      {entries.length === 0 ? <p className="text-xs text-slate-300">no data</p> : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {entries.map(e => (
            <div key={e.key} className="flex items-center justify-between text-xs">
              <span className="text-slate-600 truncate pr-2">{e.key}</span>
              <span className="font-semibold text-slate-800">{e.count.toLocaleString()}{unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ReportsTab() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo]     = useState(iso(new Date()))
  const [data, setData] = useState<Reports | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setMsg(null)
    fetch(`/api/oms/reports?from=${from}&to=${to}`, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setMsg(d.error); else setData(d) })
      .catch(e => setMsg(String(e))).finally(() => setLoading(false))
  }, [from, to])
  useEffect(() => { load() }, [load])

  const entriesFromMap = (m: Record<string, number>): Entry[] => Object.entries(m).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">📊 Reports</h2>
          <p className="text-xs text-slate-400 mt-0.5">Operations reporting for the selected date range.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-slate-500">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block text-xs border border-slate-200 rounded-lg px-2 py-1.5" /></label>
          <label className="text-[11px] text-slate-500">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block text-xs border border-slate-200 rounded-lg px-2 py-1.5" /></label>
          <button onClick={load} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700">Run</button>
        </div>
      </div>

      {msg && <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-600">{msg}</div>}
      {loading && <p className="text-sm text-slate-400 py-6 text-center">Crunching…</p>}

      {data && !loading && (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Kpi label="Dispatched" value={data.dispatch.total.toLocaleString()} />
            <Kpi label="Returns (courier)" value={data.returns.total.toLocaleString()} />
            <Kpi label="Cancellations" value={data.cancellations.total.toLocaleString()} />
            <Kpi label="Packed" value={data.pack.total.toLocaleString()} />
            <Kpi label="Returns received" value={data.returnsReceived.total.toLocaleString()} sub={`${data.returnsReceived.good} good · ${data.returnsReceived.damaged} damaged`} />
            <Kpi label="Range" value={`${data.range.from.slice(5)}→${data.range.to.slice(5)}`} />
          </div>

          {/* Courier summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Courier summary</p>
              <button onClick={() => downloadCsv('courier-summary', ['courier', 'total', 'delivered', 'returned', 'return_rate_%', 'cod'], data.courierSummary.map(c => [c.courier, c.total, c.delivered, c.returned, c.returnRate, c.cod]))} className="text-[10px] text-blue-600">↓ CSV</button>
            </div>
            <table className="w-full text-xs">
              <thead className="text-slate-400 text-[10px] uppercase"><tr><th className="text-left py-1">Courier</th><th className="text-right">Booked</th><th className="text-right">Delivered</th><th className="text-right">Returned</th><th className="text-right">Return %</th><th className="text-right">COD</th></tr></thead>
              <tbody>
                {data.courierSummary.map(c => (
                  <tr key={c.courier} className="border-t border-slate-50">
                    <td className="py-1 font-semibold text-slate-700 capitalize">{c.courier}</td>
                    <td className="text-right">{c.total.toLocaleString()}</td>
                    <td className="text-right text-emerald-600">{c.delivered.toLocaleString()}</td>
                    <td className="text-right text-rose-600">{c.returned.toLocaleString()}</td>
                    <td className={`text-right font-semibold ${c.returnRate >= 30 ? 'text-rose-600' : 'text-slate-700'}`}>{c.returnRate}%</td>
                    <td className="text-right">PKR {c.cod.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Staff productivity */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Staff — who did what</p>
              <button onClick={() => downloadCsv('staff', ['agent', 'total', 'confirms', 'cancels', 'packs', 'moves'], data.staff.map(s => [s.agent, s.total, s.confirms, s.cancels, s.packs, s.moves]))} className="text-[10px] text-blue-600">↓ CSV</button>
            </div>
            {data.staff.length === 0 ? <p className="text-xs text-slate-300">no agent activity in range</p> : (
              <table className="w-full text-xs">
                <thead className="text-slate-400 text-[10px] uppercase"><tr><th className="text-left py-1">Agent</th><th className="text-right">Actions</th><th className="text-right">Confirms</th><th className="text-right">Cancels</th><th className="text-right">Packs</th><th className="text-right">Moves</th></tr></thead>
                <tbody>
                  {data.staff.map(s => (
                    <tr key={s.agent} className="border-t border-slate-50">
                      <td className="py-1 font-semibold text-slate-700">{s.agent}</td>
                      <td className="text-right">{s.total}</td><td className="text-right">{s.confirms}</td><td className="text-right">{s.cancels}</td><td className="text-right">{s.packs}</td><td className="text-right">{s.moves}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Grids of entry tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <EntryTable title="Products dispatched" entries={data.products} dl={() => downloadCsv('products-dispatched', ['product', 'qty'], data.products.map(e => [e.key, e.count]))} />
            <EntryTable title="Dispatch by city" entries={data.dispatch.byCity} dl={() => downloadCsv('dispatch-by-city', ['city', 'count'], data.dispatch.byCity.map(e => [e.key, e.count]))} />
            <EntryTable title="Dispatch by courier" entries={entriesFromMap(data.dispatch.byCourier)} />
            <EntryTable title="Returns by reason" entries={data.returns.byReason} dl={() => downloadCsv('returns-by-reason', ['reason', 'count'], data.returns.byReason.map(e => [e.key, e.count]))} />
            <EntryTable title="Returns by city" entries={data.returns.byCity} />
            <EntryTable title="Returns by courier" entries={entriesFromMap(data.returns.byCourier)} />
            <EntryTable title="Cancellations by day" entries={data.cancellations.byDay} />
            <EntryTable title="Cancellation reasons" entries={data.cancellations.reasons} dl={() => downloadCsv('cancellation-reasons', ['reason', 'count'], data.cancellations.reasons.map(e => [e.key, e.count]))} />
            <EntryTable title="Packed by day" entries={data.pack.byDay} />
            <EntryTable title="Dispatched by day" entries={data.dispatch.byDay} dl={() => downloadCsv('dispatched-by-day', ['day', 'count'], data.dispatch.byDay.map(e => [e.key, e.count]))} />
            <EntryTable title="Returns received by day" entries={data.returnsReceived.byDay} />
          </div>
        </>
      )}
    </div>
  )
}
