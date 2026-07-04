import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf'],
  images: {
    domains: ['lookaside.fbsbx.com', 'scontent.xx.fbcdn.net', 'p16-sign-va.tiktokcdn.com'],
  },
}

export default nextConfig
