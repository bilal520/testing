import { NextRequest, NextResponse } from 'next/server'

export const dynamic    = 'force-dynamic'
export const maxDuration = 180

// Ordered by preference — first available model wins
const MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
]

const VARIATION_NOTES = [
  'Version A: Most faithful to the reference layout. Clean, premium, direct.',
  'Version B: Bolder composition. Higher contrast. More attention-grabbing headline treatment.',
  'Version C: Lifestyle and atmospheric feel. Softer, aspirational, emotional.',
  'Version D: Minimal and clean. Product as hero. Simple typography. Breathable white space.',
]

const MODE_INSTRUCTIONS: Record<string, string> = {
  copy_layout: `Your task: Create an original Elyscents Facebook ad that follows the structural layout of the REFERENCE AD IMAGE.
Study the reference carefully:
— Where is the headline placed? Top, bottom, overlay?
— How much of the image is product vs background vs text?
— Are there any graphic elements (warning labels, comparison columns, headline pills, dividers)?
— What is the visual hierarchy?
Replicate THAT STRUCTURE with Elyscents branding. Change: brand, text, product, colours if brand-specific.
Do NOT copy: any other brand's logo, name, or identity.`,

  product_scene: `Your task: Create a premium lifestyle scene for Elyscents featuring the uploaded product bottle.
— Place the exact uploaded product bottle naturally in a beautiful, aspirational scene
— The product must look physically real in the scene — not floating, not blurred, not wrong scale
— Use the reference image (if provided) only for mood/atmosphere inspiration, not layout
— Scene should match: ${''/* filled in dynamically */}`,

  make_variations: `Your task: Create a close variation of the REFERENCE AD IMAGE with the Elyscents product.
— Keep the overall concept, structure, and visual idea very close to the reference
— Substitute: the product image with the uploaded Elyscents bottle
— Replace: all text with the new headline/offer/CTA provided
— Maintain: the reference's overall energy and layout`,
}

interface ImagePart { data: string; mimeType: string }

interface BriefVariant {
  name:        string
  element:     string
  instruction: string
}

interface CreativeBrief {
  dna:                  string
  concept:              string
  angle:                string
  patternInterrupt:     string
  selectedHeadline:     string
  subheadline:          string
  productPlacement:     string
  placementDescription: string
  backgroundWorld:      string
  backgroundDescription: string
  colorTheme:           string
  colorThemeData:       { label: string; primary: string; accent: string; textColor: string }
  trustCue:             string
  offerText:            string
  variants:             BriefVariant[]
}

interface RequestBody {
  mode:            string
  referenceImage?: ImagePart
  productImage?:   ImagePart
  logoImage?:      ImagePart
  headline:        string
  subheadline?:    string
  offer:           string
  cta:             string
  style:           string
  audience:        string
  aspectRatio:     string
  variationIndex:  number
  brief?:          CreativeBrief   // when set, overrides generic prompt logic
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY not set. Add it to .env.local and Vercel environment variables.' },
      { status: 500 }
    )
  }

  const body = await req.json() as RequestBody
  const { mode, referenceImage, productImage, logoImage, headline, subheadline, offer, cta, style, audience, aspectRatio, variationIndex, brief } = body

  type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }
  const parts: GeminiPart[] = []

  if (referenceImage?.data) {
    parts.push({ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.data } })
    parts.push({ text: '[REFERENCE IMAGE — layout/structure inspiration only. Do NOT copy brand/product/logo/text.]' })
  }

  if (productImage?.data) {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } })
    parts.push({ text: '[ELYSCENTS PRODUCT — this EXACT bottle MUST appear in the final image, clearly visible, undistorted, recognisable.]' })
  }

  if (logoImage?.data) {
    parts.push({ inlineData: { mimeType: logoImage.mimeType, data: logoImage.data } })
    parts.push({ text: '[ELYSCENTS LOGO — provided for reference only. Do NOT include it in the scene — the app will overlay it.]' })
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  // KEY RULE: Gemini generates the VISUAL SCENE ONLY.
  // The app (Canvas renderer) overlays all text, headlines, CTA, badges.
  // Gemini must NOT render any text in the image — it will be garbled and unusable.

  let prompt: string

  if (brief) {
    const variant = brief.variants[variationIndex] ?? brief.variants[0]

    prompt = `You are generating the BACKGROUND VISUAL SCENE for a Facebook ad. All text will be added by the app after your output — you must NOT include any text.

━━━ ABSOLUTE RULE ━━━
ZERO TEXT in the image. No headlines. No offer text. No CTA buttons. No price text. No badge labels. No brand name. No product name. No guarantee text. No letters. No numbers. No typography of ANY kind. The app will overlay all text precisely after you generate the scene.

━━━ WHAT TO GENERATE ━━━
A clean premium product scene:
- The Elyscents perfume bottle (from the product image) placed as the visual hero
- Background: ${brief.backgroundDescription}
- Lighting and mood: ${brief.dna.split(',')[0]}
- Product placement: ${brief.placementDescription}
- Leave adequate EMPTY SPACE at the top 35% for headline text overlay
- Leave adequate EMPTY SPACE at the bottom 22% for CTA + badge overlay

━━━ THIS VARIANT (${variant.name}) ━━━
${variant.instruction}

━━━ ASPECT RATIO ━━━
${aspectRatio}

━━━ PRODUCT RULES ━━━
1. The Elyscents bottle from the uploaded product image MUST appear — show it clearly, in focus, undistorted
2. No other brand's products or logos
3. Premium quality — cinematic lighting, sharp product, beautiful composition
4. NO TEXT ANYWHERE in the image

Generate the clean visual scene now.`
  } else {
    const modeInstruction = MODE_INSTRUCTIONS[mode] ?? MODE_INSTRUCTIONS.copy_layout
    const variationNote   = VARIATION_NOTES[variationIndex] ?? VARIATION_NOTES[0]
    prompt = `You are generating a visual scene for a Facebook ad. All text will be added by the app — do NOT include text in the image.

${modeInstruction}

Style: ${style} | Audience: ${audience} | Format: ${aspectRatio}
${variationNote}

RULES:
- ZERO TEXT in the image — no letters, words, numbers, labels, or typography of any kind
- Product bottle MUST appear clearly in the scene
- Leave top 35% and bottom 22% of image with open space for text overlays
- Premium feel, cinematic lighting, mobile-first composition

Generate the clean visual scene now.`
  }

  parts.push({ text: prompt })

  type GeminiResponsePart = { text?: string; inlineData?: { mimeType: string; data: string } }

  const reqBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  })

  // Try each model in order until one works
  let lastError = 'No image generation model available on this API key'
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody }
      )
      const data = await res.json()

      // Model not found — try next
      if (res.status === 404 || data?.error?.status === 'NOT_FOUND') {
        lastError = data?.error?.message ?? `Model ${model} not found`
        continue
      }

      if (!res.ok) {
        lastError = data?.error?.message ?? `Gemini API error ${res.status} (model: ${model})`
        continue
      }

      const imgPart = (data.candidates?.[0]?.content?.parts as GeminiResponsePart[] | undefined)
        ?.find(p => p.inlineData?.mimeType?.startsWith('image/'))

      if (!imgPart?.inlineData) {
        const finishReason = data.candidates?.[0]?.finishReason
        const blockReason  = data.promptFeedback?.blockReason
        lastError = blockReason
          ? `Blocked by safety filter: ${blockReason}`
          : finishReason === 'SAFETY'
            ? 'Content blocked by safety filter — try different text or style'
            : `Model ${model} returned no image`
        continue
      }

      return NextResponse.json({
        imageData: imgPart.inlineData.data,
        mimeType:  imgPart.inlineData.mimeType,
        model,
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Unknown error (model: ${model})`
    }
  }

  return NextResponse.json({ error: lastError }, { status: 500 })
}
