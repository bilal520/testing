import type { Offer, Product, BrandDB, DbMarket } from './brandData'

export interface OfferMatch {
  offer: Offer
  confidence: number    // 0–95
  reasons: string[]
}

// Run text-based matching of ad content against active offers in the DB.
// Called client-side after analysis returns — no server needed.
export function matchOffersToAd(
  content: { title?: string; text?: string; transcript?: string },
  db: BrandDB,
  market: DbMarket,
): OfferMatch[] {
  if (!db.offers.length) return []

  const blob = [content.title, content.text, content.transcript]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const activeOffers = db.offers.filter(
    o => o.status === 'active' && o.market === market,
  )

  const matches: OfferMatch[] = activeOffers.map(offer => {
    let score = 0
    const reasons: string[] = []

    // 1. Offer name or alias found in ad text
    const offerTerms = [offer.name, ...offer.aliases].filter(Boolean).map(t => t.toLowerCase())
    for (const term of offerTerms) {
      if (blob.includes(term)) {
        score += 40
        reasons.push(`"${term}" in ad text`)
        break
      }
    }

    // 2. Exact price match
    if (offer.bundlePrice > 0 && blob.includes(offer.bundlePrice.toString())) {
      score += 30
      reasons.push(`price ${offer.bundlePrice} mentioned`)
    }

    // 3. Individual product names/aliases found
    for (const item of offer.items) {
      const product = db.products.find(p => p.id === item.productId)
      if (!product) continue
      const terms = [product.name, product.shortName, ...product.aliases].filter(Boolean).map(t => t.toLowerCase())
      for (const term of terms) {
        if (term && blob.includes(term)) {
          score += 20
          reasons.push(`product "${product.name}" mentioned`)
          break
        }
      }
    }

    return { offer, confidence: Math.min(score, 95), reasons }
  })

  return matches
    .filter(m => m.confidence > 15)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
}

// Find a product by id
export function findProduct(db: BrandDB, id: string): Product | undefined {
  return db.products.find(p => p.id === id)
}
