import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FB_BASE  = 'https://graph.facebook.com/v19.0'
const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN!

export async function GET(req: NextRequest) {
  const adId = req.nextUrl.searchParams.get('adId')?.trim()
  if (!adId) return NextResponse.json({ error: 'No adId' }, { status: 400 })

  // 1. Fetch creative with wide field set
  const creativeUrl = new URL(`${FB_BASE}/${adId}`)
  creativeUrl.searchParams.set('fields',
    'creative{id,video_id,body,title,thumbnail_url,image_url,' +
    'object_story_spec{video_data{message,video_id,image_url}},' +
    'asset_feed_spec}'
  )
  creativeUrl.searchParams.set('access_token', FB_TOKEN)

  const creativeRes  = await fetch(creativeUrl.toString(), { cache: 'no-store' })
  const creativeData = await creativeRes.json()

  const c       = creativeData.creative ?? {}
  const videoId = c.video_id ?? c.object_story_spec?.video_data?.video_id ?? null

  // Both possible video IDs from different creative structures
  const videoId2 = c.object_story_spec?.video_data?.video_id ?? null

  async function tryVideoSource(vid: string) {
    const vUrl = new URL(`${FB_BASE}/${vid}`)
    vUrl.searchParams.set('fields', 'source,permalink_url,format')
    vUrl.searchParams.set('access_token', FB_TOKEN)
    const vRes  = await fetch(vUrl.toString(), { cache: 'no-store' })
    return await vRes.json()
  }

  const vid1Data = videoId  ? await tryVideoSource(videoId)  : null
  const vid2Data = videoId2 ? await tryVideoSource(videoId2) : null

  const videoSource = vid1Data?.source ?? vid2Data?.source ?? null

  let videoFetchStatus: number | null = null
  let videoBytesReceived: number | null = null
  if (videoSource) {
    try {
      const headRes      = await fetch(videoSource, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
      videoFetchStatus   = headRes.status
      videoBytesReceived = parseInt(headRes.headers.get('content-length') ?? '0', 10)
    } catch { videoFetchStatus = -1 }
  }

  return NextResponse.json({
    adId,
    videoId, videoId2,
    vid1ApiResponse: vid1Data,
    vid2ApiResponse: vid2Data,
    videoSource:        videoSource ? videoSource.slice(0, 120) + '...' : null,
    videoFetchStatus,
    videoBytesReceived,
    creative: { id: c.id, title: c.title, body: c.body?.slice(0, 300), videoId, thumbnailUrl: c.thumbnail_url },
  })
}
