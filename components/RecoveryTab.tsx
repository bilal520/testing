'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

const rs = (n: unknown) => `Rs ${Math.round(Number(n ?? 0)).toLocaleString()}`
const num = (n: unknown) => Number(n ?? 0).toLocaleString()

interface Report {
  range: { from: string; to: string }
  funnel: Record<string, number>
  money: Record<string, number>
  byStep: Array<{ step: number; sent: number; delivered: number; read: number }>
  byTemplate: Array<{ template: string; sent: number; recovered: number }>
  detail: Array<Record<string, unknown>>
  error?: string
}
interface Status {
  config: Record<string, unknown>
  enabled: boolean
  paused: boolean
  testNumbers: string[]
  templates: Record<string, { name: string; language: string }>   // cars_wa_templates config map
  wa: { connected?: boolean; phone?: { display_phone_number?: string; quality_rating?: string }; error?: string; templates?: Array<{ name: string; status: string; language: string; category: string }> } | null
  suppression: number
  isAdmin: boolean
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const monthStart = () => todayStr().slice(0, 8) + '01'

export default function RecoveryTab() {
  const [range, setRange] = useState<Report | null>(null)
  const [today, setToday] = useState<Report | null>(null)
  const [mtd, setMtd] = useState<Report | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [loading, setLoading] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [busy, setBusy] = useState('')

  const getReport = (f: string, t: string) => fetch(`/api/cars/report?from=${f}&to=${t}`, { cache: 'no-store' }).then(r => r.json())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, td, m, s] = await Promise.all([
        getReport(from, to), getReport(todayStr(), todayStr()), getReport(monthStart(), todayStr()),
        fetch('/api/cars/config', { cache: 'no-store' }).then(r => r.json()),
      ])
      setRange(r); setToday(td); setMtd(m); setStatus(s)
    } finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { load() }, [load])

  const act = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label)
    try { await fetch('/api/cars/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await load() }
    finally { setBusy('') }
  }

  const exportCsv = () => {
    if (!range?.detail?.length) return
    const cols = ['recoveredAt', 'order', 'phone', 'value', 'confidence', 'step', 'deliveryStatus', 'cash']
    const lines = [cols.join(',')].concat(range.detail.map(d => cols.map(c => JSON.stringify(d[c] ?? '')).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `recovery_${from}_${to}.csv`; a.click()
  }

  const f = range?.funnel ?? {}, mo = range?.money ?? {}
  const q = status?.wa?.phone?.quality_rating

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Checkout Recovery</h2>
          <p className="text-xs text-gray-500">Abandoned-cart recovery via WhatsApp — money actually made (delivery-realized).</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1" />
          <span className="text-gray-400">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1" />
          <button onClick={load} className="px-3 py-1.5 bg-gray-900 text-white rounded text-xs">{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      {/* status banner */}
      {status && !status.enabled && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2.5">
          🟡 <b>Shadow mode</b> — the engine is computing and logging every intended message but <b>sending nothing</b>. Flip the master switch in Setup to go live.
        </div>
      )}
      {status?.enabled && status.paused && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5">
          🔴 <b>Paused</b> — sends are halted (WhatsApp quality {q ?? 'dropped'}). Resume in Setup once quality recovers.
        </div>
      )}
      {status?.enabled && !status.paused && status.testNumbers.length > 0 && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm px-4 py-2.5">
          🔵 <b>Supervised live</b> — only sending to {status.testNumbers.length} test number(s); everyone else is shadowed.
        </div>
      )}

      {/* headline money tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Recovered today" value={num((today?.funnel.recoveredConfirmed ?? 0) + (today?.funnel.recoveredProbable ?? 0))} sub={`${rs(today?.funnel.revenueConfirmed)} gross`} />
        <Tile label="Money made today" value={rs(today?.money.cashCollected)} sub={`${num(today?.money.deliveredOrders)} delivered · ${num(today?.money.inTransit)} in transit`} accent />
        <Tile label="MTD money made" value={rs(mtd?.money.netMade)} sub={`${rs(mtd?.money.cashCollected)} collected`} accent />
        <Tile label="MTD recovered" value={num((mtd?.funnel.recoveredConfirmed ?? 0) + (mtd?.funnel.recoveredProbable ?? 0))} sub={`ROI ${num(mtd?.money.roi)}×`} />
      </div>

      {/* range funnel + money */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title={`Funnel · ${from} → ${to}`}>
          <Row k="Abandoned carts" v={`${num(f.abandoned)} · ${rs(f.abandonedValue)}`} />
          <Row k="Messaged" v={num(f.messagedCheckouts)} />
          <Row k="Sent / Delivered / Read" v={`${num(f.sent)} / ${num(f.delivered)} / ${num(f.read)}`} />
          {Number(f.shadow) > 0 && <Row k="Shadow (not sent)" v={num(f.shadow)} muted />}
          <Row k="Replies" v={num(f.replies)} />
          <Row k="Recovered — confirmed" v={`${num(f.recoveredConfirmed)} · ${rs(f.revenueConfirmed)}`} strong />
          <Row k="Recovered — assisted" v={`${num(f.recoveredProbable)} · ${rs(f.revenueProbable)}`} muted />
          <Row k="Recovery rate" v={`${num(f.recoveryRate)}%`} />
        </Card>
        <Card title="Money actually made (delivery-realized)">
          <Row k="Delivered → cash collected" v={`${num(mo.deliveredOrders)} · ${rs(mo.cashCollected)}`} strong />
          <Row k="In transit (potential)" v={`${num(mo.inTransit)} · ${rs(mo.inTransitValue)}`} muted />
          <Row k="Returned (RTO)" v={`${num(mo.returnedOrders)} · −${rs(mo.returnCost)}`} />
          <Row k="Message cost" v={`−${rs(mo.msgCost)}`} muted />
          {Number(mo.incentiveCost) > 0 && <Row k="Incentive cost" v={`−${rs(mo.incentiveCost)}`} muted />}
          <div className="border-t my-1" />
          <Row k="NET money made" v={rs(mo.netMade)} strong />
          <Row k="ROI (net ÷ msg cost)" v={`${num(mo.roi)}×`} />
        </Card>
      </div>

      {/* per-step + per-template */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="By sequence step">
          {(range?.byStep ?? []).map(s => (
            <Row key={s.step} k={`Step ${s.step} (${s.step === 1 ? '1h' : s.step === 2 ? '24h' : '72h'})`} v={`${num(s.sent)} sent · ${num(s.read)} read`} />
          ))}
        </Card>
        <Card title="By template">
          {(range?.byTemplate ?? []).map(t => <Row key={t.template} k={t.template} v={`${num(t.sent)} sent`} />)}
          {!range?.byTemplate?.length && <p className="text-xs text-gray-400">No sends yet.</p>}
        </Card>
      </div>

      {/* detail log */}
      <Card title={`Recovered orders (${range?.detail?.length ?? 0})`} action={<button onClick={exportCsv} className="text-xs text-cyan-700 hover:underline">Export CSV</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b">
              <th className="py-1 pr-3">Recovered</th><th className="pr-3">Order</th><th className="pr-3">Phone</th><th className="pr-3 text-right">Value</th><th className="pr-3">Attribution</th><th className="pr-3">Step</th><th className="pr-3">Delivery</th><th className="text-right">Cash</th>
            </tr></thead>
            <tbody>
              {(range?.detail ?? []).slice(0, 100).map((d, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1 pr-3 text-gray-500">{String(d.recoveredAt ?? '').slice(0, 10)}</td>
                  <td className="pr-3">{String(d.order ?? '—')}</td>
                  <td className="pr-3 text-gray-500">{String(d.phone ?? '')}</td>
                  <td className="pr-3 text-right">{rs(d.value)}</td>
                  <td className="pr-3"><span className={`badge text-[10px] ${d.confidence === 'exact' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{String(d.confidence ?? '')}</span></td>
                  <td className="pr-3">{String(d.step ?? '')}</td>
                  <td className="pr-3"><DeliveryBadge s={String(d.deliveryStatus ?? '')} /></td>
                  <td className="text-right">{Number(d.cash) > 0 ? rs(d.cash) : '—'}</td>
                </tr>
              ))}
              {!range?.detail?.length && <tr><td colSpan={8} className="py-4 text-center text-gray-400">No recovered orders in this range yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* admin setup */}
      {status?.isAdmin && (
        <div>
          <button onClick={() => setShowSetup(v => !v)} className="text-xs text-gray-500 hover:text-gray-800">{showSetup ? '▾' : '▸'} Setup & controls (admin)</button>
          {showSetup && status && <SetupPanel status={status} busy={busy} act={act} />}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-medium text-gray-800">{title}</h3>{action}</div>
      {children}
    </div>
  )
}
function Row({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={muted ? 'text-gray-400' : 'text-gray-600'}>{k}</span>
      <span className={`${strong ? 'font-semibold text-gray-900' : muted ? 'text-gray-400' : 'text-gray-800'}`}>{v}</span>
    </div>
  )
}
function DeliveryBadge({ s }: { s: string }) {
  const map: Record<string, string> = { delivered: 'bg-green-50 text-green-700', in_transit: 'bg-blue-50 text-blue-700', returned: 'bg-red-50 text-red-600', cancelled: 'bg-gray-100 text-gray-500', pending: 'bg-gray-100 text-gray-500' }
  return <span className={`badge text-[10px] ${map[s] ?? 'bg-gray-100 text-gray-500'}`}>{s.replace('_', ' ')}</span>
}

function SetupPanel({ status, busy, act }: { status: Status; busy: string; act: (p: Record<string, unknown>, l: string) => void }) {
  const [tests, setTests] = useState(status.testNumbers.join(', '))
  const cfg = status.config as Record<string, unknown>
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4 text-sm">
      {/* master switch */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">Master switch</div>
          <div className="text-xs text-gray-500">OFF = shadow (safe). ON = real WhatsApp sends to customers.</div>
        </div>
        {status.enabled
          ? <button disabled={!!busy} onClick={() => { if (confirm('Turn OFF recovery sends (back to shadow)?')) act({ action: 'disable' }, 'disable') }} className="px-3 py-1.5 rounded bg-red-600 text-white text-xs">Turn OFF</button>
          : <button disabled={!!busy} onClick={() => { if (confirm('Go LIVE? Real WhatsApp messages will be sent to customers (respecting the test-number allowlist if set).')) act({ action: 'enable' }, 'enable') }} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs">Go LIVE</button>}
      </div>

      {status.enabled && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">{status.paused ? 'Sends paused (quality).' : 'Sends active.'}</div>
          {status.paused
            ? <button disabled={!!busy} onClick={() => act({ action: 'resume' }, 'resume')} className="px-3 py-1 rounded border text-xs">Resume</button>
            : <button disabled={!!busy} onClick={() => act({ action: 'pause' }, 'pause')} className="px-3 py-1 rounded border text-xs">Pause</button>}
        </div>
      )}

      {/* WhatsApp + templates */}
      <div className="border-t pt-3">
        <div className="font-medium mb-1">WhatsApp</div>
        <div className="text-xs text-gray-600">
          {status.wa?.connected ? `Connected · ${status.wa.phone?.display_phone_number ?? ''} · quality ${status.wa.phone?.quality_rating ?? '—'}` : `Not connected ${status.wa?.error ? '· ' + status.wa.error : ''}`}
        </div>
        <div className="mt-1 space-y-0.5">
          {(status.wa?.templates ?? []).map(t => (
            <div key={t.name} className="flex justify-between text-xs">
              <span className="text-gray-600">{t.name}</span>
              <span className={t.status === 'APPROVED' ? 'text-green-600' : 'text-amber-600'}>{t.status}</span>
            </div>
          ))}
          {!(status.wa?.templates ?? []).length && <div className="text-xs text-gray-400">No cart_recovery_* templates found — submit + approve them in Meta.</div>}
        </div>
      </div>

      {/* test numbers */}
      <div className="border-t pt-3">
        <div className="font-medium mb-1">Test numbers (supervised go-live)</div>
        <div className="text-xs text-gray-500 mb-1">When set, ONLY these get real sends; everyone else is shadowed. Comma-separated 03XXXXXXXXX.</div>
        <div className="flex gap-2">
          <input value={tests} onChange={e => setTests(e.target.value)} placeholder="03001234567" className="flex-1 border rounded px-2 py-1 text-xs" />
          <button disabled={!!busy} onClick={() => act({ action: 'setTestNumbers', numbers: tests.split(',').map(s => s.trim()).filter(Boolean) }, 'tests')} className="px-3 py-1 rounded bg-gray-900 text-white text-xs">Save</button>
        </div>
      </div>

      {/* config */}
      <div className="border-t pt-3">
        <div className="font-medium mb-1">Config</div>
        <ConfigEditor cfg={cfg} busy={busy} onSave={c => act({ action: 'setConfig', config: c }, 'config')} />
      </div>

      {/* run once */}
      <div className="border-t pt-3 flex items-center justify-between">
        <div className="text-xs text-gray-500">Run one poll+send cycle now (respects gating — shadow while OFF). Suppressed: {status.suppression}</div>
        <button disabled={!!busy} onClick={() => act({ action: 'runNow' }, 'run')} className="px-3 py-1 rounded border text-xs">{busy === 'run' ? 'Running…' : 'Run now'}</button>
      </div>
    </div>
  )
}

function ConfigEditor({ cfg, busy, onSave }: { cfg: Record<string, unknown>, busy: string, onSave: (c: Record<string, unknown>) => void }) {
  const delays = (Array.isArray(cfg.sequence_delays_min) ? cfg.sequence_delays_min : [60, 1440, 4320]) as number[]
  const [floor, setFloor] = useState(String(cfg.min_cart_value ?? 1000))
  const [win, setWin] = useState(String(cfg.send_window ?? '09:00-22:00'))
  const [cap, setCap] = useState(String(cfg.daily_send_cap ?? 200))
  const [disc, setDisc] = useState(String(cfg.discount_type ?? 'free_shipping'))
  const [step3, setStep3] = useState(Boolean(cfg.step3_enabled ?? true))
  const [delay1, setDelay1] = useState(String(delays[0] ?? 60))
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <label className="flex flex-col">1st message delay (min)<input value={delay1} onChange={e => setDelay1(e.target.value)} className="border rounded px-2 py-1" /></label>
      <label className="flex flex-col">Cart floor (Rs)<input value={floor} onChange={e => setFloor(e.target.value)} className="border rounded px-2 py-1" /></label>
      <label className="flex flex-col">Send window (PKT)<input value={win} onChange={e => setWin(e.target.value)} className="border rounded px-2 py-1" /></label>
      <label className="flex flex-col">Daily cap<input value={cap} onChange={e => setCap(e.target.value)} className="border rounded px-2 py-1" /></label>
      <label className="flex flex-col">Incentive
        <select value={disc} onChange={e => setDisc(e.target.value)} className="border rounded px-2 py-1">
          <option value="free_shipping">Free shipping</option><option value="percent">Percent</option><option value="none">None</option>
        </select>
      </label>
      <label className="flex items-center gap-2 col-span-2"><input type="checkbox" checked={step3} onChange={e => setStep3(e.target.checked)} /> Send 3rd (72h) message</label>
      <div className="col-span-2">
        <button disabled={!!busy} onClick={() => onSave({ min_cart_value: Number(floor), send_window: win, daily_send_cap: Number(cap), discount_type: disc, step3_enabled: step3, sequence_delays_min: [Number(delay1), delays[1] ?? 1440, delays[2] ?? 4320] })} className="px-3 py-1 rounded bg-gray-900 text-white text-xs">{busy === 'config' ? 'Saving…' : 'Save config'}</button>
      </div>
    </div>
  )
}
