import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getMetaAppCreds } from '@/lib/oms/whatsapp'

export const dynamic = 'force-dynamic'

// Start Meta OAuth (Facebook Login) for WhatsApp Business. Requires the redirect
// URI below to be whitelisted in the Meta app's Facebook-Login settings, and the
// app to have whatsapp_business_management + _messaging permissions.
export async function GET(req: NextRequest) {
  const { appId } = await getMetaAppCreds()
  if (!appId) return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 500 })

  const redirectUri = `${req.nextUrl.origin}/api/oms/whatsapp/callback`
  const scope = 'whatsapp_business_management,whatsapp_business_messaging,business_management'
  const state = crypto.randomUUID()
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${state}`

  const res = NextResponse.redirect(url)
  res.cookies.set('wa_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
