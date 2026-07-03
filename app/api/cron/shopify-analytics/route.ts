import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STORE         = '482886-3.myshopify.com'
const SESSION_KEY   = 'shopify_pk_cli_session'
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000

interface ShopifySession {
  access_token:  string
  refresh_token: string
  client_id:     string
  expires_at:    string
  store:         string
}

function pktDate(offsetDays = 0): string {
  const d = new Date(Date.now() + PKT_OFFSET_MS - offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function loadSession(): Promise<ShopifySession> {
  const { data, error } = await supabaseAdmin
    .from('site_settings')
    .select('value')
    .eq('key', SESSION_KEY)
    .single()
  if (error || !data) throw new Error('shopify_pk_cli_session not found in Supabase')
  return JSON.parse(data.value) as ShopifySession
}

async function saveSession(session: ShopifySession): Promise<void> {
  await supabaseAdmin.from('site_settings').upsert(
    { key: SESSION_KEY, value: JSON.stringify(session), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
}

async function getValidToken(): Promise<string> {
  const session = await loadSession()

  const expiresAt  = new Date(session.expires_at)
  const fiveMinutes = 5 * 60 * 1000
  if (expiresAt.getTime() - Date.now() > fiveMinutes) {
    return session.access_token
  }

  // Token expires within 5 minutes — refresh it
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     session.client_id,
      grant_type:    'refresh_token',
      refresh_token: session.refresh_token,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json() as {
    access_token:  string
    refresh_token: string
    expires_in:    number
  }

  const updated: ShopifySession = {
    ...session,
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }
  await saveSession(updated)
  return updated.access_token
}

async function runShopifyQL(token: string, since: string, until: string) {
  const query = `{ shopifyqlQuery(query: "FROM sessions SHOW sessions, sessions_that_completed_checkout, conversion_rate SINCE ${since} UNTIL ${until}") { tableData { columns { name } rows } parseErrors } }`

  const res = await fetch(`https://${STORE}/admin/api/unstable/graphql.json`, {
    method:  'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
  const json = await res.json() as { data?: { shopifyqlQuery?: { tableData?: { rows?: Record<string, string>[] }; parseErrors?: unknown[] } }; errors?: unknown[] }
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`)
  const parseErrors = json.data?.shopifyqlQuery?.parseErrors
  if (parseErrors?.length) throw new Error(`ShopifyQL errors: ${JSON.stringify(parseErrors)}`)
  return json.data
}

async function cacheAnalytics(date: string, sessions: number, sessionsCompleted: number, conversionRate: number) {
  const payload = {
    sessions,
    sessions_completed:  sessionsCompleted,
    conversion_rate_pct: conversionRate * 100,
    updated_at:          new Date().toISOString(),
  }
  await supabaseAdmin.from('site_settings').upsert(
    { key: `shopify_pk_analytics_${date}`, value: JSON.stringify(payload), updated_at: payload.updated_at },
    { onConflict: 'key' }
  )
  return payload
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today     = pktDate(0)
  const yesterday = pktDate(1)
  const results: Record<string, unknown> = {}

  let token: string
  try {
    token = await getValidToken()
  } catch (e) {
    return NextResponse.json({ error: `Auth failed: ${(e as Error).message}` }, { status: 500 })
  }

  for (const { date, since, until } of [
    { date: today,     since: 'today',     until: 'today'     },
    { date: yesterday, since: 'yesterday', until: 'yesterday' },
  ]) {
    try {
      const data   = await runShopifyQL(token, since, until)
      const rows   = data?.shopifyqlQuery?.tableData?.rows
      if (!rows?.length) { results[date] = 'skipped (no data)'; continue }
      const row    = rows[0]
      const cached = await cacheAnalytics(
        date,
        Number(row.sessions)                         || 0,
        Number(row.sessions_that_completed_checkout) || 0,
        Number(row.conversion_rate)                  || 0,
      )
      results[date] = cached
    } catch (e) {
      results[date] = `error: ${(e as Error).message}`
    }
  }

  return NextResponse.json({ ok: true, results })
}
