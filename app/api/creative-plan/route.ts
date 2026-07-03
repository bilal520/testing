import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic   = 'force-dynamic'
export const maxDuration = 120

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are a Facebook performance ad creative strategist for Elyscents, a premium Pakistani perfume D2C brand.

Brand context:
- Sells perfumes, attars, and bundles primarily to Pakistani women aged 18–40
- Key markets: Karachi, Lahore, Islamabad
- Top selling points: long-lasting 8+ hours, affordable luxury, free delivery, COD, money-back guarantee
- Tone: aspirational and relatable — not stiff, not cheap

Copy rules:
- Punchy, readable in 2 seconds on mobile
- Social proof and urgency convert best
- "paise wapas" or "guarantee" words build strong trust in Pakistan
- Always keep text short enough to read at a glance

Always return ONLY valid JSON. No markdown, no explanation, no code fences.`

// ─── Concept prompt builders ──────────────────────────────────────────────────

function warningPrompt(d: Record<string, string>) {
  return `Create a WARNING ad creative brief for this perfume.

Product: ${d.productName || 'Elyscents Perfume'}
Offer: ${d.offer || 'Buy 2 Get Free Delivery'}
Hook angle: ${d.hook || 'This perfume makes people stop and ask what you are wearing'}
Audience: ${d.audience || 'Pakistani women 18–35'}
Tone: ${d.tone || 'premium curious'}

WARNING ad rules:
- First word seen is WARNING — triggers pattern interrupt
- Hook inside the warning card creates curiosity or social proof (max 18 words)
- Background must be premium lifestyle relevant to perfume (no random dark rooms)
- Product must be visible somewhere in the scene
- Red CTA pill at bottom — action-focused, includes offer

Generate exactly 4 background variants using different world/setting:
1. Feminine vanity / dressing table — warm, golden tones
2. Luxury perfume shelf or marble surface — cool, sophisticated
3. Gifting / romantic occasion — soft petals, ribbon, gift box context
4. Lifestyle outdoor close-up blur — airy, fresh, aspirational

JSON format:
{
  "headline": "WARNING",
  "hookText": "...",
  "cta": "...",
  "score": { "scrollStop": 0-10, "trust": 0-10, "conceptFit": 0-10, "offerClarity": 0-10 },
  "variants": [
    {
      "name": "short variant name",
      "backgroundStyle": "1-line visual description",
      "backgroundPrompt": "Detailed AI image gen prompt. Background scene only — NO people, NO faces, NO products, NO text, NO logos. Describe environment, lighting, props, mood, color palette.",
      "mood": "2-3 mood words",
      "accentColor": "#hex"
    }
  ]
}`
}

function thisIsNotPrompt(d: Record<string, string>) {
  return `Create a "THIS IS NOT" ad creative brief.

Product: ${d.productName || 'Elyscents Perfume'}
Comparison: ${d.comparison || 'AN EXPENSIVE IMPORTED COLOGNE'}
Benefit line: ${d.benefit || 'Your confidence will be unforgettable'}
Audience: ${d.audience || 'Pakistani women 18–35'}

THIS IS NOT rules:
- Huge bold headline: THIS IS / NOT / [comparison]
- "NOT" must be visually distinct — large, italic, accent color (e.g. lime)
- Comparison must be something the audience recognizes as a problem
- Benefit line reframes with "But, ..."
- Product is the visual hero of the lower half
- Must be understood in 1 second — bold, minimal clutter

Common good comparisons for Pakistan: body spray, cheap mist, 2-hour fragrance, imported overpriced cologne, deodorant masquerading as perfume, harsh oud

Generate exactly 4 color/style variants:
1. Hot pink / magenta — high energy, bold (accentColor: lime #d4ff4e)
2. Deep navy — premium trusted (accentColor: warm gold #ffd54f)
3. Jet black — luxury contrast (accentColor: lime #d4ff4e)
4. Deep purple — editorial aspirational (accentColor: pale lavender #e8d5ff)

JSON format:
{
  "comparison": "...",
  "benefit": "But, ...",
  "productTip": "brief note on product visual treatment",
  "score": { "scrollStop": 0-10, "trust": 0-10, "conceptFit": 0-10, "offerClarity": 0-10 },
  "variants": [
    {
      "name": "...",
      "bgColor": "#hex",
      "accentColor": "#hex",
      "backgroundPrompt": "AI prompt for subtle background texture or gradient — no objects, no people, no text"
    }
  ]
}`
}

function usVsThemPrompt(d: Record<string, string>) {
  return `Create a "US vs THEM" comparison ad brief.

Our brand: Elyscents
Them: ${d.theirName || 'Imported Brands'}
Product: ${d.productName || 'Elyscents Perfume'}
Our advantages: ${d.ourPoints || 'Long-lasting 8+ hours, Made for Pakistan climate, Free delivery + COD'}
Their weaknesses: ${d.theirPoints || 'Fades in 2-3 hours, Expensive import price, Not suited to Pakistani weather'}
Show price comparison: ${d.showPrice || 'yes'}

US vs THEM rules:
- Split layout — our side clearly wins visually
- Max 3 comparison rows
- Product image on our side
- Scan in 2 seconds — no long text
- Our side: green ticks. Their side: red X marks.

Generate exactly 4 visual style variants:
1. Clean white — clinical, honest
2. Light cream/warm — premium aspirational
3. Dark luxury — bold contrast, dark header
4. Fresh green-accent — quality/nature feel

JSON format:
{
  "ourName": "Elyscents",
  "theirName": "...",
  "ourPoints": ["...", "...", "..."],
  "theirPoints": ["...", "...", "..."],
  "cta": "...",
  "score": { "scrollStop": 0-10, "trust": 0-10, "conceptFit": 0-10, "offerClarity": 0-10 },
  "variants": [
    {
      "name": "...",
      "ourBg": "#hex",
      "theirBg": "#hex",
      "headerBg": "#hex",
      "headerText": "#hex",
      "accentGreen": "#hex",
      "mood": "..."
    }
  ]
}`
}

function newsPrompt(d: Record<string, string>) {
  return `Create a news/editorial style ad creative brief for a perfume.

Product: ${d.productName || 'Elyscents Perfume'}
Headline angle: ${d.hook || 'Pakistani women switching to this local fragrance'}
Audience: ${d.audience || 'Pakistani women 18–40'}

NEWS AD rules:
- Borrows trust of editorial/news format
- Main headline is dramatic but believable — news style (12 words max)
- Publication name MUST be fictional — never copy real outlet names
- Body copy sounds like editorial/reporting, NOT an ad
- Product appears as article illustration
- Best if it feels like the audience's actual trusted media

IMPORTANT: Create fictional Pakistani publication names like "The Pakistan Lifestyle Weekly", "Dawn Style Report", "Pakistan Consumer Today" etc. Do NOT use real restricted brands.

Generate exactly 4 editorial style variants:
1. Classic newspaper — black masthead, serif, newsprint feel
2. Lifestyle magazine — clean, feminine, feature-article
3. Breaking news card — urgent, bold, social-breaking format
4. Consumer report — clinical, review/credibility style

JSON format:
{
  "headline": "...",
  "subDeck": "...",
  "body": "...",
  "publicationName": "THE ... (fictional)",
  "volume": "Volume 01, Special Edition",
  "score": { "scrollStop": 0-10, "trust": 0-10, "conceptFit": 0-10, "offerClarity": 0-10 },
  "variants": [
    {
      "name": "...",
      "style": "newspaper|magazine|breaking|consumer",
      "bgColor": "#hex",
      "headerBg": "#hex",
      "headerText": "#hex",
      "accentColor": "#hex",
      "publicationName": "optional override for variant",
      "mood": "..."
    }
  ]
}`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  try {
    const body = await req.json() as Record<string, string>
    const { concept } = body

    const prompt =
      concept === 'warning'     ? warningPrompt(body)   :
      concept === 'this_is_not' ? thisIsNotPrompt(body)  :
      concept === 'us_vs_them'  ? usVsThemPrompt(body)   :
      concept === 'news'        ? newsPrompt(body)        :
      null

    if (!prompt) return NextResponse.json({ error: 'Unknown concept' }, { status: 400 })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system:     SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    })

    let raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    // Strip markdown code fences Claude sometimes adds despite instructions
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    // Extract first { ... } block as a safety net
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
    if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1)
    const plan = JSON.parse(raw)
    return NextResponse.json({ concept, plan })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
