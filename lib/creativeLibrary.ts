// Creative Library — tracks AI-generated ads and links them to Facebook performance
// Stores metadata only (no image data) to keep localStorage lean

const KEY = 'elyscents_gen_library_v1'
const MAX  = 100

export interface LibraryEntry {
  genId:         string            // e.g. "ely-gen-a3b4c5d7"
  createdAt:     string            // ISO string
  market:        string
  concept:       string
  angle:         string
  headline:      string
  dna:           string
  productName:   string
  offer:         string
  audienceStage: string
  variantCount:  number
  scores:        { scrollStop: number; clarity: number; trustStrength: number; offerClarity: number } | null
  linkedFbAdIds: string[]          // FB ad IDs manually or auto-linked
}

export function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'ely-gen-'
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function loadLibrary(): LibraryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveEntry(entry: LibraryEntry): void {
  if (typeof window === 'undefined') return
  try {
    const lib = loadLibrary()
    const exists = lib.findIndex(e => e.genId === entry.genId)
    if (exists >= 0) { lib[exists] = entry }
    else { lib.unshift(entry) }
    // Keep only MAX entries
    if (lib.length > MAX) lib.splice(MAX)
    localStorage.setItem(KEY, JSON.stringify(lib))
  } catch { /* localStorage full — silently skip */ }
}

export function linkFbAdId(genId: string, fbAdId: string): void {
  if (typeof window === 'undefined') return
  try {
    const lib = loadLibrary()
    const entry = lib.find(e => e.genId === genId)
    if (!entry) return
    if (!entry.linkedFbAdIds.includes(fbAdId)) entry.linkedFbAdIds.push(fbAdId)
    localStorage.setItem(KEY, JSON.stringify(lib))
  } catch { /* ignore */ }
}

export function unlinkFbAdId(genId: string, fbAdId: string): void {
  if (typeof window === 'undefined') return
  try {
    const lib = loadLibrary()
    const entry = lib.find(e => e.genId === genId)
    if (!entry) return
    entry.linkedFbAdIds = entry.linkedFbAdIds.filter(id => id !== fbAdId)
    localStorage.setItem(KEY, JSON.stringify(lib))
  } catch { /* ignore */ }
}

export function deleteEntry(genId: string): void {
  if (typeof window === 'undefined') return
  try {
    const lib = loadLibrary().filter(e => e.genId !== genId)
    localStorage.setItem(KEY, JSON.stringify(lib))
  } catch { /* ignore */ }
}

// Find library entry by Facebook ad name (checks if name contains the genId)
export function findByAdName(adName: string): LibraryEntry | null {
  if (!adName) return null
  const match = adName.match(/ely-gen-[a-z0-9]{8}/i)
  if (!match) return null
  const lib = loadLibrary()
  return lib.find(e => e.genId === match[0]) ?? null
}

// Find library entry by linked FB ad ID
export function findByFbAdId(fbAdId: string): LibraryEntry | null {
  if (!fbAdId) return null
  const lib = loadLibrary()
  return lib.find(e => e.linkedFbAdIds.includes(fbAdId)) ?? null
}
