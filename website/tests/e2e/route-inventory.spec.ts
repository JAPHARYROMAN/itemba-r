/**
 * @contract Route inventory: the rebuild against the golden baseline of
 * origin/main (tests/baseline, recorded by scripts/snapshot-routes.mjs).
 *
 * Hard fields must equal the baseline and cannot be approved away:
 *   status 200, <title>, canonical, og:url, robots meta, the per-route OG
 *   image (path, 1200x630 PNG), twitter:card, every baseline anchor id,
 *   JSON-LD @type and @id coverage (superset), EnquiryRouter presence and
 *   default intent, the company-profile print hooks, response headers,
 *   sitemap order, host and trailing-slash redirects, asset and download
 *   headers, and 404s for unknown URLs.
 *
 * Anchors and JSON-LD coverage are supersets: new section ids and new
 * structured data are fine, but nothing the baseline links or ships may
 * disappear.
 *
 * Soft fields (description, keywords, og/twitter copy) must equal the
 * baseline or the exact value listed for that route in
 * tests/baseline/approved-changes.json, with a reason. Approvals that no
 * longer differ from the baseline fail as stale so the list stays honest.
 *
 * The page DOM is read with JavaScript disabled, as the baseline was.
 */
import { SOFT_FIELDS, approvedChanges, baseline, baselineRoute, intentIdFor, type HeaderMap } from './support/baseline';
import { readPageFacts, type PageFacts } from './support/dom';
import { expect, openRoute, test } from './support/fixtures';
import { headerValue, pngSize, rawRequest } from './support/http';
import { parseBlocks, topLevelEntities, typesOf } from './support/jsonld';
import { ROUTES, SITEMAP_PATHS, absoluteUrl } from './support/routes';

// x-powered-by may be dropped (architecture §6: poweredByHeader: false) but
// must never change to anything else.
const DROPPABLE_HEADERS = new Set(['x-powered-by']);

function compareHeaders(label: string, expected: HeaderMap, actual: Record<string, string | string[] | undefined>): string[] {
  const problems: string[] = [];
  for (const [name, want] of Object.entries(expected)) {
    const raw = actual[name];
    const got = raw === undefined ? null : Array.isArray(raw) ? raw.join(', ') : String(raw);
    if (got === want) continue;
    if (got === null && DROPPABLE_HEADERS.has(name)) continue;
    problems.push(`${label}: header ${name} is ${JSON.stringify(got)}, baseline ${JSON.stringify(want)}`);
  }
  if (actual['x-robots-tag'] !== undefined && expected['x-robots-tag'] === undefined) {
    problems.push(`${label}: unexpected x-robots-tag ${JSON.stringify(actual['x-robots-tag'])} on the production host`);
  }
  return problems;
}

const first = (pairs: [string, string][], key: string): string | null => pairs.find(([k]) => k === key)?.[1] ?? null;
const pathOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
};

function softValue(source: { description: string | null; keywords: string | null; og: [string, string][]; twitter: [string, string][] }, field: string): string | null {
  if (field === 'description') return source.description;
  if (field === 'keywords') return source.keywords;
  if (field.startsWith('og:')) return first(source.og, field);
  return first(source.twitter, field);
}

test.describe('contract › route inventory', { tag: '@contract' }, () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) =>
      ['image', 'font', 'media', 'stylesheet'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
    );
  });

  for (const pathname of ROUTES) {
    test(`${pathname} matches the baseline`, async ({ page }) => {
      const base = baselineRoute(pathname);
      const approvals = approvedChanges().routes[pathname] ?? {};
      const problems: string[] = [];
      const hard = (field: string, got: unknown, want: unknown) => {
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          problems.push(`${field}: got ${JSON.stringify(got)}, baseline ${JSON.stringify(want)}`);
        }
      };

      // ── Response ──
      const raw = await rawRequest(pathname);
      hard('status', raw.status, 200);
      problems.push(...compareHeaders(pathname, baseline().headers.routes[pathname] ?? {}, raw.headers));

      await openRoute(page, pathname);
      const facts: PageFacts = await page.evaluate(readPageFacts);

      // ── Hard metadata ──
      hard('title', facts.title, base.title);
      hard('canonical', facts.canonical, base.canonical);
      hard('og:url', first(facts.og, 'og:url'), first(base.og, 'og:url'));
      hard('robots meta', facts.robots, base.robots);
      const baseOgImage = pathOf(first(base.og, 'og:image'));
      const ogImage = pathOf(first(facts.og, 'og:image'));
      hard('og:image path', ogImage, baseOgImage);
      for (const key of ['og:image:width', 'og:image:height', 'og:image:type']) {
        hard(key, first(facts.og, key), first(base.og, key));
      }
      hard('twitter:card', first(facts.twitter, 'twitter:card'), first(base.twitter, 'twitter:card'));
      if (first(base.twitter, 'twitter:image')) {
        hard('twitter:image path', pathOf(first(facts.twitter, 'twitter:image')), baseOgImage);
      }

      // ── Soft copy (approved-changes.json) ──
      for (const field of SOFT_FIELDS) {
        const want = softValue(base, field);
        const got = softValue(facts, field);
        const approval = approvals[field];
        if (want === null) {
          if (approval) problems.push(`${field}: approval is unnecessary (the baseline has no value; additions need none)`);
          continue;
        }
        if (got === want) {
          if (approval) problems.push(`${field}: stale approval (the page matches the baseline again); remove it`);
          continue;
        }
        if (approval && approval.value === got) continue;
        problems.push(
          `${field}: changed from ${JSON.stringify(want)} to ${JSON.stringify(got)}` +
            (approval ? ` but approved-changes.json approves ${JSON.stringify(approval.value)}` : ' without an entry in approved-changes.json'),
        );
      }

      // ── Anchors (superset) ──
      const ids = new Set(facts.ids);
      const missingIds = base.ids.filter((id) => !ids.has(id));
      if (missingIds.length) problems.push(`anchors removed: ${missingIds.map((id) => `#${id}`).join(' ')}`);

      // ── JSON-LD coverage (superset) ──
      const blocks = parseBlocks(facts.jsonLdRaw);
      for (const b of blocks) if (b.error) problems.push(`JSON-LD block ${b.index} does not parse: ${b.error}`);
      const entities = blocks.flatMap((b) => topLevelEntities(b.data));
      const types = new Set(entities.flatMap(typesOf));
      const missingTypes = base.jsonLdTypes.filter((t) => !types.has(t));
      if (missingTypes.length) problems.push(`JSON-LD @type coverage lost: ${missingTypes.join(', ')}`);
      const ldIds = new Set(entities.map((e) => e['@id']).filter((v): v is string => typeof v === 'string'));
      const baseLdIds = base.jsonLd.flatMap((b) => (b.entities ?? []).map((e) => e['@id'])).filter((v): v is string => !!v);
      const missingLdIds = [...new Set(baseLdIds)].filter((id) => !ldIds.has(id));
      if (missingLdIds.length) problems.push(`JSON-LD @id coverage lost: ${missingLdIds.join(', ')}`);

      // ── EnquiryRouter ──
      const routers = facts.enquiryRouters.map((r) => intentIdFor(r.defaultIntent) ?? r.defaultIntent ?? intentIdFor(r.defaultIntentLabel));
      hard('EnquiryRouter present', routers.length > 0, base.enquiryRouter.present);
      if (base.enquiryRouter.present) hard('EnquiryRouter default intent', routers[0] ?? null, base.enquiryRouter.defaultIntent);

      // ── Print / PDF hooks ──
      if (base.printHooks.printDocumentRoot > 0) {
        hard('.print-document-root count', facts.printHooks.printDocumentRoot, base.printHooks.printDocumentRoot);
        hard('print profiles', [...facts.printHooks.printProfiles].sort(), [...base.printHooks.printProfiles].sort());
      }
      for (const link of base.printHooks.downloadLinks) {
        const found = facts.printHooks.downloadLinks.find((l) => l.href === link.href);
        if (!found) problems.push(`download link removed: ${link.href}`);
        else if (link.download && !found.download) problems.push(`download link lost its download attribute: ${link.href}`);
      }

      // ── Per-route OG image ──
      if (baseOgImage) {
        const og = await rawRequest(baseOgImage, { timeoutMs: 60_000 });
        const size = pngSize(og.body);
        hard(`${baseOgImage} status`, og.status, 200);
        hard(`${baseOgImage} content-type`, headerValue(og.headers, 'content-type'), 'image/png');
        hard(`${baseOgImage} size`, size, { width: 1200, height: 630 });
      }

      expect(problems, `${pathname} differs from the golden baseline`).toEqual([]);
    });
  }

  test('sitemap.xml lists the 25 URLs in baseline order', async () => {
    const res = await rawRequest('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(headerValue(res.headers, 'content-type')).toContain('xml');
    const xml = res.body.toString('utf8');
    const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, block = '']) => {
      const tag = (name: string) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
      return { loc: tag('loc'), lastmod: tag('lastmod'), changefreq: tag('changefreq'), priority: tag('priority') };
    });
    const baseEntries = baseline().metadataRoutes.sitemap.entries;
    expect(entries.map((e) => e.loc)).toEqual(SITEMAP_PATHS.map((p) => absoluteUrl(p)));
    expect(entries.map((e) => e.loc)).toEqual(baseEntries.map((e) => e.loc));
    expect(entries.map((e) => [e.loc, e.changefreq, e.priority])).toEqual(baseEntries.map((e) => [e.loc, e.changefreq, e.priority]));
    for (const e of entries) {
      expect(e.lastmod && !Number.isNaN(Date.parse(e.lastmod)), `${e.loc} lastmod ${e.lastmod}`).toBeTruthy();
    }
  });

  test('robots.txt allows the site and points at the sitemap; the manifest parses', async () => {
    const robots = await rawRequest('/robots.txt');
    expect(robots.status).toBe(200);
    const body = robots.body.toString('utf8');
    expect(body).toMatch(/^User-Agent:\s*\*/im);
    expect(body).toContain('Sitemap: https://www.itembagrouptz.com/sitemap.xml');
    expect(body, 'robots.txt must not disallow the whole site').not.toMatch(/^Disallow:\s*\/\s*$/im);

    const manifest = await rawRequest('/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    const json = JSON.parse(manifest.body.toString('utf8')) as Record<string, unknown>;
    const base = baseline().metadataRoutes.manifest.json ?? {};
    expect(json.short_name).toBe(base.short_name);
    expect(json.start_url).toBe(base.start_url);
    expect(Array.isArray(json.icons) && json.icons.length > 0).toBe(true);
  });

  test('host redirects, staging hosts and trailing slashes behave as the baseline', async () => {
    const { hostRedirects, controlHosts, trailingSlash } = baseline().redirects;
    const problems: string[] = [];
    for (const r of hostRedirects) {
      const res = await rawRequest(r.path, { host: r.host });
      const got = { status: res.status, location: headerValue(res.headers, 'location') };
      if (got.status !== r.status || got.location !== r.location) {
        problems.push(`${r.host}${r.path}: ${JSON.stringify(got)}, baseline ${JSON.stringify({ status: r.status, location: r.location })}`);
      }
    }
    for (const r of trailingSlash) {
      const res = await rawRequest(r.path);
      const got = { status: res.status, location: headerValue(res.headers, 'location') };
      if (got.status !== r.status || got.location !== r.location) {
        problems.push(`${r.path}: ${JSON.stringify(got)}, baseline ${JSON.stringify({ status: r.status, location: r.location })}`);
      }
    }
    for (const r of controlHosts) {
      const res = await rawRequest(r.path, { host: r.host });
      const location = headerValue(res.headers, 'location');
      const robotsTag = headerValue(res.headers, 'x-robots-tag');
      if (res.status !== r.status || location !== r.location) {
        problems.push(`${r.host}${r.path}: ${res.status} ${location}, baseline ${r.status} ${r.location}`);
      }
      const staging = /staging/.test(r.host);
      // Staging hosts may gain `noindex` (architecture §6); production never.
      if (!staging && robotsTag !== null) problems.push(`${r.host}: x-robots-tag ${robotsTag} on the production host`);
      if (staging && robotsTag !== null && !/noindex/i.test(robotsTag)) problems.push(`${r.host}: unexpected x-robots-tag ${robotsTag}`);
    }
    expect(problems).toEqual([]);
  });

  test('static assets and profile downloads keep their status and headers', async () => {
    const problems: string[] = [];
    for (const [asset, base] of Object.entries(baseline().misc.assets)) {
      const res = await rawRequest(asset, { timeoutMs: 60_000 });
      if (res.status !== base.status) problems.push(`${asset}: status ${res.status}, baseline ${base.status}`);
      problems.push(...compareHeaders(asset, baseline().headers.assets[asset] ?? {}, res.headers));
    }
    expect(problems).toEqual([]);
  });

  test('unknown URLs return 404 and are not indexable', async () => {
    const problems: string[] = [];
    for (const [pathname, base] of Object.entries(baseline().misc.notFound)) {
      const res = await rawRequest(pathname);
      if (res.status !== base.status) problems.push(`${pathname}: status ${res.status}, baseline ${base.status}`);
      const html = res.body.toString('utf8');
      const robots = html.match(/<meta[^>]*name="robots"[^>]*>/)?.[0]?.match(/content="([^"]*)"/)?.[1] ?? null;
      if (!robots || !/noindex/i.test(robots)) problems.push(`${pathname}: robots meta ${JSON.stringify(robots)}, expected noindex`);
    }
    expect(problems).toEqual([]);
  });

  test('approved-changes.json only approves soft fields on sitemap routes', () => {
    const { routes } = approvedChanges();
    const unknown = Object.keys(routes).filter((r) => !SITEMAP_PATHS.includes(r));
    expect(unknown, 'approved-changes.json names routes outside the sitemap').toEqual([]);
  });
});
