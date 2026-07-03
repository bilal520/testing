'use client'
import { useState, useRef, useCallback } from 'react'
import {
  loadDB, saveDB, uid, compressImageFile,
  ALL_MARKETS, CURRENCIES, MARKET_FLAGS, POSE_LABELS, ASSET_TYPE_LABELS,
  type BrandDB, type Product, type Offer, type OfferItem,
  type ProductAsset, type AssetType, type FounderPhoto, type FounderPose,
  type Category, type DbMarket,
} from '@/lib/brandData'

// ─── Helpers ────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ${on ? 'bg-green-500' : 'bg-gray-200'}`}>
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gray-400" />
  )
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input type="number" value={value || ''} onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gray-400" />
  )
}

function Dropzone({ label, onFiles }: { label: string; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden"
        onChange={e => e.target.files && onFiles(Array.from(e.target.files))} />
      <button type="button" onClick={() => ref.current?.click()}
        className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 text-center text-xs text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
        + {label}
      </button>
    </div>
  )
}

function ThumbGrid({ assets, onDelete, onPrimary }: {
  assets: ProductAsset[]
  onDelete: (id: string) => void
  onPrimary: (id: string) => void
}) {
  if (!assets.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {assets.map(a => (
        <div key={a.id} className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.src} alt={a.label}
            className={`w-16 h-16 object-cover rounded-lg border-2 bg-gray-50 ${a.isPrimary ? 'border-gray-900' : 'border-gray-200'}`} />
          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors" />
          <button onClick={() => onDelete(a.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            ×
          </button>
          {!a.isPrimary && (
            <button onClick={() => onPrimary(a.id)} title="Set as primary"
              className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/60 text-white rounded-b-lg py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              Primary
            </button>
          )}
          {a.isPrimary && (
            <div className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-gray-900 text-white rounded-b-lg py-0.5">★</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Shopify Image Fetcher ───────────────────────────────────────────────────

interface ShopifyFetchResult {
  title: string; handle: string
  images: { src: string; alt: string; position: number }[]
}

function ShopifyImagePicker({ onAdd }: {
  onAdd: (images: { src: string; alt: string; type: AssetType }[]) => void
}) {
  const [shopUrl,   setShopUrl]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<ShopifyFetchResult | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [assetType, setAssetType] = useState<AssetType>('packshot')

  async function fetchImages() {
    if (!shopUrl.includes('/products/')) return
    setLoading(true); setError(null); setResult(null); setSelected(new Set())
    try {
      const res  = await fetch(`/api/fetch-shopify-images?url=${encodeURIComponent(shopUrl)}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setResult(data as ShopifyFetchResult)
      // Pre-select all images
      setSelected(new Set((data as ShopifyFetchResult).images.map((i: { src: string }) => i.src)))
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  function toggle(src: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(src) ? next.delete(src) : next.add(src)
      return next
    })
  }

  function handleAdd() {
    if (!result) return
    const toAdd = result.images
      .filter(img => selected.has(img.src))
      .map(img => ({ src: img.src, alt: img.alt, type: assetType }))
    onAdd(toAdd)
    setResult(null); setShopUrl(''); setSelected(new Set())
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Fetch from Shopify</p>
      <div className="flex gap-2">
        <input value={shopUrl} onChange={e => setShopUrl(e.target.value)}
          placeholder="https://elyscents.pk/products/peak-breeze"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gray-400" />
        <button onClick={fetchImages} disabled={loading || !shopUrl.includes('/products/')}
          className="shrink-0 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
          {loading ? '…' : 'Fetch →'}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {result && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">{result.title} — {result.images.length} images</p>
            <div className="flex gap-1.5 items-center">
              <select value={assetType} onChange={e => setAssetType(e.target.value as AssetType)}
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none">
                {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map(t => (
                  <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <button onClick={() => setSelected(new Set(result.images.map(i => i.src)))}
                className="text-[10px] text-blue-600 hover:underline">All</button>
              <button onClick={() => setSelected(new Set())}
                className="text-[10px] text-gray-400 hover:underline">None</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {result.images.map((img, i) => (
              <button key={img.src} onClick={() => toggle(img.src)}
                className={`relative rounded-lg overflow-hidden border-2 transition-all ${selected.has(img.src) ? 'border-gray-900 ring-1 ring-gray-900' : 'border-transparent'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={img.alt} className="w-full aspect-square object-cover bg-gray-100" />
                {selected.has(img.src) && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-gray-900 rounded-full flex items-center justify-center">
                    <span className="text-white text-[8px] font-bold">✓</span>
                  </div>
                )}
                <p className="text-[9px] text-gray-400 text-center py-0.5">{i + 1}</p>
              </button>
            ))}
          </div>
          <button onClick={handleAdd} disabled={selected.size === 0}
            className="w-full py-2 bg-gray-900 text-white text-xs rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
            Add {selected.size} selected image{selected.size !== 1 ? 's' : ''} as {ASSET_TYPE_LABELS[assetType]}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Product Form ────────────────────────────────────────────────────────────

const EMPTY_PRODUCT: Omit<Product, 'id' | 'createdAt'> = {
  name: '', shortName: '', sku: '', category: 'perfume',
  aliases: [], markets: ['pakistan'], pricing: {},
  assets: [], landingPage: '', status: 'active',
}

function ProductForm({ initial, products, onSave, onCancel }: {
  initial: Partial<Product>
  products: Product[]
  onSave: (p: Product) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Omit<Product, 'id' | 'createdAt'>>({ ...EMPTY_PRODUCT, ...initial })
  const [urlInput, setUrlInput] = useState('')
  const [assetType, setAssetType] = useState<AssetType>('packshot')
  const [saving, setSaving] = useState(false)

  const update = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }))

  function toggleMarket(m: DbMarket) {
    update({ markets: form.markets.includes(m) ? form.markets.filter(x => x !== m) : [...form.markets, m] })
  }

  async function addFiles(files: File[]) {
    setSaving(true)
    try {
      const newAssets = await Promise.all(files.map(async f => ({
        id: uid(), src: await compressImageFile(f, 500), type: assetType,
        isPrimary: form.assets.length === 0, label: f.name.replace(/\.[^.]+$/, ''),
      })))
      update({ assets: [...form.assets, ...newAssets] })
    } finally { setSaving(false) }
  }

  function addUrl() {
    const url = urlInput.trim()
    if (!url.startsWith('http')) return
    const asset: ProductAsset = { id: uid(), src: url, type: assetType, isPrimary: form.assets.length === 0, label: url.split('/').pop()?.split('?')[0] ?? 'image' }
    update({ assets: [...form.assets, asset] })
    setUrlInput('')
  }

  function deleteAsset(id: string) {
    const next = form.assets.filter(a => a.id !== id)
    if (!next.find(a => a.isPrimary) && next.length) next[0].isPrimary = true
    update({ assets: next })
  }

  function setPrimary(id: string) {
    update({ assets: form.assets.map(a => ({ ...a, isPrimary: a.id === id })) })
  }

  function handleSave() {
    if (!form.name.trim()) return
    const product: Product = {
      ...form,
      id: (initial as Product).id ?? uid(),
      createdAt: (initial as Product).createdAt ?? new Date().toISOString(),
    }
    onSave(product)
  }

  const aliasStr = form.aliases.join(', ')

  return (
    <div className="rounded-xl border-2 border-gray-900 bg-white p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Product name *">
          <TextInput value={form.name} onChange={v => update({ name: v })} placeholder="Peak Breeze" />
        </Field>
        <Field label="Short name">
          <TextInput value={form.shortName} onChange={v => update({ shortName: v })} placeholder="Peak" />
        </Field>
        <Field label="SKU">
          <TextInput value={form.sku} onChange={v => update({ sku: v })} placeholder="PB-001" />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={e => update({ category: e.target.value as Category })}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gray-400">
            <option value="perfume">Perfume</option>
            <option value="attar">Attar</option>
            <option value="bundle">Bundle</option>
            <option value="islamic">Islamic Product</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>

      {/* Markets */}
      <Field label="Markets">
        <div className="flex gap-3 mt-1">
          {ALL_MARKETS.map(m => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={form.markets.includes(m)} onChange={() => toggleMarket(m)}
                className="rounded border-gray-300" />
              <span className="text-sm">{MARKET_FLAGS[m]} {m.charAt(0).toUpperCase() + m.slice(1)}</span>
            </label>
          ))}
        </div>
      </Field>

      {/* Pricing per market */}
      {form.markets.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Pricing</p>
          <div className="grid grid-cols-3 gap-3">
            {form.markets.map(m => (
              <div key={m}>
                <label className="text-xs text-gray-500 block mb-1">{MARKET_FLAGS[m]} Price ({CURRENCIES[m]})</label>
                <NumInput
                  value={form.pricing[m]?.price ?? 0}
                  onChange={v => update({ pricing: { ...form.pricing, [m]: { ...form.pricing[m], price: v } } })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aliases */}
      <Field label="Aliases (comma-separated — for ad matching)">
        <TextInput value={aliasStr}
          onChange={v => update({ aliases: v.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="peak, breeze, blue bottle, PB, peak briz" />
      </Field>

      {/* Status */}
      <div className="flex items-center gap-3">
        <Toggle on={form.status === 'active'} onChange={v => update({ status: v ? 'active' : 'inactive' })} />
        <span className="text-sm text-gray-600">{form.status === 'active' ? 'Active' : 'Inactive'}</span>
      </div>

      {/* Images */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Product Images</p>
        <div className="flex gap-2 mb-2">
          <select value={assetType} onChange={e => setAssetType(e.target.value as AssetType)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-gray-400">
            {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map(t => (
              <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <Dropzone label={`Upload ${ASSET_TYPE_LABELS[assetType]}`} onFiles={addFiles} />
        <div className="flex gap-2 mt-2">
          <TextInput value={urlInput} onChange={setUrlInput} placeholder="https://cdn.shopify.com/... (paste single image URL)" />
          <button type="button" onClick={addUrl} disabled={!urlInput.startsWith('http')}
            className="shrink-0 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors">
            Add
          </button>
        </div>
        <div className="border-t border-gray-100 pt-3 mt-1">
          <ShopifyImagePicker onAdd={items => {
            const newAssets: ProductAsset[] = items.map((item, idx) => ({
              id: uid(), src: item.src, type: item.type,
              isPrimary: form.assets.length === 0 && idx === 0,
              label: item.alt,
            }))
            update({ assets: [...form.assets, ...newAssets] })
          }} />
        </div>
        <ThumbGrid assets={form.assets} onDelete={deleteAsset} onPrimary={setPrimary} />
        <p className="text-[10px] text-gray-300 mt-1.5">★ = primary image used in ad generation</p>
      </div>

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button onClick={handleSave} disabled={!form.name.trim() || saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : 'Save Product'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Offer Form ──────────────────────────────────────────────────────────────

const EMPTY_OFFER: Omit<Offer, 'id' | 'createdAt'> = {
  name: '', market: 'pakistan', items: [], bundlePrice: 0, savings: 0,
  guaranteeText: '', cod: true, cta: 'Order Now', landingPage: '',
  aliases: [], status: 'active',
}

function OfferForm({ initial, products, onSave, onCancel }: {
  initial: Partial<Offer>
  products: Product[]
  onSave: (o: Offer) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Omit<Offer, 'id' | 'createdAt'>>({ ...EMPTY_OFFER, ...initial })

  const update = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }))

  function toggleProduct(pid: string) {
    const exists = form.items.find(i => i.productId === pid)
    if (exists) {
      update({ items: form.items.filter(i => i.productId !== pid) })
    } else {
      update({ items: [...form.items, { productId: pid, quantity: 1 }] })
    }
  }

  function setQty(pid: string, qty: number) {
    update({ items: form.items.map(i => i.productId === pid ? { ...i, quantity: qty } : i) })
  }

  const availableProducts = products.filter(p =>
    p.status === 'active' && (p.markets.includes(form.market))
  )

  const aliasStr = form.aliases.join(', ')

  return (
    <div className="rounded-xl border-2 border-gray-900 bg-white p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Offer name *">
          <TextInput value={form.name} onChange={v => update({ name: v })} placeholder="Summer 2 Deal" />
        </Field>
        <Field label="Market">
          <select value={form.market} onChange={e => update({ market: e.target.value as DbMarket })}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {ALL_MARKETS.map(m => <option key={m} value={m}>{MARKET_FLAGS[m]} {m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
          </select>
        </Field>
      </div>

      {/* Products selection */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Products in this offer</p>
        {availableProducts.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No active products for {form.market}. Add products first.</p>
        ) : (
          <div className="space-y-2">
            {availableProducts.map(p => {
              const item = form.items.find(i => i.productId === p.id)
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <input type="checkbox" checked={!!item} onChange={() => toggleProduct(p.id)} className="rounded border-gray-300" />
                  <span className="text-sm text-gray-700 flex-1">{p.name}{p.shortName ? ` (${p.shortName})` : ''}</span>
                  {item && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Qty:</span>
                      <input type="number" min={1} value={item.quantity}
                        onChange={e => setQty(p.id, parseInt(e.target.value) || 1)}
                        className="w-14 border border-gray-200 rounded px-2 py-0.5 text-xs text-center focus:outline-none focus:border-gray-400" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Bundle price (${CURRENCIES[form.market]})`}>
          <NumInput value={form.bundlePrice} onChange={v => update({ bundlePrice: v })} />
        </Field>
        <Field label={`Savings (${CURRENCIES[form.market]})`}>
          <NumInput value={form.savings} onChange={v => update({ savings: v })} />
        </Field>
        <Field label="Guarantee text">
          <TextInput value={form.guaranteeText} onChange={v => update({ guaranteeText: v })} placeholder="100% paise wapas" />
        </Field>
        <Field label="CTA button text">
          <TextInput value={form.cta} onChange={v => update({ cta: v })} placeholder="Order Now" />
        </Field>
        <div className="col-span-2">
          <Field label="Landing page URL">
            <TextInput value={form.landingPage} onChange={v => update({ landingPage: v })} placeholder="https://..." />
          </Field>
        </div>
      </div>

      {/* COD + Status */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <Toggle on={form.cod} onChange={v => update({ cod: v })} />
          <span className="text-sm text-gray-600">COD available</span>
        </div>
        <div className="flex items-center gap-2">
          <Toggle on={form.status === 'active'} onChange={v => update({ status: v ? 'active' : 'inactive' })} />
          <span className="text-sm text-gray-600">{form.status === 'active' ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      {/* Aliases */}
      <Field label="Aliases (comma-separated — for ad matching)">
        <TextInput value={aliasStr}
          onChange={v => update({ aliases: v.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="2x summer deal, 2749 deal, garmi deal, peak + deep" />
      </Field>

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button onClick={() => { if (form.name.trim()) onSave({ ...form, id: (initial as Offer).id ?? uid(), createdAt: (initial as Offer).createdAt ?? new Date().toISOString() }) }}
          disabled={!form.name.trim()}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
          Save Offer
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Main Setup Tab ──────────────────────────────────────────────────────────

type SetupSection = 'products' | 'offers' | 'founder' | 'logo'

export default function BrandSetupTab() {
  const [db, setDb] = useState<BrandDB>(() => loadDB())
  const [section, setSection] = useState<SetupSection>('products')
  const [productForm, setProductForm] = useState<Partial<Product> | null>(null)
  const [offerForm, setOfferForm] = useState<Partial<Offer> | null>(null)
  const founderRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const [founderPose, setFounderPose] = useState<FounderPose>('direct_camera')

  function updateDB(patch: Partial<BrandDB>) {
    const next = { ...db, ...patch }
    setDb(next)
    saveDB(next)
  }

  // ── Products ─────────────────────────────────────────────────────────────

  function saveProduct(p: Product) {
    const exists = db.products.find(x => x.id === p.id)
    updateDB({ products: exists ? db.products.map(x => x.id === p.id ? p : x) : [...db.products, p] })
    setProductForm(null)
  }

  function deleteProduct(id: string) {
    if (!confirm('Delete this product? Any offers using it will need to be updated.')) return
    updateDB({ products: db.products.filter(p => p.id !== id) })
  }

  // ── Offers ────────────────────────────────────────────────────────────────

  function saveOffer(o: Offer) {
    const exists = db.offers.find(x => x.id === o.id)
    updateDB({ offers: exists ? db.offers.map(x => x.id === o.id ? o : x) : [...db.offers, o] })
    setOfferForm(null)
  }

  function deleteOffer(id: string) {
    if (!confirm('Delete this offer?')) return
    updateDB({ offers: db.offers.filter(o => o.id !== id) })
  }

  // ── Founder photos ────────────────────────────────────────────────────────

  async function handleFounderFiles(files: File[]) {
    const newPhotos: FounderPhoto[] = await Promise.all(files.slice(0, 10).map(async f => ({
      id: uid(), src: await compressImageFile(f, 600), pose: founderPose,
      label: POSE_LABELS[founderPose], isPrimary: false,
    })))
    updateDB({ founderPhotos: [...db.founderPhotos, ...newPhotos] })
  }

  function deleteFounder(id: string) {
    updateDB({ founderPhotos: db.founderPhotos.filter(p => p.id !== id) })
  }

  function setPrimaryFounder(id: string, pose: FounderPose) {
    updateDB({
      founderPhotos: db.founderPhotos.map(p =>
        p.id === id ? { ...p, isPrimary: true } : p.pose === pose ? { ...p, isPrimary: false } : p
      ),
    })
  }

  // ── Logo ──────────────────────────────────────────────────────────────────

  async function handleLogo(files: File[]) {
    if (!files[0]) return
    const src = await compressImageFile(files[0], 400)
    updateDB({ logoSrc: src })
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const sections: { id: SetupSection; label: string }[] = [
    { id: 'products', label: `Products (${db.products.length})` },
    { id: 'offers',   label: `Offers (${db.offers.length})` },
    { id: 'founder',  label: `Founder Photos (${db.founderPhotos.length})` },
    { id: 'logo',     label: 'Logo' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Brand Library</h2>
        <p className="text-xs text-gray-400 mt-0.5">Products, offers, and assets. Used for ad matching and image generation. Stored locally.</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {sections.map(s => (
          <button key={s.id} onClick={() => { setSection(s.id); setProductForm(null); setOfferForm(null) }}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              section === s.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Products ─────────────────────────────────────────── */}
      {section === 'products' && (
        <div className="space-y-3">
          {!productForm && (
            <button onClick={() => setProductForm({})}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
              + Add Product
            </button>
          )}
          {productForm && (
            <ProductForm
              initial={productForm}
              products={db.products}
              onSave={saveProduct}
              onCancel={() => setProductForm(null)}
            />
          )}
          {db.products.map(p => {
            const thumb = p.assets.find(a => a.isPrimary) ?? p.assets[0]
            const price = p.markets.map(m => `${CURRENCIES[m]} ${p.pricing[m]?.price ?? '—'}`).join(' / ')
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb.src} alt={p.name} className="w-12 h-12 object-cover rounded-lg border border-gray-200 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-lg shrink-0">🧴</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-gray-900">{p.name}</p>
                      {p.shortName && <span className="text-xs text-gray-400">({p.shortName})</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {p.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{p.markets.map(m => MARKET_FLAGS[m]).join(' ')} · {price}</p>
                    {p.aliases.length > 0 && (
                      <p className="text-[11px] text-gray-300 mt-0.5 truncate">
                        Aliases: {p.aliases.slice(0, 5).join(', ')}{p.aliases.length > 5 ? `+${p.aliases.length - 5}` : ''}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-300">{p.assets.length} image{p.assets.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setProductForm(p)}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-gray-800 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteProduct(p.id)}
                      className="text-xs px-2 py-1 rounded border border-red-100 text-red-400 hover:text-red-700 transition-colors">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {db.products.length === 0 && !productForm && (
            <p className="text-center py-8 text-sm text-gray-300">No products yet. Add your first product above.</p>
          )}
        </div>
      )}

      {/* ── Offers ───────────────────────────────────────────── */}
      {section === 'offers' && (
        <div className="space-y-3">
          {!offerForm && (
            <button onClick={() => setOfferForm({})}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
              + Add Offer / Bundle
            </button>
          )}
          {offerForm && (
            <OfferForm
              initial={offerForm}
              products={db.products}
              onSave={saveOffer}
              onCancel={() => setOfferForm(null)}
            />
          )}
          {db.offers.map(o => {
            const productNames = o.items
              .map(item => db.products.find(p => p.id === item.productId))
              .filter(Boolean)
              .map(p => p!.shortName || p!.name)
              .join(' + ')
            return (
              <div key={o.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-900 text-white flex items-center justify-center text-lg shrink-0">
                    {MARKET_FLAGS[o.market]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-gray-900">{o.name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${o.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {o.status}
                      </span>
                    </div>
                    {productNames && <p className="text-xs text-gray-500 mt-0.5">{productNames}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {CURRENCIES[o.market]} {o.bundlePrice}
                      {o.savings > 0 ? ` · Save ${o.savings}` : ''}
                      {o.guaranteeText ? ` · ${o.guaranteeText}` : ''}
                    </p>
                    {o.aliases.length > 0 && (
                      <p className="text-[11px] text-gray-300 mt-0.5 truncate">
                        Aliases: {o.aliases.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setOfferForm(o)}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-gray-800 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteOffer(o.id)}
                      className="text-xs px-2 py-1 rounded border border-red-100 text-red-400 hover:text-red-700 transition-colors">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {db.offers.length === 0 && !offerForm && (
            <p className="text-center py-8 text-sm text-gray-300">No offers yet. Create your first offer above.</p>
          )}
        </div>
      )}

      {/* ── Founder Photos ────────────────────────────────────── */}
      {section === 'founder' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-900">Upload Founder Photo</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pose / Mood">
                <select value={founderPose} onChange={e => setFounderPose(e.target.value as FounderPose)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                  {(Object.keys(POSE_LABELS) as FounderPose[]).map(p => (
                    <option key={p} value={p}>{POSE_LABELS[p]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <input ref={founderRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && handleFounderFiles(Array.from(e.target.files))} />
            <button onClick={() => founderRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
              + Upload {POSE_LABELS[founderPose]} photo
            </button>
          </div>
          <p className="text-xs text-gray-400">Image ad generator selects founder photo by pose. Tag your photos correctly for best results.</p>

          {/* Grouped by pose */}
          {(Object.keys(POSE_LABELS) as FounderPose[]).map(pose => {
            const photos = db.founderPhotos.filter(p => p.pose === pose)
            if (!photos.length) return null
            return (
              <div key={pose} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{POSE_LABELS[pose]}</p>
                <div className="flex flex-wrap gap-3">
                  {photos.map(photo => (
                    <div key={photo.id} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.src} alt={photo.label}
                        className={`w-20 h-20 object-cover rounded-xl border-2 ${photo.isPrimary ? 'border-gray-900' : 'border-gray-200'}`} />
                      <button onClick={() => deleteFounder(photo.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        ×
                      </button>
                      {!photo.isPrimary && (
                        <button onClick={() => setPrimaryFounder(photo.id, pose)}
                          className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white rounded-b-xl py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                          Set primary
                        </button>
                      )}
                      {photo.isPrimary && (
                        <div className="absolute bottom-0 left-0 right-0 text-[8px] bg-gray-900 text-white rounded-b-xl py-0.5 text-center">★ primary</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {db.founderPhotos.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-300">No founder photos yet.</p>
          )}
        </div>
      )}

      {/* ── Logo ─────────────────────────────────────────────── */}
      {section === 'logo' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <p className="text-sm font-medium text-gray-900">Brand Logo</p>
            {db.logoSrc ? (
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={db.logoSrc} alt="Logo" className="h-16 object-contain border border-gray-200 rounded-lg p-2 bg-gray-50" />
                <div>
                  <button onClick={() => logoRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:text-gray-900 transition-colors block mb-1.5">
                    Replace
                  </button>
                  <button onClick={() => updateDB({ logoSrc: '' })}
                    className="text-xs text-red-400 hover:text-red-700 transition-colors">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input ref={logoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => e.target.files && handleLogo(Array.from(e.target.files))} />
                <button onClick={() => logoRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors">
                  + Upload logo (PNG with transparent background preferred)
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-center text-gray-300">All assets stored locally in your browser. Never sent to a server.</p>
        </div>
      )}
    </div>
  )
}
