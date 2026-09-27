import type { MetadataRoute } from 'next';
import { surfaces } from '@/design/tokens';
import { site } from '@/content/site';

/**
 * The web app manifest.
 * - The name and the flag-resolved group description, as on home.
 * - The canvas colour, as on html/body and the theme-color meta, so the
 *   launch splash and the browser chrome match the light shell.
 * - `lang` is the html `lang`.
 * - Only square icons, at their real sizes. /logo.png (930x360, a white
 *   lockup) was declared as a 512x512 icon on origin/main and is gone;
 *   there is no maskable icon until one is produced.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.title,
    short_name: site.name,
    description: site.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: surfaces.canvas,
    theme_color: surfaces.canvas,
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
    ],
  };
}
