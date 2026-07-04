import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

async function handler(req: NextRequest) {
  const url = new URL(req.url)
  const path = url.pathname.replace('/clerk-proxy', '')
  const target = `https://frontend-api.clerk.services${path}${url.search}`

  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    if (!['host', 'connection', 'transfer-encoding'].includes(key)) {
      headers[key] = value
    }
  })
  headers['host'] = 'frontend-api.clerk.services'

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  })

  const resHeaders = new Headers(res.headers)
  const origin = req.headers.get('origin') || 'https://testing.core47.ai'
  resHeaders.set('Access-Control-Allow-Origin', origin)
  resHeaders.set('Access-Control-Allow-Credentials', 'true')
  resHeaders.delete('content-encoding')

  return new NextResponse(res.body, {
    status: res.status,
    headers: resHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = () => new NextResponse(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': 'https://testing.core47.ai',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Credentials': 'true',
  },
})
