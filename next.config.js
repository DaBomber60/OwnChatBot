/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['@prisma/client'],
  },
  serverRuntimeConfig: {
    apiTimeout: 15 * 60 * 1000,
  },
  // Removed unsupported top-level `api` key (was causing warnings). For large payloads,
  // set custom config inside individual API route files via export const config = { api: { bodyParser: { sizeLimit: '500mb' } } }
  env: {
    // Only expose non-sensitive public config. API keys are now stored solely in DB settings.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
  },
  transpilePackages: [],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
