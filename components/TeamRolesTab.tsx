'use client'

import { useState, useEffect, Fragment } from 'react'
import { ROLES, MODULES, ROLE_MODULES, type Role, type ModuleKey } from '@/lib/rbac-constants'

interface TUser { id: string; email: string; name: string; role: Role; modules: ModuleKey[] | null }

const roleLabel = (r: Role) => ROLES.find(x => x.key === r)?.label ?? r

export default function TeamRolesTab() {
  const [users, setUsers]   = useState<TUser[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]       = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('marketing')
  const [editing, setEditing] = useState<string | null>(null)
  const [editMods, setEditMods] = useState<ModuleKey[]>([])

  function load() {
    setLoading(true)
    fetch('/api/admin/users', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.error) setMsg(d.error); else setUsers(d.users) })
      .catch(e => setMsg(String(e))).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function setRole(u: TUser, role: Role) {
    setMsg(null)
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id, role, modules: null }) })
    const d = await res.json(); if (d.error) { setMsg(d.error); return }
    setMsg(`✓ ${u.email} is now ${roleLabel(role)}`); load()
  }
  async function saveMods(u: TUser) {
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id, role: u.role, modules: editMods }) })
    const d = await res.json(); if (d.error) { setMsg(d.error); return }
    setMsg(`✓ Custom modules saved for ${u.email}`); setEditing(null); load()
  }
  async function invite() {
    if (!inviteEmail.trim()) { setMsg('Enter an email to invite.'); return }
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) })
    const d = await res.json(); if (d.error) { setMsg(d.error); return }
    setMsg(`✓ Invitation sent to ${inviteEmail} as ${roleLabel(inviteRole)}.`); setInviteEmail(''); load()
  }
  function startEdit(u: TUser) { setEditing(u.id); setEditMods(u.modules ?? ROLE_MODULES[u.role]) }
  const toggleMod = (m: ModuleKey) => setEditMods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-900">👥 Team &amp; Roles</h2>
        <p className="text-xs text-slate-400 mt-0.5">Invite teammates and control which modules each person can see. Changes take effect on their next page load.</p>
      </div>

      {msg && <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-600">{msg}</div>}

      {/* Invite */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Invite a teammate</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com" type="email"
            className="text-xs border border-slate-200 rounded-lg px-3 py-2 w-64" />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)} className="text-xs border border-slate-200 rounded-lg px-2 py-2">
            {ROLES.filter(r => r.key !== 'none').map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button onClick={invite} className="text-xs bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-700">Send invite</button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">They get an email invite; on sign-up they land with this role.</p>
      </div>

      {/* Users */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-bold">Member</th>
                <th className="text-left px-3 py-2 font-bold">Role</th>
                <th className="text-left px-3 py-2 font-bold">Modules</th>
                <th className="text-right px-3 py-2 font-bold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? <tr><td colSpan={4} className="text-center py-8 text-slate-400">Loading team…</td></tr>
                : users.length === 0 ? <tr><td colSpan={4} className="text-center py-8 text-slate-400">No team members yet.</td></tr>
                : users.map(u => {
                  const effective = u.modules ?? ROLE_MODULES[u.role]
                  return (
                    <Fragment key={u.id}>
                      <tr className="align-top">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-slate-800">{u.name}</p>
                          <p className="text-slate-400">{u.email}</p>
                        </td>
                        <td className="px-3 py-2">
                          <select value={u.role} onChange={e => setRole(u, e.target.value as Role)} className="text-xs border border-slate-200 rounded px-1.5 py-1">
                            {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1 max-w-md">
                            {effective.length === 0 ? <span className="text-slate-300">none</span>
                              : effective.map(m => <span key={m} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{m}</span>)}
                            {u.modules && <span className="text-[10px] text-amber-600">custom</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => (editing === u.id ? setEditing(null) : startEdit(u))} className="text-[11px] text-blue-600">
                            {editing === u.id ? 'close' : 'customize'}
                          </button>
                        </td>
                      </tr>
                      {editing === u.id && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 bg-slate-50">
                            <p className="text-[11px] font-semibold text-slate-500 mb-2">Custom module access for {u.email} (overrides the role defaults):</p>
                            <div className="flex flex-wrap gap-2 mb-2">
                              {MODULES.map(m => (
                                <label key={m.key} className="flex items-center gap-1 text-[11px] bg-white border border-slate-200 rounded px-2 py-1 cursor-pointer">
                                  <input type="checkbox" checked={editMods.includes(m.key)} onChange={() => toggleMod(m.key)} />
                                  {m.label}
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveMods(u)} className="text-[11px] bg-slate-900 text-white px-2.5 py-1 rounded hover:bg-slate-700">Save custom access</button>
                              <button onClick={() => setRole(u, u.role)} className="text-[11px] text-slate-500 border border-slate-200 px-2.5 py-1 rounded">Reset to role defaults</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role reference */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Role defaults</p>
        <div className="space-y-1">
          {ROLES.filter(r => r.key !== 'none').map(r => (
            <div key={r.key} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="font-semibold text-slate-700 w-40">{r.label}</span>
              <span className="text-slate-500">{r.key === 'admin' ? 'everything' : ROLE_MODULES[r.key].join(', ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
