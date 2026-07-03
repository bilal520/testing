import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-4" style={{ background: '#f8f7f4' }}>

      {/* Logo + Bismillah */}
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/elyscents-logo.png" alt="Elyscents" className="h-20 w-auto mx-auto mb-4" />
        <p className="bismillah mb-1">بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ</p>
        <p className="text-xs text-gray-400 mt-2">Marketing Dashboard — Internal Access Only</p>
      </div>

      <SignIn />
    </div>
  )
}
