import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// ─── Controlled vocabulary libraries ─────────────────────────────────────────

const PLACEMENT_DESCRIPTIONS: Record<string, string> = {
  hero_center:      'Product bottle centered and dominant, fills 40%+ of image height, close-up and sharp',
  product_left:     'Product on left third, bold headline and copy fill right two-thirds',
  product_right:    'Product on right third, bold copy and offer fill left two-thirds',
  bundle_foreground: 'Both bottles placed together in foreground, value offer message above them',
  stack_premium:    'Bottle + box stacked in editorial product-shot style, luxury framing',
  split_comparison: 'Left vs right split — two sides clearly divided',
  editorial_spot:   'Product featured like a magazine product spotlight, journalistic composition',
  minimal_float:    'Bottle floating on very clean or very dark background, maximum breathing room',
}

const BACKGROUND_DESCRIPTIONS: Record<string, string> = {
  vanity_premium:   'Premium dressing table / vanity scene, soft luxury lighting, feminine elegance',
  gift_setup:       'Gift-wrapping or gift table scene, celebratory, Eid or occasion feel',
  premium_shelf:    'High-end perfume boutique shelf display, retail luxury feel',
  outdoor_summer:   'Pakistani summer outdoor context — warm natural light, heat is implied',
  formal_desk:      'Professional formal desk setup, masculine, office-professional appeal',
  wedding_table:    'Wedding or event table with florals and decoration, celebration scene',
  dark_studio:      'Pure dark studio, dramatic directional lighting, moody and premium',
  clean_white:      'Clean bright white minimal studio, product-focus, clinical clarity',
  karachi_urban:    'Urban Pakistani context — city life, everyday premium, relatable backdrop',
  luxury_fabric:    'Luxurious fabric folds — velvet or silk as background texture, opulence',
}

const COLOR_THEMES: Record<string, { label: string; primary: string; accent: string; textColor: string }> = {
  dark_warning:   { label: 'Dark Warning',     primary: '#0f0f0f', accent: '#e8192c',  textColor: '#ffffff' },
  blush_premium:  { label: 'Blush Premium',    primary: '#fdf0f0', accent: '#c2185b',  textColor: '#1a0a0a' },
  dark_gold:      { label: 'Dark Gold',        primary: '#0a0a08', accent: '#c9a84c',  textColor: '#ffffff' },
  clean_white:    { label: 'Clean White',      primary: '#ffffff', accent: '#1a1a1a',  textColor: '#1a1a1a' },
  deep_navy:      { label: 'Deep Navy',        primary: '#0d1b2a', accent: '#4db8ff',  textColor: '#ffffff' },
  warm_cream:     { label: 'Warm Cream',       primary: '#faf3e0', accent: '#8b4513',  textColor: '#2c1810' },
  forest_luxury:  { label: 'Forest Luxury',    primary: '#1b2820', accent: '#4caf50',  textColor: '#f5f5f5' },
  editorial_gray: { label: 'Editorial Gray',   primary: '#f0f0f0', accent: '#222222',  textColor: '#1a1a1a' },
  deep_maroon:    { label: 'Deep Maroon',      primary: '#1a0000', accent: '#d4af37',  textColor: '#f5f5f5' },
  soft_lavender:  { label: 'Soft Lavender',    primary: '#f5f0ff', accent: '#6b21a8',  textColor: '#1a0a2e' },
}

const ELYSCENTS_PROVEN_ANGLES = [
  'Long-lasting in Pakistani heat — 8+ hours tested',
  'Luxury feel without luxury price — affordable premium',
  'Compliment factor — people stop and ask what perfume this is',
  'Repeat-order proof — customers keep reordering',
  'Gift-worthy — the perfume people actually use',
  'Body spray is not a real perfume — make the switch',
  '2-perfume bundle deal — more value, no compromise',
  'No risk — money-back guarantee + COD',
  'Signature scent — find your daily fragrance',
  'Summer test — works even in Karachi heat',
]

const SYSTEM = `You are an elite Facebook performance ad creative strategist. You understand Pakistani buyer psychology for premium D2C brands.

You are NOT a designer. You are the BRAIN that controls what the designer will produce.

Your job: Before any image is generated, produce a complete creative brief that controls:
- The ONE angle this ad will argue
- The pattern interrupt that will stop the scroll
- The headline (scored and selected)
- How the product is placed
- What world/background to use
- What color signals to send
- What trust element to include
- How 4 variants differ — each testing ONLY ONE element

ELYSCENTS BRAND RULES:
- Premium Pakistani D2C perfume brand
- Key strengths: long-lasting, affordable luxury, free delivery, COD, money-back guarantee
- Primary products: perfumes, attars, 2-3 bottle bundles
- Primary audience: Pakistani women 18-40

HEADLINE RULES — MUST ENFORCE:
- Max 8 words
- One idea only
- Must create: curiosity OR pain OR proof OR comparison OR fear of missing out
- Sound like a real person, not a designer
- Never: "discover elegance", "timeless fragrance", "luxury redefined" — ban all generic luxury phrases
- SCORE before you commit

Return ONLY valid JSON — no markdown, no explanation.`

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const body = await req.json() as {
    productName:    string
    offer:          string
    price:          string
    audienceStage:  'cold' | 'warm' | 'hot'
    angleHint?:     string
    market:         string
    cta:            string
    style?:         string
    audience?:      string
  }

  const stageGuide = {
    cold: 'COLD TRAFFIC — never heard of Elyscents. GOAL: stop the scroll and spark curiosity. BEST concepts: Warning, This Is Not, News-style editorial, unexpected comparison. DO NOT lead with price or product name. Lead with PROBLEM or PATTERN INTERRUPT.',
    warm: 'WARM TRAFFIC — has seen Elyscents but not bought. GOAL: build trust and show proof. BEST concepts: repeat-order social proof, before/after comparison, product explained clearly, testimonial angle. Show specific benefits and proof elements.',
    hot:  'HOT TRAFFIC / RETARGETING — seriously considered buying. GOAL: eliminate hesitation and force the decision. BEST concepts: bundle value breakdown, Us vs Them comparison, guarantee-led, urgency offer. Make the offer impossible to ignore.',
  }[body.audienceStage]

  const angleSection = body.angleHint
    ? `USER SPECIFIED ANGLE: "${body.angleHint}" — build everything around this.`
    : `PICK THE STRONGEST ANGLE from these proven Elyscents angles for this product + audience + stage:\n${ELYSCENTS_PROVEN_ANGLES.map((a, i) => `${i + 1}. ${a}`).join('\n')}`

  const prompt = `Build a complete creative brief for this Elyscents Facebook image ad.

━━━ AD INPUTS ━━━
Product: ${body.productName || 'Elyscents Perfume'}
Offer/deal: ${body.offer || 'Free Delivery + COD'}
Price: ${body.price || 'Not specified'}
Market: ${body.market}
Target: ${body.audience || 'Pakistani women 18-35'}
CTA: ${body.cta || 'Order Now'}
Style direction: ${body.style || 'Premium luxury'}

━━━ AUDIENCE STAGE ━━━
${body.audienceStage.toUpperCase()}: ${stageGuide}

━━━ ANGLE SELECTION ━━━
${angleSection}

━━━ CONTROLLED VOCABULARY ━━━
Product placement options: ${JSON.stringify(Object.keys(PLACEMENT_DESCRIPTIONS))}
Background world options: ${JSON.stringify(Object.keys(BACKGROUND_DESCRIPTIONS))}
Color theme options: ${JSON.stringify(Object.keys(COLOR_THEMES))}

━━━ TASK ━━━
1. Select ONE angle — the strongest possible for this product + stage
2. Generate 5 headline candidates. Score each (0-10) for scrollStop + clarity. Select the winner.
3. Pick placement, background, and color theme based on concept logic
4. Design 4 variants — each changes EXACTLY ONE element:
   V1 = base (execute brief faithfully)
   V2 = headline test (write the ALTERNATIVE headline text here — it will actually be rendered by the app)
   V3 = mood/color test (different stylePreset for color/font change)
   V4 = trust emphasis (modify the bubble text or badges to emphasize the trust cue more)

AVAILABLE STYLE PRESETS FOR OVERLAY RENDERER:
- premium_luxury: white serif headline, gold subline, dark frosted bubble, gold CTA pill — for luxury/aspirational concepts
- bold_direct: impact sans headline, yellow subline, white bubble, dark CTA — for direct-response/urgency
- social_proof: bold serif headline, white chat bubble (light bg), for proof/testimonial angle
- warning_style: red headline, frosted bubble with red border, red badges — for WARNING/alert concepts
- fresh_summer: white impact headline, blue badges, bright CTA — for summer/fresh scents

HEADLINE RULES (the app renders text — no AI typography in image):
- Max 8 words per headline
- Roman Urdu is fine (Bhai Yeh Konsa Perfume Hai?)
- NO Urdu script (Arabic characters) — app will render Roman text only
- Short subline max 8 words, in Roman Urdu or English

━━━ OUTPUT FORMAT ━━━
Return this exact JSON:
{
  "dna": "One-line strategy: [concept] for [stage] [audience], angle=[angle], trust=[trust cue]",
  "concept": "warning|this_is_not|us_vs_them|news|lifestyle|proof|bundle_value",
  "angle": "the one clear idea in plain language",
  "awarenessStage": "${body.audienceStage}",
  "patternInterrupt": "exactly what stops the scroll — be specific, not generic",
  "headlines": [
    {"text": "...", "scrollStop": 0, "clarity": 0, "chosen": false, "reason": "one-line why"}
  ],
  "selectedHeadline": "the chosen headline text",
  "subheadline": "supporting line max 8 words",
  "productPlacement": "one key from the placement options",
  "backgroundWorld": "one key from the background options",
  "colorTheme": "one key from the color theme options",
  "trustCue": "specific trust element — be concrete",
  "offerText": "the final offer text for the ad",
  "layout": {
    "stylePreset": "premium_luxury",
    "overlay": "gradient_top",
    "bubble": { "text": "Short real customer reaction or question in Roman Urdu or English (max 8 words)", "style": "soft_white" },
    "badges": ["Free Delivery", "Cash on Delivery", "7-Din Wapsi"],
    "cta": { "text": "${body.cta || 'Order Now'}", "style": "gold_pill" },
    "logoPosition": "bottom_left"
  },
  "variants": [
    {
      "name": "V1 Base", "element": "base",
      "headline": "the chosen headline here",
      "subline": "short support line here",
      "stylePreset": "premium_luxury",
      "instruction": "Execute brief faithfully — control version. No text in image."
    },
    {
      "name": "V2 Headline", "element": "headline",
      "headline": "WRITE THE ALTERNATIVE HEADLINE TEXT HERE — different angle, same format",
      "subline": "short support line",
      "stylePreset": "premium_luxury",
      "instruction": "Alternative headline test. Different background angle or composition vs V1."
    },
    {
      "name": "V3 Mood", "element": "color_mood",
      "headline": "same headline as V1",
      "subline": "same subline",
      "stylePreset": "bold_direct",
      "instruction": "Different background mood and lighting vs V1. Same composition."
    },
    {
      "name": "V4 Trust", "element": "trust_cue",
      "headline": "same headline as V1",
      "subline": "same subline",
      "stylePreset": "premium_luxury",
      "instruction": "Make the guarantee/trust element more prominent in the scene styling."
    }
  ],
  "scores": {
    "scrollStop": 0,
    "clarity": 0,
    "trustStrength": 0,
    "offerClarity": 0
  }
}`

  try {
    const anthropic = new Anthropic({ apiKey: key })
    const msg       = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2500,
      system:     SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    })

    let raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
    if (s === -1 || e === -1) {
      throw new Error(`Claude did not return JSON. Response started with: "${raw.slice(0, 80)}"`)
    }
    raw = raw.slice(s, e + 1)
    const brief = JSON.parse(raw)

    // Enrich with full descriptions
    brief.placementDescription  = PLACEMENT_DESCRIPTIONS[brief.productPlacement]  ?? brief.productPlacement
    brief.backgroundDescription = BACKGROUND_DESCRIPTIONS[brief.backgroundWorld]  ?? brief.backgroundWorld
    brief.colorThemeData        = COLOR_THEMES[brief.colorTheme]                  ?? COLOR_THEMES.clean_white

    // Ensure layout.badges fallback
    if (!brief.layout) brief.layout = {}
    if (!brief.layout.badges?.length) brief.layout.badges = ['Free Delivery', 'Cash on Delivery', '7-Din Wapsi']
    if (!brief.layout.cta) brief.layout.cta = { text: body.cta || 'Order Now', style: 'gold_pill' }
    if (!brief.layout.stylePreset) brief.layout.stylePreset = 'premium_luxury'
    if (!brief.layout.overlay) brief.layout.overlay = 'gradient_top'
    if (!brief.layout.logoPosition) brief.layout.logoPosition = 'bottom_left'

    // Backfill variant headline/subline from selectedHeadline if missing
    if (Array.isArray(brief.variants)) {
      brief.variants = brief.variants.map((v: Record<string, string>) => ({
        ...v,
        headline:    v.headline    || brief.selectedHeadline || '',
        subline:     v.subline     || brief.subheadline      || '',
        stylePreset: v.stylePreset || brief.layout.stylePreset,
      }))
    }

    return NextResponse.json({ brief })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Brief generation failed' },
      { status: 500 }
    )
  }
}
