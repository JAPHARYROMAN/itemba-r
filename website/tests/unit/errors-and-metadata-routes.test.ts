/**
 * Page group P7 (WP2.8): the 404 and the error boundaries, the metadata
 * routes, the next.config additions and the deploy documents.
 *
 * - /sitemap.xml keeps the 25 URLs in the baseline order, priorities and
 *   change frequency, with each page's lastModified from its content date.
 * - /robots.txt keeps the site crawlable and disallows /api/.
 * - /manifest.webmanifest declares only square icons at their real sizes
 *   (no /logo.png), in the html lang, on the canvas colour.
 * - next.config.ts drops X-Powered-By and marks the staging hosts noindex,
 *   keeping the host redirects and the headers.
 * - The 404 is "Page Not Found | Itemba Group" (one suffix), noindex, with
 *   one h1 "Page not found" and a way home; the error boundaries are calm
 *   pages with a retry that never show the error message.
 * - DEPLOY.md and .env.example say what the code does (308 redirects,
 *   enquiry_submit as a conversion_action, the /app/data volume).
 *
 * Rendered with react-dom/server; next/navigation and the local font are
 * mocked.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { companies } from '@/content/companies';
import { contact } from '@/content/contact';
import { insightArticles } from '@/content/insights';
import { locationProfiles } from '@/content/locations';
import { serviceAreas } from '@/content/services';
import { coreRoutes, site } from '@/content/site';
import { surfaces } from '@/design/tokens';
import { documentTitle } from '@/lib/seo';
import { SITEMAP_PATHS, absoluteUrl } from '../../scripts/lib/routes.mjs';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/does-not-exist',
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
}));
// next/font/local only works inside the Next compiler.
vi.mock('@/design/fonts', () => ({ inter: { variable: 'font-inter', className: 'font-inter', style: {} } }));

const { default: sitemap } = await import('@/app/sitemap');
const { default: robots } = await import('@/app/robots');
const { default: manifest } = await import('@/app/manifest');
const NotFoundModule = await import('@/app/not-found');
const { default: RouteError } = await import('@/app/error');
const { default: GlobalError } = await import('@/app/global-error');
const { default: nextConfig } = await import('../../next.config');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
const render = (element: ReactElement) => renderToStaticMarkup(element);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string) {
  const buf = readFileSync(path.join(ROOT, 'public', file));
  expect(buf.readUInt32BE(0), `${file} is a PNG`).toBe(0x89504e47);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

type BaselineSitemap = { sitemap: { entries: { loc: string; changefreq: string; priority: string }[] } };
const baselineSitemap = (JSON.parse(read('tests/baseline/metadata-routes.json')) as BaselineSitemap).sitemap.entries;

describe('/sitemap.xml', () => {
  const entries = sitemap();

  it('lists the 25 URLs in the baseline order, with the baseline priorities and change frequency', () => {
    expect(entries.map((e) => e.url)).toEqual(SITEMAP_PATHS.map((p) => absoluteUrl(p)));
    expect(entries.map((e) => [e.url, e.changeFrequency, String(e.priority)])).toEqual(
      baselineSitemap.map((e) => [e.loc, e.changefreq, e.priority]),
    );
  });

  it("dates each URL from its own content's updatedAt", () => {
    const expected = new Map<string, string>([
      ...coreRoutes.map((r) => [r.path, r.updatedAt] as const),
      ...serviceAreas.map((s) => [`/services/${s.slug}`, s.updatedAt] as const),
      ...locationProfiles.map((l) => [`/locations/${l.slug}`, l.updatedAt] as const),
      ...companies.map((c) => [`/companies/${c.slug}`, c.updatedAt] as const),
      ...insightArticles.map((a) => [`/insights/${a.slug}`, a.updatedAt] as const),
    ]);
    expect(expected.size).toBe(25);
    for (const entry of entries) {
      const pathname = new URL(entry.url).pathname;
      const date = entry.lastModified instanceof Date ? entry.lastModified : new Date(entry.lastModified ?? NaN);
      expect(Number.isNaN(date.getTime()), `${pathname} lastModified`).toBe(false);
      expect(date.toISOString().slice(0, 10), pathname).toBe(expected.get(pathname));
    }
  });
});

describe('/robots.txt', () => {
  it('allows the site, disallows the API and points at the sitemap', () => {
    const { rules, sitemap: sitemapUrl } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userAgent: '*', allow: '/', disallow: '/api/' });
    expect(sitemapUrl).toBe(`${site.url}/sitemap.xml`);
  });
});

describe('/manifest.webmanifest', () => {
  const m = manifest();

  it('matches the html lang and the canvas, with the flag-resolved description', () => {
    expect(read('src/app/layout.tsx')).toContain('lang={site.language}');
    expect(m.lang).toBe(site.language);
    expect(m.background_color).toBe(surfaces.canvas);
    expect(m.theme_color).toBe(surfaces.canvas);
    expect(m.short_name).toBe('Itemba Group');
    expect(m.start_url).toBe('/');
    expect(m.description).toBe(site.description);
    expect(m.description).not.toMatch(/manufacturing/i);
  });

  it('declares only square icons at their real sizes, and no /logo.png', () => {
    const icons = m.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.map((i) => i.src)).not.toContain('/logo.png');
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.sizes, icon.src).toBe(pngSize(icon.src.replace(/^\//, '')));
      expect(icon.purpose ?? 'any').toBe('any');
    }
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });
});

describe('next.config.ts additions', () => {
  it('drops the X-Powered-By header and keeps the standalone output and trailing-slash default', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.output).toBe('standalone');
    expect(nextConfig.trailingSlash).toBeUndefined();
  });

  it('marks both staging hosts noindex, and nothing else', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const robotsRules = rules.filter((r) => r.headers.some((hd) => hd.key.toLowerCase() === 'x-robots-tag'));
    const hosts = robotsRules.flatMap((r) => (r.has ?? []).map((cond) => (cond.type === 'host' ? cond.value : null)));
    expect(hosts.sort()).toEqual(['staging-www.itembagrouptz.com', 'www-staging.itembagrouptz.com']);
    for (const rule of robotsRules) {
      expect(rule.source).toBe('/:path*');
      expect(rule.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
    }
  });

  it('keeps the security headers, the cache rules and the permanent host redirects', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const site = rules.find((r) => r.source === '/:path*' && !r.has);
    expect(site?.headers.map((hd) => hd.key)).toEqual([
      'X-DNS-Prefetch-Control',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
    expect(rules.map((r) => r.source)).toEqual(expect.arrayContaining(['/logo.png', '/opengraph-image', '/downloads/:file*']));
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects.map((r) => [r.has?.[0]?.value, r.destination, r.permanent])).toEqual([
      ['itembagrouptz.com', 'https://www.itembagrouptz.com/:path*', true],
      ['itembagroup.com', 'https://www.itembagrouptz.com/:path*', true],
      ['www.itembagroup.com', 'https://www.itembagrouptz.com/:path*', true],
    ]);
  });
});

describe('404', () => {
  const { metadata } = NotFoundModule;
  const html = render(h(NotFoundModule.default));

  it('is titled "Page Not Found | Itemba Group" (one suffix), noindex, with no canonical', () => {
    expect(metadata.title).toBe('Page Not Found');
    expect(documentTitle(metadata.title as string)).toBe('Page Not Found | Itemba Group');
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates).toEqual({ canonical: null });
  });

  it('has one h1, "Page not found", and no skipped heading levels', () => {
    expect(tags(html, 'h1')).toEqual(['Page not found']);
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i) expect(level - (levels[i - 1] ?? 1), `h${levels[i - 1]} → h${level}`).toBeLessThanOrEqual(1);
    });
  });

  it('leads home with the one pill, then the group office and the three companies', () => {
    const links = hrefs(html);
    expect(links[0]).toBe('/');
    expect(links).toContain('/contact');
    for (const company of companies) expect(links).toContain(`/companies/${company.slug}`);
    expect(html.match(/rounded-pill/g)).toHaveLength(1);
    expect(links).not.toContain('/partnerships');
  });

  it('renders nothing hidden', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    expect(html).not.toContain('data-reveal');
  });
});

describe('error boundaries', () => {
  const failure = Object.assign(new Error('secret upstream failure: db://internal'), { digest: 'd1g3st' });

  it('error.tsx: a calm page with a retry and a way home, never the error message', () => {
    const html = render(h(RouteError, { error: failure, reset: () => {} }));
    expect(tags(html, 'h1')).toEqual(['Something went wrong']);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*Try again/);
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/', '/contact']));
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain('d1g3st');
    expect(html).not.toContain('secret upstream failure');
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
  });

  it('global-error.tsx: its own html and body, noindex, and the direct channels to the group office', () => {
    const html = render(h(GlobalError, { error: failure, reset: () => {} }));
    expect(html).toMatch(new RegExp(`^<html lang="${site.language}"`));
    expect(html).toContain('<title>Something went wrong | Itemba Group</title>');
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain('<main id="main-content"');
    expect(tags(html, 'h1')).toEqual(['Something went wrong']);
    const links = hrefs(html);
    expect(links).toContain('/');
    expect(links.some((l) => l.startsWith('tel:'))).toBe(true);
    expect(links.some((l) => l.startsWith(contact.whatsapp.split('?')[0] ?? 'https://wa.me/'))).toBe(true);
    expect(links.some((l) => l.startsWith('mailto:'))).toBe(true);
    expect(html).not.toContain('secret upstream failure');
  });
});

describe('deploy documents', () => {
  it('DEPLOY.md: 308 redirects, and enquiry_submit as a conversion_action value', () => {
    const doc = read('DEPLOY.md');
    // 301 may only appear to say the redirects are not 301.
    const claims = [...doc.matchAll(/(\S+\s+)?\b301\b/g)].filter((m) => !/^not\s/.test(m[1] ?? ''));
    expect(claims.map((m) => m[0])).toEqual([]);
    expect(doc).toMatch(/sends as\s+\*\*308\*\*/);
    expect(doc).toMatch(/`conversion_action` set to\s+`enquiry_submit`/);
    expect(doc).toContain('X-Robots-Tag: noindex');
    expect(doc).not.toContain('src/app/company-profile/page.tsx');
  });

  it('.env.example stores enquiries on the /app/data volume', () => {
    const env = read('.env.example');
    expect(env).toMatch(/^ENQUIRY_STORAGE_DIR=\/app\/data$/m);
    expect(env).not.toContain('/tmp/');
  });

  it('.dockerignore keeps the raw images and test artefacts out, and the profile PDFs in', () => {
    const lines = read('.dockerignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(lines).toEqual(expect.arrayContaining(['images', 'test-results', 'playwright-report', '.env', '.env.*', '!.env.example']));
    expect(lines.filter((l) => /^(public|public\/downloads)(\/.*)?$/.test(l) || l === 'downloads')).toEqual([]);
  });
});
