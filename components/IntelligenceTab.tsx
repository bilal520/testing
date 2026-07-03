'use client'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import type { Message, DailyReport, CreativeIdea, MessageSource, MessageCategory } from '@/lib/hub/types'

// ── Constants ────────────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📸', whatsapp: '💬', gmail: '📧',
}
const SOURCE_COLORS: Record<string, string> = {
  facebook:  'border-blue-500/40 bg-blue-500/5',
  instagram: 'border-pink-500/40 bg-pink-500/5',
  whatsapp:  'border-green-500/40 bg-green-500/5',
  gmail:     'border-yellow-500/40 bg-yellow-500/5',
}
const CATEGORY_BADGE: Record<string, string> = {
  complaint:    'bg-red-500/20 text-red-300',
  feedback:     'bg-blue-500/20 text-blue-300',
  review:       'bg-green-500/20 text-green-300',
  cancel_reason:'bg-orange-500/20 text-orange-300',
  creative_idea:'bg-purple-500/20 text-purple-300',
  question:     'bg-yellow-500/20 text-yellow-300',
  other:        'bg-slate-500/20 text-slate-400',
}
const CATEGORY_COLORS: Record<string, string> = {
  complaint:    'bg-red-500/20 text-red-300 border-red-500/30',
  feedback:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  review:       'bg-green-500/20 text-green-300 border-green-500/30',
  cancel_reason:'bg-orange-500/20 text-orange-300 border-orange-500/30',
  creative_idea:'bg-purple-500/20 text-purple-300 border-purple-500/30',
  question:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  other:        'bg-slate-500/20 text-slate-300 border-slate-500/30',
}
const TYPE_LABELS: Record<string, string> = {
  video_organic: '🎬 Organic Video',
  video_ads:     '📢 Paid Ad',
  product:       '✨ Product',
  website:       '🌐 Website',
}
const TYPE_COLORS: Record<string, string> = {
  video_organic: 'border-purple-500/30 bg-purple-500/5',
  video_ads:     'border-indigo-500/30 bg-indigo-500/5',
  product:       'border-green-500/30 bg-green-500/5',
  website:       'border-blue-500/30 bg-blue-500/5',
}

const SOURCES:    MessageSource[]    = ['facebook', 'instagram', 'whatsapp', 'gmail']
const CATEGORIES: MessageCategory[] = ['complaint','feedback','review','cancel_reason','creative_idea','question','other']

// ── Sub-components ───────────────────────────────────────────────────────────

function DailyReportPanel() {
  const [report, setReport]   = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg]   = useState('')
  const [genDate, setGenDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetch('/api/hub/daily-report')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setReport(d)
        // Default the date picker to the last date that had data
        if (d?.report_date) setGenDate(d.report_date)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function generateReport() {
    setGenerating(true)
    setGenMsg(`Analysing ${genDate} messages with Claude AI…`)
    try {
      const res = await fetch('/api/hub/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: genDate }),
      })
      const data = await res.json()
      if (data.error) { setGenMsg(`Error: ${data.error}`); return }
      setReport(data)
      setGenMsg(`Report generated for ${genDate}.`)
    } catch {
      setGenMsg('Failed to generate report.')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-700/40 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white">Daily Intelligence Report</h3>
          {report && (
            <p className="text-xs text-slate-400 mt-0.5">
              {format(new Date(report.report_date), 'EEEE, d MMMM yyyy')} · {report.total_messages} messages
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={genDate}
            onChange={e => setGenDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
          />
          <button
            onClick={generateReport}
            disabled={generating}
            className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            {generating ? 'Generating…' : '⚡ Generate Report'}
          </button>
        </div>
      </div>

      {genMsg && (
        <p className="text-xs text-slate-400 italic">{genMsg}</p>
      )}

      {!report ? (
        <div className="text-slate-500 text-sm text-center py-8 border border-slate-700 rounded-xl">
          No report yet — click Generate Report to create one.
        </div>
      ) : (
        <>
          {/* Sentiment bar */}
          {report.total_messages > 0 && (
            <>
              <div className="flex rounded-full overflow-hidden h-2">
                {(['positive', 'neutral', 'negative'] as const).map(s => {
                  const count = report.sentiment_breakdown?.[s] ?? 0
                  const pct = (count / report.total_messages) * 100
                  const colors = { positive: 'bg-green-500', neutral: 'bg-slate-500', negative: 'bg-red-500' }
                  return <div key={s} style={{ width: `${pct}%` }} className={colors[s]} />
                })}
              </div>
              <div className="flex gap-4 text-xs">
                {(['positive', 'neutral', 'negative'] as const).map(s => {
                  const cls = s === 'positive' ? 'text-green-400' : s === 'negative' ? 'text-red-400' : 'text-slate-400'
                  return (
                    <span key={s} className={cls}>
                      {s}: {report.sentiment_breakdown?.[s] ?? 0}
                    </span>
                  )
                })}
              </div>
            </>
          )}

          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(report.category_breakdown ?? {}).map(([cat, count]) => (
              <span key={cat} className={`px-2 py-1 rounded-full border text-xs font-medium ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other}`}>
                {cat.replace('_', ' ')} ({count})
              </span>
            ))}
          </div>

          {/* Key insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.top_complaint && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-1">Top Complaint</p>
                <p className="text-sm text-slate-200">{report.top_complaint}</p>
              </div>
            )}
            {report.top_feedback && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide mb-1">Top Feedback</p>
                <p className="text-sm text-slate-200">{report.top_feedback}</p>
              </div>
            )}
          </div>

          {/* Consensus */}
          {report.consensus_summary && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide mb-2">Consensus</p>
              <p className="text-sm text-slate-300 leading-relaxed">{report.consensus_summary}</p>
            </div>
          )}

          {/* Video ideas */}
          {report.video_ideas?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide mb-2">
                Content Ideas from Customers
              </p>
              <div className="space-y-2">
                {report.video_ideas.map((idea, i) => (
                  <div key={i} className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-purple-200">{idea.title}</p>
                      <span className="text-[10px] text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full shrink-0">{idea.angle}</span>
                    </div>
                    <p className="text-xs text-slate-400 italic mb-1">&ldquo;{idea.source_quote}&rdquo;</p>
                    <p className="text-xs text-slate-500">Hook: {idea.hook}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Product & website flags */}
          {report.product_flags?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-wide mb-2">Product & Website Flags</p>
              <ul className="space-y-1">
                {report.product_flags.map((flag, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-yellow-500 shrink-0">▶</span>
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function InboxPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [source, setSource]     = useState<MessageSource | ''>('')
  const [category, setCategory] = useState<MessageCategory | ''>('')
  const [date, setDate]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (source)   params.set('source', source)
    if (category) params.set('category', category)
    if (date)     params.set('date', date)
    const res  = await fetch(`/api/hub/messages?${params}`)
    const json = await res.json()
    setMessages(json.messages ?? [])
    setTotal(json.total ?? 0)
    setLoading(false)
  }, [page, source, category, date])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={source}
          onChange={e => { setSource(e.target.value as MessageSource | ''); setPage(1) }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none"
        >
          <option value="">All sources</option>
          {SOURCES.map(s => <option key={s} value={s}>{SOURCE_ICONS[s]} {s}</option>)}
        </select>
        <select
          value={category}
          onChange={e => { setCategory(e.target.value as MessageCategory | ''); setPage(1) }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none"
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <input
          type="date"
          value={date}
          onChange={e => { setDate(e.target.value); setPage(1) }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none"
        />
        {(source || category || date) && (
          <button
            onClick={() => { setSource(''); setCategory(''); setDate(''); setPage(1) }}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{total} messages</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-slate-800/50 rounded-xl animate-pulse" />)}
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No messages found.</div>
      ) : (
        <div className="space-y-2">
          {messages.map(msg => (
            <div key={msg.id} className={`border rounded-xl p-4 ${SOURCE_COLORS[msg.source] ?? 'border-slate-700 bg-slate-800/30'}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0 mt-0.5">{SOURCE_ICONS[msg.source]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium text-white">{msg.sender_name ?? 'Unknown'}</span>
                    <span className="text-xs text-slate-500 capitalize">{msg.source} · {msg.source_type}</span>
                    {msg.category && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_BADGE[msg.category] ?? CATEGORY_BADGE.other}`}>
                        {msg.category.replace('_', ' ')}
                      </span>
                    )}
                    {msg.urgency === 'high' && (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> urgent
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 line-clamp-2">{msg.content}</p>
                  {msg.sub_category && <p className="text-xs text-slate-500 mt-1 italic">{msg.sub_category}</p>}
                </div>
                <span className="text-xs text-slate-500 shrink-0">
                  {format(new Date(msg.received_at), 'dd MMM HH:mm')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-40 text-slate-300"
          >Prev</button>
          <span className="px-4 py-1.5 text-sm text-slate-400">{page} / {Math.ceil(total / 50)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-4 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-40 text-slate-300"
          >Next</button>
        </div>
      )}
    </div>
  )
}

function IdeasPanel() {
  const [ideas, setIdeas]   = useState<CreativeIdea[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (type: string) => {
    setLoading(true)
    const res  = await fetch(`/api/hub/creative-ideas?type=${type}`)
    const data = await res.json()
    setIdeas(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  async function markUsed(id: string) {
    await fetch('/api/hub/creative-ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, used: true } : i))
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {['all', 'video_organic', 'video_ads', 'product', 'website'].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === t
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {t === 'all' ? 'All Ideas' : TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-800/50 rounded-xl animate-pulse" />)}
        </div>
      ) : ideas.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">
          No ideas yet — they appear automatically after each daily report.
        </p>
      ) : (
        <div className="space-y-2">
          {ideas.map(idea => (
            <div
              key={idea.id}
              className={`border rounded-xl p-4 transition-opacity ${TYPE_COLORS[idea.idea_type] ?? 'border-slate-700 bg-slate-800/30'} ${idea.used ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-400">{TYPE_LABELS[idea.idea_type]}</span>
                    {idea.used && <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Used</span>}
                  </div>
                  <p className="text-sm text-slate-200 font-medium">{idea.idea}</p>
                  {idea.customer_quote && (
                    <p className="text-xs text-slate-500 italic mt-1">&ldquo;{idea.customer_quote}&rdquo;</p>
                  )}
                  <p className="text-xs text-slate-600 mt-1">
                    {format(new Date(idea.extracted_at), 'dd MMM yyyy')}
                  </p>
                </div>
                {!idea.used && (
                  <button
                    onClick={() => markUsed(idea.id)}
                    className="shrink-0 text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300"
                  >
                    Mark used
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

interface HubStats {
  total: number; highUrgency: number; uncategorized: number
  bySource: Record<string, number>; complaints: number; ideas: number
  latestDate: string | null
}

function StatsBar() {
  const [stats, setStats] = useState<HubStats | null>(null)

  useEffect(() => {
    // Fetch all messages (no date filter) to get total counts
    Promise.all([
      fetch('/api/hub/messages?page=1').then(r => r.json()),
      fetch('/api/hub/messages?page=1&urgency=high').then(r => r.json()).catch(() => ({ total: 0 })),
    ]).then(([all]) => {
      const msgs: Message[] = all.messages ?? []
      const bySource: Record<string, number> = {}
      let highUrgency = 0, complaints = 0, ideas = 0, uncategorized = 0
      for (const m of msgs) {
        bySource[m.source] = (bySource[m.source] ?? 0) + 1
        if (m.urgency === 'high') highUrgency++
        if (m.category === 'complaint') complaints++
        if (m.category === 'creative_idea') ideas++
        if (!m.category) uncategorized++
      }
      const latestDate = msgs[0]?.received_at ?? null
      setStats({ total: all.total ?? 0, highUrgency, uncategorized, bySource, complaints, ideas, latestDate })
    }).catch(() => {})
  }, [])

  if (!stats) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
        <p className="text-2xl font-bold text-white">{stats.total}</p>
        <p className="text-xs text-slate-400 mt-1">Total messages</p>
        {stats.latestDate && (
          <p className="text-[10px] text-slate-600 mt-0.5">
            Latest: {format(new Date(stats.latestDate), 'dd MMM HH:mm')}
          </p>
        )}
      </div>
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
        <p className="text-2xl font-bold text-red-300">{stats.highUrgency}</p>
        <p className="text-xs text-slate-400 mt-1">High urgency</p>
        {stats.uncategorized > 0 && (
          <p className="text-[10px] text-amber-500 mt-0.5">{stats.uncategorized} uncategorised</p>
        )}
      </div>
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
        <div className="flex gap-2 flex-wrap">
          {Object.entries(stats.bySource).map(([src, count]) => (
            <span key={src} className="text-xs text-slate-300">{SOURCE_ICONS[src]} {count}</span>
          ))}
          {Object.keys(stats.bySource).length === 0 && <span className="text-xs text-slate-500">—</span>}
        </div>
        <p className="text-xs text-slate-400 mt-2">By channel</p>
      </div>
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-200">{stats.complaints} complaints</p>
        <p className="text-xs text-slate-400 mt-1">{stats.ideas} ideas extracted</p>
      </div>
    </div>
  )
}

// ── Counterfeit Watch ─────────────────────────────────────────────────────────

interface CounterfeitPage {
  id: string; page_id: string; page_name: string; page_url: string
  ad_count: number; search_terms: string[]; sample_ads: { body: string; snapshot_url: string; start_date: string }[]
  status: 'active' | 'reported' | 'removed' | 'whitelisted'
  first_seen: string; last_seen: string; notes?: string
}

const STATUS_BADGE: Record<string, string> = {
  active:      'bg-red-500/20 text-red-300 border-red-500/30',
  reported:    'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  removed:     'bg-green-500/20 text-green-300 border-green-500/30',
  whitelisted: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

function CounterfeitWatchPanel() {
  const [pages, setPages]           = useState<CounterfeitPage[]>([])
  const [loading, setLoading]       = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [scanMsg, setScanMsg]       = useState('')
  const [filter, setFilter]         = useState<string>('active')
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [clearing, setClearing]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const load = useCallback(async (status = filter) => {
    setLoading(true)
    const res  = await fetch(`/api/hub/counterfeit/pages${status ? `?status=${status}` : ''}`)
    const data = await res.json()
    setPages(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function handleScan() {
    setScanning(true)
    setScanMsg('Scanning Facebook Ad Library…')
    try {
      const res  = await fetch('/api/hub/counterfeit/scan', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) { setScanMsg(`Error: ${data.error}`); return }
      setScanMsg(`Done — ${data.pages_found} pages found, ${data.new_pages} new`)
      load()
    } catch (e) {
      setScanMsg(`Scan failed: ${String(e)}`)
    } finally {
      setScanning(false)
    }
  }

  async function handleClearAll() {
    setClearing(true)
    try {
      await fetch('/api/hub/counterfeit/pages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setPages([])
      setScanMsg('History cleared.')
    } catch (e) {
      setScanMsg(`Clear failed: ${String(e)}`)
    } finally {
      setClearing(false)
      setShowConfirm(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    await fetch('/api/hub/counterfeit/pages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setPages(prev => prev.map(p => p.id === id ? { ...p, status: status as CounterfeitPage['status'] } : p))
  }

  const active      = pages.filter(p => p.status === 'active').length
  const reported    = pages.filter(p => p.status === 'reported').length
  const removed     = pages.filter(p => p.status === 'removed').length

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold text-red-300">{active}</p>
            <p className="text-xs text-slate-400 mt-0.5">Active fakes</p>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold text-yellow-300">{reported}</p>
            <p className="text-xs text-slate-400 mt-0.5">Reported</p>
          </div>
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold text-green-300">{removed}</p>
            <p className="text-xs text-slate-400 mt-0.5">Removed</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scanMsg && <p className="text-xs text-slate-400 text-right max-w-xs">{scanMsg}</p>}
          {showConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-300">Clear all history?</span>
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="text-xs px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {clearing ? 'Clearing…' : 'Yes, clear'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="text-sm px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors"
            >
              🗑 Clear History
            </button>
          )}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-sm px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl transition-colors"
          >
            {scanning ? '⟳ Scanning…' : '🔍 Scan Now'}
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {['active', 'reported', 'removed', 'whitelisted', ''].map(s => (
          <button
            key={s}
            onClick={() => { setFilter(s); load(s) }}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === s
                ? 'bg-slate-600 border-slate-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Info banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
        💡 Scans Facebook Ad Library for ads mentioning Elyscents, Royal Oud, Salsa Spirit, Zarak — then filters out your official pages. Mark as "Reported" after filing with Meta IP portal to track progress.
      </div>

      {/* Pages list */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800/50 rounded-xl animate-pulse" />)}</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {filter === 'active' ? 'No active fake pages found. Run a scan to check.' : 'No pages in this category.'}
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map(page => (
            <div key={page.id} className="border border-slate-700 rounded-xl bg-slate-800/30 overflow-hidden">
              {/* Main row */}
              <div className="p-4 flex items-start gap-3">
                <span className="text-2xl mt-0.5">🚨</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <a
                      href={page.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors"
                    >
                      {page.page_name} ↗
                    </a>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_BADGE[page.status]}`}>
                      {page.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {page.search_terms.map(t => (
                      <span key={t} className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span>{page.ad_count} ad{page.ad_count !== 1 ? 's' : ''} found</span>
                    <span>First seen: {format(new Date(page.first_seen), 'dd MMM yyyy')}</span>
                    <span>Last seen: {format(new Date(page.last_seen), 'dd MMM')}</span>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  {page.status === 'active' && (
                    <>
                      <a
                        href="https://www.facebook.com/help/contact/1758255661104383"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-center transition-colors"
                      >
                        Report to Meta
                      </a>
                      <button
                        onClick={() => updateStatus(page.id, 'reported')}
                        className="text-xs px-3 py-1.5 bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 border border-yellow-600/30 rounded-lg transition-colors"
                      >
                        Mark reported
                      </button>
                    </>
                  )}
                  {page.status === 'reported' && (
                    <button
                      onClick={() => updateStatus(page.id, 'removed')}
                      className="text-xs px-3 py-1.5 bg-green-600/30 hover:bg-green-600/50 text-green-300 border border-green-600/30 rounded-lg transition-colors"
                    >
                      Mark removed
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(page.id, 'whitelisted')}
                    className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded-lg transition-colors"
                  >
                    Whitelist
                  </button>
                  {page.sample_ads.length > 0 && (
                    <button
                      onClick={() => setExpanded(expanded === page.id ? null : page.id)}
                      className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 rounded-lg transition-colors"
                    >
                      {expanded === page.id ? 'Hide ads' : 'See ads'}
                    </button>
                  )}
                </div>
              </div>
              {/* Expanded ad samples */}
              {expanded === page.id && page.sample_ads.length > 0 && (
                <div className="border-t border-slate-700 p-4 bg-slate-900/50 space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Ad samples</p>
                  {page.sample_ads.map((ad, i) => (
                    <div key={i} className="text-xs text-slate-300 bg-slate-800 rounded-lg p-3">
                      {ad.body && <p className="mb-2 italic text-slate-400">&ldquo;{ad.body}&rdquo;</p>}
                      {ad.snapshot_url && (
                        <a
                          href={ad.snapshot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          View ad snapshot ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

type SubTab = 'report' | 'inbox' | 'ideas' | 'counterfeit'

export default function IntelligenceTab({ initialTab }: { initialTab?: SubTab } = {}) {
  const [subTab, setSubTab] = useState<SubTab>(initialTab ?? 'report')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncErrors, setSyncErrors] = useState<string[]>([])

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('Pulling from Facebook & Instagram…')
    try {
      const res  = await fetch('/api/hub/ingest', { method: 'POST' })
      const data = await res.json()

      // Collect per-source errors
      const errors: string[] = []
      if (data.facebook_dms_error)       errors.push(`FB DMs: ${data.facebook_dms_error}`)
      if (data.facebook_comments_error)  errors.push(`FB Comments: ${data.facebook_comments_error}`)
      if (data.instagram_comments_error) errors.push(`IG Comments: ${data.instagram_comments_error}`)
      if (data.instagram_dms_error)      errors.push(`IG DMs: ${data.instagram_dms_error}`)

      const newMsgs = (data.facebook_dms ?? 0) + (data.facebook_comments ?? 0) +
                      (data.instagram_dms ?? 0) + (data.instagram_comments ?? 0)

      if (errors.length > 0 && newMsgs === 0) {
        setSyncMsg(`Errors — ${errors[0]}`)
        setSyncErrors(errors)
      } else if (newMsgs === 0) {
        setSyncMsg('All caught up — no new messages.')
        setSyncErrors([])
      } else {
        const parts = [
          data.facebook_dms      ? `${data.facebook_dms} FB DMs`           : null,
          data.facebook_comments ? `${data.facebook_comments} FB comments` : null,
          data.instagram_dms     ? `${data.instagram_dms} IG DMs`          : null,
          data.instagram_comments? `${data.instagram_comments} IG comments`: null,
          data.categorized       ? `${data.categorized} categorised`        : null,
        ].filter(Boolean)
        setSyncMsg(`Done — ${parts.join(', ')}`)
        setSyncErrors(errors)
      }
    } catch (e) {
      setSyncMsg(`Sync failed: ${String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Intelligence Hub</h2>
            <p className="text-sm text-slate-400 mt-0.5">Pakistan · Customer Voice · AI Analysis</p>
          </div>
          <div className="flex items-center gap-3">
            {syncMsg && (
              <p className={`text-xs max-w-xs text-right ${syncErrors.length > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                {syncMsg}
              </p>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-sm px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl transition-colors"
            >
              {syncing ? '⟳ Syncing…' : '⟳ Sync Now'}
            </button>
          </div>
        </div>

        {/* Sync error details */}
        {syncErrors.length > 0 && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-xs font-bold text-red-400 mb-2">Connection errors detected:</p>
            {syncErrors.map((err, i) => (
              <p key={i} className="text-xs text-red-300 font-mono break-all">{err}</p>
            ))}
          </div>
        )}

        {/* Stats */}
        <StatsBar />

        {/* Sub-tabs */}
        <div className="flex gap-0 border-b border-slate-700 mb-6 overflow-x-auto">
          {([
            { key: 'report',      label: '📋 Daily Report' },
            { key: 'inbox',       label: '💌 Unified Inbox' },
            { key: 'ideas',       label: '💡 Creative Ideas' },
            { key: 'counterfeit', label: '🚨 Counterfeit Watch' },
          ] as { key: SubTab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
                subTab === t.key
                  ? 'border-indigo-500 text-indigo-300 font-medium'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Panel */}
        {subTab === 'report'      && <DailyReportPanel />}
        {subTab === 'inbox'       && <InboxPanel />}
        {subTab === 'ideas'       && <IdeasPanel />}
        {subTab === 'counterfeit' && <CounterfeitWatchPanel />}
      </div>
    </div>
  )
}
