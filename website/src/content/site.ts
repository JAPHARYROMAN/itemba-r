/**
 * Site-wide constants, URL helpers and the core route list.
 * Small and client-safe (no server-only import).
 */
import { flags } from './flags';

/** Sectors in the group description; `manufacturing` only when the flag confirms it. */
const siteDescriptions = {
  standard:
    'Itemba Group is a Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating across energy, trade, logistics, construction, hospitality, and real estate.',
  withManufacturing:
    'Itemba Group is a Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating across energy, trade, logistics, construction, hospitality, real estate, and manufacturing.',
} as const;

/** html lang (also on its own, for the global error page's client bundle). */
export const siteLanguage = 'en';

export const site = {
  name: 'Itemba Group',
  url: 'https://www.itembagrouptz.com',
  domain: 'www.itembagrouptz.com',
  title: "Itemba Group | Tanzania's Diversified Business Group",
  /** Flag-resolved (`mentionManufacturing`). */
  description: flags.mentionManufacturing ? siteDescriptions.withManufacturing : siteDescriptions.standard,
  shortDescription: 'A multi-industry business ecosystem in Tanzania.',
  locale: 'en_TZ',
  /** html lang */
  language: siteLanguage,
  /** Founding year shown on the print letterhead ("EST. 2012"). */
  established: 2012,
  /** Default meta keywords for the root layout. */
  keywords:
    'Itemba Group, Tanzania, Songwe, Tunduma, energy, fuel distribution, logistics, cross-border transit, trade distribution, construction supplies, hospitality, real estate, Mwanjalisi Oil, Westsides, Itemba Enterprises',
  /** Place line used on cards and the letterhead. */
  placeLine: 'Mpemba-Tunduma · Songwe Region · Tanzania',
} as const;

export { siteDescriptions };

/**
 * Date the current content was last reviewed (drives sitemap lastModified).
 * The rebuilt pages' copy changed (tests/baseline/approved-changes.json), so
 * it is the rebuild's review date, not origin/main's 2026-05-14.
 */
export const contentUpdatedAt = '2026-09-27';

/** The 11 core routes in sitemap order (services, locations, companies and insights follow). */
export const coreRoutes = [
  { path: '/', priority: 1, updatedAt: contentUpdatedAt },
  { path: '/about', priority: 0.85, updatedAt: contentUpdatedAt },
  { path: '/services', priority: 0.88, updatedAt: contentUpdatedAt },
  { path: '/locations', priority: 0.82, updatedAt: contentUpdatedAt },
  { path: '/companies', priority: 0.9, updatedAt: contentUpdatedAt },
  { path: '/capabilities', priority: 0.84, updatedAt: contentUpdatedAt },
  { path: '/insights', priority: 0.76, updatedAt: contentUpdatedAt },
  { path: '/company-profile', priority: 0.86, updatedAt: contentUpdatedAt },
  { path: '/partnerships', priority: 0.82, updatedAt: contentUpdatedAt },
  { path: '/faq', priority: 0.78, updatedAt: contentUpdatedAt },
  { path: '/contact', priority: 0.8, updatedAt: contentUpdatedAt },
] as const;

/** Sitemap priority per dynamic route family. */
export const routePriorities = {
  service: 0.84,
  location: 0.83,
  company: 0.82,
  insight: 0.74,
} as const;

export function absoluteUrl(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${site.url}${normalized}`;
}

export function companyUrl(slug: string) {
  return `/companies/${slug}`;
}

export function serviceUrl(slug: string) {
  return `/services/${slug}`;
}

export function locationUrl(slug: string) {
  return `/locations/${slug}`;
}

export function insightUrl(slug: string) {
  return `/insights/${slug}`;
}
