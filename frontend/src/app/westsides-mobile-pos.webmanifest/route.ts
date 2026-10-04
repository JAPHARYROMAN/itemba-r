import { mobilePosSetupStartUrl } from '@/lib/mobile-pos-proxy-policy';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(
    JSON.stringify({
      name: 'Itemba POS',
      id: '/mobile-pos',
      short_name: 'Itemba POS',
      description: 'Sales and stock, with your team and ITEMBA OS.',
      start_url: mobilePosSetupStartUrl(new URL(request.url).searchParams.get('setup')),
      scope: '/',
      display: 'standalone',
      // Kaunta identity: warm-paper chrome (design-direction §2.1); the old
      // teal theme_color was an orphan no surface ever used.
      background_color: '#faf7f0',
      theme_color: '#faf7f0',
      orientation: 'portrait',
      icons: [
        {
          src: '/brand/itemba-group-logo.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: '/brand/itemba-group-logo.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    }),
    {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
