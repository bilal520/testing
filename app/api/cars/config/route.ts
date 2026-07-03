import { NextRequest, NextResponse } from 'next/server'
import { guardModule, getAccess } from '@/lib/rbac'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { fetchTemplates } from '@/lib/oms/whatsapp'
import {
  getCarsConfig, setCarsConfig, isCarsEnabled, setCarsEnabled, isCarsPaused, setCarsPaused,
  getTestNumbers, setTestNumbers, getCarsTemplateMap, setCarsTemplateMap, type CarsConfig,
} from '@/lib/cars/config'
import { addCarsSuppression } from '@/lib/cars/suppress'
import { ingestCheckouts, runSequences } from '@/lib/cars/engine'
import { normalisePhone } from '@/lib/shopify'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET — CARS status + config for the Setup panel.
export async function GET() {
  const g = await guardModule('recovery'); if (g) return g
  const [config, enabled, paused, testNumbers, templates] = await Promise.all([
    getCarsConfig(), isCarsEnabled(), isCarsPaused(), getTestNumbers(), getCarsTemplateMap(),
  ])
  let wa: unknown = null
  try {
    const t = await fetchTemplates()
    const recovery = (t.templates ?? []).filter(x => /cart_recovery/i.test(x.name))
    wa = { connected: t.connected, phone: t.phone, templates: recovery, error: t.error }
  } catch { /* WhatsApp not configured yet */ }
  let suppression = 0
  try { const { count } = await supabaseAdmin.from('cars_suppression').select('phone', { count: 'exact', head: true }); suppression = count ?? 0 } catch { /* table absent */ }
  const { isAdmin } = await getAccess()
  return NextResponse.json({ config, enabled, paused, testNumbers, templates, wa, suppression, isAdmin })
}

// POST — admin actions.
export async function POST(req: NextRequest) {
  const g = await guardModule('recovery'); if (g) return g
  const { isAdmin } = await getAccess()
  if (!isAdmin) return NextResponse.json({ error: 'admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { action?: string; [k: string]: unknown }
  switch (body.action) {
    case 'enable':  await setCarsEnabled(true);  return NextResponse.json({ ok: true, enabled: true })
    case 'disable': await setCarsEnabled(false); return NextResponse.json({ ok: true, enabled: false })
    case 'pause':   await setCarsPaused(true);   return NextResponse.json({ ok: true, paused: true })
    case 'resume':  await setCarsPaused(false);  return NextResponse.json({ ok: true, paused: false })
    case 'setConfig': {
      const cfg = await setCarsConfig((body.config ?? {}) as Partial<CarsConfig>)
      return NextResponse.json({ ok: true, config: cfg })
    }
    case 'setTestNumbers': {
      const nums = (Array.isArray(body.numbers) ? body.numbers : []).map(n => normalisePhone(String(n))).filter(Boolean) as string[]
      await setTestNumbers(nums); return NextResponse.json({ ok: true, testNumbers: nums })
    }
    case 'setTemplates': {
      await setCarsTemplateMap((body.templates ?? {}) as Record<string, { name: string; language: string }>)
      return NextResponse.json({ ok: true })
    }
    case 'suppress': {
      const p = normalisePhone(String(body.phone ?? '')); if (!p) return NextResponse.json({ error: 'bad phone' }, { status: 400 })
      await addCarsSuppression(p, 'manual'); return NextResponse.json({ ok: true })
    }
    case 'runNow': { // manual tick for testing (respects gating — shadow while OFF)
      const ingest = await ingestCheckouts(); const send = await runSequences()
      return NextResponse.json({ ok: true, ingest, send })
    }
    default: return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
