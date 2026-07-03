import { NextRequest, NextResponse } from 'next/server'
import { saveShopifyToken } from '@/lib/shopify'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

async function getSetting(key: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', key).single()
    return data?.value ?? null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/setup/shopify?error=denied', req.nextUrl.origin))
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/setup/shopify?error=missing_params', req.nextUrl.origin))
  }

  const savedState = req.cookies.get('shopify_oauth_state')?.value
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(new URL('/setup/shopify?error=state_mismatch', req.nextUrl.origin))
  }

  const domain       = process.env.SHOPIFY_PK_DOMAIN ?? await getSetting('shopify_pk_domain') ?? '482886-3.myshopify.com'
  const clientId     = process.env.SHOPIFY_PK_CLIENT_ID     ?? await getSetting('shopify_pk_client_id')     ?? ''
  const clientSecret = process.env.SHOPIFY_PK_CLIENT_SECRET ?? await getSetting('shopify_pk_client_secret') ?? ''

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/setup/shopify?error=missing_credentials', req.nextUrl.origin))
  }

  try {
    const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      return NextResponse.redirect(
        new URL(`/setup/shopify?error=${encodeURIComponent('Token exchange failed: ' + txt.slice(0, 120))}`, req.nextUrl.origin)
      )
    }

    const { access_token } = await tokenRes.json()

    // Save to Supabase (best effort)
    await saveShopifyToken(access_token).catch(() => {})

    const res = NextResponse.redirect(
      new URL(`/setup/shopify?success=1&token=${encodeURIComponent(access_token)}`, req.nextUrl.origin)
    )
    res.cookies.delete('shopify_oauth_state')
    return res

  } catch (err) {
    return NextResponse.redirect(
      new URL(`/setup/shopify?error=${encodeURIComponent(String(err))}`, req.nextUrl.origin)
    )
  }
}
