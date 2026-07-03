import { SignUp } from '@clerk/nextjs'

// Sign-up is invite-only: this page is reached via a Clerk invitation ticket
// (?__clerk_ticket=...). The middleware blocks it otherwise.
export default function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-4" style={{ background: '#f8f7f4' }}>
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/elyscents-logo.png" alt="Elyscents" className="h-20 w-auto mx-auto mb-4" />
        <p className="bismillah mb-1">بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ</p>
        <p className="text-xs text-gray-400 mt-2">Complete your invite to the Elyscents Dashboard</p>
      </div>
      <SignUp />
    </div>
  )
}
