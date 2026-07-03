import { supabaseAdmin } from '@/lib/hub/supabase'

// RTO risk scoring (Phase 4). Uses signals we already have from Courier
// Intelligence — destination-city return rate is the strongest — plus COD value
// and address quality. Output drives the high-risk hold + agent flags.

export interface RiskResult { score: number; level: 'low' | 'medium' | 'high'; factors: string[] }

// City return-rate cache (per process, 30 min) — avoids a DB hit per order.
type CityRate = { rate: number; closed: number }
let _cityRates: Map<string, CityRate> | null = null
let _cityRatesExp = 0

async function cityReturnRate(city: string): Promise<CityRate | null> {
  if (!city || city === 'Unknown') return null
  if (!_cityRates || Date.now() > _cityRatesExp) {
    _cityRates = new Map()
    _cityRatesExp = Date.now() + 30 * 60 * 1000
    // Aggregate closed parcels per city across couriers (paginate past 1000 cap).
    const agg = new Map<string, { del: number; ret: number }>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('courier_orders').select('city, norm_status')
        .in('norm_status', ['delivered', 'returned'])
        .range(from, from + 999)
      if (error || !data) break
      for (const r of data) {
        const c = (r.city as string) || 'Unknown'
        const e = agg.get(c) ?? { del: 0, ret: 0 }
        if (r.norm_status === 'delivered') e.del++; else e.ret++
        agg.set(c, e)
      }
      if (data.length < 1000) break
    }
    for (const [c, e] of agg) {
      const closed = e.del + e.ret
      _cityRates.set(c.toLowerCase(), { rate: closed ? e.ret / closed : 0, closed })
    }
  }
  return _cityRates.get(city.toLowerCase()) ?? null
}

export async function computeRisk(input: { city: string; codAmount: number; addressScore: number }): Promise<RiskResult> {
  let score = 0
  const factors: string[] = []

  const cr = await cityReturnRate(input.city)
  if (cr && cr.closed >= 10) {
    const pct = Math.round(cr.rate * 100)
    if (cr.rate >= 0.40)      { score += 45; factors.push(`High-return city: ${input.city} ${pct}%`) }
    else if (cr.rate >= 0.25) { score += 25; factors.push(`Elevated city returns: ${input.city} ${pct}%`) }
  }

  if (input.codAmount >= 8000)      { score += 20; factors.push(`High COD value (PKR ${Math.round(input.codAmount).toLocaleString()})`) }
  else if (input.codAmount >= 5000) { score += 10; factors.push('Above-average COD value') }

  if (input.addressScore < 60)      { score += 20; factors.push(`Weak address (${input.addressScore}/100)`) }
  else if (input.addressScore < 80) { score += 8 }

  score = Math.min(score, 100)
  const level: RiskResult['level'] = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'
  return { score, level, factors }
}
