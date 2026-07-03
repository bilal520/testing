import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/api/webhooks/(.*)', '/api/hub/report/(.*)', '/api/shopify/callback(.*)', '/api/shopify/analytics-update', '/api/cron/(.*)', '/api/courier/sync', '/api/courier/enrich-tracking', '/api/oms/tick', '/api/oms/reconcile', '/api/oms/leopards-cities', '/api/oms/whatsapp/callback', '/api/cars/tick', '/api/cars/attribution', '/api/cars/daily-summary', '/api/cf/hunt'])
const isSignUpRoute = createRouteMatcher(['/sign-up(.*)'])

export default clerkMiddleware(async (auth, request) => {
  // Sign-up is invite-only: allow it ONLY when arriving with a Clerk invitation
  // ticket; otherwise bounce to sign-in.
  if (isSignUpRoute(request)) {
    if (request.nextUrl.searchParams.has('__clerk_ticket')) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }

  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
