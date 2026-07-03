import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/hub/supabase'
import { categorizeMessages } from '@/lib/hub/claude'
import { applyOmsReply } from '@/lib/oms/whatsapp'
import { applyCarsReply } from '@/lib/cars/whatsapp'

export const dynamic = 'force-dynamic'

// GET — Meta webhook verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — incoming WhatsApp messages from Meta
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ ok: true })
    }

    const rows: {
      source: string; source_type: string; external_id: string
      sender_name?: string; sender_id: string
      content: string; received_at: string; raw_data: unknown
    }[] = []

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue
        const value = change.value

        // Build contact name map
        const contacts: Record<string, string> = {}
        for (const c of value.contacts ?? []) {
          contacts[c.wa_id] = c.profile?.name ?? c.wa_id
        }

        // Only process messages for our number
        const ourPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
        if (ourPhoneId && value.metadata?.phone_number_id !== ourPhoneId) continue

        for (const msg of value.messages ?? []) {
          const content =
            msg.type === 'text'     ? msg.text?.body :
            msg.type === 'image'    ? '[Image]' :
            msg.type === 'audio'    ? '[Voice message]' :
            msg.type === 'video'    ? '[Video]' :
            msg.type === 'document' ? '[Document]' :
            msg.type === 'sticker'  ? '[Sticker]' :
            `[${msg.type}]`

          if (!content) continue

          // OMS: let a customer reply (1/2/3 or keywords) drive their order state.
          // Additive + best-effort — never blocks message ingestion.
          if (msg.type === 'text' && msg.text?.body) {
            applyOmsReply(msg.from, msg.text.body).catch(() => {})
            applyCarsReply(msg.from, msg.text.body).catch(() => {})
          }

          rows.push({
            source: 'whatsapp',
            source_type: 'message',
            external_id: `wa_${msg.id}`,
            sender_name: contacts[msg.from],
            sender_id: msg.from,
            content,
            received_at: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
            raw_data: msg,
          })
        }

        // CARS: WhatsApp delivery receipts → update recovery message status.
        for (const st of value.statuses ?? []) {
          if (!st?.id) continue
          await supabaseAdmin.from('cars_messages').update({
            status: st.status, status_updated_at: new Date().toISOString(),
            failure_reason: st.errors?.[0]?.title ?? st.errors?.[0]?.message ?? null,
          }).eq('message_id', st.id)
        }
      }
    }

    if (rows.length > 0) {
      const { data: inserted } = await supabaseAdmin
        .from('messages')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
        .select('id, content, source, sender_name')

      // Categorize immediately so daily report picks them up without needing a manual sync
      if (inserted?.length) {
        categorizeMessages(inserted).catch(err =>
          console.error('WhatsApp categorize error:', err)
        )
      }
    }

    // Always return 200 — Meta will retry if we don't
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
