import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/hub/supabase'
import type { Message, DailyReport, VideoIdea } from '@/lib/hub/types'

// Lazy singleton — avoids Vercel build-time crash when env vars aren't set yet
let _client: Anthropic | null = null
const getClient = () => {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// ── Categorisation ─────────────────────────────────────────────────────────

const CATEGORY_SYSTEM = `You are a customer intelligence analyst for Elyscents, a Pakistani fragrance brand (elyscents.pk).
You will receive customer messages from Facebook, Instagram, WhatsApp, and email.
For each message, classify it and return a JSON array with these fields per message:
  - id: the message id (copy from input)
  - category: one of: order | complaint | feedback | review | cancel_reason | creative_idea | question | demand_signal | other
  - sub_category: a brief descriptor (e.g. "delivery delay", "wrong product", "scent lasts long", "ordering Royal Oud", "Royal Oud in demand")
  - sentiment: positive | negative | neutral
  - urgency: high | medium | low

Rules:
- order: customer is placing an order, asking for payment details/account number, confirming a purchase, or saying they want to buy. Always mark as positive sentiment. WhatsApp messages asking for price/quantity/address are almost always orders.
- demand_signal: customer mentions that a product is in demand, popular, asked for by others, or that they/others specifically want a product ("Royal Oud is demanded", "everyone wants Zarak", "my friend wants Salsa Spirit"). Always mark as positive sentiment.
- complaint: customer is unhappy, has a problem, needs resolution
- feedback: opinion, suggestion, general comment without urgency
- review: describing experience with product (positive or negative)
- cancel_reason: explicitly says they cancelled or didn't buy and why
- creative_idea: contains an insight that could inspire content, product, or marketing
- question: asking about a product, price, availability, delivery — but NOT placing an order yet
- urgency=high: if they mention refund, angry, never buying again, or explicit complaint
- urgency=high for orders too if they seem ready to pay immediately

Return ONLY valid JSON array. No prose.`

export async function categorizeMessages(
  messages: Pick<Message, 'id' | 'content' | 'source' | 'sender_name'>[]
): Promise<number> {
  if (!messages.length) return 0

  const BATCH = 20
  let totalUpdated = 0

  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH)
    const input = batch.map((m) => ({
      id: m.id, source: m.source,
      content: m.content.substring(0, 500),
    }))

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: CATEGORY_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    let results: { id: string; category: string; sub_category: string; sentiment: string; urgency: string }[]

    try {
      results = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? text)
    } catch {
      console.error('Failed to parse categorization:', text)
      continue
    }

    for (const result of results) {
      await supabaseAdmin.from('messages').update({
        category: result.category,
        sub_category: result.sub_category,
        sentiment: result.sentiment,
        urgency: result.urgency,
        categorized_at: new Date().toISOString(),
      }).eq('id', result.id)
      totalUpdated++
    }
  }

  return totalUpdated
}

// ── Daily Report ───────────────────────────────────────────────────────────

const REPORT_SYSTEM = `You are the Head of Customer Intelligence for Elyscents, a fragrance brand in Pakistan.
Every day you analyse all customer messages and produce a concise intelligence briefing for the founders.
The founders are busy — give them actionable insights they can act on TODAY.
Write in a direct, professional tone. Be specific with examples from actual customer messages.`

export async function generateDailyReport(date: string): Promise<DailyReport> {
  const { data: messages, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .gte('received_at', `${date}T00:00:00.000Z`)
    .lte('received_at', `${date}T23:59:59.999Z`)
    .not('category', 'is', null)

  if (error) throw error

  const msgs = (messages ?? []) as Message[]
  if (!msgs.length) return buildEmptyReport(date)

  const catBreakdown: Record<string, number> = {}
  const sentBreakdown: Record<string, number> = {}
  for (const m of msgs) {
    if (m.category) catBreakdown[m.category] = (catBreakdown[m.category] ?? 0) + 1
    if (m.sentiment) sentBreakdown[m.sentiment] = (sentBreakdown[m.sentiment] ?? 0) + 1
  }

  const sampleMsgs = msgs.slice(0, 50).map((m) => ({
    source: m.source, category: m.category,
    sentiment: m.sentiment, urgency: m.urgency,
    content: m.content.substring(0, 300),
  }))

  const prompt = `Date: ${date}
Total messages: ${msgs.length}
Category breakdown: ${JSON.stringify(catBreakdown)}
Sentiment breakdown: ${JSON.stringify(sentBreakdown)}

Sample messages:
${JSON.stringify(sampleMsgs, null, 2)}

Return a JSON object with exactly these fields:
{
  "top_complaint": "Most common complaint in one sentence with a specific example",
  "top_feedback": "Most common positive feedback in one sentence",
  "consensus_summary": "2-3 sentence overall summary of what customers said today",
  "video_ideas": [
    {
      "title": "Video title",
      "hook": "First 3 seconds hook line",
      "angle": "organic or ads or both",
      "source_quote": "actual customer quote that inspired this",
      "why": "why this will resonate"
    }
  ],
  "product_flags": ["specific product issue flagged by customers"],
  "website_flags": ["specific website issue flagged by customers"]
}

Produce 3-5 video_ideas. Return ONLY valid JSON.`

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  let parsed: {
    top_complaint?: string; top_feedback?: string; consensus_summary?: string
    video_ideas?: VideoIdea[]; product_flags?: string[]; website_flags?: string[]
  }
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text) }
  catch { parsed = {} }

  for (const idea of parsed.video_ideas ?? []) {
    await supabaseAdmin.from('creative_ideas').insert({
      idea_type: idea.angle === 'ads' ? 'video_ads' : 'video_organic',
      idea: idea.title,
      customer_quote: idea.source_quote,
      extracted_at: new Date().toISOString(),
    })
  }

  const report: Omit<DailyReport, 'id'> = {
    report_date: date,
    generated_at: new Date().toISOString(),
    total_messages: msgs.length,
    top_complaint: parsed.top_complaint,
    top_feedback: parsed.top_feedback,
    consensus_summary: parsed.consensus_summary,
    video_ideas: parsed.video_ideas ?? [],
    product_flags: [...(parsed.product_flags ?? []), ...(parsed.website_flags ?? [])],
    category_breakdown: catBreakdown as DailyReport['category_breakdown'],
    sentiment_breakdown: sentBreakdown as DailyReport['sentiment_breakdown'],
    full_report: text,
  }

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('daily_reports')
    .upsert(report, { onConflict: 'report_date' })
    .select().single()
  if (saveErr) throw saveErr

  return saved as DailyReport
}

function buildEmptyReport(date: string): DailyReport {
  return {
    id: '', report_date: date, generated_at: new Date().toISOString(),
    total_messages: 0, consensus_summary: 'No messages received for this date.',
    video_ideas: [], product_flags: [],
    category_breakdown: {} as DailyReport['category_breakdown'],
    sentiment_breakdown: {} as DailyReport['sentiment_breakdown'],
  }
}
