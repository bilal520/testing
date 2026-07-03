// Central brand database — products, offers, and founder assets
// Stored in localStorage; never sent to server

export type AssetType   = 'transparent' | 'packshot' | 'lifestyle' | 'box' | 'ad_ready'
export type FounderPose = 'holding_product' | 'direct_camera' | 'smiling' | 'curiosity' | 'guarantee' | 'pointing' | 'other'
export type Category    = 'perfume' | 'attar' | 'bundle' | 'islamic' | 'other'
export type DbMarket    = 'pakistan' | 'uae' | 'bangladesh'

export interface ProductAsset {
  id: string
  src: string        // base64 dataUrl OR https:// CDN URL (Shopify, etc.)
  type: AssetType
  isPrimary: boolean
  label: string
}

export interface Product {
  id: string
  name: string
  shortName: string
  sku: string
  category: Category
  aliases: string[]            // "peak", "breeze", "blue bottle", "PB" — for text matching
  markets: DbMarket[]
  pricing: Partial<Record<DbMarket, { price: number; compareAt?: number }>>
  assets: ProductAsset[]
  landingPage: string
  status: 'active' | 'inactive'
  createdAt: string
}

export interface OfferItem {
  productId: string
  quantity: number
}

export interface Offer {
  id: string
  name: string
  market: DbMarket
  items: OfferItem[]           // links to products by id
  bundlePrice: number
  savings: number
  guaranteeText: string
  cod: boolean
  cta: string
  landingPage: string
  aliases: string[]            // "2x summer deal", "2749 deal", "garmi deal"
  status: 'active' | 'inactive'
  createdAt: string
}

export interface FounderPhoto {
  id: string
  src: string
  pose: FounderPose
  label: string
  isPrimary: boolean
}

export interface BrandDB {
  products: Product[]
  offers: Offer[]
  founderPhotos: FounderPhoto[]
  logoSrc: string
  updatedAt: string
}

// ─── Persistence ────────────────────────────────────────────────────────────

const DB_KEY = 'elyscents_db_v1'

const EMPTY_DB: BrandDB = {
  products: [], offers: [], founderPhotos: [], logoSrc: '', updatedAt: '',
}

export function loadDB(): BrandDB {
  if (typeof window === 'undefined') return EMPTY_DB
  try {
    const raw = localStorage.getItem(DB_KEY)
    return raw ? { ...EMPTY_DB, ...JSON.parse(raw) } : EMPTY_DB
  } catch { return EMPTY_DB }
}

export function saveDB(db: BrandDB) {
  localStorage.setItem(DB_KEY, JSON.stringify({ ...db, updatedAt: new Date().toISOString() }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function uid() { return Math.random().toString(36).slice(2, 10) }

export const CURRENCIES: Record<DbMarket, string> = { pakistan: 'PKR', uae: 'AED', bangladesh: 'BDT' }

export const MARKET_FLAGS: Record<DbMarket, string> = { pakistan: '🇵🇰', uae: '🇦🇪', bangladesh: '🇧🇩' }

export const ALL_MARKETS: DbMarket[] = ['pakistan', 'uae', 'bangladesh']

export const POSE_LABELS: Record<FounderPose, string> = {
  holding_product: 'Holding Product',
  direct_camera:   'Direct Camera',
  smiling:         'Smiling',
  curiosity:       'Curiosity / Unusual',
  guarantee:       'Guarantee',
  pointing:        'Pointing',
  other:           'Other',
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  transparent: 'Transparent PNG',
  packshot:    'Packshot',
  lifestyle:   'Lifestyle',
  box:         'Box / Packaging',
  ad_ready:    'Ad-Ready Square',
}

// Get product names for an offer
export function offerProductNames(offer: Offer, products: Product[]): string {
  return offer.items
    .map(item => products.find(p => p.id === item.productId)?.shortName || products.find(p => p.id === item.productId)?.name || '?')
    .join(' + ')
}

// Get primary image for a product
export function primaryAsset(product: Product): ProductAsset | null {
  return product.assets.find(a => a.isPrimary) ?? product.assets[0] ?? null
}

export async function compressImageFile(file: File, maxDim = 500): Promise<string> {
  return new Promise((resolve, reject) => {
    const img  = new Image()
    const url  = URL.createObjectURL(file)
    img.onload = () => {
      const scale  = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = reject
    img.src = url
  })
}
