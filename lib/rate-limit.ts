// Server-side rate limiter for cache-busting refreshes.
// In-memory per market — resets on server restart, but prevents API hammering
// during normal usage regardless of what the client sends.

const COOLDOWN_MS = 15 * 60 * 1000  // 15 minutes

const lastRefresh = new Map<string, number>()

export function canRefresh(key: string): boolean {
  const last = lastRefresh.get(key)
  if (!last) return true
  return Date.now() - last >= COOLDOWN_MS
}

export function recordRefresh(key: string): void {
  lastRefresh.set(key, Date.now())
}
