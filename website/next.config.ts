import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  // The OG cards (src/lib/og-card.tsx) read their fonts and the crest from
  // disk at request time, e.g. for a slug that was not prerendered. The file
  // tracer cannot see those reads, so list the files for every card route.
  outputFileTracingIncludes: {
    '/**/opengraph-image*': ['./src/assets/fonts/og/*.ttf', './public/logo-print.png'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
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
