'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ShopifySetupContent() {
  const params  = useSearchParams()
  const success = params.get('success') === '1'
  const token   = params.get('token') ?? ''
  const error   = params.get('error') ?? ''

  const [clientId,     setClientId]     = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [testStatus,   setTestStatus]   = useState<'idle'|'testing'|'ok'|'fail'>('idle')

  // If we just got a token back, save to .env instructions are shown
  useEffect(() => {
    if (success && token) setTestStatus('ok')
  }, [success, token])

  async function handleConnect() {
    if (!clientId || !clientSecret) return
    setSaving(true)
    // Save credentials to env via API, then redirect to OAuth
    const res = await fetch('/api/shopify/setup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId, clientSecret }),
    })
    setSaving(false)
    if (res.ok) {
      window.location.href = '/api/shopify/auth'
    } else {
      alert('Failed to save credentials. Check console.')
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sqlSnippet = `CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON site_settings
  FOR ALL USING (true);`

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8">
          <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">← Back to dashboard</a>
          <h1 className="text-2xl font-bold text-gray-900">Connect Shopify</h1>
          <p className="text-sm text-gray-500 mt-1">One-time setup for elyscents.pk Revenue Intelligence</p>
        </div>

        {/* Success state */}
        {success && token && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <p className="text-green-700 font-semibold text-sm mb-1">✓ Connected successfully!</p>
              <p className="text-green-600 text-xs">Your Shopify store is now linked. The Revenue Intelligence tab will start showing data.</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your access token (also saved to DB)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all font-mono text-gray-800">
                  {token}
                </code>
                <button onClick={() => copy(token)}
                  className="shrink-0 text-xs bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-700">
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Also add this to Vercel env vars as <code className="bg-gray-100 px-1 rounded">SHOPIFY_PK_ACCESS_TOKEN</code> for reliability.
              </p>
            </div>

            <a href="/dashboard"
              className="block w-full text-center bg-gray-900 text-white text-sm font-semibold py-3 rounded-xl hover:bg-gray-700 transition-colors">
              Go to Revenue Intelligence →
            </a>
          </div>
        )}

        {/* Error state */}
        {error && !success && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 font-semibold text-sm">Connection failed</p>
            <p className="text-red-600 text-xs mt-1 break-all">{decodeURIComponent(error)}</p>
          </div>
        )}

        {/* Setup form */}
        {!success && (
          <div className="space-y-5">

            {/* Step 1 — Supabase table */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                <p className="text-sm font-semibold text-gray-800">Run this SQL in Supabase (once)</p>
              </div>
              <p className="text-xs text-gray-500 mb-3">Creates the settings table where your token will be stored.</p>
              <div className="relative">
                <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700 font-mono leading-relaxed">{sqlSnippet}</pre>
                <button onClick={() => copy(sqlSnippet)}
                  className="absolute top-2 right-2 text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-50">
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <a href="https://supabase.com/dashboard/project/pkbvsfomajuzemqrmcmy/editor"
                target="_blank" rel="noopener noreferrer"
                className="inline-block mt-3 text-xs text-blue-600 hover:underline">
                Open Supabase SQL Editor →
              </a>
            </div>

            {/* Step 2 — Credentials */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                <p className="text-sm font-semibold text-gray-800">Enter your Dev Dashboard app credentials</p>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                From <a href="https://shopify.dev" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">shopify.dev</a> → Apps → your app → Settings → Credentials
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Client ID</label>
                  <input
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    placeholder="54cc5bc4b60782cbba79196bdd..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    placeholder="shpss_..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-400"
                  />
                </div>
              </div>

              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs font-semibold text-amber-800 mb-1">Before clicking Connect:</p>
                <p className="text-xs text-amber-700">In your Dev Dashboard app → Configuration → set Redirect URL to:</p>
                <code className="text-[11px] text-amber-900 bg-amber-100 px-2 py-1 rounded mt-1 block break-all">
                  {typeof window !== 'undefined' ? window.location.origin : 'https://your-vercel-url.vercel.app'}/api/shopify/callback
                </code>
              </div>
            </div>

            {/* Step 3 — Connect */}
            <button
              onClick={handleConnect}
              disabled={!clientId || !clientSecret || saving}
              className="w-full bg-gray-900 text-white text-sm font-semibold py-3.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : '3 — Connect to Shopify →'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              You&apos;ll be redirected to Shopify to approve access, then automatically returned here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ShopifySetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-sm text-gray-400">Loading…</p></div>}>
      <ShopifySetupContent />
    </Suspense>
  )
}
