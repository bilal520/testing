import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic = 'force-dynamic'

// Saves Client ID + Secret to Supabase so the auth/callback routes can use them
// (env vars can't be set at runtime, so we store in DB for OAuth flow)
export async function POST(req: NextRequest) {
  try {
    const { clientId, clientSecret } = await req.json()
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Missing clientId or clientSecret' }, { status: 400 })
    }

    await supabaseAdmin.from('site_settings').upsert([
      { key: 'shopify_pk_client_id',     value: clientId,     updated_at: new Date().toISOString() },
      { key: 'shopify_pk_client_secret', value: clientSecret, updated_at: new Date().toISOString() },
    ], { onConflict: 'key' })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
