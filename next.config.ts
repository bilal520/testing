import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf'],
  images: {
    domains: ['lookaside.fbsbx.com', 'scontent.xx.fbcdn.net', 'p16-sign-va.tiktokcdn.com'],
  },
  async rewrites() {
    return [
      {
        source: '/clerk-proxy/:path*',
        destination: 'https://clerk.core47.ai/:path*',
      },
    ]
  },
}

export default nextConfig
