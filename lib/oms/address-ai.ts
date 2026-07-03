import Anthropic from '@anthropic-ai/sdk'

// Claude-based address completeness (Phase 3). Pakistani addresses are messy and
// landmark-based, so a rules-only check misses nuance. Called only for borderline
// addresses (rules score < 85) to keep cost/latency down. Best-effort: on any
// failure we fall back to the rules verdict.

let _client: Anthropic | null = null
const client = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

export type AddressQuality = 'complete' | 'vague' | 'city_only' | 'missing'

export async function classifyAddress(address: string, city: string): Promise<{ quality: AddressQuality; complete: boolean } | null> {
  const a = (address ?? '').trim()
  if (!a) return { quality: 'missing', complete: false }
  try {
    const msg = await client().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content:
          `You classify Pakistani courier delivery addresses. Given the address and city, decide if a rider could find it.\n` +
          `Address: "${a}"\nCity: "${city}"\n` +
          `Reply ONLY JSON: {"quality":"complete"|"vague"|"city_only"|"missing"}.\n` +
          `complete = has a house/flat/street/block/sector OR a clear named landmark (masjid, market, school, well-known place).\n` +
          `vague = some detail but a rider would likely need to call.\ncity_only = only city/area, no locator.\nmissing = empty or garbage.`,
      }],
    })
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const quality = JSON.parse(m[0]).quality as AddressQuality
    if (!['complete', 'vague', 'city_only', 'missing'].includes(quality)) return null
    return { quality, complete: quality === 'complete' }
  } catch { return null }
}
