import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton — client is only created on first use, not at module load.
// This prevents Vercel's build-time page-data collection from crashing when
// env vars are not set during the build phase.
let _admin: SupabaseClient | null = null

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_admin) {
      _admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      )
    }
    const val = (_admin as unknown as Record<string | symbol, unknown>)[prop]
    return typeof val === 'function' ? (val as Function).bind(_admin) : val
  },
})
