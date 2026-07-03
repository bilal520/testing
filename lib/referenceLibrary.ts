// ── Reference Ad Library ──────────────────────────────────────────────────────
// 200-300 high-converting ad images stored in IndexedDB (browser).
// Metadata (tags, scores) stored in localStorage for fast querying.
// Images compressed to ~40KB thumbnails to keep storage manageable.

const DB_NAME    = 'elyscents_reflib_v1'
const DB_VERSION = 1
const IMG_STORE  = 'images'
const META_KEY   = 'elyscents_reflib_meta_v1'
const MAX        = 300

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RefMeta {
  id:             string
  addedAt:        string
  concept:        string   // warning|this_is_not|social_proof|news|lifestyle|us_vs_them|bundle_value|unknown
  stages:         string[] // cold, warm, hot
  subject:        string   // founder|product_only|model|founder_with_product|none
  background:     string   // dark|light|lifestyle|editorial|clean|outdoor
  format:         string   // 1:1|4:5|9:16|unknown
  energy:         string   // urgent|aspirational|informational|confrontational|conversational
  patternInterrupt?: string
  score:          number   // 1-5 user quality rating
  autoTagged:     boolean
  notes?:         string
}

// ── Metadata CRUD (localStorage) ──────────────────────────────────────────────

export function loadMeta(): RefMeta[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '[]') }
  catch { return [] }
}

function persistMeta(items: RefMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(items.slice(0, MAX)))
}

export function addMeta(m: RefMeta) {
  persistMeta([m, ...loadMeta().filter(x => x.id !== m.id)])
}

export function updateMeta(id: string, patch: Partial<RefMeta>) {
  persistMeta(loadMeta().map(m => m.id === id ? { ...m, ...patch } : m))
}

export function deleteMeta(id: string) {
  persistMeta(loadMeta().filter(m => m.id !== id))
}

// ── IndexedDB image storage ───────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('IndexedDB not available')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(IMG_STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveImage(id: string, dataUrl: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IMG_STORE, 'readwrite')
    const req = tx.objectStore(IMG_STORE).put({ id, dataUrl })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getImage(id: string): Promise<string | null> {
  const db = await openDB()
  return new Promise(resolve => {
    const req = db.transaction(IMG_STORE, 'readonly').objectStore(IMG_STORE).get(id)
    req.onsuccess = () => resolve(req.result?.dataUrl ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDB()
  return new Promise(resolve => {
    const tx = db.transaction(IMG_STORE, 'readwrite')
    tx.objectStore(IMG_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// Get multiple images at once (for reference selection)
export async function getImages(ids: string[]): Promise<{ id: string; dataUrl: string }[]> {
  if (!ids.length) return []
  const db = await openDB()
  const results: { id: string; dataUrl: string }[] = []
  await Promise.all(ids.map(id => new Promise<void>(resolve => {
    const req = db.transaction(IMG_STORE, 'readonly').objectStore(IMG_STORE).get(id)
    req.onsuccess = () => { if (req.result?.dataUrl) results.push({ id, dataUrl: req.result.dataUrl }); resolve() }
    req.onerror = () => resolve()
  })))
  return results
}

// ── Reference selection ───────────────────────────────────────────────────────

export interface SelectedRef {
  meta:    RefMeta
  dataUrl: string
}

export function scoreMeta(ref: RefMeta, concept: string, stage: string): number {
  let s = ref.score  // base: user quality rating (1-5)
  if (ref.concept === concept) s += 4
  else if (ref.concept !== 'unknown') s += 0
  if (ref.stages.includes(stage)) s += 3
  return s
}

export async function selectBestReferences(
  concept: string, stage: string, limit = 4
): Promise<SelectedRef[]> {
  const allMeta = loadMeta()
  if (!allMeta.length) return []

  const scored = allMeta
    .map(ref => ({ ref, score: scoreMeta(ref, concept, stage) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(10, allMeta.length))

  // Diversity pass: pick refs with different backgrounds/subjects to avoid 3 identical-looking ones
  const picked: typeof scored = []
  const usedBackgrounds = new Set<string>()
  for (const candidate of scored) {
    if (picked.length >= limit) break
    if (picked.length < 1 || !usedBackgrounds.has(candidate.ref.background) || picked.length === limit - 1) {
      picked.push(candidate)
      usedBackgrounds.add(candidate.ref.background)
    }
  }
  // Fill remaining slots if needed
  for (const candidate of scored) {
    if (picked.length >= limit) break
    if (!picked.includes(candidate)) picked.push(candidate)
  }

  const ids = picked.map(p => p.ref.id)
  const images = await getImages(ids)
  const imgMap = new Map(images.map(i => [i.id, i.dataUrl]))

  return picked
    .filter(p => imgMap.has(p.ref.id))
    .map(p => ({ meta: p.ref, dataUrl: imgMap.get(p.ref.id)! }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function refUid(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export async function compressRefImage(file: File, maxSide = 700): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = reject; img.src = url
  })
}
