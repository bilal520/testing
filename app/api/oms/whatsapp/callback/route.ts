import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { getMetaAppCreds } from '@/lib/oms/whatsapp'

export const dynamic = 'force-dynamic'

// Meta OAuth callback → exchange code for a long-lived token, store DB-first,
// and discover the WABA id. Then bounce back to the OMS tab.
export async function GET(req: NextRequest) {
  const dash = new URL('/dashboard', req.nextUrl.origin)
  dash.searchParams.set('tab', 'oms')

  const code  = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get('wa_oauth_state')?.value
  if (!code)                        { dash.searchParams.set('wa', 'error');          return NextResponse.redirect(dash) }
  if (!state || state !== cookieState) { dash.searchParams.set('wa', 'state_mismatch'); return NextResponse.redirect(dash) }

  const { appId, secret } = await getMetaAppCreds()
  const redirectUri = `${req.nextUrl.origin}/api/oms/whatsapp/callback`
  const now = new Date().toISOString()

  try {
    const tokRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&client_secret=${secret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`)
    const tj = await tokRes.json()
    if (tj.error || !tj.access_token) { dash.searchParams.set('wa', 'token_error'); return NextResponse.redirect(dash) }

    // Exchange for a long-lived token.
    const llRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${tj.access_token}`)
    const ll = await llRes.json()
    const token = ll.access_token ?? tj.access_token

    await supabaseAdmin.from('site_settings').upsert({ key: 'whatsapp_access_token', value: token, updated_at: now }, { onConflict: 'key' })

    // Discover the WABA id (best-effort).
    try {
      const biz = await fetch(`https://graph.facebook.com/v21.0/me/businesses?access_token=${token}`).then(r => r.json())
      const bizId = biz.data?.[0]?.id
      if (bizId) {
        const wabas = await fetch(`https://graph.facebook.com/v21.0/${bizId}/owned_whatsapp_business_accounts?access_token=${token}`).then(r => r.json())
        const wabaId = wabas.data?.[0]?.id
        if (wabaId) await supabaseAdmin.from('site_settings').upsert({ key: 'whatsapp_business_account_id', value: wabaId, updated_at: now }, { onConflict: 'key' })
      }
    } catch { /* keep existing WABA id */ }

    dash.searchParams.set('wa', 'connected')
    const res = NextResponse.redirect(dash)
    res.cookies.delete('wa_oauth_state')
    return res
  } catch {
    dash.searchParams.set('wa', 'error')
    return NextResponse.redirect(dash)
  }
}
