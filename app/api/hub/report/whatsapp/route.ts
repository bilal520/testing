import { NextResponse } from 'next/server'
import { getTikTokData, getGoogleAdsData } from '@/lib/windsor'
import { getFacebookData } from '@/lib/facebook'
import { MARKETS, toPrimaryCurrency } from '@/lib/accounts'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300

const WA_PHONE_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID!
const WA_TOKEN     = process.env.WHATSAPP_ACCESS_TOKEN!
const RECIPIENT    = process.env.REPORT_RECIPIENT_WHATSAPP! // e.g. 923001234567

function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function fmt(n: number) {
  return Math.round(n).toLocaleString('en-PK')
}

function truncate(name: string, max = 35) {
  return name.length > max ? name.substring(0, max - 1) + '…' : name
}

async function sendWhatsApp(params: string[]) {
  const components = params.map((val, i) => ({
    type: 'body',
    parameters: [{ type: 'text', text: val }],
    // index is 1-based in Meta's API
  }))

  const body = {
    messaging_product: 'whatsapp',
    to: RECIPIENT,
    type: 'template',
    template: {
      name: 'daily_performance_report',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: params.map(val => ({ type: 'text', text: String(val) })),
        },
      ],
    },
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return res.json()
}

export async function POST() {
  try {
    if (!RECIPIENT) {
      return NextResponse.json({ ok: false, error: 'REPORT_RECIPIENT_WHATSAPP not set' }, { status: 500 })
    }

    const date     = yesterday()
    const config   = MARKETS['pakistan']
    const fbIds    = config.accounts.filter(a => a.platform === 'facebook').map(a => a.id)
    const ttIds    = config.accounts.filter(a => a.platform === 'tiktok').map(a => a.id)
    const gIds     = config.accounts.filter(a => a.platform === 'google_ads').map(a => a.id)

    const [fbRows, ttRows, gRows] = await Promise.all([
      fbIds.length ? getFacebookData(fbIds, date, date).catch(() => [])    : Promise.resolve([]),
      ttIds.length ? getTikTokData(ttIds, date, date).catch(() => [])      : Promise.resolve([]),
      gIds.length  ? getGoogleAdsData(gIds, date, date).catch(() => [])    : Promise.resolve([]),
    ])

    // ── Platform totals ──────────────────────────────────────────────────────

    let fbSpend = 0, fbPurchases = 0
    for (const r of fbRows as { spend: number; purchases: number; account_id: string }[]) {
      const acct = config.accounts.find(a => a.id === String(r.account_id))
      fbSpend     += toPrimaryCurrency(r.spend ?? 0, acct?.currency ?? 'PKR', 'pakistan')
      fbPurchases += r.purchases ?? 0
    }

    let ttSpend = 0, ttPurchases = 0
    for (const r of ttRows as { spend: number; complete_payment: number; account_id: string }[]) {
      const acct = config.accounts.find(a => a.id === String(r.account_id))
      ttSpend     += toPrimaryCurrency(r.spend ?? 0, acct?.currency ?? 'AED', 'pakistan')
      ttPurchases += r.complete_payment ?? 0
    }

    let gSpend = 0, gPurchases = 0
    for (const r of gRows as { spend: number; conversions: number; account_id: string }[]) {
      const acct = config.accounts.find(a => a.id === String(r.account_id))
      gSpend     += toPrimaryCurrency(r.spend ?? 0, acct?.currency ?? 'AED', 'pakistan')
      gPurchases += r.conversions ?? 0
    }

    const fbCac = fbPurchases > 0 ? fbSpend / fbPurchases : 0
    const ttCac = ttPurchases > 0 ? ttSpend / ttPurchases : 0
    const gCac  = gPurchases  > 0 ? gSpend  / gPurchases  : 0

    // ── Top 2 creatives — highest spend yesterday ────────────────────────────

    type CreativeRow = { name: string; spend: number; purchases: number; cac: number }
    const creatives: CreativeRow[] = []

    for (const r of fbRows as { ad_name: string; spend: number; purchases: number; account_id: string }[]) {
      if (!r.ad_name) continue
      const acct = config.accounts.find(a => a.id === String(r.account_id))
      const spendPKR = toPrimaryCurrency(r.spend ?? 0, acct?.currency ?? 'PKR', 'pakistan')
      const purch    = r.purchases ?? 0
      creatives.push({ name: r.ad_name, spend: spendPKR, purchases: purch, cac: purch > 0 ? spendPKR / purch : 0 })
    }

    for (const r of ttRows as { ad_name: string; spend: number; complete_payment: number; account_id: string }[]) {
      if (!r.ad_name) continue
      const acct = config.accounts.find(a => a.id === String(r.account_id))
      const spendPKR = toPrimaryCurrency(r.spend ?? 0, acct?.currency ?? 'AED', 'pakistan')
      const purch    = r.complete_payment ?? 0
      creatives.push({ name: r.ad_name, spend: spendPKR, purchases: purch, cac: purch > 0 ? spendPKR / purch : 0 })
    }

    // Sort by spend desc, take top 2
    const top2 = creatives
      .filter(c => c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 2)

    while (top2.length < 2) top2.push({ name: 'N/A', spend: 0, purchases: 0, cac: 0 })

    // ── Format date for display ──────────────────────────────────────────────
    const displayDate = new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    })

    // ── Send ─────────────────────────────────────────────────────────────────
    const params = [
      displayDate,                          // {{1}}
      fmt(fbSpend),                         // {{2}} FB spend
      fmt(ttSpend),                         // {{3}} TikTok spend
      fmt(gSpend),                          // {{4}} Google spend
      fbCac > 0 ? fmt(fbCac) : 'N/A',      // {{5}} FB CAC
      ttCac > 0 ? fmt(ttCac) : 'N/A',      // {{6}} TikTok CAC
      gCac  > 0 ? fmt(gCac)  : 'N/A',      // {{7}} Google CAC
      truncate(top2[0].name),               // {{8}} creative 1 name
      fmt(top2[0].spend),                   // {{9}} creative 1 spend
      top2[0].cac > 0 ? fmt(top2[0].cac) : 'N/A', // {{10}} creative 1 CAC
      truncate(top2[1].name),               // {{11}} creative 2 name
      fmt(top2[1].spend),                   // {{12}} creative 2 spend
      top2[1].cac > 0 ? fmt(top2[1].cac) : 'N/A', // {{13}} creative 2 CAC
    ]

    const waResult = await sendWhatsApp(params)

    return NextResponse.json({
      ok: true,
      date,
      fb: { spend: fbSpend, purchases: fbPurchases, cac: fbCac },
      tiktok: { spend: ttSpend, purchases: ttPurchases, cac: ttCac },
      google: { spend: gSpend, purchases: gPurchases, cac: gCac },
      top2,
      whatsapp: waResult,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
