import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 })

  const { imageDataUrl } = await req.json() as { imageDataUrl: string }
  if (!imageDataUrl) return NextResponse.json({ error: 'No image' }, { status: 400 })

  const openai = new OpenAI({ apiKey: key })

  const prompt = `You are tagging a Facebook/Instagram ad image for a reference library. Analyze it and return structured JSON tags only.

Return ONLY this JSON — no markdown, no extra text:
{
  "concept": "one of: warning|this_is_not|social_proof|news|lifestyle|us_vs_them|bundle_value|unknown",
  "stages": ["cold"],
  "subject": "one of: founder|product_only|model|founder_with_product|none",
  "background": "one of: dark|light|lifestyle|editorial|clean|outdoor",
  "format": "one of: 1:1|4:5|9:16|unknown",
  "energy": "one of: urgent|aspirational|informational|confrontational|conversational",
  "patternInterrupt": "in 5 words: what stops the scroll visually"
}

concept guide:
- warning: alert/caution/danger framing, red accents, tension
- this_is_not: bold denial headline, comparison or reframe
- social_proof: chat bubble, testimonial, DM screenshot feel
- news: masthead, editorial column, article style
- lifestyle: aspirational scene, premium mood, desire
- us_vs_them: comparison table/checklist, two sides
- bundle_value: price prominent, deal first, offer-led

stages guide:
- cold: pattern interrupt heavy, no price, curiosity first
- warm: benefit clear, trust cues visible
- hot: price/COD/guarantee prominent, offer-driven`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
        ],
      }],
      max_tokens: 250,
      response_format: { type: 'json_object' },
    })

    const raw  = res.choices[0]?.message?.content ?? '{}'
    const data = JSON.parse(raw)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Auto-tag failed' }, { status: 500 })
  }
}
