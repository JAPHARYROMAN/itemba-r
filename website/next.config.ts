import type { NextConfig } from 'next';

/**
 * Staging hosts run the same image as production, with production
 * canonicals and an allow-all robots.txt. `X-Robots-Tag: noindex` keeps
 * them out of search results; production hosts never get the header.
 */
const STAGING_HOSTS = ['staging-www.itembagrouptz.com', 'www-staging.itembagrouptz.com'];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  // No `X-Powered-By: Next.js` on responses.
  poweredByHeader: false,
  experimental: {
    // One stylesheet per page. Every stylesheet is imported by the root
    // layout (and global-error, alike), so without Next's CSS chunking they
    // extract into a single file. The chunking pass would split them again
    // (it caps a chunk at 100 kB of unminified CSS), and each extra file is
    // another render-blocking request on a slow phone connection.
    cssChunking: false,
  },
  // The OG cards (src/lib/og-card.tsx) read their fonts and the crest from
  // disk at request time, e.g. for a slug that was not prerendered. The file
  // tracer cannot see those reads, so list the files for every card route.
  outputFileTracingIncludes: {
    '/**/opengraph-image*': ['./src/assets/fonts/og/*.ttf', './public/logo-print.png'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // Pinned, not left to the defaults: scripts/generate-profile-pdfs.mjs
    // (frozen) rewrites print photos to /_next/image?…&w=828&q=75, so 828
    // must stay a device size and 75 an allowed quality through any upgrade
    // (Next 16 narrows the default qualities to [75]). The sizes are Next
    // 15's defaults; <Media quality> may use any of the three qualities.
    // tests/unit/islands.test.ts checks the pins.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [60, 75, 85],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
      {
        source: '/logo.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/opengraph-image',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // Pre-generated profile PDFs change in place on regen, so cache short
        // with SWR rather than immutable.
        source: '/downloads/:file*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
      // No Cache-Control rule for /:path*/opengraph-image: Next already
      // serves every route's card as `public, immutable, no-transform,
      // max-age=31536000` (tests/baseline/og-images.json).
      ...STAGING_HOSTS.map((host) => ({
        source: '/:path*',
        has: [{ type: 'host' as const, value: host }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      })),
    ];
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'itembagrouptz.com' }],
        destination: 'https://www.itembagrouptz.com/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'itembagroup.com' }],
        destination: 'https://www.itembagrouptz.com/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.itembagroup.com' }],
        destination: 'https://www.itembagrouptz.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default config;
