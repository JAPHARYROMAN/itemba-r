/**
 * Page group P7 (WP2.8) against the running server: the 404 page and the
 * metadata routes, beyond what route-inventory.spec.ts holds against the
 * baseline.
 *
 * @contract (server responses, desktop project only):
 *   - unknown URLs, top-level and under every [slug] route, answer 404 with
 *     "Page Not Found | Itemba Group" (one suffix), noindex and no canonical,
 *     and (server-rendered wherever the route allows it) the h1 "Page not
 *     found" with a link home;
 *   - robots.txt disallows /api/ and nothing else; the manifest's lang is
 *     the html lang and each icon is a square PNG of its declared size;
 *   - every sitemap lastmod is a date; no X-Powered-By header; the staging
 *     hosts (and only they) answer X-Robots-Tag: noindex.
 *
 * @quality (360 px and 1280 px): the 404 has no serious or critical axe
 * violations, reads fully without JavaScript, and never scrolls sideways.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, norm, test } from './support/fixtures';
import { headerValue, inlineOpacityZero, pngSize, rawRequest } from './support/http';
import { SITEMAP_PATHS } from './support/routes';

const NOT_FOUND = '/does-not-exist';
const SLUG_404S = [
  '/companies/not-a-real-company',
  '/services/not-a-real-service',
  '/locations/not-a-real-location',
  '/insights/not-a-real-article',
];
const TITLE = 'Page Not Found | Itemba Group';

/**
 * An unknown slug renders the 404 page in the server HTML only when its
 * [slug] page sets `dynamicParams = false` (docs/PAGE-GUIDE.md §6); until
 * then Next answers 404 with an empty error shell that JavaScript fills. So
 * the h1 is checked for every route whose page opts in, which tightens by
 * itself as the page groups land.
 */
function rendersNotFoundOnTheServer(pathname: string): boolean {
  const segment = pathname.split('/')[1];
  if (!segment || pathname.split('/').length !== 3) return true;
  const page = path.resolve(__dirname, '../../src/app', segment, '[slug]', 'page.tsx');
  return /^export const dynamicParams = false;?$/m.test(readFileSync(page, 'utf8'));
}

const headTags = (html: string, pattern: RegExp) => html.match(pattern) ?? [];
const attrOf = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

async function openNotFound(page: Page, pathname = NOT_FOUND) {
  const response = await page.goto(pathname, { waitUntil: 'load' });
  expect(response?.status(), `${pathname} should answer 404`).toBe(404);
}

test.describe('contract › 404 and metadata routes', { tag: '@contract' }, () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== 'desktop', 'server responses do not depend on the viewport; desktop only');
  });

  for (const pathname of [NOT_FOUND, ...SLUG_404S]) {
    test(`${pathname}: 404, one title suffix, noindex, no canonical, h1 "Page not found"`, async () => {
      const res = await rawRequest(pathname);
      expect(res.status).toBe(404);
      const html = res.body.toString('utf8');
      expect(headTags(html, /<title>[^<]*<\/title>/g)).toEqual([`<title>${TITLE}</title>`]);
      const robots = headTags(html, /<meta name="robots"[^>]*>/g).map((t) => attrOf(t, 'content'));
      expect(robots.length, 'a robots meta').toBeGreaterThan(0);
      for (const content of robots) expect(content, 'every robots meta says noindex').toMatch(/noindex/);
      expect(headTags(html, /<link rel="canonical"[^>]*>/g), 'a missing page has no canonical').toEqual([]);
      expect(headerValue(res.headers, 'x-powered-by')).toBeNull();

      if (!rendersNotFoundOnTheServer(pathname)) {
        test.info().annotations.push({
          type: 'server 404 body',
          description: `${pathname}: its [slug] page does not set dynamicParams = false yet, so Next serves an empty error shell and the 404 renders only with JavaScript (origin/main did the same).`,
        });
        return;
      }
      const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => norm((m[1] ?? '').replace(/<[^>]*>/g, '')));
      expect(h1s).toEqual(['Page not found']);
      expect(html).toMatch(/<a[^>]*href="\/"[^>]*>(?:(?!<\/a>)[\s\S])*Back to home/);
    });
  }

  test('robots.txt disallows /api/ only, and keeps the sitemap', async () => {
    const res = await rawRequest('/robots.txt');
    expect(res.status).toBe(200);
    const body = res.body.toString('utf8');
    expect(body).toMatch(/^User-Agent: \*$/m);
    expect(body).toMatch(/^Allow: \/$/m);
    expect(body.match(/^Disallow:.*$/gm)).toEqual(['Disallow: /api/']);
    expect(body).toContain('Sitemap: https://www.itembagrouptz.com/sitemap.xml');
  });

  test('the manifest matches the html lang and declares square icons at their real sizes', async ({ page }) => {
    const res = await rawRequest('/manifest.webmanifest');
    expect(res.status).toBe(200);
    const manifest = JSON.parse(res.body.toString('utf8')) as {
      lang: string;
      background_color: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    await page.goto('/');
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    expect(manifest.lang).toBe(htmlLang);
    const themeColor = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
    expect(manifest.background_color).toBe(themeColor);
    expect(manifest.icons.map((i) => i.src)).not.toContain('/logo.png');
    for (const icon of manifest.icons) {
      const file = await rawRequest(icon.src);
      expect(file.status, icon.src).toBe(200);
      const size = pngSize(file.body);
      expect(size && `${size.width}x${size.height}`, icon.src).toBe(icon.sizes);
      expect(size?.width, `${icon.src} is square`).toBe(size?.height);
    }
  });

  test('sitemap.xml dates every URL', async () => {
    const xml = (await rawRequest('/sitemap.xml')).body.toString('utf8');
    const lastmods = [...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1] ?? '');
    expect(lastmods).toHaveLength(SITEMAP_PATHS.length);
    for (const value of lastmods) expect(Number.isNaN(Date.parse(value)), value).toBe(false);
  });

  test('no X-Powered-By; staging hosts, and only they, answer X-Robots-Tag: noindex', async () => {
    for (const pathname of ['/', '/about', '/api/health', NOT_FOUND]) {
      const res = await rawRequest(pathname);
      expect(headerValue(res.headers, 'x-powered-by'), pathname).toBeNull();
      expect(headerValue(res.headers, 'x-robots-tag'), pathname).toBeNull();
    }
    for (const host of ['staging-www.itembagrouptz.com', 'www-staging.itembagrouptz.com']) {
      for (const pathname of ['/', '/about', NOT_FOUND]) {
        const res = await rawRequest(pathname, { host });
        expect(headerValue(res.headers, 'x-robots-tag'), `${host}${pathname}`).toBe('noindex');
      }
    }
    const production = await rawRequest('/about', { host: 'www.itembagrouptz.com' });
    expect(production.status).toBe(200);
    expect(headerValue(production.headers, 'x-robots-tag')).toBeNull();
  });
});

test.describe('quality › 404 page', { tag: '@quality' }, () => {
  test.describe('accessibility', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test(`${NOT_FOUND}: no serious or critical axe violations`, async ({ page }, testInfo) => {
      await openNotFound(page);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).analyze();
      await testInfo.attach('axe-violations.json', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact} ${v.id}: ${v.help} (e.g. ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`);
      expect(blocking, `${NOT_FOUND} at ${page.viewportSize()?.width}px`).toEqual([]);
    });

    test(`${NOT_FOUND}: reflows without sideways scrolling`, async ({ page }) => {
      await openNotFound(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe('no JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test.beforeEach(async ({ page }) => {
      await page.route('**/*', (route) =>
        ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
      );
    });

    test(`${NOT_FOUND}: content and navigation are visible without JavaScript`, async ({ page }) => {
      const html = (await rawRequest(NOT_FOUND)).body.toString('utf8');
      expect(inlineOpacityZero(html), 'inline opacity:0 in the server HTML').toEqual([]);

      await openNotFound(page);
      const report = await page.evaluate(() => {
        const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const shown = (el: Element) => {
          const r = el.getBoundingClientRect();
          return el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 0 && r.height > 0;
        };
        const main = document.querySelector('main');
        const hidden: string[] = [];
        let visibleChars = 0;
        for (const el of main?.querySelectorAll('*') ?? []) {
          if (el.closest('script, style, template, noscript, [aria-hidden="true"]')) continue;
          const own = clean([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' '));
          if (!own || !el.checkVisibility()) continue;
          if (el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) visibleChars += own.length;
          else hidden.push(own.slice(0, 60));
        }
        const h1s = [...document.querySelectorAll('h1')];
        return { h1: h1s.map((h) => clean(h.textContent)), h1Shown: h1s.every(shown), hidden, visibleChars };
      });
      expect(report.h1).toEqual(['Page not found']);
      expect(report.h1Shown).toBe(true);
      expect(report.hidden).toEqual([]);
      expect(report.visibleChars).toBeGreaterThan(80);

      // The primary navigation: visible links, or the native popover menu, which opens without JavaScript.
      const navTargets = async () =>
        page.evaluate((paths) => {
          const shown = (el: Element) => {
            const r = el.getBoundingClientRect();
            return el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 0 && r.height > 0;
          };
          const scopes = [...document.querySelectorAll('header, [popover], nav:not(main nav):not(footer nav)')];
          const hrefs = scopes.flatMap((s) => [...s.querySelectorAll('a[href^="/"]')].filter(shown).map((a) => a.getAttribute('href') ?? ''));
          return [...new Set(hrefs.filter((h) => h !== '/' && paths.includes(h)))];
        }, [...SITEMAP_PATHS]);
      let targets = await navTargets();
      if (targets.length < 3) {
        const toggle = page.locator('header button[popovertarget], button[popovertarget]').filter({ visible: true }).first();
        if (await toggle.count()) {
          await toggle.click();
          targets = await navTargets();
        }
      }
      expect(targets.length, `visible primary navigation: ${targets.join(', ') || 'none'}`).toBeGreaterThanOrEqual(3);
    });
  });
});
