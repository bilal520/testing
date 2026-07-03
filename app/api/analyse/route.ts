import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { toFile } from 'openai'
import { MARKETS, type Market } from '@/lib/accounts'

export const maxDuration = 300
export const dynamic    = 'force-dynamic'

const FB_BASE  = 'https://graph.facebook.com/v19.0'
const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN!

function getAnthropicClient() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }) }
function getOpenAIClient()   { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }) }

async function getAdCreative(adId: string) {
  const url = new URL(`${FB_BASE}/${adId}`)
  url.searchParams.set('fields',
    'creative{id,video_id,body,title,thumbnail_url,' +
    'object_story_spec{video_data{message,video_id}}}'
  )
  url.searchParams.set('access_token', FB_TOKEN)

  const res  = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json()
  const c    = data.creative ?? {}

  const adText     = c.body  ?? c.object_story_spec?.video_data?.message ?? ''
  const adTitle    = c.title ?? ''
  const videoId    = c.object_story_spec?.video_data?.video_id ?? c.video_id ?? null
  const thumbnailUrl = c.thumbnail_url ?? null

  let videoUrl: string | null = null
  if (videoId) {
    const vUrl = new URL(`${FB_BASE}/${videoId}`)
    vUrl.searchParams.set('fields', 'source')
    vUrl.searchParams.set('access_token', FB_TOKEN)
    const vRes  = await fetch(vUrl.toString(), { cache: 'no-store' })
    const vData = await vRes.json()
    videoUrl = vData.source ?? null
  }

  return { videoUrl, adText, adTitle, thumbnailUrl }
}

async function transcribe(videoUrl: string): Promise<string> {
  try {
    const vidRes = await fetch(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!vidRes.ok) return ''
    const buffer = await vidRes.arrayBuffer()
    if (buffer.byteLength > 24 * 1024 * 1024) return ''
    const file = await toFile(Buffer.from(buffer), 'ad.mp4', { type: 'video/mp4' })
    const result = await getOpenAIClient().audio.transcriptions.create({ file, model: 'whisper-1' })
    return result.text ?? ''
  } catch (e) {
    console.error('Transcription failed:', e)
    return ''
  }
}

async function getThumbnailBase64(url: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 5 * 1024 * 1024) return null
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    const mediaType = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg'
    return { data: Buffer.from(buf).toString('base64'), mediaType }
  } catch { return null }
}

const PROMPT = (adTitle: string, adText: string, transcript: string, hasImage: boolean) => `
You are a senior performance ad strategist for a Pakistani D2C fragrance brand.

${hasImage
  ? '⚠ IMAGE PROVIDED. Complete Stage 1 Frame Inventory with full literal detail before any marketing interpretation. Do not skip any field.'
  : '(No image available — estimate all visual fields from caption/title only. Mark fields as [estimated])'}

════════════════════════════════════════════════
STAGE 1 — FRAME INVENTORY
Pure description. Zero interpretation. Zero marketing language. Answer each question literally.
════════════════════════════════════════════════

PEOPLE:
How many people are visible?
Describe body visibility: full / partial / obscured / not visible.
Describe exact pose or body position (seated, standing, head down, leaning forward, etc.)
What expression or emotion is visible? If unclear: say "unclear."
Face details — describe exactly what is on the face:
  • Are the eyes visible? yes / no / partially
  • Is anything covering the face? (cloth, patti/blindfold, mask, hand, nothing)
  • If something is covering: name the object precisely
  • Do NOT write "direct eye contact" if eyes are covered or not visible
  • Do NOT guess expression if face is obscured

OBJECTS AND PROPS:
List every visible object that is not a person or background.
Include: clothing details, accessories, cloth, phone, bottles, furniture, anything.
If nothing unusual: say "standard casual clothing, nothing notable."

PRODUCT:
Is the perfume bottle visible? yes / no / partial
If yes: where in the frame, how prominent?
If no: write "not shown in this frame" — do not imply it was seen

BACKGROUND AND LOCATION:
What is literally visible behind the person?
Is there a skyline, landmark, city, building, plain wall, outdoor setting, or interior?
If a skyline or landmark is visible: name it and state your certainty (certain / possible / unclear)
If background is plain, blurred, or too dark to read: write "background unclear — cannot confirm location"

LIGHTING AND MOOD:
Describe the lighting type: natural / studio / dim / low-light / coloured (state colour if present)
What is the overall visual mood of the frame?

TEXT ON SCREEN:
Is any text overlay visible? If yes: write exactly what it says.
If no text: write "none"

UNUSUAL ELEMENTS:
What is in this frame that would NOT normally appear in a standard perfume brand ad?
List each unusual element as a separate item.
Examples: eyes covered, phone screen shown to camera, warehouse background, damaged boxes, unusual posture, no product visible, outdoor location, etc.
If nothing is unusual: write "standard talking-head — nothing unusual"

VIEWER'S FIRST QUESTION:
If a random Pakistani person saw this frame for 0.5 seconds with zero audio:
What one question would immediately form in their mind? Write it in Roman Urdu.

════════════════════════════════════════════════
STAGE 2 — TOP 3 SCROLL-STOP CUES
Rank the 3 visual elements most likely to stop the scroll.
Base this ONLY on what Stage 1 literally found. Do not invent elements.
════════════════════════════════════════════════

RANKING RULES:
• If Stage 1 found eyes covered or a blindfold → Rank 1 MUST reference the eye-covering, not "eye contact"
• If Stage 1 found no unusual elements → Rank 1 is camera framing or founder presence
• Assign one category per cue: Pattern interrupt | Curiosity gap | Trust | Proof |
  Raw authenticity | Location/status | Product desire | Demonstration | Scroll stop

For each cue give: the specific element name, its category, and a strength score 1–10.

════════════════════════════════════════════════
STAGE 3 — CONTRADICTION GUARDS (enforce strictly before Stage 4)
════════════════════════════════════════════════
Check your Stage 1 findings against these rules. Rewrite any violation:
• Eyes covered or not visible → remove all "eye contact" or "direct gaze" language from everything below
• Product not visible → remove all "product visual hook" language from everything below
• Background unclear → no confident location or landmark claim anywhere below
• Face partially visible → no "full face emotion" claim
• No text overlay found → no text-hook claim based on visuals

════════════════════════════════════════════════
STAGE 4 — MARKETING INTERPRETATION
(Only after Stages 1–3 are fully complete)
AD DATA:
TITLE: ${adTitle || '—'}
CAPTION: ${adText || '—'}
TRANSCRIPT: ${transcript ? `"${transcript}"` : 'NOT AVAILABLE — caption only'}
════════════════════════════════════════════════

THREE MECHANISMS (one line each):
• Attention: what specifically stopped the scroll — reference Stage 2 Rank 1 element by name
• Trust: what created belief in the person and product
• Conversion: what closed the order

WHY IT WORKED (3–4 sentences, WhatsApp briefing tone, specific to this exact ad):

HOOKS — Generate 20. Return only those scoring 8+.
Score each: scroll-stop, pain relevance, curiosity, sounds human, speakable in 3 sec.
RULE: If Stage 1 found any unusual visual element → minimum 6 hooks must reference that exact element.
No copywriter tone. Real Pakistani founder voice on camera.
Reject: threats, fake urgency, overacting, poetic lines.
Categories: Visual | Pain | Disbelief | Comparison | Challenge | Personal | Social Proof | Gift

5 VIDEO CONCEPTS (visual-led, based on what Stage 1 actually found):

3 SCRIPTS (Roman Urdu, 50–70 words, 20–30 sec):
Pain | Price comparison | Trust & guarantee

SCORES (1–10): scrollStop / founderTrust / offerClarity / proof / replicability

IMAGE AD BRIEFS (exactly 2):
Brief 1 — CONVERSION: buyer sees deal in 1 second and orders.
Brief 2 — CURIOSITY: replicate the Stage 2 Rank 1 scroll-stop cue exactly.

For each brief: type, visualConcept (one sentence, physically describes the frame),
headline (Roman Urdu max 6 words), subheadline (max 10 words), offerStrip, cta (2–3 words),
designNotes (1–2 lines for photographer — what to do, what NOT to do),
dallePrompt (English, no brand names, no text, no specific faces — describe mood, objects, setting, lighting).

════════════════════════════════════════════════
VALID JSON ONLY — no markdown, no commentary outside the JSON
════════════════════════════════════════════════
{
  "frameInventory": {
    "people": {
      "count": 1,
      "visibility": "full | partial | obscured | none",
      "pose": "exact description of body position and posture",
      "expressionOrEmotion": "what is visible, or 'unclear'",
      "faceDetails": "exact description — are eyes visible, what is on the face, any covering object named precisely"
    },
    "objectsAndProps": ["list each visible object separately"],
    "product": {
      "visible": false,
      "timing": "opening frame | appears later | not shown",
      "role": "hero | background | not shown"
    },
    "backgroundLocation": {
      "setting": "indoor | outdoor | unclear",
      "visibleCues": ["describe each visible background element"],
      "locationSignal": "what the background communicates, or 'background unclear'"
    },
    "lightingAndMood": {
      "lighting": "description of lighting",
      "mood": "description of visual mood"
    },
    "textOverlay": {
      "visible": false,
      "readableText": []
    },
    "unusualElements": ["each unusual element as a separate string — or single string 'standard talking-head — nothing unusual'"]
  },
  "viewerReaction": {
    "firstQuestion": "Roman Urdu question a viewer asks in 0.5 sec",
    "scrollStopStrength": 8,
    "reason": "one sentence — why this frame stops the scroll"
  },
  "topScrollStopCues": [
    { "rank": 1, "element": "specific visual element name", "category": "Pattern interrupt", "strength": 9 },
    { "rank": 2, "element": "...", "category": "...", "strength": 7 },
    { "rank": 3, "element": "...", "category": "...", "strength": 5 }
  ],
  "transcriptUsed": true,
  "attentionReason": "one line — reference Stage 2 Rank 1 element by name",
  "trustReason": "...",
  "conversionReason": "...",
  "winningMechanism": "[Scroll Stop] → [Trust] → [Offer] → [Risk Removal]",
  "whyItWorked": "...",
  "hooks": [{ "text": "...", "category": "Visual|Pain|Disbelief|Comparison|Challenge|Personal|Social Proof|Gift", "score": 9 }],
  "videoIdeas": [{ "title": "...", "concept": "..." }],
  "scripts": [
    { "angle": "Pain", "script": "..." },
    { "angle": "Price Comparison", "script": "..." },
    { "angle": "Trust & Guarantee", "script": "..." }
  ],
  "scores": { "scrollStop": 0, "founderTrust": 0, "offerClarity": 0, "proof": 0, "replicability": 0 },
  "imageBriefs": [
    { "type": "conversion", "visualConcept": "...", "headline": "...", "subheadline": "...", "offerStrip": "...", "cta": "...", "designNotes": "...", "dallePrompt": "..." },
    { "type": "curiosity", "visualConcept": "...", "headline": "...", "subheadline": "...", "offerStrip": "...", "cta": "...", "designNotes": "...", "dallePrompt": "..." }
  ],
  "deepAnalysis": {
    "spokenHook": "...", "visualHook": "...", "problem": "...", "promise": "...",
    "proof": "...", "offer": "...", "guarantee": "...", "cta": "...",
    "powerWords": ["..."], "buyerPsychology": "..."
  }
}
`.trim()

export async function GET(req: NextRequest) {
  const adId   = req.nextUrl.searchParams.get('adId')?.trim()
  const market = req.nextUrl.searchParams.get('market') as Market

  if (!adId || !market || !MARKETS[market]) {
    return NextResponse.json({ error: 'Missing or invalid adId / market' }, { status: 400 })
  }

  const { videoUrl, adText, adTitle, thumbnailUrl } = await getAdCreative(adId).catch(() => ({
    videoUrl: null, adText: '', adTitle: '', thumbnailUrl: null,
  }))

  const [transcript, thumbnail] = await Promise.all([
    videoUrl ? transcribe(videoUrl) : Promise.resolve(''),
    thumbnailUrl ? getThumbnailBase64(thumbnailUrl) : Promise.resolve(null),
  ])

  const fullContent = [adTitle, adText, transcript].filter(Boolean).join(' ')
  if (!fullContent.trim()) {
    return NextResponse.json({ error: 'No content found for this ad.' }, { status: 422 })
  }

  type ImgBlock = Anthropic.ImageBlockParam
  type TxtBlock = Anthropic.TextBlockParam
  type Block    = ImgBlock | TxtBlock

  const content: Block[] = []
  if (thumbnail) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: thumbnail.mediaType, data: thumbnail.data },
    } satisfies ImgBlock)
  }
  content.push({ type: 'text', text: PROMPT(adTitle, adText, transcript, !!thumbnail) } satisfies TxtBlock)

  let msg
  try {
    msg = await getAnthropicClient().messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      messages:   [{ role: 'user', content }],
    })
  } catch (err) {
    return NextResponse.json({ error: `Analysis failed: ${String(err)}` }, { status: 500 })
  }

  // If the model hit the token ceiling the JSON is truncated — report it cleanly
  // instead of crashing on JSON.parse.
  if (msg.stop_reason === 'max_tokens') {
    return NextResponse.json(
      { error: 'Analysis got cut off (too long). Please press Analyse again.' },
      { status: 500 }
    )
  }

  const raw   = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return NextResponse.json({ error: 'AI did not return readable analysis. Please retry.' }, { status: 500 })

  let r
  try {
    r = JSON.parse(match[0])
  } catch {
    return NextResponse.json({ error: 'AI returned malformed analysis. Please press Analyse again.' }, { status: 500 })
  }

  return NextResponse.json({
    adId, adTitle, adText, transcript,
    thumbnailAnalysed:   !!thumbnail,
    transcriptUsed:      r.transcriptUsed      ?? false,
    frameInventory:      r.frameInventory      ?? null,
    viewerReaction:      r.viewerReaction      ?? null,
    topScrollStopCues:   r.topScrollStopCues   ?? [],
    attentionReason:     r.attentionReason     ?? '',
    trustReason:         r.trustReason         ?? '',
    conversionReason:    r.conversionReason    ?? '',
    winningMechanism:    r.winningMechanism    ?? '',
    whyItWorked:         r.whyItWorked         ?? '',
    hooks:               r.hooks               ?? [],
    videoIdeas:          r.videoIdeas          ?? [],
    scripts:             r.scripts             ?? [],
    scores:              r.scores              ?? null,
    imageBriefs:         r.imageBriefs         ?? [],
    deepAnalysis:        r.deepAnalysis        ?? null,
  })
}
