import { NextResponse } from 'next/server'
import { ingestFacebookDMs, ingestFacebookComments, ingestInstagramComments, ingestInstagramDMs } from '@/lib/hub/meta'
import { categorizeMessages } from '@/lib/hub/claude'
import { supabaseAdmin } from '@/lib/hub/supabase'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  try {
    // Run each source separately so we get per-source success/error
    const [fbDMs, fbComments, igComments, igDMs] = await Promise.allSettled([
      ingestFacebookDMs(),
      ingestFacebookComments(),
      ingestInstagramComments(),
      ingestInstagramDMs(),
    ])

    const results: Record<string, number | string> = {
      facebook_dms:       fbDMs.status       === 'fulfilled' ? fbDMs.value       : 0,
      facebook_comments:  fbComments.status  === 'fulfilled' ? fbComments.value  : 0,
      instagram_comments: igComments.status  === 'fulfilled' ? igComments.value  : 0,
      instagram_dms:      igDMs.status       === 'fulfilled' ? igDMs.value       : 0,
    }

    // Capture per-source errors so UI can show them
    if (fbDMs.status       === 'rejected') results.facebook_dms_error       = String(fbDMs.reason)
    if (fbComments.status  === 'rejected') results.facebook_comments_error  = String(fbComments.reason)
    if (igComments.status  === 'rejected') results.instagram_comments_error = String(igComments.reason)
    if (igDMs.status       === 'rejected') results.instagram_dms_error      = String(igDMs.reason)

    // Categorise ALL uncategorised messages across every source (FB, IG, WhatsApp)
    try {
      const { data: uncategorized } = await supabaseAdmin
        .from('messages')
        .select('id, content, source, sender_name')
        .is('category', null)
        .order('received_at', { ascending: true })

      if (uncategorized?.length) {
        results.uncategorized_found = uncategorized.length
        results.categorized = await categorizeMessages(uncategorized)
      } else {
        results.categorized = 0
      }
    } catch (err) {
      results.categorize_error = String(err)
    }

    return NextResponse.json({ ok: true, ...results, ts: new Date().toISOString() })
  } catch (err) {
    // Always return JSON, never let Vercel serve its plain-text error page
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
