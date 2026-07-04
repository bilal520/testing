import { NextRequest, NextResponse } from 'next/server'

const CLERK_FRONTEND_API = 'https://frontend-api.clerk.services'

async function handler(req: NextRequest) {
  const path = req.nextUrl.pathname.replace('/clerk-proxy', '')
  const search = req.nextUrl.search
  const url = `${CLERK_FRONTEND_API}${path}${search}`

  const headers = new Headers(req.headers)
  headers.set('host', 'frontend-api.clerk.services')

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
  })

  const responseHeaders = new Headers(res.headers)
  responseHeaders.set('Access-Control-Allow-Origin', req.headers.get('origin') || '*')
  responseHeaders.set('Access-Control-Allow-Credentials', 'true')

  return new NextResponse(res.body, {
    status: res.status,
    headers: responseHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = handler
