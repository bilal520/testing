'use client'

import { useCallback, useEffect, useState } from 'react'

interface SampleAd { id: string; snapshot_url: string; body: string; image: string | null; start: string }
interface Page {
  page_id: string; page_name: string; page_url: string; scam_score: number
  signals: Record<string, number> | null; claude_why: string | null
  profile_pic_url: string | null; landing_domains: string[] | null
  sample_ads: SampleAd[] | null; status: string; first_seen: string; last_seen: string; reported_at: string | null
}
interface RefItem { id: number; kind: string; url: string; label: string | null }
interface Data { pages: Page[]; references: RefItem[]; watchlist: Array<{ page_id: string; note: string }>; isAdmin: boolean }

const SIGNAL_LABEL: Record<string, string> = { creative: 'stolen video/image', identity: 'stolen logo/face', name: 'lookalike name', domain: 'lookalike domain', copy: 'copied ad copy', behavior: 'scam pattern' }

function reportLinks(p: Page) {
  const dom = (p.landing_domains ?? [])[0]
  return {
    metaCopyright: 'https://www.facebook.com/help/contact/1758255661104383',
    metaTrademark: 'https://www.facebook.com/help/contact/1188039708512577',
    metaImpersonation: 'https://www.facebook.com/help/contact/169486816013840',
    shopify: 'https://www.shopify.com/legal/dmca',
    whois: dom ? `https://who.is/whois/${dom}` : null,
  }
}

export default function CounterfeitHunterTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [hunting, setHunting] = useState(false)
  const [busy, setBusy] = useState('')
  const [showRefs, setShowRefs] = useState(false)
  const [faceUrl, setFaceUrl] = useState('')
  const [m, setM] = useState({ name: '', url: '', domain: '' })
  const [tok, setTok] = useState('')
  const [tokMsg, setTokMsg] = useState('')

  const testToken = async (token?: string) => {
    setTokMsg('Testing…')
    const r = await fetch('/api/cf/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'testToken', token }) }).then(r => r.json())
    setTokMsg(r.ok ? `✓ Ad Library access works (sample: ${r.sample} ads). Run a hunt now.` : `✗ ${r.error}`)
  }
  const saveToken = async () => {
    await fetch('/api/cf/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setToken', token: tok }) })
    setTok(''); await testToken()
  }

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await fetch('/api/cf/pages', { cache: 'no-store' }).then(r => r.json())) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (payload: Record<string, unknown>) => {
    setBusy(JSON.stringify(payload))
    try { await fetch('/api/cf/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await load() }
    finally { setBusy('') }
  }
  const huntNow = async () => {
    setHunting(true)
    try { await fetch('/api/cf/hunt', { method: 'POST' }); await load() } finally { setHunting(false) }
  }

  const pages = data?.pages ?? []
  const confirmed = pages.filter(p => p.scam_score >= 60 && !['whitelisted', 'removed'].includes(p.status))
  const watch = pages.filter(p => p.scam_score < 60 && p.scam_score >= 25 && !['whitelisted', 'removed'].includes(p.status))

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">🛡 Brand Guard — impersonator hunter</h2>
          <p className="text-xs text-gray-500">Finds pages reusing your videos/logo/face even when they hide your name. Confirm → report → close.</p>
        </div>
        <button onClick={huntNow} disabled={hunting} className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm disabled:opacity-50">{hunting ? 'Hunting…' : '🔎 Hunt now'}</button>
      </div>

      {/* manual log — works even before the Ad Library API is authorised */}
      <div className="rounded-lg border bg-gray-50 p-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Found one? Paste its <b>Facebook page URL</b> → we pull their ads + match them on next Hunt →</span>
        <input placeholder="Page name (e.g. Flora perfume)" value={m.name} onChange={e => setM({ ...m, name: e.target.value })} className="border rounded px-2 py-1" />
        <input placeholder="facebook.com/… page URL (required)" value={m.url} onChange={e => setM({ ...m, url: e.target.value })} className="border rounded px-2 py-1 w-64" />
        <input placeholder="their domain (elyscents.store)" value={m.domain} onChange={e => setM({ ...m, domain: e.target.value })} className="border rounded px-2 py-1" />
        <button disabled={!!busy || !m.name} onClick={() => { act({ action: 'addPage', name: m.name, url: m.url, domain: m.domain }); setM({ name: '', url: '', domain: '' }) }} className="px-2 py-1 rounded bg-gray-900 text-white">Add</button>
      </div>

      {/* Ad Library API token — required for auto-hunt (system tokens are rejected) */}
      {data?.isAdmin && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs space-y-1">
          <div className="font-medium text-amber-800">Ad Library API token</div>
          <div className="text-amber-700">Auto-hunt needs a <b>USER</b> access token from your identity-confirmed Facebook account (the system token is rejected by Meta). Get one at developers.facebook.com/tools/explorer (logged in as your confirmed account) and paste it here.</div>
          <div className="flex gap-2 items-center">
            <input type="password" value={tok} onChange={e => setTok(e.target.value)} placeholder="EAAG… (user token)" className="flex-1 border rounded px-2 py-1" />
            <button disabled={!tok} onClick={saveToken} className="px-2 py-1 rounded bg-gray-900 text-white">Save &amp; test</button>
            <button onClick={() => testToken()} className="px-2 py-1 rounded border">Test current</button>
          </div>
          {tokMsg && <div className={tokMsg.startsWith('✓') ? 'text-green-700' : 'text-red-600'}>{tokMsg}</div>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Confirmed impostors" value={confirmed.length} accent />
        <Tile label="To review (watch)" value={watch.length} />
        <Tile label="Reported / removed" value={pages.filter(p => ['reported', 'removed'].includes(p.status)).length} />
      </div>

      {loading && !data && <p className="text-sm text-gray-400">Loading…</p>}

      {[{ title: `Confirmed impersonators (${confirmed.length})`, list: confirmed }, { title: `Watch — needs your eyes (${watch.length})`, list: watch }].map(sec => (
        <div key={sec.title} className="space-y-3">
          <h3 className="text-sm font-medium text-gray-800">{sec.title}</h3>
          {!sec.list.length && <p className="text-xs text-gray-400">None. Run a hunt or check back after the next scan.</p>}
          {sec.list.map(p => <PageCard key={p.page_id} p={p} busy={busy} act={act} />)}
        </div>
      ))}

      {/* reference set (protect these) */}
      {data?.isAdmin && (
        <div>
          <button onClick={() => setShowRefs(v => !v)} className="text-xs text-gray-500 hover:text-gray-800">{showRefs ? '▾' : '▸'} Protected assets (what we match against)</button>
          {showRefs && (
            <div className="mt-2 rounded-lg border bg-gray-50 p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Your ad creatives are auto-pulled from Facebook. Add photos of your face so we catch pages using it as their profile.</span>
                <button disabled={!!busy} onClick={() => act({ action: 'refreshCreatives' })} className="px-2 py-1 rounded border text-xs">Refresh creatives</button>
              </div>
              <div className="flex gap-2">
                <input value={faceUrl} onChange={e => setFaceUrl(e.target.value)} placeholder="https://…/your-photo.jpg (founder face)" className="flex-1 border rounded px-2 py-1 text-xs" />
                <button disabled={!!busy || !faceUrl} onClick={() => { act({ action: 'refAdd', kind: 'face', url: faceUrl, label: 'founder' }); setFaceUrl('') }} className="px-2 py-1 rounded bg-gray-900 text-white text-xs">Add face</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(data.references ?? []).map(r => (
                  <div key={r.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt={r.kind} className="h-14 w-14 object-cover rounded border" referrerPolicy="no-referrer" />
                    <span className="absolute -top-1 -left-1 text-[9px] bg-gray-800 text-white px-1 rounded">{r.kind}</span>
                    <button onClick={() => act({ action: 'refRemove', id: r.id })} className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none">×</button>
                  </div>
                ))}
                {!data.references?.length && <span className="text-xs text-gray-400">No references yet — click Refresh creatives.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent && value > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold ${accent && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function PageCard({ p, busy, act }: { p: Page; busy: string; act: (x: Record<string, unknown>) => void }) {
  const rl = reportLinks(p)
  const chips = Object.entries(p.signals ?? {}).filter(([, v]) => v >= 50).map(([k]) => SIGNAL_LABEL[k] ?? k)
  const scoreColor = p.scam_score >= 60 ? 'bg-red-600' : p.scam_score >= 25 ? 'bg-amber-500' : 'bg-gray-400'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.profile_pic_url ? <img src={p.profile_pic_url} alt="" className="h-12 w-12 rounded-full object-cover border" referrerPolicy="no-referrer" /> : <div className="h-12 w-12 rounded-full bg-gray-100" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a href={p.page_url} target="_blank" rel="noreferrer" className="font-medium text-gray-900 hover:underline">{p.page_name}</a>
            <span className={`text-white text-xs px-2 py-0.5 rounded ${scoreColor}`}>{p.scam_score}</span>
            {p.status !== 'active' && <span className="text-[10px] uppercase text-gray-500 border rounded px-1">{p.status}</span>}
          </div>
          {p.claude_why && <p className="text-xs text-gray-600 mt-0.5">{p.claude_why}</p>}
          <div className="flex flex-wrap gap-1 mt-1">
            {chips.map(c => <span key={c} className="badge text-[10px] bg-red-50 text-red-700">{c}</span>)}
            {(p.landing_domains ?? []).slice(0, 2).map(d => <span key={d} className="badge text-[10px] bg-gray-100 text-gray-600">{d}</span>)}
          </div>
        </div>
      </div>

      {/* their stolen ads */}
      {!!p.sample_ads?.length && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {p.sample_ads.map((a, i) => (
            <a key={i} href={a.snapshot_url} target="_blank" rel="noreferrer" className="shrink-0" title="Open in Ad Library">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.image ? <img src={a.image} alt="" className="h-24 w-24 object-cover rounded border" referrerPolicy="no-referrer" /> : <div className="h-24 w-24 rounded border bg-gray-50 text-[10px] text-gray-400 flex items-center justify-center">ad</div>}
            </a>
          ))}
        </div>
      )}

      {/* actions + takedown links */}
      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
        <span className="text-gray-400">Report →</span>
        <a href={rl.metaCopyright} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Meta (copyright)</a>
        <a href={rl.metaTrademark} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Meta (trademark)</a>
        <a href={rl.metaImpersonation} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Meta (impersonation)</a>
        <a href={rl.shopify} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Shopify DMCA</a>
        {rl.whois && <a href={rl.whois} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Domain whois</a>}
        <span className="flex-1" />
        <button disabled={!!busy} onClick={() => act({ action: 'setStatus', pageId: p.page_id, status: 'reported' })} className="px-2 py-1 rounded bg-gray-900 text-white">Mark reported</button>
        <button disabled={!!busy} onClick={() => act({ action: 'setStatus', pageId: p.page_id, status: 'removed' })} className="px-2 py-1 rounded border">Removed</button>
        <button disabled={!!busy} onClick={() => act({ action: 'setStatus', pageId: p.page_id, status: 'whitelisted' })} className="px-2 py-1 rounded border text-gray-500">Not them</button>
        <button disabled={!!busy} onClick={() => act({ action: 'watchlistAdd', pageId: p.page_id, note: p.page_name })} className="px-2 py-1 rounded border">Watchlist</button>
      </div>
    </div>
  )
}
