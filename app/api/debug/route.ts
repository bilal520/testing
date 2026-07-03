import { NextRequest, NextResponse } from 'next/server'

const WINDSOR_KEY = process.env.WINDSOR_API_KEY!
const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN!

// Returns raw API responses so we can diagnose data issues
export async function GET(req: NextRequest) {
  const today = new Date().toISOString().split('T')[0]
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]

  // --- Windsor TikTok raw ---
  let tiktokRaw: unknown = null
  let tiktokError: string | null = null
  try {
    const url = new URL('https://connectors.windsor.ai/tiktok')
    url.searchParams.set('api_key', WINDSOR_KEY)
    url.searchParams.set('date_from', threeDaysAgo)
    url.searchParams.set('date_to', today)
    url.searchParams.set('fields', 'date,account_id,account_name,ad_name,spend,complete_payment,cost_per_conversion,complete_payment_roas,value_per_complete_payment')
    const res = await fetch(url.toString(), { cache: 'no-store' })
    tiktokRaw = await res.json()
  } catch (e) {
    tiktokError = String(e)
  }

  // --- Facebook raw for first PK account ---
  let fbRaw: unknown = null
  let fbError: string | null = null
  const testAccountId = '370296538938550' // Elyscents WYP (PKR account)
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/act_${testAccountId}/insights`)
    url.searchParams.set('level', 'ad')
    url.searchParams.set('fields', 'ad_id,ad_name,account_id,spend,actions,action_values,purchase_roas,impressions')
    url.searchParams.set('time_range', JSON.stringify({ since: threeDaysAgo, until: today }))
    url.searchParams.set('time_increment', '1')
    url.searchParams.set('access_token', FB_TOKEN)
    url.searchParams.set('limit', '10')
    const res = await fetch(url.toString(), { cache: 'no-store' })
    fbRaw = await res.json()
  } catch (e) {
    fbError = String(e)
  }

  // --- Facebook raw for UAE account ---
  let fbUaeRaw: unknown = null
  const uaeAccountId = '1396321775133016'
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/act_${uaeAccountId}/insights`)
    url.searchParams.set('level', 'ad')
    url.searchParams.set('fields', 'ad_id,ad_name,account_id,spend,actions,action_values,purchase_roas')
    url.searchParams.set('time_range', JSON.stringify({ since: threeDaysAgo, until: today }))
    url.searchParams.set('time_increment', '1')
    url.searchParams.set('access_token', FB_TOKEN)
    url.searchParams.set('limit', '10')
    const res = await fetch(url.toString(), { cache: 'no-store' })
    fbUaeRaw = await res.json()
  } catch (e) {
    fbUaeRaw = String(e)
  }

  return NextResponse.json({
    dates: { from: threeDaysAgo, to: today },
    windsor_tiktok: { error: tiktokError, data: tiktokRaw },
    facebook_pk_wyp: { error: fbError, data: fbRaw },
    facebook_uae: { data: fbUaeRaw },
  }, { headers: { 'Content-Type': 'application/json' } })
}
