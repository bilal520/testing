'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserButton } from '@clerk/nextjs'
import KpiSection from '@/components/KpiSection'
import CreativesSection from '@/components/CreativesSection'
import ActivitySection from '@/components/ActivitySection'
import MonthlySpendSection from '@/components/MonthlySpendSection'
import CleanupSection from '@/components/CleanupSection'
import CompetitorsTab from '@/components/CompetitorsTab'
import WinningScriptsTab from '@/components/WinningScriptsTab'
import BrandSetupTab from '@/components/BrandSetupTab'
import CreativeStudioTab from '@/components/CreativeStudioTab'
import IntelligenceTab from '@/components/IntelligenceTab'
import ShopifyIntelligenceTab from '@/components/ShopifyIntelligenceTab'
import CourierIntelligenceTab from '@/components/CourierIntelligenceTab'
import OmsWorkspaceTab from '@/components/OmsWorkspaceTab'
import ReportSettingsPanel from '@/components/ReportSettingsPanel'
import TeamRolesTab from '@/components/TeamRolesTab'
import ReportsTab from '@/components/ReportsTab'
import RecoveryTab from '@/components/RecoveryTab'
// Brand Guard (counterfeit hunter) shelved 2026-07-03 — Ad Library API can't
// surface small scam pages (see docs/COUNTERFEIT_HUNTER_SPEC.md). Code kept dormant.
// import CounterfeitHunterTab from '@/components/CounterfeitHunterTab'
import { MARKETS } from '@/lib/accounts'
import type { Market } from '@/lib/accounts'
import type { CreativeData } from '@/components/CreativeCard'
import type { ActivityData } from '@/components/ActivitySection'
import type { MonthlyData } from '@/app/api/monthly/route'
import type { CleanupResponse } from '@/app/api/cleanup/route'

const MARKET_LIST: Market[] = ['pakistan', 'uae', 'bangladesh']
type TabView = Market | 'cleanup' | 'competitors' | 'scripts' | 'setup' | 'studio' | 'intelligence' | 'shopify' | 'courier' | 'oms' | 'recovery' | 'brandguard' | 'settings' | 'team' | 'reports'

// Which module unlocks each tab (mirrors lib/rbac.ts TAB_MODULE, client-side).
const TAB_MODULE: Record<string, string> = {
  pakistan: 'markets', uae: 'markets', bangladesh: 'markets', cleanup: 'markets',
  shopify: 'revenue', competitors: 'competitors', scripts: 'scripts', studio: 'studio',
  intelligence: 'intelligence', courier: 'courier', oms: 'oms', recovery: 'recovery', brandguard: 'intelligence', reports: 'reports', setup: 'setup',
  settings: 'notifications', team: 'team',
}
// First-allowed order used to pick a landing tab.
const TAB_ORDER = ['pakistan', 'shopify', 'oms', 'recovery', 'courier', 'reports', 'competitors', 'scripts', 'studio', 'intelligence', 'settings', 'setup', 'team']
interface Access { role: string; modules: string[]; isAdmin: boolean }

export default function DashboardPage() {
  const [tab, setTab] = useState<TabView>('pakistan')
  const [access, setAccess] = useState<Access | null>(null)
  const can = (mod: string) => !!access && (access.isAdmin || access.modules.includes(mod))
  const canTab = (t: string) => can(TAB_MODULE[t])

  // Load the user's role/modules, then land them on their first allowed tab.
  useEffect(() => {
    fetch('/api/me/access').then(r => r.json()).then((a: Access) => {
      setAccess(a)
      setTab(prev => (a.isAdmin || a.modules.includes(TAB_MODULE[prev]))
        ? prev
        : (TAB_ORDER.find(t => a.isAdmin || a.modules.includes(TAB_MODULE[t])) as TabView) ?? prev)
    }).catch(() => setAccess({ role: 'none', modules: [], isAdmin: false }))
  }, [])
  const market = (['cleanup', 'competitors', 'scripts', 'setup', 'studio', 'intelligence', 'shopify', 'courier', 'oms', 'recovery', 'brandguard', 'settings', 'team', 'reports'] as TabView[]).includes(tab) ? 'pakistan' : tab as Market
  const [metricsData, setMetricsData] = useState<Record<string, unknown> | null>(null)
  const [creativesData, setCreativesData] = useState<Record<string, unknown> | null>(null)
  const [activityData, setActivityData] = useState<ActivityData | null>(null)
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null)
  const [cleanupData, setCleanupData] = useState<CleanupResponse | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [minutesAgo, setMinutesAgo] = useState(0)
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const s = localStorage.getItem('elyscents_next_refresh')
    return s ? parseInt(s) : null
  })
  const [cooldownSec, setCooldownSec] = useState(0)

  const load = useCallback(async (mkt: Market, refresh = false) => {
    setLoading(true)
    try {
      const qs = `market=${mkt}${refresh ? '&refresh=1' : ''}`
      const [mRes, cRes, aRes, mnRes] = await Promise.all([
        fetch(`/api/metrics?${qs}`),
        fetch(`/api/creatives?${qs}`),
        fetch(`/api/activity?market=${mkt}`),
        fetch(`/api/monthly?market=${mkt}`),
      ])
      const safeJson = (r: Response) => r.ok ? r.json().catch(() => null) : Promise.resolve(null)
      const [m, c, a, mn] = await Promise.all([safeJson(mRes), safeJson(cRes), safeJson(aRes), safeJson(mnRes)])
      if (m) { setMetricsData(m); setFetchedAt(m.fetchedAt ?? new Date().toISOString()) }
      if (c) setCreativesData(c)
      if (a) setActivityData(a)
      if (mn) setMonthlyData(mn)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCleanup = useCallback(async () => {
    setCleanupLoading(true)
    try {
      const res  = await fetch('/api/cleanup')
      const data = await res.json()
      setCleanupData(data)
    } finally {
      setCleanupLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'cleanup')     { if (!cleanupData) loadCleanup() }
    else if (!['competitors', 'scripts', 'setup', 'studio', 'intelligence'].includes(tab)) { load(tab as Market) }
  }, [tab, load, loadCleanup, cleanupData])

  // Update "X min ago" counter every minute
  useEffect(() => {
    if (!fetchedAt) return
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60000)
      setMinutesAgo(diff)
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [fetchedAt])

  // Cooldown countdown — ticks every second while active
  useEffect(() => {
    if (!nextRefreshAt) return
    const tick = () => setCooldownSec(Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextRefreshAt])

  const canRefresh = !nextRefreshAt || Date.now() >= nextRefreshAt

  function handleRefresh() {
    if (!canRefresh || loading || cleanupLoading) return
    const next = Date.now() + 15 * 60 * 1000   // 15-minute cooldown
    setNextRefreshAt(next)
    localStorage.setItem('elyscents_next_refresh', String(next))
    if (tab === 'cleanup') loadCleanup()
    else load(tab as Market, true)
  }

  const days: string[] = (metricsData?.days as string[]) ?? []

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center justify-between">
          {/* Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/elyscents-logo.png" alt="Elyscents" className="h-14 w-auto" />

          {/* Bismillah — center of top bar */}
          <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
            <span className="bismillah" style={{ fontSize: '1.05rem' }}>
              بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ
            </span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {fetchedAt && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Updated {minutesAgo === 0 ? 'just now' : `${minutesAgo} min ago`}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading || cleanupLoading || !canRefresh}
              title={!canRefresh ? `Next refresh available in ${Math.floor(cooldownSec / 60)}m ${cooldownSec % 60}s` : 'Refresh data'}
              className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40"
            >
              {(loading || cleanupLoading)
                ? 'Loading…'
                : !canRefresh
                  ? `↺ ${Math.floor(cooldownSec / 60)}:${String(cooldownSec % 60).padStart(2, '0')}`
                  : '↺ Refresh'}
            </button>
            <UserButton />
          </div>
        </div>

        {/* Tabs: markets + cleanup */}
        <div className="max-w-screen-2xl mx-auto px-4 flex gap-0 border-t border-gray-100">
          {can('markets') && (<>
            {MARKET_LIST.map(m => (
              <button
                key={m}
                onClick={() => { setTab(m); setMetricsData(null); setCreativesData(null); setActivityData(null); setMonthlyData(null) }}
                className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
                  tab === m ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {MARKETS[m].flag} {MARKETS[m].name}
              </button>
            ))}
            <div className="flex items-center px-3"><div className="w-px h-4 bg-gray-200" /></div>
          </>)}
          {can('revenue') && (
            <button onClick={() => setTab('shopify')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'shopify' ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-gray-500 hover:text-green-600'}`}>
              🛍 Revenue Intel
            </button>
          )}
          {can('markets') && (
            <button onClick={() => setTab('cleanup')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'cleanup' ? 'border-red-500 text-red-700 font-medium' : 'border-transparent text-gray-500 hover:text-red-600'}`}>
              ⚠ Cleanup
              {cleanupData && cleanupData.totalFlagged > 0 && (<span className="badge bg-red-100 text-red-700 text-xs">{cleanupData.totalFlagged}</span>)}
            </button>
          )}
          {can('competitors') && (
            <button onClick={() => setTab('competitors')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'competitors' ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-purple-600'}`}>
              🔍 Competitors
            </button>
          )}
          {can('scripts') && (
            <button onClick={() => setTab('scripts')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'scripts' ? 'border-yellow-500 text-yellow-700 font-medium' : 'border-transparent text-gray-500 hover:text-yellow-600'}`}>
              ✍️ Scripts
            </button>
          )}
          {can('studio') && (
            <button onClick={() => setTab('studio')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'studio' ? 'border-pink-500 text-pink-700 font-medium' : 'border-transparent text-gray-500 hover:text-pink-600'}`}>
              🎨 Creative Studio
            </button>
          )}
          {can('intelligence') && (
            <button onClick={() => setTab('intelligence')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'intelligence' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-indigo-600'}`}>
              🧠 Intelligence
            </button>
          )}
          {can('courier') && (
            <button onClick={() => setTab('courier')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'courier' ? 'border-orange-500 text-orange-700 font-medium' : 'border-transparent text-gray-500 hover:text-orange-600'}`}>
              🚚 Courier
            </button>
          )}
          {can('oms') && (
            <button onClick={() => setTab('oms')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'oms' ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-gray-500 hover:text-green-600'}`}>
              📦 OMS
            </button>
          )}
          {can('recovery') && (
            <button onClick={() => setTab('recovery')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'recovery' ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-gray-500 hover:text-emerald-600'}`}>
              🛒 Recovery
            </button>
          )}
          {can('reports') && (
            <button onClick={() => setTab('reports')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'reports' ? 'border-cyan-600 text-cyan-700 font-medium' : 'border-transparent text-gray-500 hover:text-cyan-600'}`}>
              📊 Reports
            </button>
          )}
          {can('setup') && (
            <button onClick={() => setTab('setup')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'setup' ? 'border-gray-500 text-gray-700 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              ⚙ Setup
            </button>
          )}
          {can('notifications') && (
            <button onClick={() => setTab('settings')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'settings' ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-400 hover:text-blue-600'}`}>
              🔔 Notifications
            </button>
          )}
          {can('team') && (
            <button onClick={() => setTab('team')}
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${tab === 'team' ? 'border-slate-700 text-slate-800 font-medium' : 'border-transparent text-gray-400 hover:text-slate-600'}`}>
              👥 Team
            </button>
          )}
        </div>
      </div>

      {/* Main content */}

      {/* ── Shopify Revenue Intelligence tab ─────────────────────────────── */}
      {tab === 'shopify' && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <ShopifyIntelligenceTab />
        </div>
      )}

      {/* ── Competitors tab ──────────────────────────────────────────────── */}
      {tab === 'competitors' && <CompetitorsTab />}

      {/* ── Winning Scripts tab ──────────────────────────────────────────── */}
      {tab === 'scripts' && <WinningScriptsTab />}

      {/* ── Creative Studio tab ──────────────────────────────────────────── */}
      {tab === 'studio' && <CreativeStudioTab market={market} />}

      {/* ── Intelligence Hub tab ─────────────────────────────────────────── */}
      {tab === 'intelligence' && <IntelligenceTab />}

      {/* ── Courier Intelligence tab ──────────────────────────────────────── */}
      {tab === 'courier' && can('courier') && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <CourierIntelligenceTab />
        </div>
      )}

      {/* ── OMS (Order Management) tab ─────────────────────────────────────── */}
      {tab === 'oms' && can('oms') && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <OmsWorkspaceTab />
        </div>
      )}

      {/* ── Checkout Recovery tab ─────────────────────────────────────────── */}
      {tab === 'recovery' && can('recovery') && <RecoveryTab />}


      {/* ── Reports tab (ops manager / admin / analyst) ───────────────────── */}
      {tab === 'reports' && can('reports') && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <ReportsTab />
        </div>
      )}

      {/* ── Team & Roles tab (admin) ──────────────────────────────────────── */}
      {tab === 'team' && can('team') && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <TeamRolesTab />
        </div>
      )}

      {/* No-access screen for users with no modules yet */}
      {access && !access.isAdmin && access.modules.length === 0 && (
        <div className="max-w-screen-2xl mx-auto px-4 py-24 text-center text-sm text-gray-400">
          You don&apos;t have access to any modules yet. Please ask an admin to assign you a role.
        </div>
      )}

      {/* ── Brand Setup tab ──────────────────────────────────────────────── */}
      {tab === 'setup' && <BrandSetupTab />}

      {/* ── Notifications / Report Settings tab ──────────────────────────── */}
      {tab === 'settings' && <ReportSettingsPanel />}

      {/* ── Cleanup tab ──────────────────────────────────────────────────── */}
      {tab === 'cleanup' && (
        cleanupLoading && !cleanupData
          ? <div className="text-center py-20 text-gray-400 text-sm">Scanning all markets for bad CAC ads…</div>
          : cleanupData
            ? <CleanupSection data={cleanupData} />
            : null
      )}

      {/* ── Market tabs ──────────────────────────────────────────────────── */}
      {can('markets') && !['cleanup', 'competitors', 'scripts', 'studio', 'setup', 'intelligence', 'shopify', 'courier', 'oms', 'recovery', 'brandguard', 'reports', 'settings', 'team'].includes(tab) && (
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          {loading && !metricsData ? (
            <div className="text-center py-20 text-gray-400 text-sm">Loading {MARKETS[market].name} data…</div>
          ) : (
            <div className="flex flex-col gap-8">
              {metricsData && (
                <div className="card p-5">
                  <KpiSection
                    market={market}
                    days={days}
                    cumulative={metricsData.cumulative as Record<string, { spend: number; purchases: number; cac: number; roas: number; aov: number; revenue: number }>}
                    byAccount={metricsData.byAccount as Record<string, { name: string; platform: string; currency: string; days: Record<string, { spend: number; purchases: number; cac: number; roas: number; revenue: number; aov: number }> }>}
                  />
                </div>
              )}
              {monthlyData && (
                <div className="card p-5">
                  <MonthlySpendSection data={monthlyData} />
                </div>
              )}
              {activityData && (
                <div className="card p-5">
                  <ActivitySection data={activityData} />
                </div>
              )}
              {creativesData && (
                <div className="card p-5">
                  <CreativesSection
                    days={days}
                    creatives={(creativesData.creatives as CreativeData[]) ?? []}
                    market={market}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
