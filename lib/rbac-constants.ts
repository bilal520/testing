// Client-safe RBAC constants (no server imports). Shared by lib/rbac.ts
// (server) and the Team & Roles admin UI (client).

export type Role = 'admin' | 'ops_manager' | 'agent' | 'warehouse' | 'marketing' | 'analyst' | 'none'
export type ModuleKey =
  | 'markets' | 'revenue' | 'competitors' | 'scripts' | 'studio'
  | 'intelligence' | 'courier' | 'oms' | 'recovery' | 'reports' | 'notifications' | 'setup' | 'team'

export const MODULES: Array<{ key: ModuleKey; label: string }> = [
  { key: 'markets',      label: 'Markets (PK/UAE/BD ads)' },
  { key: 'revenue',      label: 'Revenue Intel' },
  { key: 'competitors',  label: 'Competitors' },
  { key: 'scripts',      label: 'Scripts' },
  { key: 'studio',       label: 'Creative Studio' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'courier',      label: 'Courier' },
  { key: 'oms',          label: 'OMS (Orders)' },
  { key: 'recovery',     label: 'Recovery (checkout)' },
  { key: 'reports',      label: 'Reports' },
  { key: 'notifications',label: 'Notifications' },
  { key: 'setup',        label: 'Setup' },
  { key: 'team',         label: 'Team & Roles (admin)' },
]

export const ROLES: Array<{ key: Role; label: string }> = [
  { key: 'admin',       label: 'Admin' },
  { key: 'ops_manager', label: 'Ops Manager' },
  { key: 'agent',       label: 'Confirmation Agent' },
  { key: 'warehouse',   label: 'Warehouse' },
  { key: 'marketing',   label: 'Marketing' },
  { key: 'analyst',     label: 'Analyst / Viewer' },
  { key: 'none',        label: 'No access' },
]

const ALL: ModuleKey[] = MODULES.map(m => m.key)
export const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  admin:       ALL,
  ops_manager: ['oms', 'courier', 'recovery', 'reports', 'revenue', 'notifications'],
  agent:       ['oms'],
  warehouse:   ['oms'],
  marketing:   ['markets', 'revenue', 'competitors', 'scripts', 'studio', 'intelligence', 'recovery'],
  analyst:     ['reports', 'revenue', 'intelligence', 'recovery'],
  none:        [],
}

// Dashboard tab id → the module that unlocks it.
export const TAB_MODULE: Record<string, ModuleKey> = {
  pakistan: 'markets', uae: 'markets', bangladesh: 'markets', cleanup: 'markets',
  shopify: 'revenue', competitors: 'competitors', scripts: 'scripts', studio: 'studio',
  intelligence: 'intelligence', courier: 'courier', oms: 'oms', recovery: 'recovery', reports: 'reports', setup: 'setup',
  settings: 'notifications', team: 'team',
}
