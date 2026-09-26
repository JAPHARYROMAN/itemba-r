/**
 * Copy for the 404 page (and the error boundaries that arrive with WP2.8).
 * Small and client-safe: error boundaries are client components.
 */
import type { LinkItem } from './types';

export const notFoundPage = {
  /**
   * origin/main title. The root template appends " | Itemba Group", so this
   * renders with a double suffix; WP2.8 switches to the plain title below.
   */
  legacyMetaTitle: 'Page Not Found | Itemba Group',
  metaTitle: 'Page Not Found',
  eyebrow: 'Error 404',
  code: '404',
  title: 'Page Not Found',
  body: "The page you're looking for doesn't exist or may have been moved. Let's get you back on track.",
  links: [
    { label: 'Back to Home', href: '/' },
    { label: 'Our Companies', href: '/companies' },
    { label: 'Services', href: '/services' },
  ] satisfies LinkItem[],
};
