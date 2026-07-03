import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

async function getSetting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single()
    return data?.value ?? null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const domain = process.env.SHOPIFY_PK_DOMAIN ?? await getSetting('shopify_pk_domain') ?? '482886-3.myshopify.com'

  // Client ID: env var first, then Supabase (saved via /api/shopify/setup)
  const clientId = process.env.SHOPIFY_PK_CLIENT_ID ?? await getSetting('shopify_pk_client_id')

  if (!clientId) {
    return NextResponse.redirect(new URL('/setup/shopify?error=missing_client_id', req.nextUrl.origin))
  }

  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  // Hardcoded to match exactly what's registered in Shopify Dev Dashboard
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI ?? 'https://elyscentsads.core47.ai/api/shopify/callback'

  const authUrl = `https://${domain}/admin/oauth/authorize?` + new URLSearchParams({
    client_id:    clientId,
    scope:        'read_orders,read_customers,read_analytics',
    redirect_uri: redirectUri,
    state,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('shopify_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600 })
  return res
}
