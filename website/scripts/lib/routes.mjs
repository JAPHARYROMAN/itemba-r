/**
 * The public URL contract of the Itemba Group website: the exact 25 sitemap
 * URLs, in sitemap order (coreRoutes, then services, locations, companies and
 * insights). Shared by scripts/snapshot-routes.mjs and the test suites.
 */
export const SITE_ORIGIN = 'https://www.itembagrouptz.com';

export const SITEMAP_PATHS = Object.freeze([
  '/',
  '/about',
  '/services',
  '/locations',
  '/companies',
  '/capabilities',
  '/insights',
  '/company-profile',
  '/partnerships',
  '/faq',
  '/contact',
  '/services/fuel-and-lubricants',
  '/services/trade-and-distribution',
  '/services/logistics-and-cross-border-transit',
  '/services/construction-supplies-and-hardware',
  '/services/hospitality-and-lodging',
  '/services/real-estate-and-property',
  '/locations/songwe-tunduma',
  '/companies/mwanjalisi-oil',
  '/companies/westsides-company',
  '/companies/itemba-enterprises',
  '/insights/route-business-enquiry-itemba-group',
  '/insights/tunduma-corridor-fuel-trade-logistics',
  '/insights/choose-right-itemba-company',
  '/insights/supplier-bulk-purchase-enquiries',
]);

/** `/` → `/opengraph-image`, `/about` → `/about/opengraph-image`. */
export function ogImagePath(pathname) {
  return pathname === '/' ? '/opengraph-image' : `${pathname}/opengraph-image`;
}

/** Absolute URL as it appears in canonicals and og:url. */
export function absoluteUrl(pathname) {
  return `${SITE_ORIGIN}${pathname === '/' ? '/' : pathname}`;
}
