// Browser-only canvas text overlay engine
// Gemini generates the clean visual scene; this module renders all text on top.

export type PresetId    = 'premium_luxury' | 'bold_direct' | 'social_proof' | 'warning_style' | 'fresh_summer'
export type CTAStyle    = 'gold_pill' | 'white_pill' | 'red_pill' | 'dark_pill'
export type BubbleStyle = 'soft_white' | 'dark_frosted' | 'warm_amber'
export type OverlayGrad = 'gradient_top' | 'gradient_bottom' | 'gradient_full' | 'none'

export interface OverlayLayout {
  stylePreset:   PresetId
  overlay:       OverlayGrad
  bubble?:       { text: string; style: BubbleStyle }
  badges:        string[]
  cta:           { text: string; style: CTAStyle }
  logoPosition?: 'bottom_left' | 'bottom_right' | 'top_right'
}

export interface VariantOverlay {
  headline:     string
  subline?:     string
  stylePreset?: PresetId  // V3 color test overrides base preset
}

// ─── Preset definitions ───────────────────────────────────────────────────────

interface P {
  hlFont:      (sz: number) => string
  hlColor:     string
  hlShadow:    string | null
  subFont:     (sz: number) => string
  subColor:    string
  bblBg:       string
  bblColor:    string
  bblBorder:   string
  badgeBg:     string
  badgeColor:  string
  badgeBorder: string
  cta:         Record<CTAStyle, [string, string]>  // [bg, textColor]
  gradTop:     [string, string]
  gradBot:     [string, string]
  gradRatio:   number  // fraction of height the gradient covers
}

const PRESETS: Record<PresetId, P> = {
  premium_luxury: {
    hlFont:      sz => `bold ${sz}px Georgia,"Times New Roman",serif`,
    hlColor:     '#ffffff',
    hlShadow:    'rgba(0,0,0,0.85)',
    subFont:     sz => `${sz}px Georgia,serif`,
    subColor:    '#d4af37',
    bblBg:       'rgba(12,8,4,0.60)',
    bblColor:    '#ffffff',
    bblBorder:   'rgba(212,175,55,0.50)',
    badgeBg:     'rgba(0,0,0,0.70)',
    badgeColor:  '#ffffff',
    badgeBorder: 'rgba(212,175,55,0.55)',
    cta: {
      gold_pill:  ['#c9a84c', '#000000'],
      white_pill: ['#ffffff', '#000000'],
      red_pill:   ['#e8192c', '#ffffff'],
      dark_pill:  ['#1a1a1a', '#ffffff'],
    },
    gradTop:   ['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.00)'],
    gradBot:   ['rgba(0,0,0,0.00)', 'rgba(0,0,0,0.72)'],
    gradRatio: 0.42,
  },
  bold_direct: {
    hlFont:      sz => `900 ${sz}px "Arial Black",Impact,sans-serif`,
    hlColor:     '#ffffff',
    hlShadow:    'rgba(0,0,0,0.75)',
    subFont:     sz => `bold ${sz}px Arial,sans-serif`,
    subColor:    '#ffe066',
    bblBg:       'rgba(255,255,255,0.94)',
    bblColor:    '#111111',
    bblBorder:   'rgba(0,0,0,0.12)',
    badgeBg:     '#1a1a1a',
    badgeColor:  '#ffffff',
    badgeBorder: 'rgba(255,255,255,0.15)',
    cta: {
      gold_pill:  ['#c9a84c', '#000000'],
      white_pill: ['#ffffff', '#111111'],
      red_pill:   ['#e8192c', '#ffffff'],
      dark_pill:  ['#111111', '#ffffff'],
    },
    gradTop:   ['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.00)'],
    gradBot:   ['rgba(0,0,0,0.00)', 'rgba(0,0,0,0.65)'],
    gradRatio: 0.38,
  },
  social_proof: {
    hlFont:      sz => `bold ${sz}px Georgia,serif`,
    hlColor:     '#ffffff',
    hlShadow:    'rgba(0,0,0,0.65)',
    subFont:     sz => `${sz}px Arial,sans-serif`,
    subColor:    '#e8e8e8',
    bblBg:       'rgba(255,255,255,0.97)',
    bblColor:    '#1a1a1a',
    bblBorder:   'rgba(0,0,0,0.08)',
    badgeBg:     'rgba(0,0,0,0.65)',
    badgeColor:  '#ffffff',
    badgeBorder: 'rgba(255,255,255,0.20)',
    cta: {
      gold_pill:  ['#c9a84c', '#000000'],
      white_pill: ['#ffffff', '#000000'],
      red_pill:   ['#e8192c', '#ffffff'],
      dark_pill:  ['#1a1a1a', '#ffffff'],
    },
    gradTop:   ['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.00)'],
    gradBot:   ['rgba(0,0,0,0.00)', 'rgba(0,0,0,0.65)'],
    gradRatio: 0.38,
  },
  warning_style: {
    hlFont:      sz => `900 ${sz}px "Arial Black",Impact,sans-serif`,
    hlColor:     '#e8192c',
    hlShadow:    'rgba(0,0,0,0.95)',
    subFont:     sz => `bold ${sz}px Arial,sans-serif`,
    subColor:    '#ffffff',
    bblBg:       'rgba(232,25,44,0.12)',
    bblColor:    '#ffffff',
    bblBorder:   'rgba(232,25,44,0.65)',
    badgeBg:     'rgba(232,25,44,0.88)',
    badgeColor:  '#ffffff',
    badgeBorder: 'rgba(255,255,255,0.20)',
    cta: {
      gold_pill:  ['#e8192c', '#ffffff'],
      white_pill: ['#ffffff', '#e8192c'],
      red_pill:   ['#e8192c', '#ffffff'],
      dark_pill:  ['#000000', '#ffffff'],
    },
    gradTop:   ['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.00)'],
    gradBot:   ['rgba(0,0,0,0.00)', 'rgba(0,0,0,0.78)'],
    gradRatio: 0.48,
  },
  fresh_summer: {
    hlFont:      sz => `900 ${sz}px "Arial Black",Impact,sans-serif`,
    hlColor:     '#ffffff',
    hlShadow:    'rgba(0,60,140,0.55)',
    subFont:     sz => `bold ${sz}px Arial,sans-serif`,
    subColor:    '#fff8c0',
    bblBg:       'rgba(255,255,255,0.94)',
    bblColor:    '#004080',
    bblBorder:   'rgba(0,120,255,0.22)',
    badgeBg:     'rgba(0,80,160,0.88)',
    badgeColor:  '#ffffff',
    badgeBorder: 'rgba(255,255,255,0.20)',
    cta: {
      gold_pill:  ['#ffd700', '#000000'],
      white_pill: ['#ffffff', '#004080'],
      red_pill:   ['#e8192c', '#ffffff'],
      dark_pill:  ['#004080', '#ffffff'],
    },
    gradTop:   ['rgba(0,40,100,0.62)', 'rgba(0,40,100,0.00)'],
    gradBot:   ['rgba(0,40,100,0.00)', 'rgba(0,40,100,0.62)'],
    gradRatio: 0.40,
  },
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

const CANVAS_W = 1080  // All outputs are 1080px wide

const CANVAS_H: Record<string, number> = {
  '1:1':  1080,
  '4:5':  1350,
  '9:16': 1920,
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Word-wrap text, return lines
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

// Draw word-wrapped text, returns y after last line
function drawText(
  ctx: CanvasRenderingContext2D, text: string,
  x: number, y: number, maxWidth: number, lineHeight: number,
  align: CanvasTextAlign = 'center'
): number {
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  const lines = wrapLines(ctx, text, maxWidth)
  for (const ln of lines) { ctx.fillText(ln, x, y); y += lineHeight }
  return y
}

// Rounded rectangle path
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ─── Overlay drawing functions ────────────────────────────────────────────────

function drawGradient(ctx: CanvasRenderingContext2D, type: OverlayGrad, p: P, w: number, h: number) {
  if (type === 'none') return
  if (type === 'gradient_top' || type === 'gradient_full') {
    const g = ctx.createLinearGradient(0, 0, 0, h * p.gradRatio)
    g.addColorStop(0, p.gradTop[0]); g.addColorStop(1, p.gradTop[1])
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * p.gradRatio)
  }
  if (type === 'gradient_bottom' || type === 'gradient_full') {
    const g = ctx.createLinearGradient(0, h * (1 - p.gradRatio), 0, h)
    g.addColorStop(0, p.gradBot[0]); g.addColorStop(1, p.gradBot[1])
    ctx.fillStyle = g; ctx.fillRect(0, h * (1 - p.gradRatio), w, h * p.gradRatio)
  }
}

function drawHeadline(ctx: CanvasRenderingContext2D, text: string, p: P, w: number, h: number): number {
  const sz = Math.round(w * 0.063)  // ~68px on 1080
  ctx.font = p.hlFont(sz)
  if (p.hlShadow) {
    ctx.shadowColor = p.hlShadow; ctx.shadowBlur = 14; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2
  }
  ctx.fillStyle = p.hlColor
  const y = Math.round(h * 0.075)
  const nextY = drawText(ctx, text, w / 2, y, w * 0.88, sz * 1.18)
  ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
  return nextY
}

function drawSubline(ctx: CanvasRenderingContext2D, text: string, p: P, w: number, afterY: number): number {
  const sz = Math.round(w * 0.034)  // ~37px on 1080
  ctx.font = p.subFont(sz)
  ctx.fillStyle = p.subColor
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillText(text, w / 2, afterY + Math.round(w * 0.010))
  return afterY + sz * 1.3 + Math.round(w * 0.010)
}

function drawBubble(ctx: CanvasRenderingContext2D, text: string, style: BubbleStyle, p: P, w: number, h: number) {
  const sz     = Math.round(w * 0.037)   // ~40px
  const padX   = Math.round(w * 0.038)
  const padY   = Math.round(w * 0.028)
  const r      = Math.round(w * 0.030)
  const tailSz = Math.round(w * 0.022)

  ctx.font = p.hlFont(sz).replace(/^bold /, '')  // use subFont style
  ctx.font = `bold ${sz}px Arial,"Helvetica Neue",sans-serif`

  // Measure text to size the bubble
  const lines   = wrapLines(ctx, text, w * 0.55)
  const lineH   = sz * 1.30
  const bblW    = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2
  const bblH    = lines.length * lineH + padY * 2

  // Position: left-center-ish area (30% from left, 45-55% vertical)
  const bx = Math.round(w * 0.05)
  const by = Math.round(h * 0.46)

  // Background fill
  const bg = style === 'soft_white' ? 'rgba(255,255,255,0.94)'
           : style === 'warm_amber' ? 'rgba(250,230,180,0.92)'
           : p.bblBg   // dark_frosted uses preset
  const textCol = style === 'soft_white' ? '#1a1a1a'
                : style === 'warm_amber' ? '#3a2000'
                : p.bblColor

  ctx.save()
  roundRect(ctx, bx, by, bblW, bblH, r)
  ctx.fillStyle = bg; ctx.fill()
  ctx.strokeStyle = style === 'soft_white' ? 'rgba(0,0,0,0.08)' : p.bblBorder
  ctx.lineWidth = 1.5; ctx.stroke()

  // Tail (bottom-left triangle)
  ctx.beginPath()
  ctx.moveTo(bx + r, by + bblH)
  ctx.lineTo(bx + r, by + bblH + tailSz)
  ctx.lineTo(bx + r + tailSz * 1.6, by + bblH)
  ctx.fillStyle = bg; ctx.fill()
  ctx.strokeStyle = 'transparent'; ctx.stroke()

  // Text inside bubble
  ctx.fillStyle = textCol
  ctx.textBaseline = 'top'; ctx.textAlign = 'left'
  let ty = by + padY
  for (const ln of lines) { ctx.fillText(ln, bx + padX, ty); ty += lineH }
  ctx.restore()
}

function drawBadges(ctx: CanvasRenderingContext2D, badges: string[], p: P, w: number, h: number): number {
  if (!badges.length) return h - Math.round(w * 0.11)
  const sz     = Math.round(w * 0.026)  // ~28px
  ctx.font     = `bold ${sz}px Arial,sans-serif`
  const padX   = Math.round(w * 0.040)
  const padY   = Math.round(w * 0.018)
  const gap    = Math.round(w * 0.018)
  const pillH  = sz + padY * 2
  const pillR  = pillH / 2

  // Measure each badge
  const widths = badges.map(b => ctx.measureText(b).width + padX * 2)
  const total  = widths.reduce((a, b) => a + b, 0) + gap * (badges.length - 1)
  let x        = (w - total) / 2
  const y      = h - Math.round(w * 0.22) - pillH   // bottom area

  ctx.textBaseline = 'middle'
  badges.forEach((b, i) => {
    const pw = widths[i]
    roundRect(ctx, x, y, pw, pillH, pillR)
    ctx.fillStyle   = p.badgeBg; ctx.fill()
    ctx.strokeStyle = p.badgeBorder; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle   = p.badgeColor
    ctx.textAlign   = 'center'
    ctx.fillText(b, x + pw / 2, y + pillH / 2)
    x += pw + gap
  })
  return y
}

function drawCTA(ctx: CanvasRenderingContext2D, text: string, style: CTAStyle, p: P, w: number, h: number) {
  const [bg, fg] = p.cta[style]
  const sz     = Math.round(w * 0.040)   // ~43px
  ctx.font     = `bold ${sz}px Arial,sans-serif`
  const tw     = ctx.measureText(text).width
  const padX   = Math.round(w * 0.070)
  const padY   = Math.round(w * 0.025)
  const bw     = tw + padX * 2
  const bh     = sz + padY * 2
  const bx     = (w - bw) / 2
  const by     = h - Math.round(w * 0.11)
  const br     = bh / 2

  roundRect(ctx, bx, by, bw, bh, br)
  ctx.fillStyle = bg; ctx.fill()

  // Subtle shadow on pill
  ctx.save()
  ctx.shadowColor   = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur    = 12
  ctx.shadowOffsetY = 4
  roundRect(ctx, bx, by, bw, bh, br)
  ctx.fillStyle = bg; ctx.fill()
  ctx.restore()

  ctx.fillStyle   = fg
  ctx.textAlign   = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, by + bh / 2)
}

async function drawLogo(ctx: CanvasRenderingContext2D, logoData: string, pos: string, w: number, h: number) {
  try {
    const img   = await loadImg(`data:image/png;base64,${logoData}`)
    const lh    = Math.round(w * 0.055)   // ~60px
    const lw    = Math.round((img.width / img.height) * lh)
    const pad   = Math.round(w * 0.030)
    const x     = pos === 'bottom_right' ? w - lw - pad : pad
    const y     = pos === 'top_right'    ? pad : h - lh - pad
    ctx.globalAlpha = 0.85
    ctx.drawImage(img, x, y, lw, lh)
    ctx.globalAlpha = 1.0
  } catch { /* logo load failed silently */ }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function applyTextOverlay(
  imageBase64: string,
  mimeType:    string,
  layout:      OverlayLayout,
  variant:     VariantOverlay,
  format:      string,
  logoBase64?: string | null
): Promise<{ data: string; mimeType: string }> {
  if (typeof document === 'undefined') throw new Error('Canvas overlay is browser-only')

  const w   = CANVAS_W
  const h   = CANVAS_H[format] ?? CANVAS_H['1:1']
  const pid = variant.stylePreset ?? layout.stylePreset
  const p   = PRESETS[pid] ?? PRESETS.premium_luxury

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!

  // 1. Draw base Gemini image (stretched to fill canvas)
  const baseImg = await loadImg(`data:${mimeType};base64,${imageBase64}`)
  ctx.drawImage(baseImg, 0, 0, w, h)

  // 2. Gradient overlays for contrast
  drawGradient(ctx, layout.overlay, p, w, h)
  // Always add a bottom gradient for badge/CTA readability
  if (layout.overlay !== 'gradient_bottom' && layout.overlay !== 'gradient_full') {
    const g = ctx.createLinearGradient(0, h * 0.60, 0, h)
    g.addColorStop(0, 'rgba(0,0,0,0.00)'); g.addColorStop(1, 'rgba(0,0,0,0.68)')
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.60, w, h * 0.40)
  }

  // 3. Headline
  const afterHL = drawHeadline(ctx, variant.headline, p, w, h)

  // 4. Subline
  if (variant.subline) drawSubline(ctx, variant.subline, p, w, afterHL)

  // 5. Chat bubble (middle area)
  if (layout.bubble?.text) drawBubble(ctx, layout.bubble.text, layout.bubble.style, p, w, h)

  // 6. Badges
  drawBadges(ctx, layout.badges, p, w, h)

  // 7. CTA
  drawCTA(ctx, layout.cta.text, layout.cta.style, p, w, h)

  // 8. Logo
  if (logoBase64) await drawLogo(ctx, logoBase64, layout.logoPosition ?? 'bottom_left', w, h)

  const out = canvas.toDataURL('image/jpeg', 0.93)
  return { data: out.split(',')[1], mimeType: 'image/jpeg' }
}
