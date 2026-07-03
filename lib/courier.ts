// Courier API clients — PostEx & Leopards
// Env vars required: POSTEX_TOKEN, LEOPARDS_API_KEY, LEOPARDS_API_PASSWORD

const POSTEX_BASE   = 'https://api.postex.pk/services/integration/api/order'
const LEOPARDS_BASE = 'https://merchantapi.leopardscourier.com/api'

// ── Status normalisation ──────────────────────────────────────────────────────

export type NormalisedStatus =
  | 'booked'
  | 'in_transit'
  | 'out_for_delivery'
  | 'attempted'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'expired'
  | 'other'

// NOTE: PostEx's API `transactionStatus` uses different labels than the merchant
// portal/CSV. Real API values: "Return", "Return In-Transit", "Transferred",
// "In Stock", "Cancelled", "Under Verification", "Picked". Match with includes()
// (not exact ===) so these are classified correctly — otherwise returns/cancels
// fall through to 'other' and get wrongly counted as money still owed.
export function normalisePostexStatus(s: string): NormalisedStatus {
  const t = (s ?? '').toLowerCase().trim()
  if (t.includes('delivered') && !t.includes('under review')) return 'delivered'
  if (t.includes('return'))                                    return 'returned'  // Return, Return In-Transit, Returned, Out for Return
  if (t.includes('cancel') || t.includes('un-assigned') || t.includes('unassigned')) return 'cancelled'
  if (t.includes('expired'))                                   return 'expired'
  if (t.includes('attempt'))                                   return 'attempted'
  if (t.includes('out for delivery'))                          return 'out_for_delivery'
  if (['booked', 'unbooked'].some(x => t.includes(x)))         return 'booked'
  if (['transferred', 'in stock', 'picked', 'verification', 'warehouse', 'en-route', 'en route', 'in transit', 'in-transit', 'under review'].some(x => t.includes(x)))
    return 'in_transit'
  return 'other'
}

export function normaliseLeopardsStatus(s: string): NormalisedStatus {
  const t = (s ?? '').toLowerCase()
  if (t.includes('deliver') && !t.includes('return') && !t.includes('attempt')) return 'delivered'
  if (t.includes('return')) return 'returned'
  if (t.includes('attempt')) return 'attempted'
  if (t.includes('out for delivery')) return 'out_for_delivery'
  if (['transit', 'in route', 'warehouse', 'hub', 'picked'].some(x => t.includes(x))) return 'in_transit'
  if (['booked', 'request'].some(x => t.includes(x))) return 'booked'
  return 'other'
}

// ── Common order shape ────────────────────────────────────────────────────────

export interface CourierOrder {
  id:               string           // "{courier}_{trackingNumber}"
  courier:          'postex' | 'leopards'
  trackingNumber:   string
  orderRef:         string
  bookingDate:      string           // YYYY-MM-DD
  deliveryDate:     string | null
  status:           string           // raw courier status
  normStatus:       NormalisedStatus
  city:             string
  codAmount:        number
  transactionFee:   number
  upfrontPaid:      number
  reservePaid:      number
  returnReason:     string | null
  attemptCount:     number
  lastStatusDate:   string | null
  raw:              unknown
}

// ── PostEx ────────────────────────────────────────────────────────────────────

interface PostexOrderRaw {
  customerName?: string
  customerPhone?: string
  deliveryAddress?: string
  invoicePayment?: number
  orderRefNumber?: string
  transactionTax?: number
  transactionFee?: number
  trackingNumber?: string
  transactionDate?: string
  orderPickupDate?: string
  orderDeliveryDate?: string
  upfrontPayment?: number
  upfrontPaymentDate?: string
  merchantName?: string
  transactionStatus?: string
  reversalTax?: number
  reversalFee?: number
  cityName?: string
  transactionNotes?: string
  reservePayment?: number
  reservePaymentDate?: string
  balancePayment?: number
  items?: number
  invoiceDivision?: number
}

function parseDate(s?: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  // ISO timestamp: "2026-06-23T12:58:19.000+0500" → take local date portion
  // by parsing and formatting in PKT (+05:00)
  if (t.includes('T')) {
    try {
      const ms  = new Date(t).getTime()
      const pkt = new Date(ms + 5 * 3_600_000)
      return pkt.toISOString().slice(0, 10)
    } catch { return null }
  }
  const d = t.slice(0, 10)
  return d.match(/^\d{4}-\d{2}-\d{2}$/) ? d : null
}

function toNum(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function mapPostexOrder(raw: PostexOrderRaw): CourierOrder {
  const status    = raw.transactionStatus ?? 'Unknown'
  const tracking  = raw.trackingNumber ?? ''
  const bookDate  = parseDate(raw.transactionDate) ?? parseDate(raw.orderPickupDate) ?? new Date().toISOString().slice(0, 10)
  const delivDate = parseDate(raw.orderDeliveryDate)

  // Extract return reason from transactionNotes if present
  let returnReason: string | null = null
  if (raw.transactionNotes && normalisePostexStatus(status) === 'returned') {
    returnReason = raw.transactionNotes.trim() || null
  }

  return {
    id:             `postex_${tracking}`,
    courier:        'postex',
    trackingNumber: tracking,
    orderRef:       raw.orderRefNumber ?? '',
    bookingDate:    bookDate,
    deliveryDate:   delivDate,
    status,
    normStatus:     normalisePostexStatus(status),
    city:           (raw.cityName ?? 'Unknown').trim(),
    codAmount:      toNum(raw.invoicePayment),
    transactionFee: toNum(raw.transactionFee),
    upfrontPaid:    toNum(raw.upfrontPayment),
    reservePaid:    toNum(raw.reservePayment),
    returnReason,
    attemptCount:   0,
    lastStatusDate: null,
    raw,
  }
}

export async function postexListOrders(
  fromDate: string,
  toDate:   string,
  statusID  = 0,
): Promise<CourierOrder[]> {
  const token = process.env.POSTEX_TOKEN
  if (!token) throw new Error('POSTEX_TOKEN not configured')

  // GET with query params — actual param names confirmed from live API
  const params = new URLSearchParams({
    orderStatusId: String(statusID),
    startDate:     fromDate,
    endDate:       toDate,
  })
  const url = `${POSTEX_BASE}/v1/get-all-order?${params}`
  const res = await fetch(url, { headers: { token } })
  if (!res.ok) throw new Error(`PostEx list orders HTTP ${res.status}`)
  const json = await res.json() as {
    statusCode?:    string
    statusMessage?: string
    dist?:          PostexOrderRaw[]   // flat array, not wrapped
  }
  if (json.statusCode !== '200') {
    throw new Error(`PostEx error: ${json.statusMessage ?? JSON.stringify(json)}`)
  }

  return (json.dist ?? []).map(mapPostexOrder)
}

export async function postexPaymentStatus(trackingNumber: string): Promise<{
  settle: boolean
  settlementDate: string | null
  cprNumber1: string | null
  cprNumber2: string | null
  upfrontPaymentDate: string | null
  reservePaymentDate: string | null
} | null> {
  const token = process.env.POSTEX_TOKEN
  if (!token) return null

  const res = await fetch(
    `${POSTEX_BASE}/v1/payment-status/${encodeURIComponent(trackingNumber)}`,
    { headers: { token } }
  )
  if (!res.ok) return null
  const json = await res.json() as {
    statusCode?: string
    dist?: {
      settle?: boolean
      settlementDate?: string
      upfrontPaymentDate?: string
      cprNumber_1?: string
      reservePaymentDate?: string
      cprNumber_2?: string
    }
  }
  if (json.statusCode !== '200') return null
  const d = json.dist ?? {}
  return {
    settle:             d.settle ?? false,
    settlementDate:     parseDate(d.settlementDate),
    cprNumber1:         d.cprNumber_1 ?? null,
    cprNumber2:         d.cprNumber_2 ?? null,
    upfrontPaymentDate: parseDate(d.upfrontPaymentDate),
    reservePaymentDate: parseDate(d.reservePaymentDate),
  }
}

// ── Leopards ──────────────────────────────────────────────────────────────────

interface LeopardsPacketRaw {
  booking_date?:           string   // "yyyy-mm-dd"
  delivery_date?:          string   // "yyyy-mm-dd" or "0000-00-00"
  tracking_number?:        string
  booked_packet_order_id?: string
  origin_city?:            string
  destination_city?:       string
  consignment_name_eng?:   string
  consignment_phone?:      string
  consignment_address?:    string
  booked_packet_status?:   string
  cod_value?:              string
}

function mapLeopardsOrder(raw: LeopardsPacketRaw): CourierOrder {
  const status   = raw.booked_packet_status ?? 'Unknown'
  const tracking = raw.tracking_number ?? ''

  // Leopards getBookedPacketLastStatus returns dates as "yyyy-mm-dd" already
  const bookDate  = parseDate(raw.booking_date)  ?? new Date().toISOString().slice(0, 10)
  const delivDate = raw.delivery_date && raw.delivery_date !== '0000-00-00'
    ? parseDate(raw.delivery_date)
    : null

  return {
    id:             `leopards_${tracking}`,
    courier:        'leopards',
    trackingNumber: tracking,
    orderRef:       raw.booked_packet_order_id ?? '',
    bookingDate:    bookDate,
    deliveryDate:   delivDate,
    status,
    normStatus:     normaliseLeopardsStatus(status),
    city:           (raw.destination_city ?? 'Unknown').trim(),
    codAmount:      toNum(raw.cod_value),
    transactionFee: 0,
    upfrontPaid:    0,
    reservePaid:    0,
    returnReason:   null,   // not available in last-status endpoint; enriched later via tracking
    attemptCount:   0,
    lastStatusDate: null,
    raw,
  }
}

// ── Leopards payment enrichment ───────────────────────────────────────────────

export interface LeopardsCPR {
  id:            string
  cprNumber:     string
  paymentDate:   string | null
  amount:        number
  paymentMethod: string
  status:        string
  raw:           unknown
}

/**
 * For up to 50 CN numbers per call, returns which ones have been remitted
 * and under which CPR number (invoice_cheque_no).
 */
export async function leopardsGetPaymentDetails(
  cnNumbers: string[]
): Promise<Map<string, { cprNumber: string; cprDate: string | null; paymentMethod: string }>> {
  const api_key      = process.env.LEOPARDS_API_KEY
  const api_password = process.env.LEOPARDS_API_PASSWORD
  if (!api_key || !api_password) return new Map()

  const result = new Map<string, { cprNumber: string; cprDate: string | null; paymentMethod: string }>()

  const chunks: string[][] = []
  for (let i = 0; i < cnNumbers.length; i += 50) chunks.push(cnNumbers.slice(i, i + 50))

  const fetchChunk = async (chunk: string[]): Promise<void> => {
    const params = new URLSearchParams({ api_key, api_password, cn_numbers: chunk.join(',') })
    try {
      const res  = await fetch(`${LEOPARDS_BASE}/getPaymentDetails/format/json/?${params}`)
      if (!res.ok) return
      const json = await res.json() as {
        status?: number
        error?: unknown
        payment_list?: Array<{
          booked_packet_cn?: string
          invoice_cheque_no?: string
          invoice_cheque_date?: string
          payment_method?: string
        }>
      }
      // Log status for debugging — Leopards may return status≠1 even on success
      if (json.status !== 1) {
        console.warn('[leopardsGetPaymentDetails] status:', json.status, 'error:', json.error, 'payment_list length:', json.payment_list?.length ?? 0)
      }
      for (const item of json.payment_list ?? []) {
        if (item.booked_packet_cn && item.invoice_cheque_no) {
          result.set(item.booked_packet_cn, {
            cprNumber:     item.invoice_cheque_no,
            cprDate:       parseDate(item.invoice_cheque_date),
            paymentMethod: item.payment_method ?? '',
          })
        }
      }
    } catch (err) { console.error('[leopardsGetPaymentDetails] batch error:', err) }
  }

  // Process 50-CN chunks with limited concurrency so a large backlog settles in
  // one sync instead of dozens of sequential round-trips.
  const CONCURRENCY = 8
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(fetchChunk))
  }
  return result
}

/** Leopards invoice/CPR list for a date range (used for cash balance history). */
export async function leopardsGetInvoices(from: string, to: string): Promise<LeopardsCPR[]> {
  const api_key      = process.env.LEOPARDS_API_KEY
  const api_password = process.env.LEOPARDS_API_PASSWORD
  if (!api_key || !api_password) return []

  const params = new URLSearchParams({ api_key, api_password, start_date: from, end_date: to })
  try {
    const res  = await fetch(`${LEOPARDS_BASE}/getInvoices/format/json/?${params}`)
    if (!res.ok) return []
    const json = await res.json() as {
      status?: number
      data?: Array<{
        invoice_cheque_no?:     string
        invoice_cheque_date?:   string
        invoice_cheque_amount?: string
        payment_method_name?:   string
        pay_status_name?:       string
      }>
    }
    if (json.status !== 1) return []
    return (json.data ?? []).map(item => ({
      id:            `leopards_${item.invoice_cheque_no ?? ''}`,
      cprNumber:     item.invoice_cheque_no ?? '',
      paymentDate:   parseDate(item.invoice_cheque_date),
      amount:        Number(item.invoice_cheque_amount ?? 0),
      paymentMethod: item.payment_method_name ?? '',
      status:        item.pay_status_name ?? '',
      raw:           item,
    }))
  } catch { return [] }
}

export async function leopardsGetStatuses(
  fromDate: string,
  toDate:   string,
): Promise<CourierOrder[]> {
  const api_key      = process.env.LEOPARDS_API_KEY
  const api_password = process.env.LEOPARDS_API_PASSWORD
  if (!api_key || !api_password) throw new Error('LEOPARDS_API_KEY / LEOPARDS_API_PASSWORD not configured')

  const url = `${LEOPARDS_BASE}/getBookedPacketLastStatus/format/json/`
  const params = new URLSearchParams({ api_key, api_password, from_date: fromDate, to_date: toDate })
  const res = await fetch(`${url}?${params}`)
  if (!res.ok) throw new Error(`Leopards getBookedPacketLastStatus HTTP ${res.status}`)
  const json = await res.json() as {
    status?: number
    error?:  unknown
    packet_list?: LeopardsPacketRaw[]
  }
  if (json.status !== 1) {
    throw new Error(`Leopards error: ${JSON.stringify(json.error)}`)
  }
  return (json.packet_list ?? []).map(mapLeopardsOrder)
}

// ── Tracking-history enrichment (attempts, last movement, return reason) ────────

export interface TrackingInfo {
  lastStatusDate: string | null   // yyyy-mm-dd of the most recent movement
  attemptCount:   number          // failed delivery attempts
  returnReason:   string | null   // human-readable reason if returned/attempted
}

/** PostEx per-parcel tracking. History code 0013 = "Attempt Made". */
export async function postexTrackOrder(trackingNumber: string): Promise<TrackingInfo | null> {
  const token = process.env.POSTEX_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${POSTEX_BASE}/v1/track-order/${encodeURIComponent(trackingNumber)}`, { headers: { token } })
    if (!res.ok) return null
    const json = await res.json() as {
      statusCode?: string
      dist?: {
        transactionNotes?: string
        transactionStatusHistory?: Array<{ transactionStatusMessage?: string; transactionStatusMessageCode?: string; updatedAt?: string }>
      }
    }
    if (json.statusCode !== '200') return null
    const hist = json.dist?.transactionStatusHistory ?? []
    if (hist.length === 0) return { lastStatusDate: null, attemptCount: 0, returnReason: json.dist?.transactionNotes?.trim() || null }

    let lastRaw = ''
    let attemptCount = 0
    let lastAttemptMsg: string | null = null
    for (const h of hist) {
      if (h.updatedAt && h.updatedAt > lastRaw) lastRaw = h.updatedAt
      if (h.transactionStatusMessageCode === '0013') {
        attemptCount++
        lastAttemptMsg = h.transactionStatusMessage?.trim() || lastAttemptMsg
      }
    }
    return {
      lastStatusDate: parseDate(lastRaw),
      attemptCount,
      returnReason:   lastAttemptMsg ?? (json.dist?.transactionNotes?.trim() || null),
    }
  } catch { return null }
}

/** Leopards per-parcel tracking (comma-separated CNs per call). */
export async function leopardsTrackPackets(cnNumbers: string[]): Promise<Map<string, TrackingInfo>> {
  const api_key      = process.env.LEOPARDS_API_KEY
  const api_password = process.env.LEOPARDS_API_PASSWORD
  const result = new Map<string, TrackingInfo>()
  if (!api_key || !api_password || cnNumbers.length === 0) return result

  const chunks: string[][] = []
  for (let i = 0; i < cnNumbers.length; i += 20) chunks.push(cnNumbers.slice(i, i + 20))

  const fetchChunk = async (chunk: string[]): Promise<void> => {
    const params = new URLSearchParams({ api_key, api_password, track_numbers: chunk.join(',') })
    try {
      const res = await fetch(`${LEOPARDS_BASE}/trackBookedPacket/format/json/?${params}`)
      if (!res.ok) return
      const json = await res.json() as {
        status?: number
        packet_list?: Array<{
          track_number?: string
          status_remarks?: string
          'Tracking Detail'?: Array<{ Status?: string; Activity_datetime?: string; Reason?: string | null }>
        }>
      }
      for (const p of json.packet_list ?? []) {
        const cn = p.track_number
        if (!cn) continue
        const td = p['Tracking Detail'] ?? []
        let lastRaw = '', attempts = 0, lastReason: string | null = null
        for (const t of td) {
          if (t.Activity_datetime && t.Activity_datetime > lastRaw) lastRaw = t.Activity_datetime
          if ((t.Status ?? '').toLowerCase().includes('attempt')) attempts++
          if (t.Reason != null && String(t.Reason).trim()) lastReason = String(t.Reason).trim()
        }
        const remarks = typeof p.status_remarks === 'string' ? p.status_remarks.trim() : ''
        result.set(cn, {
          lastStatusDate: parseDate(lastRaw),
          attemptCount:   attempts,
          returnReason:   (remarks || lastReason || null),
        })
      }
    } catch { /* skip chunk */ }
  }

  const CONCURRENCY = 6
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(fetchChunk))
  }
  return result
}
