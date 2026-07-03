import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const { backgroundPrompt, type } = await req.json() as {
      backgroundPrompt: string; type: string
    }

    const moodStyle = type === 'curiosity'
      ? 'Cinematic, dark and mysterious, dramatic lighting, high contrast.'
      : 'Clean, bright studio, professional, aspirational, luxurious.'

    // Background-only prompt — NO people, NO products.
    // Real founder + products will be composited client-side on Canvas.
    const prompt =
      `Background scene for a perfume social media advertisement. ` +
      `${moodStyle} ` +
      `${(backgroundPrompt ?? '').slice(0, 600)} ` +
      `IMPORTANT: Empty environment — absolutely no people, no faces, no hands, no perfume bottles, no products, no text, no logos. ` +
      `Just the atmospheric background/setting. Square format 1:1.`

    for (const model of ['gpt-image-1', 'dall-e-3', 'dall-e-2']) {
      try {
        const response = await openai.images.generate({
          model,
          prompt: prompt.slice(0, model === 'dall-e-2' ? 950 : 4000),
          n: 1,
          size: '1024x1024',
          ...(model === 'dall-e-2' ? {} : { quality: 'medium' }),
        } as Parameters<typeof openai.images.generate>[0]) as {
          data?: Array<{ url?: string; b64_json?: string }>
        }

        const item     = response.data?.[0]
        const imageUrl = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null)
        if (imageUrl) return NextResponse.json({ imageUrl, model })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('quota') || msg.includes('billing')) break
        continue
      }
    }

    return NextResponse.json({ error: 'Background generation failed' }, { status: 500 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
