import { NextRequest, NextResponse } from 'next/server'
import OpenAI, { toFile } from 'openai'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// ─── Base rules (every generation) ───────────────────────────────────────────

const BASE_RULES = `Create a high-converting Facebook/Instagram ad image for Elyscents perfume, designed for Pakistani buyers.

MANDATORY RULES:
The ad must look like a real paid social performance creative — not random poster art, not a luxury magazine editorial, not a blank product shot.
Product bottle must be clearly visible, label-facing, realistic, premium, unobstructed.
Mobile-first layout. Readable in 1 second. Strong headline hierarchy. Clear CTA area.
Text must be large, legible, and exactly as specified — do not add, remove, or alter any text.
Do not use Urdu script. Roman text only (English and Roman Urdu as written in the inputs).`

// ─── Concept signal (short hint — visual direction comes from reference images) ─

const CONCEPT_SIGNAL: Record<string, string> = {
  warning:      'Warning/alert style — creates alarm and stop-scroll tension',
  this_is_not:  'Assumption-breaker — boldly reframes what the product is',
  social_proof: 'Social proof — shows real demand and peer validation',
  proof:        'Social proof — shows real demand and peer validation',
  news:         'Editorial/news style — borrowed authority and credibility',
  lifestyle:    'Aspirational lifestyle — premium desire and aspiration',
  us_vs_them:   'Comparison — Elyscents clearly wins on every dimension',
  bundle_value: 'Value offer — price and deal are the visual hero',
}

// ─── Stage modifier ───────────────────────────────────────────────────────────

const STAGE_MODIFIER: Record<string, string> = {
  cold: 'COLD audience (never heard of Elyscents): lead with pattern interrupt and curiosity. Do not lead with price. Make them stop and wonder.',
  warm: 'WARM audience (aware, not bought): lead with benefit clarity and trust. Social proof elements work well.',
  hot:  'HOT audience (ready to buy): offer-driven. Price, COD, guarantee must be clear and prominent. Remove hesitation.',
}

// ─── Size map ─────────────────────────────────────────────────────────────────

const SIZE_MAP: Record<string, '1024x1024' | '1024x1536' | '1536x1024'> = {
  '1:1':  '1024x1024',
  '4:5':  '1024x1536',
  '9:16': '1024x1536',
}

// ─── Variant tweaks ───────────────────────────────────────────────────────────

const VARIANT_TWEAKS = [
  'Base version. Execute all instructions faithfully.',
  'Slightly different background environment or setting — keep all text and product placement identical.',
  'Shift the color temperature: warmer or cooler than the base — same layout and composition.',
  'Make the trust element (guarantee, COD badge, or social proof cue) more visually dominant.',
]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImageInput {
  data:     string  // base64
  mimeType: string
}

export interface OAIRequestBody {
  productImage?:    ImageInput
  referenceImages?: ImageInput[]  // up to 4 high-converting reference ads
  headline:        string
  subline?:        string
  offer:           string
  cta:             string
  concept:         string
  stage:           string
  angle?:          string
  bubbleText?:     string
  trustCue?:       string
  aspectRatio:     string
  variationIndex:  number
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 })

  const body = await req.json() as OAIRequestBody
  const {
    productImage, referenceImages = [],
    headline, subline, offer, cta,
    concept, stage, angle,
    bubbleText, trustCue,
    aspectRatio, variationIndex,
  } = body

  const size          = SIZE_MAP[aspectRatio] ?? '1024x1024'
  const conceptSignal = CONCEPT_SIGNAL[concept] ?? concept
  const stageMod      = STAGE_MODIFIER[stage]   ?? STAGE_MODIFIER.cold
  const variantTweak  = VARIANT_TWEAKS[variationIndex] ?? VARIANT_TWEAKS[0]
  const refCount      = referenceImages.filter(r => r?.data).length

  // ── Build all image inputs (order matters — prompt references by position) ─

  type UploadedFile = Awaited<ReturnType<typeof toFile>>
  const allImages: UploadedFile[]    = []
  const imageLabels: string[]        = []

  async function pushImage(input: ImageInput, label: string) {
    const mime = input.mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
    const ext  = mime === 'image/png' ? 'png' : 'jpg'
    const file = await toFile(Buffer.from(input.data, 'base64'), `${label}.${ext}`, { type: mime })
    allImages.push(file)
    imageLabels.push(label)
  }

  if (productImage?.data) await pushImage(productImage, 'product')
  for (let i = 0; i < referenceImages.length; i++) {
    if (referenceImages[i]?.data) await pushImage(referenceImages[i], `reference_${i + 1}`)
  }

  // ── Assemble prompt ───────────────────────────────────────────────────────

  const imageInputSection = allImages.length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE INPUTS PROVIDED (in order attached):
${imageLabels.map((l, i) => {
  if (l === 'product') return `${i + 1}. Product bottle — this exact Elyscents bottle must appear in your output`
  return `${i + 1}. Reference ad — study its visual mood, composition, text zones, and emotional energy`
}).join('\n')}` : ''

  const referenceSection = refCount > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFERENCE AD GUIDANCE:
${refCount} high-converting reference ads are attached. These are real ads that have proven to convert.
Study each reference for:
- Overall visual composition and layout structure
- Where text is placed and what size hierarchy they use
- Color palette, background treatment, and lighting mood
- What creates the emotional trigger or pattern interrupt
- The balance between product, person (if any), and text

Your output must have the SAME visual energy and conversion psychology as these references.
Capture their approach but create a completely original ad with:
- Elyscents product and branding
- The exact text specified below
- Pakistani market context

DO NOT copy any text, logos, or visual identity from the reference ads.
DO capture: visual concept, composition logic, color mood, text placement approach.` : ''

  const prompt = `${BASE_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONCEPT: ${conceptSignal}
AUDIENCE: ${stageMod}
${imageInputSection}${referenceSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND CONTEXT:
Product: Elyscents perfume — Pakistani D2C brand
${angle ? `Angle: ${angle}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXACT TEXT TO RENDER — copy precisely, no changes, no additions:

HEADLINE (largest text, top zone, bold high-contrast):
"${headline}"
${subline ? `\nSUPPORTING LINE (smaller, below headline):\n"${subline}"\n` : ''}${bubbleText ? `\nCHAT/MESSAGE BUBBLE (clean rounded bubble shape, middle zone of image):\n"${bubbleText}"\n` : ''}
OFFER LINE (bottom zone, clearly legible):
"${offer}"

CTA BUTTON (high-contrast pill or button, bottom-center):
"${cta}"

${trustCue ? `TRUST ELEMENT (clean badge or short label):\n${trustCue}` : 'TRUST BADGES: include "Free Delivery" and "COD" as small clean badges near the CTA'}

TEXT RULES:
- Render ONLY the text listed above. No extra words, labels, or paragraphs.
- Copy every word exactly as written. Do not correct, rephrase, or translate.
- Roman text only. No Urdu or Arabic script.
- All text must be readable on a mobile screen at arm's length.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT: ${aspectRatio}
VARIANT: ${variantTweak}`

  const openai = new OpenAI({ apiKey: key })

  try {
    let result: { b64_json?: string | null } | undefined

    if (allImages.length > 0) {
      const res = await openai.images.edit({
        model:              'gpt-image-1',
        image:              allImages.length === 1 ? allImages[0] : allImages,
        prompt,
        n:                  1,
        size,
        output_format:      'jpeg',
        output_compression: 82,
      })
      result = res.data?.[0]
    } else {
      const res = await openai.images.generate({
        model:              'gpt-image-1',
        prompt,
        n:                  1,
        size,
        output_format:      'jpeg',
        output_compression: 82,
      })
      result = res.data?.[0]
    }

    if (!result?.b64_json) {
      return NextResponse.json({ error: 'OpenAI returned no image data' }, { status: 500 })
    }

    return NextResponse.json({ imageData: result.b64_json, mimeType: 'image/jpeg' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OpenAI image generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
