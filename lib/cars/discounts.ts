import { shopifyGraphQL } from '@/lib/shopify'
import type { CarsConfig } from '@/lib/cars/config'

// ════════════════════════════════════════════════════════════════════════════
// Unique single-use recovery discount codes (Shopify). Requires `write_discounts`
// scope. Creates a REAL discount in Shopify — only ever called on a LIVE send
// (never in shadow mode). Free-shipping is the default (protects margin + is the
// step-2 incentive) and doubles as the exact-attribution key.
// ════════════════════════════════════════════════════════════════════════════

function makeCode(checkoutId: string): string {
  const short = checkoutId.replace(/\D/g, '').slice(-5) || Math.random().toString().slice(2, 7)
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `EL${short}${rand}`
}

interface UserErr { field?: string[]; message: string }

/** Create a unique, single-use, 48h recovery code. Returns the code, or null
 *  (discount_type='none', or on error → caller falls back to no code). */
export async function createRecoveryCode(checkoutId: string, cfg: CarsConfig): Promise<string | null> {
  if (cfg.discount_type === 'none') return null
  const code = makeCode(checkoutId)
  const startsAt = new Date().toISOString()
  const endsAt = new Date(Date.now() + (cfg.attribution_window_hours || 48) * 3_600_000).toISOString()
  const title = `CARS recovery ${code}`

  try {
    if (cfg.discount_type === 'free_shipping') {
      const data: { discountCodeFreeShippingCreate?: { userErrors: UserErr[] } } = await shopifyGraphQL(`
        mutation($d: DiscountCodeFreeShippingInput!) {
          discountCodeFreeShippingCreate(freeShippingCodeDiscount: $d) {
            userErrors { field message }
          }
        }`, {
          d: {
            title, code, startsAt, endsAt,
            usageLimit: 1, appliesOncePerCustomer: true,
            customerSelection: { all: true },
            destination: { all: true },
          },
        })
      const errs = data.discountCodeFreeShippingCreate?.userErrors ?? []
      if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
    } else { // percent
      const pct = Math.max(0.01, Math.min(0.9, (cfg.discount_percent || 10) / 100))
      const data: { discountCodeBasicCreate?: { userErrors: UserErr[] } } = await shopifyGraphQL(`
        mutation($d: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $d) {
            userErrors { field message }
          }
        }`, {
          d: {
            title, code, startsAt, endsAt,
            usageLimit: 1, appliesOncePerCustomer: true,
            customerSelection: { all: true },
            customerGets: { value: { percentage: pct }, items: { all: true } },
          },
        })
      const errs = data.discountCodeBasicCreate?.userErrors ?? []
      if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
    }
    return code
  } catch {
    return null // never block a send on discount failure
  }
}
