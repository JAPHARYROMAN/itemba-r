import type { MetadataRoute } from 'next';
import { surfaces } from '@/design/tokens';
import { site } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.title,
    short_name: site.name,
    description: site.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The canvas, as on html/body and the theme-color meta: the launch splash
    // and the browser chrome match the light shell.
    background_color: surfaces.canvas,
    theme_color: surfaces.canvas,
    // The same language as <html lang>.
    lang: site.language,
    categories: ['business'],
    icons: [
      {
        src: '/favicon-48x48.png',
        sizes: '48x48',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/site-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/site-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
