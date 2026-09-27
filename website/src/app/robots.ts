import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/content/site';

/**
 * Crawl everything except the API (the enquiry endpoint and the health
 * probe are not pages), and point at the sitemap. Staging hosts are kept
 * out of the index by an `X-Robots-Tag: noindex` header (next.config.ts),
 * not here: every host serves the same robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
