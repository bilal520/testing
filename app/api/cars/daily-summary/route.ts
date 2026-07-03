import { NextRequest, NextResponse } from 'next/server'
import { writeDailyStats, buildCarsReport } from '@/lib/cars/report'
import { getCarsConfig, setCarsPaused } from '@/lib/cars/config'
import { fetchTemplates } from '@/lib/oms/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Daily 9 AM PKT rollup + quality auto-pause. Cron-only. Writes cars_daily_stats
// for yesterday and returns the summary (incl. MTD "money actually made").
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pkt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const yesterday = pkt(new Date(Date.now() - 86_400_000))
  const monthStart = yesterday.slice(0, 8) + '01'

  try {
    const day = await writeDailyStats(yesterday)
    const mtd = await buildCarsReport(monthStart, yesterday)

    // Quality auto-pause: drop from Green → pause live sends.
    let quality: string | null = null
    try {
      const cfg = await getCarsConfig()
      const t = await fetchTemplates()
      quality = (t.phone as { quality_rating?: string } | null)?.quality_rating ?? null
      if (cfg.quality_pause && quality && quality.toUpperCase() !== 'GREEN') await setCarsPaused(true)
    } catch { /* WhatsApp not configured */ }

    return NextResponse.json({
      ok: true, date: yesterday,
      yesterday: { funnel: day.funnel, money: day.money },
      mtd: { moneyMade: mtd.money.netMade, cashCollected: mtd.money.cashCollected, recovered: mtd.funnel.recoveredConfirmed + mtd.funnel.recoveredProbable },
      quality,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) })
  }
}
