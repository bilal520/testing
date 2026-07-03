import { supabaseAdmin } from '@/lib/hub/supabase'
import { normalisePhone } from '@/lib/shopify'

// RTO (return-to-origin) defense: a customer who has previously had parcels
// RETURNED by a courier is a high risk when they order again. We match the new
// order's normalized phone against historical courier returns (courier_orders,
// which stores per-parcel norm_status + return reason + city + the customer
// phone in cust_phone_norm).

export interface RtoProfile {
  returnCount:  number
  lastReturnAt: string | null
  reasons:      string[]
  cities:       string[]
  couriers:     string[]
  tier:         'none' | 'caution' | 'high'
}

export const EMPTY_RTO: RtoProfile = { returnCount: 0, lastReturnAt: null, reasons: [], cities: [], couriers: [], tier: 'none' }

/** Look up a phone's courier return history. Returns EMPTY_RTO when clean. */
export async function getRtoProfile(rawPhone: string | null | undefined): Promise<RtoProfile> {
  const phone = normalisePhone(rawPhone)
  if (!phone) return EMPTY_RTO

  const { data } = await supabaseAdmin
    .from('courier_orders')
    .select('return_reason, city, courier, booking_date, delivery_date, last_status_date')
    .eq('cust_phone_norm', phone)
    .eq('norm_status', 'returned')
    .limit(200)

  const rows = data ?? []
  if (!rows.length) return EMPTY_RTO

  const reasons  = [...new Set(rows.map(r => (r.return_reason ?? '').trim()).filter(Boolean))].slice(0, 6)
  const cities   = [...new Set(rows.map(r => (r.city ?? '').trim()).filter(Boolean))].slice(0, 6)
  const couriers = [...new Set(rows.map(r => r.courier as string).filter(Boolean))]
  const dates    = rows.map(r => (r.last_status_date ?? r.delivery_date ?? r.booking_date) as string).filter(Boolean).sort()
  const returnCount = rows.length

  return {
    returnCount,
    lastReturnAt: dates.length ? dates[dates.length - 1] : null,
    reasons, cities, couriers,
    tier: returnCount >= 2 ? 'high' : 'caution',   // 1 prior return = caution, 2+ = high
  }
}
