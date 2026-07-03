import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'

// ── GET: CPR upload history derived from settled orders ───────────────────────

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('courier_orders')
    .select('courier, cpr_number, cpr_date')
    .eq('is_settled', true)
    .not('cpr_number', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by cpr_number + courier + cpr_date, count orders per CPR
  const map = new Map<string, { courier: string; cprNumber: string; cprDate: string | null; ordersSettled: number }>()
  for (const row of data ?? []) {
    const key = `${row.courier}__${row.cpr_number}`
    const existing = map.get(key)
    if (existing) {
      existing.ordersSettled++
    } else {
      map.set(key, {
        courier:       row.courier,
        cprNumber:     row.cpr_number,
        cprDate:       row.cpr_date ?? null,
        ordersSettled: 1,
      })
    }
  }

  const history = Array.from(map.values()).sort((a, b) => {
    if (a.cprDate && b.cprDate) return b.cprDate.localeCompare(a.cprDate)
    return a.cprNumber.localeCompare(b.cprNumber)
  })

  return NextResponse.json({ history })
}

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// unpdf bundles a serverless-safe patched pdfjs-dist with no browser API deps
async function parsePdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc    = await getDocumentProxy(new Uint8Array(buffer))
  const result = await extractText(doc, { mergePages: true })
  // mergePages:true → { totalPages, text }; without → string[]
  return typeof result === 'string' ? result
    : Array.isArray(result)         ? result.join('\n')
    : result.text
}

// ── Extraction helpers ────────────────────────────────────────────────────────

function parseDDMMYYYY(match: RegExpMatchArray | null): string | null {
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function extractPostexData(text: string, filename: string) {
  // PostEx tracking numbers are 14-digit integers (e.g. 20129530223853)
  const cns = [...new Set(
    Array.from(text.matchAll(/\b(\d{14})\b/g), m => m[1])
  )]

  // CPR number: try filename first (CPR-GY8H9505444.pdf), then text
  let cprNumber: string | null = null
  const fnMatch = filename.match(/CPR[-_]([A-Z0-9]{6,15})/i)
  if (fnMatch) {
    cprNumber = fnMatch[1].toUpperCase()
  } else {
    const txtMatch = text.match(/CPR\s*(?:No\.?|Number|#)?\s*:?\s*([A-Z0-9]{6,15})/i)
    cprNumber = txtMatch?.[1]?.toUpperCase() ?? null
  }

  const cprDate = parseDDMMYYYY(text.match(/(\d{2})\/(\d{2})\/(\d{4})/))
  return { cns, cprNumber, cprDate }
}

function extractLeopardsData(text: string) {
  // Leopards CN format: 2 uppercase letters + 10 digits (e.g. KI7534780976)
  const cns = [...new Set(
    Array.from(text.matchAll(/\b([A-Z]{2}\d{10})\b/g), m => m[1])
  )]

  // CPR number: CASH followed by digits (e.g. CASH3229259)
  const cprMatch = text.match(/\b(CASH\d+)\b/)
  const cprNumber = cprMatch?.[1] ?? null

  const cprDate = parseDDMMYYYY(text.match(/(\d{2})\/(\d{2})\/(\d{4})/))
  return { cns, cprNumber, cprDate }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file    = formData.get('file') as File | null
  const courier = formData.get('courier') as string | null

  if (!file || !courier || !['postex', 'leopards'].includes(courier)) {
    return NextResponse.json(
      { error: 'file and courier (postex|leopards) required' },
      { status: 400 }
    )
  }

  // Parse PDF
  const buffer = Buffer.from(await file.arrayBuffer())
  let text: string
  try {
    text = await parsePdf(buffer)
  } catch (err) {
    return NextResponse.json(
      { error: `PDF parsing failed: ${String(err)}` },
      { status: 422 }
    )
  }

  const { cns, cprNumber, cprDate } =
    courier === 'postex'
      ? extractPostexData(text, file.name)
      : extractLeopardsData(text)

  if (cns.length === 0) {
    return NextResponse.json({
      error:
        'No tracking numbers found in PDF. Confirm you selected the correct courier.',
      found: 0,
      settled: 0,
    })
  }

  // Find which CNs exist in our DB (within any booking window)
  const ids = cns.map(cn => `${courier}_${cn}`)
  const existingIds: string[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabaseAdmin
      .from('courier_orders')
      .select('id')
      .in('id', ids.slice(i, i + 500))
    for (const r of data ?? []) existingIds.push(r.id as string)
  }

  if (existingIds.length === 0) {
    return NextResponse.json({
      found:     cns.length,
      settled:   0,
      cprNumber,
      cprDate,
      message:
        `Found ${cns.length} CNs in PDF but none matched orders in the database. ` +
        'Orders may be outside the sync window.',
    })
  }

  // Mark matched orders as settled — use update() not upsert() to avoid
  // the NOT NULL constraint on courier (upsert validates INSERT side even
  // when ON CONFLICT fires an UPDATE).
  for (let i = 0; i < existingIds.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('courier_orders')
      .update({ is_settled: true, cpr_number: cprNumber, cpr_date: cprDate })
      .in('id', existingIds.slice(i, i + 500))
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    found:    cns.length,
    settled:  existingIds.length,
    cprNumber,
    cprDate,
    message:  `Settled ${existingIds.length} of ${cns.length} CNs found in PDF.`,
  })
}
