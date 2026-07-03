'use client'

import { useEffect, useState } from 'react'

export default function ReportSettingsPanel() {
  const [number, setNumber]   = useState('')
  const [enabled, setEnabled] = useState(false)
  const [time, setTime]       = useState('10:00')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  useEffect(() => {
    fetch('/api/settings/report')
      .then(r => r.json())
      .then(d => {
        setNumber(d.whatsapp_number ?? '')
        setEnabled(d.daily_report_enabled ?? false)
        setTime(d.report_time ?? '10:00')
      })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    await fetch('/api/settings/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp_number: number, daily_report_enabled: enabled, report_time: time }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-8">
      <div className="max-w-lg">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Notifications</h2>
        <p className="text-sm text-gray-500 mb-6">
          Receive a daily WhatsApp summary of ad performance and Shopify revenue every morning at 10am PKT.
        </p>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">

          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Daily Report</p>
              <p className="text-xs text-gray-400 mt-0.5">Sent at 10:00 AM PKT every day</p>
            </div>
            <button
              onClick={() => setEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* Delivery time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Delivery Time <span className="text-gray-400 font-normal">(Pakistan Standard Time)</span>
            </label>
            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
            >
              {Array.from({ length: 18 }, (_, i) => i + 6).map(h => {
                const val  = `${String(h).padStart(2, '0')}:00`
                const ampm = h < 12 ? 'AM' : 'PM'
                const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h
                return <option key={val} value={val}>{h12}:00 {ampm} PKT</option>
              })}
            </select>
            <p className="text-xs text-amber-600 mt-1.5">Currently all reports send at 10:00 AM PKT. Custom times activate when upgraded to Vercel Pro.</p>
          </div>

          {/* WhatsApp number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              WhatsApp Number
            </label>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">+</span>
              <input
                type="tel"
                value={number}
                onChange={e => setNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="923001234567"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Include country code, no + or spaces (e.g. 923001234567)</p>
          </div>

          {/* Preview */}
          {enabled && number && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-1">Preview message</p>
              <p className="text-xs text-gray-600 font-mono leading-5 whitespace-pre-wrap">{
`📊 Elyscents Daily Report — 29 Jun 2026

🇵🇰 Pakistan
Spend: PKR 45,230 | Purchases: 145 | CAC: PKR 312 🟢 | ROAS: 8.40x

🇦🇪 UAE
Spend: AED 2,100 | Purchases: 38 | CAC: AED 5.5 🟡 | ROAS: 6.20x

🇧🇩 Bangladesh
Spend: BDT 28,000 | Purchases: 52 | CAC: BDT 538 🟠 | ROAS: 4.10x

🛍 Shopify PK (yesterday)
Orders: 360 | Revenue: PKR 1,648,049

Full report in Google Sheets ✅`
              }</p>
            </div>
          )}

          {/* Save */}
          <button
            onClick={save}
            disabled={saving}
            className="w-full bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
