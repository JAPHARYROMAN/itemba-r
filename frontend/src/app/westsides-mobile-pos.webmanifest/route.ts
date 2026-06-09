export const dynamic = 'force-static';

export function GET() {
  return new Response(
    JSON.stringify({
      name: 'Westsides Mobile POS',
      short_name: 'Westsides POS',
      description: 'Minimal Westsides counter-sale entry connected to ITEMBA-R.',
      start_url: '/westsides/mobile-pos',
      scope: '/',
      display: 'standalone',
      background_color: '#07111f',
      theme_color: '#0f766e',
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
      },
    },
  );
}
