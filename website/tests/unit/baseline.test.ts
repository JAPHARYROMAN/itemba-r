/**
 * Integrity of the golden baseline recorded from origin/main by
 * scripts/snapshot-routes.mjs and scripts/pdf-facts.mjs. Later suites diff the
 * rebuild against these files, so a partial or corrupted baseline must fail
 * loudly here rather than silently weaken those comparisons.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN, SITEMAP_PATHS, absoluteUrl, ogImagePath } from '../../scripts/lib/routes.mjs';

const BASELINE = path.resolve(__dirname, '../baseline');
const load = <T>(file: string): T => JSON.parse(readFileSync(path.join(BASELINE, file), 'utf8')) as T;

type LdEntity = { '@type': unknown; '@id': string | null };
type RouteFacts = {
  status: number;
  title: string;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  og: [string, string][];
  twitter: [string, string][];
  h1: string[];
  ids: string[];
  jsonLd: { entities?: LdEntity[]; parseError?: string }[];
  enquiryRouter: { present: boolean; defaultIntent: string | null };
  quickContact: { present: boolean };
};

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const routes = load<Record<string, RouteFacts>>('routes.json');

describe('golden baseline: routes', () => {
  it('covers exactly the 25 sitemap URLs in sitemap order', () => {
    expect(SITEMAP_PATHS).toHaveLength(25);
    expect(Object.keys(routes)).toEqual([...SITEMAP_PATHS]);
  });

  it.each([...SITEMAP_PATHS])('%s was captured completely', (pathname) => {
    const r = routes[pathname]!;
    expect(r.status).toBe(200);
    expect(r.title).toMatch(/Itemba Group/);
    expect(r.description).toBeTruthy();
    expect(r.robots).toBe('index, follow');
    const expectedCanonical = pathname === '/' ? [SITE_ORIGIN, `${SITE_ORIGIN}/`] : [absoluteUrl(pathname)];
    expect(expectedCanonical).toContain(r.canonical);
    const og = Object.fromEntries(r.og);
    expect(expectedCanonical).toContain(og['og:url']);
    expect(og['og:image']).toContain(ogImagePath(pathname));
    expect(r.twitter.some(([k]) => k === 'twitter:card')).toBe(true);
    expect(r.h1.length).toBeGreaterThan(0);
    expect(r.ids).toContain('main-content');
    expect(r.jsonLd.every((block) => !block.parseError)).toBe(true);
    const ids = r.jsonLd.flatMap((block) => (block.entities ?? []).map((e) => e['@id']));
    expect(ids).toContain(ORG_ID);
  });

  it('records the deep-link anchors the rebuild must keep', () => {
    expect(routes['/companies']!.ids).toEqual(expect.arrayContaining(['mwanjalisi', 'westsides', 'enterprises']));
    expect(routes['/faq']!.ids.filter((id) => id !== 'main-content')).toHaveLength(12);
    expect(routes['/company-profile']!.ids).toEqual(
      expect.arrayContaining([
        'cover-page',
        'company-overview',
        'vision-mission',
        'business-activities',
        'products-services',
        'target-market',
        'operations-branches',
        'management-ownership',
        'company-history',
        'assets-capacity',
        'financial-overview',
        'compliance-information',
        'competitive-strengths',
        'future-plans',
        'banking-purpose',
        'contact-information',
        'attachments',
      ]),
    );
  });

  it('records EnquiryRouter defaults and the QuickContact route matrix', () => {
    const defaults = Object.fromEntries(
      SITEMAP_PATHS.map((p) => [p, routes[p]!.enquiryRouter.present ? routes[p]!.enquiryRouter.defaultIntent : null]),
    );
    expect(defaults['/services/fuel-and-lubricants']).toBe('mwanjalisi');
    expect(defaults['/companies/westsides-company']).toBe('westsides');
    expect(defaults['/companies/itemba-enterprises']).toBe('enterprises');
    expect(defaults['/contact']).toBe('general');
    const quickShown = SITEMAP_PATHS.filter((p) => routes[p]!.quickContact.present);
    expect(quickShown).toEqual(['/', '/about', '/services', '/locations', '/companies', '/insights']);
    // QuickContact is hidden exactly where an inline EnquiryRouter exists.
    for (const p of SITEMAP_PATHS) {
      expect(routes[p]!.quickContact.present).toBe(!routes[p]!.enquiryRouter.present);
    }
  });
});

describe('golden baseline: site-level contracts', () => {
  it('sitemap lists the 25 URLs in order', () => {
    const md = load<{ sitemap: { status: number; matchesExpectedOrder: boolean; entries: { loc: string }[] } }>(
      'metadata-routes.json',
    );
    expect(md.sitemap.status).toBe(200);
    expect(md.sitemap.matchesExpectedOrder).toBe(true);
    expect(md.sitemap.entries.map((e) => e.loc)).toEqual(SITEMAP_PATHS.map((p) => absoluteUrl(p)));
  });

  it('every route has a 1200x630 PNG Open Graph image', () => {
    const og = load<Record<string, { status: number; contentType: string; is1200x630: boolean }>>('og-images.json');
    expect(Object.keys(og)).toEqual(SITEMAP_PATHS.map((p) => ogImagePath(p)));
    for (const card of Object.values(og)) {
      expect(card.status).toBe(200);
      expect(card.contentType).toBe('image/png');
      expect(card.is1200x630).toBe(true);
    }
  });

  it('legacy and apex hosts redirect permanently to www', () => {
    const r = load<{ hostRedirects: { path: string; status: number; location: string }[] }>('redirects.json');
    expect(r.hostRedirects.length).toBeGreaterThanOrEqual(12);
    for (const hop of r.hostRedirects) {
      expect(hop.status).toBe(308);
      expect(hop.location).toBe(`${SITE_ORIGIN}${hop.path === '/' ? '' : hop.path}`);
    }
  });

  it('security headers are present on every route', () => {
    const h = load<{ routes: Record<string, Record<string, string>> }>('headers.json');
    for (const p of SITEMAP_PATHS) {
      expect(h.routes[p]).toMatchObject({
        'x-frame-options': 'SAMEORIGIN',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      });
    }
  });

  it('API liveness and the four profile downloads were captured', () => {
    const misc = load<{
      api: { health: { status: number; service: string }; enquiriesGet: { status: number } };
      assets: Record<string, { status: number; contentType: string }>;
    }>('misc.json');
    expect(misc.api.health).toMatchObject({ status: 200, service: 'itemba-group-website' });
    expect(misc.api.enquiriesGet.status).toBe(405);
    for (const id of ['group', 'westsides', 'mwanjalisi', 'enterprises']) {
      expect(misc.assets[`/downloads/itemba-${id}-profile.pdf`]).toMatchObject({
        status: 200,
        contentType: 'application/pdf',
      });
    }
  });

  it('baseline PDF facts cover the four profiles with every key string', () => {
    const pdfs = load<{ files: Record<string, { pageCount: number; keyStrings: Record<string, boolean> }> }>(
      'pdfs.json',
    );
    expect(Object.keys(pdfs.files).sort()).toEqual([
      'itemba-enterprises-profile.pdf',
      'itemba-group-profile.pdf',
      'itemba-mwanjalisi-profile.pdf',
      'itemba-westsides-profile.pdf',
    ]);
    for (const facts of Object.values(pdfs.files)) {
      expect(facts.pageCount).toBeGreaterThan(0);
      expect(Object.values(facts.keyStrings).every(Boolean)).toBe(true);
    }
  });
});
