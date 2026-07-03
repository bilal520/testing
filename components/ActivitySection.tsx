'use client'

import { useState } from 'react'
import type { AccountActivity, ParsedActivity, ActivityType } from '@/app/api/activity/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// Icon + colour per activity type
const TYPE_CONFIG: Record<ActivityType, { icon: string; label: string; cls: string }> = {
  new_ad:       { icon: '+',  label: 'New Ad',      cls: 'text-green-700 bg-green-50'  },
  new_adset:    { icon: '+',  label: 'New Ad Set',  cls: 'text-blue-700  bg-blue-50'   },
  new_campaign: { icon: '+',  label: 'New Campaign', cls: 'text-blue-700  bg-blue-50'  },
  paused_ad:    { icon: '⏸', label: 'Paused',      cls: 'text-amber-700 bg-amber-50'  },
  activated_ad: { icon: '▶', label: 'Activated',   cls: 'text-green-700 bg-green-50'  },
  deleted_ad:   { icon: '✕', label: 'Deleted',     cls: 'text-red-700   bg-red-50'    },
  budget_change:{ icon: '↕', label: 'Budget',      cls: 'text-purple-700 bg-purple-50'},
}

// ─── Creative goal bar ────────────────────────────────────────────────────────

function GoalBar({ total, goal }: { total: number; goal: number }) {
  const pct   = Math.min((total / goal) * 100, 100)
  const met   = total >= goal
  const none  = total === 0

  const barColor = none ? 'bg-red-400' : met ? 'bg-green-500' : total >= goal * 0.6 ? 'bg-amber-400' : 'bg-red-400'
  const textColor = none ? 'text-red-600' : met ? 'text-green-700' : 'text-amber-700'
  const statusText = none ? '✗ None added yet' : met ? `✓ Goal met!` : `${goal - total} more needed`

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-2xl font-semibold ${textColor}`}>{total}</span>
          <span className="text-xs text-gray-400">/ {goal} goal</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={`text-xs font-medium ${textColor} whitespace-nowrap`}>{statusText}</span>
    </div>
  )
}

// ─── Single activity row ──────────────────────────────────────────────────────

function ActivityRow({ act }: { act: ParsedActivity }) {
  const cfg = TYPE_CONFIG[act.type]
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs font-bold ${cfg.cls}`}>
        {cfg.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-gray-500">{cfg.label}</span>
          <span className="text-xs text-gray-800 truncate" title={act.name}>{act.name}</span>
        </div>
        {act.detail && (
          <div className="text-xs text-gray-500 mt-0.5">{act.detail}</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {act.actor && <div className="text-xs text-gray-400">{act.actor}</div>}
        <div className="text-xs text-gray-300">{fmtTime(act.time)}</div>
      </div>
    </div>
  )
}

// ─── Per-account block ────────────────────────────────────────────────────────

function AccountBlock({ account }: { account: AccountActivity }) {
  const [open, setOpen] = useState(true)
  const total    = account.activities.length
  const newAds   = account.activities.filter(a => a.type === 'new_ad').length
  const paused   = account.activities.filter(a => a.type === 'paused_ad').length
  const budget   = account.activities.filter(a => a.type === 'budget_change').length
  const hasOther = account.activities.filter(a => !['new_ad'].includes(a.type)).length

  if (total === 0) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700">{account.accountName}</span>
          <span className="text-xs text-gray-300">{account.currency}</span>
        </div>
        <span className="text-xs text-gray-300">No activity today</span>
      </div>
    )
  }

  // Build summary chips
  const chips: { label: string; cls: string }[] = []
  if (newAds > 0)   chips.push({ label: `+${newAds} ad${newAds > 1 ? 's' : ''}`, cls: 'bg-green-50 text-green-700' })
  if (paused > 0)   chips.push({ label: `${paused} paused`, cls: 'bg-amber-50 text-amber-700' })
  if (budget > 0)   chips.push({ label: `${budget} budget`, cls: 'bg-purple-50 text-purple-700' })
  const rest = hasOther - paused - budget
  if (rest > 0)     chips.push({ label: `${rest} other`, cls: 'bg-gray-50 text-gray-500' })

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Account header — clickable to collapse */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-2 text-left group"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-800">{account.accountName}</span>
          <span className="text-xs text-gray-300">{account.currency}</span>
          {chips.map(c => (
            <span key={c.label} className={`badge text-xs ${c.cls}`}>{c.label}</span>
          ))}
        </div>
        <span className="text-xs text-gray-300 group-hover:text-gray-400 shrink-0 ml-2">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="pb-2">
          {account.activities.map((act, i) => (
            <ActivityRow key={`${act.id}-${act.type}-${i}`} act={act} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface ActivityData {
  market: string
  totalNewAds: number
  goal: number
  accounts: AccountActivity[]
  fetchedAt: string
}

export default function ActivitySection({ data }: { data: ActivityData }) {
  const hasAnyActivity = data.accounts.some(a => a.activities.length > 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-gray-900">Today&apos;s Activity</h2>
          <span className="badge bg-gray-100 text-gray-600 text-xs">Facebook only</span>
        </div>
        <span className="text-xs text-gray-400">
          {new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      {/* Creative goal — big prominent block */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          New Creatives Added Today
        </div>
        <GoalBar total={data.totalNewAds} goal={data.goal} />
        {data.totalNewAds > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.accounts.filter(a => a.newAdCount > 0).map(a => (
              <span key={a.accountId} className="badge bg-white border border-gray-200 text-gray-600 text-xs">
                {a.accountName}: {a.newAdCount}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-account activity feed */}
      {!hasAnyActivity ? (
        <div className="text-xs text-gray-400 text-center py-4">
          No changes recorded in ad accounts today
        </div>
      ) : (
        <div>
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Ad Account Changes
          </div>
          {data.accounts.map(account => (
            <AccountBlock key={account.accountId} account={account} />
          ))}
        </div>
      )}
    </div>
  )
}
