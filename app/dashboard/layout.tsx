import { SignOutButton } from '@clerk/nextjs'
import { getAccess } from '@/lib/rbac'

// ════════════════════════════════════════════════════════════════════════════
// Dashboard gate. Authentication is already enforced by middleware (auth.protect).
// Here we only check AUTHORIZATION via RBAC (lib/rbac getAccess): the founder is
// always admin; anyone with a role or module override gets in. A signed-in user
// with no role yet (e.g. just invited in Clerk) sees a static "no access" screen.
//
// IMPORTANT: never redirect from here. A signed-in user redirected to /sign-in is
// bounced straight back by Clerk → infinite refresh loop. Render inline instead.
// (This replaces the old ALLOWED_EMAILS env allowlist, which blocked every
//  Clerk-invited teammate before RBAC could grant them access.)
// ════════════════════════════════════════════════════════════════════════════

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess()
  const hasAccess = access.isAdmin || access.role !== 'none' || access.modules.length > 0

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center" style={{ background: '#f8f7f4' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/elyscents-logo.png" alt="Elyscents" className="h-16 w-auto" />
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-gray-800 mb-2">No access yet</h1>
          <p className="text-sm text-gray-500">
            Your account{access.email ? ` (${access.email})` : ''} is signed in but hasn&apos;t been
            assigned a role. Ask an admin to give you access in the Team tab, then reload this page.
          </p>
        </div>
        <SignOutButton>
          <button className="text-xs text-gray-400 underline underline-offset-2">Sign out</button>
        </SignOutButton>
      </div>
    )
  }

  return <>{children}</>
}
