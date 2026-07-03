'use client'

import { useState, useEffect } from 'react'

interface Template { name: string; status: string; language: string; category: string; vars: number; hasButtons: boolean }
interface Data {
  connected: boolean
  phone?: { display_phone_number?: string; verified_name?: string; quality_rating?: string }
  templates: Template[]
  mapping: Record<string, { name: string; language: string }>
  enabled: boolean
  error?: string
}

const KINDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'order_confirm',    label: 'Order Confirmation', required: true },
  { key: 'confirm_reminder', label: 'Confirmation Reminder' },
  { key: 'address_request',  label: 'Incomplete Address',  required: true },
]

export default function OmsWhatsappPanel({ onClose }: { onClose: () => void }) {
  const [data, setData]     = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [map, setMap]       = useState<Record<string, string>>({})
  const [msg, setMsg]       = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/oms/whatsapp/templates').then(r => r.json()).then((d: Data) => {
      setData(d)
      const m: Record<string, string> = {}
      for (const k of KINDS) m[k.key] = d.mapping?.[k.key]?.name ?? ''
      setMap(m)
    }).catch(e => setMsg(String(e))).finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    // surface OAuth callback result
    const p = new URLSearchParams(window.location.search).get('wa')
    if (p === 'connected') setMsg('✓ WhatsApp connected via Meta.')
    else if (p) setMsg(`WhatsApp connect issue: ${p}`)
  }, [])

  const approved = (data?.templates ?? []).filter(t => t.status === 'APPROVED')

  async function saveMapping() {
    setSaving(true); setMsg(null)
    const mapping: Record<string, { name: string; language: string }> = {}
    for (const k of KINDS) {
      if (map[k.key]) {
        const t = data?.templates.find(t => t.name === map[k.key])
        mapping[k.key] = { name: map[k.key], language: t?.language ?? 'en' }
      }
    }
    const res = await fetch('/api/oms/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping }) })
    const d = await res.json(); setMsg(d.error ? d.error : '✓ Template mapping saved.'); setSaving(false); load()
  }

  async function toggleEnabled(next: boolean) {
    setSaving(true); setMsg(null)
    // Save current mapping alongside so the enable check sees it
    const mapping: Record<string, { name: string; language: string }> = {}
    for (const k of KINDS) if (map[k.key]) { const t = data?.templates.find(t => t.name === map[k.key]); mapping[k.key] = { name: map[k.key], language: t?.language ?? 'en' } }
    const res = await fetch('/api/oms/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping, enabled: next }) })
    const d = await res.json(); setMsg(d.error ? d.error : next ? '✓ WhatsApp sending ENABLED.' : 'WhatsApp sending disabled (shadow).'); setSaving(false); load()
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">📲 WhatsApp Setup</h3>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700">✕ close</button>
      </div>

      {msg && <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3 text-slate-600">{msg}</div>}
      {loading ? <p className="text-sm text-slate-400 py-4">Loading…</p> : !data ? null : (
        <div className="space-y-4">
          {/* Connection */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs">
              {data.connected ? (
                <>
                  <p className="font-semibold text-emerald-700">● Connected</p>
                  <p className="text-slate-500">{data.phone?.verified_name} · {data.phone?.display_phone_number} · quality {data.phone?.quality_rating}</p>
                </>
              ) : (
                <p className="font-semibold text-red-600">● Not connected {data.error ? `— ${data.error}` : ''}</p>
              )}
            </div>
            <a href="/api/oms/whatsapp/oauth" className="text-xs bg-[#1877F2] text-white px-3 py-2 rounded-lg hover:opacity-90">Connect via Meta (OAuth)</a>
          </div>

          {/* Template mapping */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Map OMS messages → approved templates</p>
            <div className="space-y-2">
              {KINDS.map(k => (
                <div key={k.key} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-44">{k.label}{k.required && <span className="text-red-500"> *</span>}</span>
                  <select value={map[k.key] ?? ''} onChange={e => setMap({ ...map, [k.key]: e.target.value })}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-1">
                    <option value="">— none —</option>
                    {approved.map(t => <option key={t.name} value={t.name}>{t.name} ({t.vars} vars)</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={saveMapping} disabled={saving} className="mt-2 text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40">Save mapping</button>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs">
              <p className="font-semibold text-slate-700">WhatsApp sending {data.enabled ? <span className="text-emerald-700">ON (live)</span> : <span className="text-amber-600">OFF (shadow)</span>}</p>
              <p className="text-slate-400">When ON, customers get real confirmation messages + the auto-retry loop runs.</p>
            </div>
            <button onClick={() => toggleEnabled(!data.enabled)} disabled={saving}
              className={`text-xs px-3 py-2 rounded-lg text-white disabled:opacity-40 ${data.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              {data.enabled ? 'Turn OFF' : 'Enable live sending'}
            </button>
          </div>

          {/* Templates list */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Templates from Meta ({data.templates.length})</p>
              <button onClick={load} className="text-[11px] text-blue-600">↻ refresh</button>
            </div>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-50 max-h-52 overflow-y-auto">
              {data.templates.map(t => (
                <div key={t.name} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="font-mono text-slate-700">{t.name}</span>
                  <span className="text-slate-400">{t.category} · {t.vars}v{t.hasButtons ? ' · btns' : ''} · <span className={t.status === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'}>{t.status}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
