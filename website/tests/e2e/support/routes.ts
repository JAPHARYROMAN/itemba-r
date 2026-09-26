/**
 * The 25-URL contract, shared with scripts/snapshot-routes.mjs, plus an
 * optional route filter for page work packages:
 *
 *   E2E_ROUTES=/about,/companies,/companies/* npm run test:e2e:contract
 *
 * Entries are exact paths; a trailing `*` matches a prefix (in Git Bash, set
 * MSYS_NO_PATHCONV=1 so the paths are not rewritten). Suites that are
 * inherently site-wide (sitemap order, redirects, the analytics flows) are
 * not filtered.
 */
import { SITE_ORIGIN, SITEMAP_PATHS, absoluteUrl, ogImagePath } from '../../../scripts/lib/routes.mjs';

export { SITE_ORIGIN, SITEMAP_PATHS, absoluteUrl, ogImagePath };

export const ORG_ID = `${SITE_ORIGIN}/#organization`;
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

function selectRoutes(): readonly string[] {
  const raw = process.env.E2E_ROUTES?.trim();
  if (!raw) return SITEMAP_PATHS;
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = SITEMAP_PATHS.filter((p) =>
    wanted.some((w) => (w.endsWith('*') ? p.startsWith(w.slice(0, -1)) : p === w)),
  );
  const unmatched = wanted.filter(
    (w) => !SITEMAP_PATHS.some((p) => (w.endsWith('*') ? p.startsWith(w.slice(0, -1)) : p === w)),
  );
  if (unmatched.length) {
    const mangled = unmatched.some((w) => /^[A-Za-z]:[\\/]/.test(w));
    throw new Error(
      `E2E_ROUTES entries match no sitemap URL: ${unmatched.join(', ')}.` +
        (mangled ? ' Git Bash rewrote the paths; set MSYS_NO_PATHCONV=1.' : '') +
        ` Valid paths:\n${SITEMAP_PATHS.join('\n')}`,
    );
  }
  return selected;
}

/** Routes the per-route suites run on (all 25 unless E2E_ROUTES narrows them). */
export const ROUTES: readonly string[] = selectRoutes();

/** `https://www.itembagrouptz.com/about` → `/about`; other origins → null. */
export function sitePathOf(href: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith(`${SITE_ORIGIN}/`) || href === SITE_ORIGIN) {
    return href.slice(SITE_ORIGIN.length) || '/';
  }
  return null;
}
