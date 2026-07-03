import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export interface RankRequest {
  images:  string[]   // base64 jpeg, 2–4 items
  concept: string
}

export interface RankResult {
  index:  number
  rank:   number
  reason: string
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 })

  const { images, concept } = await req.json() as RankRequest
  if (!images?.length || images.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 images to rank' }, { status: 400 })
  }

  const openai = new OpenAI({ apiKey: key })

  const prompt = `You are a Pakistani Facebook direct-response ads expert.

You are looking at ${images.length} AI-generated ad images (IMAGE_1 through IMAGE_${images.length}).
These are "${concept}" concept ads for Elyscents perfume targeting Pakistani buyers.

Rank them from BEST to WORST for real-world ad performance.

Judge each on:
1. Does the founder/person look REAL and natural (not plastic or AI-distorted)?
2. Is the headline text readable, correctly spelled, not garbled?
3. Is the perfume bottle clearly visible?
4. Would a Pakistani user stop scrolling for this?
5. Does it feel like a real ad, not AI art?

Return ONLY this JSON (no explanation outside it):
{
  "rankings": [
    { "index": 0, "rank": 1, "reason": "short reason max 10 words" },
    { "index": 1, "rank": 2, "reason": "..." },
    { "index": 2, "rank": 3, "reason": "..." }
  ]
}

index = 0-based (IMAGE_1 = index 0). rank = 1 best, ${images.length} worst.`

  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }

  const content: ContentPart[] = [{ type: 'text', text: prompt }]
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}`, detail: 'low' } })
  }

  try {
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content }],
      max_tokens:      500,
      response_format: { type: 'json_object' },
    })

    const raw  = res.choices[0]?.message?.content ?? '{}'
    const data = JSON.parse(raw)
    return NextResponse.json({ rankings: data.rankings ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ranking failed' }, { status: 500 })
  }
}
