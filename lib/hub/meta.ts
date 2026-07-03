import { supabaseAdmin } from '@/lib/hub/supabase'
import type { Message } from '@/lib/hub/types'

const PAGE_TOKEN    = process.env.META_PAGE_ACCESS_TOKEN!
const PAGE_ID       = process.env.FACEBOOK_PAGE_ID!
const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID!
const BASE          = 'https://graph.facebook.com/v20.0'

async function graphGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('access_token', PAGE_TOKEN)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Meta API ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function upsertMessages(messages: Omit<Message, 'id' | 'created_at'>[]) {
  if (!messages.length) return 0
  const { data, error } = await supabaseAdmin
    .from('messages')
    .upsert(messages, { onConflict: 'external_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

export async function ingestFacebookComments(): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
  const postsRes = await graphGet(`/${PAGE_ID}/posts`, {
    fields: 'id,message,permalink_url,created_time',
    since: String(since),
    limit: '25',
  })

  const messages: Omit<Message, 'id' | 'created_at'>[] = []
  for (const post of postsRes.data ?? []) {
    const commentsRes = await graphGet(`/${post.id}/comments`, {
      fields: 'id,message,from,created_time',
      limit: '100',
    })
    for (const c of commentsRes.data ?? []) {
      messages.push({
        source: 'facebook', source_type: 'comment',
        external_id: `fb_comment_${c.id}`,
        sender_name: c.from?.name, sender_id: c.from?.id,
        content: c.message, post_id: post.id, post_url: post.permalink_url,
        received_at: c.created_time, raw_data: c,
      })
    }
  }
  return upsertMessages(messages)
}

export async function ingestFacebookDMs(): Promise<number> {
  const convRes = await graphGet(`/${PAGE_ID}/conversations`, {
    fields: 'id,updated_time', limit: '50',
  })

  const messages: Omit<Message, 'id' | 'created_at'>[] = []
  for (const conv of convRes.data ?? []) {
    const msgsRes = await graphGet(`/${conv.id}/messages`, {
      fields: 'id,message,from,created_time', limit: '25',
    })
    for (const m of msgsRes.data ?? []) {
      if (m.from?.id === PAGE_ID) continue
      messages.push({
        source: 'facebook', source_type: 'dm',
        external_id: `fb_dm_${m.id}`,
        sender_name: m.from?.name, sender_id: m.from?.id,
        content: m.message, received_at: m.created_time, raw_data: m,
      })
    }
  }
  return upsertMessages(messages)
}

export async function ingestInstagramComments(): Promise<number> {
  const mediaRes = await graphGet(`/${IG_ACCOUNT_ID}/media`, {
    fields: 'id,permalink,timestamp', limit: '25',
  })

  const messages: Omit<Message, 'id' | 'created_at'>[] = []
  for (const media of mediaRes.data ?? []) {
    const commentsRes = await graphGet(`/${media.id}/comments`, {
      fields: 'id,text,username,timestamp', limit: '100',
    })
    for (const c of commentsRes.data ?? []) {
      messages.push({
        source: 'instagram', source_type: 'comment',
        external_id: `ig_comment_${c.id}`,
        sender_name: c.username, content: c.text,
        post_id: media.id, post_url: media.permalink,
        received_at: c.timestamp, raw_data: c,
      })
    }
  }
  return upsertMessages(messages)
}

export async function ingestInstagramDMs(): Promise<number> {
  const convRes = await graphGet(`/${IG_ACCOUNT_ID}/conversations`, {
    fields: 'id,updated_time', platform: 'instagram', limit: '50',
  })

  const messages: Omit<Message, 'id' | 'created_at'>[] = []
  for (const conv of convRes.data ?? []) {
    const msgsRes = await graphGet(`/${conv.id}/messages`, {
      fields: 'id,message,from,created_time', limit: '25',
    })
    for (const m of msgsRes.data ?? []) {
      if (m.from?.id === IG_ACCOUNT_ID) continue
      messages.push({
        source: 'instagram', source_type: 'dm',
        external_id: `ig_dm_${m.id}`,
        sender_name: m.from?.username ?? m.from?.name, sender_id: m.from?.id,
        content: m.message, received_at: m.created_time, raw_data: m,
      })
    }
  }
  return upsertMessages(messages)
}

export async function ingestAllMeta() {
  const [fbComments, fbDMs, igComments, igDMs] = await Promise.allSettled([
    ingestFacebookComments(),
    ingestFacebookDMs(),
    ingestInstagramComments(),
    ingestInstagramDMs(),
  ])
  return {
    facebook_comments:  fbComments.status  === 'fulfilled' ? fbComments.value  : 0,
    facebook_dms:       fbDMs.status       === 'fulfilled' ? fbDMs.value       : 0,
    instagram_comments: igComments.status  === 'fulfilled' ? igComments.value  : 0,
    instagram_dms:      igDMs.status       === 'fulfilled' ? igDMs.value       : 0,
  }
}
