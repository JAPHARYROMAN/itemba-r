export const dynamic = 'force-static';

export function GET() {
  return new Response(
    JSON.stringify({
      name: 'Itemba POS',
      short_name: 'Itemba POS',
      description: 'A branch-locked mobile sales counter connected to ITEMBA-R.',
      start_url: '/mobile-pos',
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
      },
    },
  );
}
