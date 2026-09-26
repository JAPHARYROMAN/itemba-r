#!/usr/bin/env node
/**
 * Golden route snapshot for the Itemba Group website.
 *
 * Records, for every one of the 25 sitemap URLs, the server-rendered facts the
 * rebuild must preserve (status, title, meta description, canonical, robots,
 * og:* and twitter:* tags, JSON-LD blocks, h1, anchor ids, EnquiryRouter and
 * QuickContact presence), plus the metadata routes, response headers, host
 * redirects, per-route Open Graph images, 404 behaviour, API liveness and
 * static assets.
 *
 * The DOM is read from the server HTML with JavaScript disabled, so the
 * snapshot reflects what crawlers and no-JS visitors receive.
 *
 * Usage:
 *   # current build (default out: test-results/snapshot), e.g. the rebuild on 3191
 *   BASE_URL=http://localhost:3191 npm run snapshot
 *   # golden baseline: only ever against an origin/main build; BASE_URL required
 *   BASE_URL=http://127.0.0.1:3190 npm run snapshot:baseline -- \
 *     --label "origin/main <sha>" [--note "..."]
 *
 * Output files (deterministic apart from snapshot-meta.json):
 *   routes.json           per-URL page facts
 *   metadata-routes.json  sitemap.xml, robots.txt, manifest.webmanifest
 *   headers.json          security + cache headers per URL and per asset
 *   redirects.json        host redirects and trailing-slash behaviour
 *   og-images.json        every <route>/opengraph-image
 *   misc.json             404s, API liveness, static assets, downloads
 *   snapshot-meta.json    when/where the snapshot was taken
 *
 * Exits 1 when a sitemap URL does not return 200 or the sitemap differs from
 * the expected 25 URLs, so it doubles as a smoke check.
 *
 * Later stages can compare markup-independent markers: rebuilt components may
 * add `data-enquiry-router` + `data-default-intent="<id>"` and
 * `data-quick-contact`; the legacy markup is detected heuristically.
 */
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SITEMAP_PATHS, ogImagePath, absoluteUrl } from './lib/routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, '..');

// ─── Arguments ───────────────────────────────────────────────────────────────
function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : fallback;
}

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3191').replace(/\/+$/, '');
const OUT_DIR = path.resolve(WEBSITE_ROOT, argValue('--out', 'test-results/snapshot'));
const LABEL = argValue('--label', process.env.SNAPSHOT_LABEL || '');
const NOTE = argValue('--note', process.env.SNAPSHOT_NOTE || '');
const GOLDEN_DIR = path.resolve(WEBSITE_ROOT, 'tests/baseline');
if ((process.argv.includes('--baseline') || OUT_DIR === GOLDEN_DIR) && !process.env.BASE_URL) {
  console.error(
    'Refusing to write the golden baseline without an explicit BASE_URL. Point it at a server built ' +
      'from origin/main (e.g. BASE_URL=http://127.0.0.1:3190), never at the rebuild.',
  );
  process.exit(2);
}

// Labels (legacy shortLabel/label and likely rebuilt labels) → intent id.
const INTENT_ALIASES = {
  general: ['general', 'general business enquiry', 'group', 'itemba group'],
  mwanjalisi: ['mwanjalisi', 'fuel', 'fuel and petroleum supply', 'mwanjalisi oil', 'mwanjalisi oil co ltd'],
  westsides: ['westsides', 'trade', 'trade and distribution', 'westsides company', 'westsides company ltd'],
  enterprises: [
    'enterprises',
    'logistics',
    'logistics and operations',
    'itemba enterprises',
    'itemba enterprises co ltd',
  ],
};

function intentIdFor(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  for (const [id, aliases] of Object.entries(INTENT_ALIASES)) {
    if (aliases.includes(v)) return id;
  }
  return null;
}

const SECURITY_HEADERS = [
  'x-dns-prefetch-control',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'strict-transport-security',
  'content-security-policy',
  'x-robots-tag',
  'x-powered-by',
];
const CACHE_HEADERS = ['cache-control', 'content-type', 'vary'];

const STATIC_ASSETS = [
  '/logo.png',
  '/logo-print.png',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/favicon-48x48.png',
  '/favicon-64x64.png',
  '/apple-touch-icon.png',
  '/site-icon-192.png',
  '/site-icon-512.png',
];

const DOWNLOADS = [
  '/downloads/itemba-group-profile.pdf',
  '/downloads/itemba-westsides-profile.pdf',
  '/downloads/itemba-mwanjalisi-profile.pdf',
  '/downloads/itemba-enterprises-profile.pdf',
];

const NOT_FOUND_PATHS = [
  '/this-route-does-not-exist',
  '/services/not-a-real-service',
  '/companies/not-a-real-company',
  '/locations/not-a-real-location',
  '/insights/not-a-real-article',
];

const REDIRECT_HOSTS = ['itembagrouptz.com', 'itembagroup.com', 'www.itembagroup.com'];
const REDIRECT_PATHS = ['/', '/about', '/services/fuel-and-lubricants', '/faq?utm_source=test'];
const CONTROL_HOSTS = ['www.itembagrouptz.com', 'staging-www.itembagrouptz.com', 'www-staging.itembagrouptz.com'];
const TRAILING_SLASH_PATHS = ['/about/', '/services/fuel-and-lubricants/', '/company-profile/'];

// ─── HTTP helper (no redirect following, Host override allowed) ─────────────
function request(pathname, { method = 'GET', host, headers = {}, timeoutMs = 30000 } = {}) {
  const url = new URL(pathname, `${BASE_URL}/`);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { 'user-agent': 'itemba-snapshot/1.0', ...(host ? { host } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${pathname}`)));
    req.on('error', reject);
    req.end();
  });
}

function pickHeaders(headers, names) {
  const out = {};
  for (const name of names) {
    if (headers[name] !== undefined) out[name] = headers[name];
  }
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function pngSize(buf) {
  // PNG signature + IHDR: width at byte 16, height at byte 20 (big endian).
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function countInlineOpacityZero(html) {
  // style="...opacity:0..." as emitted by framer-motion / inline styles.
  const styles = html.match(/style="[^"]*"/g) || [];
  return styles.filter((s) => /opacity:\s*0(?![.\d])/.test(s)).length;
}

// ─── JSON-LD summarising ─────────────────────────────────────────────────────
function flattenLd(node) {
  if (Array.isArray(node)) return node.flatMap(flattenLd);
  if (node && typeof node === 'object' && Array.isArray(node['@graph'])) {
    return node['@graph'].flatMap(flattenLd);
  }
  return node && typeof node === 'object' ? [node] : [];
}

function lengthOf(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object' && Array.isArray(v.itemListElement)) return v.itemListElement.length;
  return undefined;
}

function summariseLd(entity) {
  const counts = {};
  for (const key of ['mainEntity', 'itemListElement', 'blogPost', 'makesOffer', 'subOrganization', 'hasOfferCatalog', 'about', 'telephone']) {
    const n = lengthOf(entity[key]);
    if (n !== undefined) counts[key] = n;
  }
  const refs = {};
  for (const key of ['publisher', 'author', 'provider', 'parentOrganization', 'about', 'isPartOf']) {
    const v = entity[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      refs[key] = v['@id'] ? { '@id': v['@id'] } : { '@type': v['@type'] ?? null, name: v.name ?? null };
    }
  }
  return {
    '@type': entity['@type'] ?? null,
    '@id': entity['@id'] ?? null,
    name: entity.name ?? entity.headline ?? null,
    url: entity.url ?? null,
    keys: Object.keys(entity).sort(),
    counts,
    refs,
  };
}

// ─── In-page extraction (runs in the browser, JS disabled on the page) ───────
function extractPage() {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  // Heading text as a reader sees it: <br> and block-level children break
  // words (textContent alone would turn "Itemba Group<span class=block>
  // Company Profile</span>" into "Itemba GroupCompany Profile").
  const BLOCK_TAGS = new Set(['BR', 'DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'HEADER', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const textOf = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    if (el.tagName === 'BR') return ' ';
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') return '';
    const inner = [...el.childNodes].map(textOf).join('');
    const breaks = BLOCK_TAGS.has(el.tagName) || /(^|\s)(block|flex|grid)(\s|$)/.test(el.getAttribute('class') || '');
    return breaks ? ` ${inner} ` : inner;
  };
  const headingText = (el) => norm(textOf(el));
  const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) ?? null;
  // React useId output (React 19.0/19.1 «r0» / :r0:, React 19.2 _R_…_), not anchors.
  const reactIdLike = (id) => /«|»|^:r[0-9a-z]*:$|^_[rR][_0-9a-zA-Z]*_$|^radix-/.test(id);

  const metaPairs = (selector, keyAttr) =>
    [...document.querySelectorAll(selector)].map((m) => [m.getAttribute(keyAttr), m.getAttribute('content')]);

  const jsonLdRaw = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);

  // Anchor ids (deep-linkable) vs ids inside inline SVG (gradient/defs, not anchors).
  const idEls = [...document.body.querySelectorAll('[id]')].filter((e) => e.id && !reactIdLike(e.id));
  const bodyIds = idEls.filter((e) => !e.closest('svg')).map((e) => e.id);
  const svgIds = idEls.filter((e) => e.closest('svg')).map((e) => e.id);

  const hashLinks = [
    ...new Set(
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && (h.startsWith('#') || /^\/[^#]*#./.test(h))),
    ),
  ].sort();

  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const internalLinks = [
    ...new Set(
      hrefs
        .filter((h) => h && h.startsWith('/') && !h.startsWith('//'))
        .map((h) => h.split('#')[0].split('?')[0] || '/'),
    ),
  ].sort();
  const contactHrefs = [
    ...new Set(hrefs.filter((h) => h && (/^(tel|mailto):/i.test(h) || /wa\.me\//.test(h)))),
  ].sort();
  const externalLinks = [...new Set(hrefs.filter((h) => h && /^https?:\/\//.test(h)))].sort();

  // EnquiryRouter: explicit marker first, legacy heuristic second.
  const routers = [];
  for (const el of document.querySelectorAll('[data-enquiry-router]')) {
    routers.push({
      marker: 'data-enquiry-router',
      defaultIntent: el.getAttribute('data-default-intent'),
      defaultIntentLabel: null,
      title: norm(el.querySelector('h2,h3,h4,legend')?.textContent) || null,
    });
  }
  if (!routers.length) {
    for (const form of document.querySelectorAll('form')) {
      const pressedButtons = form.querySelectorAll('button[aria-pressed]');
      const radios = form.querySelectorAll('input[type="radio"]');
      if (!form.querySelector('textarea') || (!pressedButtons.length && !radios.length)) continue;
      let label = null;
      let value = null;
      const pressed = form.querySelector('button[aria-pressed="true"]');
      if (pressed) label = norm(pressed.textContent);
      const checked = form.querySelector('input[type="radio"]:checked');
      if (checked) {
        value = checked.value;
        label = norm(checked.closest('label')?.textContent || (checked.id && form.querySelector(`label[for="${checked.id}"]`)?.textContent)) || label;
      }
      const options = pressedButtons.length
        ? [...pressedButtons].map((b) => norm(b.textContent))
        : [...radios].map((r) => r.value);
      const fields = [...form.querySelectorAll('input, textarea, select')]
        .filter((f) => f.type !== 'hidden' && f.type !== 'radio' && f.getAttribute('aria-hidden') !== 'true')
        .map((f) => ({
          tag: f.tagName.toLowerCase(),
          type: f.getAttribute('type'),
          name: f.getAttribute('name'),
          placeholder: f.getAttribute('placeholder'),
          label: norm(f.closest('label')?.textContent) || null,
        }));
      routers.push({
        marker: 'heuristic-form',
        defaultIntent: value,
        defaultIntentLabel: label,
        title: norm(form.querySelector('h2,h3,h4,legend')?.textContent) || null,
        options,
        fields,
        hasHoneypot: !!form.querySelector('input[aria-hidden="true"], input[name="website"]'),
        submitLabel: norm(form.querySelector('button[type="submit"]')?.textContent) || null,
        contactHrefs: [...form.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      });
    }
  }

  // QuickContact: explicit marker first; otherwise a tel+wa.me cluster that
  // sits outside main/header/footer/nav/forms (the floating/sticky contact).
  let quick = document.querySelector('[data-quick-contact]');
  let quickMarker = quick ? 'data-quick-contact' : null;
  if (!quick) {
    const tels = [...document.querySelectorAll('a[href^="tel:"]')].filter(
      (a) => !a.closest('main, header, footer, nav, form'),
    );
    outer: for (const a of tels) {
      let el = a.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector('a[href*="wa.me/"]')) {
          quick = el;
          quickMarker = 'heuristic-tel-whatsapp';
          break outer;
        }
        el = el.parentElement;
      }
    }
  }

  const main = document.querySelector('main');

  return {
    htmlLang: document.documentElement.getAttribute('lang'),
    title: document.title,
    description: attr('meta[name="description"]', 'content'),
    keywords: attr('meta[name="keywords"]', 'content'),
    robots: attr('meta[name="robots"]', 'content'),
    googlebot: attr('meta[name="googlebot"]', 'content'),
    googleSiteVerification: attr('meta[name="google-site-verification"]', 'content'),
    applicationName: attr('meta[name="application-name"]', 'content'),
    themeColor: attr('meta[name="theme-color"]', 'content'),
    viewport: attr('meta[name="viewport"]', 'content'),
    canonical: attr('link[rel="canonical"]', 'href'),
    og: metaPairs('meta[property^="og:"]', 'property'),
    twitter: metaPairs('meta[name^="twitter:"]', 'name'),
    headLinks: [...document.querySelectorAll('head link[rel]')]
      .filter((l) => /icon|manifest|alternate|apple-touch/i.test(l.getAttribute('rel')))
      .map((l) => ({
        rel: l.getAttribute('rel'),
        href: l.getAttribute('href'),
        sizes: l.getAttribute('sizes'),
        type: l.getAttribute('type'),
      })),
    jsonLdRaw,
    h1: [...document.querySelectorAll('h1')].map(headingText),
    h2: [...document.querySelectorAll('h2')].map(headingText),
    ids: bodyIds,
    svgIds,
    hashLinks,
    internalLinks,
    contactHrefs,
    externalLinks,
    landmarks: {
      mainId: main?.id ?? null,
      mainCount: document.querySelectorAll('main').length,
      skipLinkHref:
        [...document.querySelectorAll('a[href^="#"]')].find((a) => /skip/i.test(a.textContent || ''))?.getAttribute('href') ?? null,
      headerCount: document.querySelectorAll('header').length,
      footerCount: document.querySelectorAll('footer').length,
      navCount: document.querySelectorAll('nav').length,
    },
    enquiryRouters: routers,
    quickContact: quick
      ? {
          present: true,
          marker: quickMarker,
          links: [...quick.querySelectorAll('a[href]')].map((a) => ({
            href: a.getAttribute('href'),
            label: a.getAttribute('aria-label') || norm(a.textContent) || null,
          })),
        }
      : { present: false, marker: null, links: [] },
    printHooks: {
      printDocumentRoot: document.querySelectorAll('.print-document-root').length,
      printProfiles: [...document.querySelectorAll('.print-profile-document[data-profile]')].map((a) =>
        a.getAttribute('data-profile'),
      ),
      downloadLinks: [...document.querySelectorAll('a[href^="/downloads/"]')].map((a) => ({
        href: a.getAttribute('href'),
        download: a.hasAttribute('download'),
      })),
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const problems = [];
  const warn = (msg) => {
    problems.push(msg);
    console.warn(`  ! ${msg}`);
  };

  console.log(`Snapshotting ${BASE_URL} → ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}`);

  const health = await request('/api/health').catch((e) => ({ status: 0, error: e.message }));
  if (health.status !== 200) {
    console.error(`Server at ${BASE_URL} is not healthy (/api/health → ${health.status}). Start it first.`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    return ['image', 'font', 'media', 'stylesheet'].includes(type) ? route.abort() : route.continue();
  });
  const page = await context.newPage();

  const routes = {};
  const routeHeaders = {};
  for (const pathname of SITEMAP_PATHS) {
    process.stdout.write(`  ${pathname} … `);
    const raw = await request(pathname);
    const html = raw.body.toString('utf8');
    routeHeaders[pathname] = pickHeaders(raw.headers, [...SECURITY_HEADERS, ...CACHE_HEADERS]);
    if (raw.status !== 200) warn(`${pathname} returned ${raw.status}`);

    const response = await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'load' });
    const dom = await page.evaluate(extractPage);

    const jsonLd = dom.jsonLdRaw.map((text, index) => {
      try {
        const data = JSON.parse(text);
        return { index, entities: flattenLd(data).map(summariseLd), data };
      } catch (error) {
        warn(`${pathname} JSON-LD block ${index} does not parse: ${error.message}`);
        return { index, parseError: String(error.message), raw: text };
      }
    });

    const enquiryRouters = dom.enquiryRouters.map((r) => ({
      ...r,
      defaultIntent: intentIdFor(r.defaultIntent) ?? r.defaultIntent ?? intentIdFor(r.defaultIntentLabel),
    }));

    const { jsonLdRaw, ...rest } = dom;
    routes[pathname] = {
      url: absoluteUrl(pathname),
      status: raw.status,
      browserStatus: response?.status() ?? null,
      contentType: raw.headers['content-type'] ?? null,
      htmlBytes: raw.body.length,
      inlineOpacityZero: countInlineOpacityZero(html),
      ...rest,
      jsonLd,
      jsonLdTypes: [...new Set(jsonLd.flatMap((b) => (b.entities || []).map((e) => String(e['@type']))))].sort(),
      enquiryRouter: {
        present: enquiryRouters.length > 0,
        count: enquiryRouters.length,
        defaultIntent: enquiryRouters[0]?.defaultIntent ?? null,
        instances: enquiryRouters,
      },
    };
    console.log(
      `${raw.status} · "${dom.title}" · h1=${JSON.stringify(dom.h1[0] ?? null)} · ld=${jsonLd.length} · router=${
        enquiryRouters.length ? enquiryRouters[0].defaultIntent ?? '?' : '-'
      } · quick=${dom.quickContact.present ? 'y' : 'n'}`,
    );
  }

  // ── Metadata routes ──
  console.log('  metadata routes …');
  const sitemap = await request('/sitemap.xml');
  const sitemapXml = sitemap.body.toString('utf8');
  const sitemapEntries = [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, block]) => {
    const tag = (name) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
    return { loc: tag('loc'), lastmod: tag('lastmod'), changefreq: tag('changefreq'), priority: tag('priority') };
  });
  const expectedLocs = SITEMAP_PATHS.map((p) => absoluteUrl(p));
  const actualLocs = sitemapEntries.map((e) => e.loc);
  const sitemapMatches = JSON.stringify(expectedLocs) === JSON.stringify(actualLocs);
  if (!sitemapMatches) {
    warn(`sitemap.xml locs differ from the expected 25 URLs (got ${actualLocs.length})`);
  }
  const robots = await request('/robots.txt');
  const manifest = await request('/manifest.webmanifest');
  let manifestJson = null;
  try {
    manifestJson = JSON.parse(manifest.body.toString('utf8'));
  } catch {
    warn('manifest.webmanifest is not valid JSON');
  }
  const metadataRoutes = {
    sitemap: {
      status: sitemap.status,
      headers: pickHeaders(sitemap.headers, CACHE_HEADERS),
      matchesExpectedOrder: sitemapMatches,
      entries: sitemapEntries,
      body: sitemapXml,
    },
    robots: {
      status: robots.status,
      headers: pickHeaders(robots.headers, CACHE_HEADERS),
      body: robots.body.toString('utf8'),
    },
    manifest: {
      status: manifest.status,
      headers: pickHeaders(manifest.headers, CACHE_HEADERS),
      json: manifestJson,
      body: manifest.body.toString('utf8'),
    },
  };

  // ── OG images ──
  console.log('  opengraph images …');
  const ogImages = {};
  for (const pathname of SITEMAP_PATHS) {
    const ogPath = ogImagePath(pathname);
    const res = await request(ogPath);
    const size = pngSize(res.body);
    const metaImage = routes[pathname].og.find(([k]) => k === 'og:image')?.[1] ?? null;
    ogImages[ogPath] = {
      route: pathname,
      status: res.status,
      contentType: res.headers['content-type'] ?? null,
      cacheControl: res.headers['cache-control'] ?? null,
      bytes: res.body.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      is1200x630: size?.width === 1200 && size?.height === 630,
      sha256: sha256(res.body),
      metaOgImage: metaImage,
      metaOgImagePath: metaImage ? new URL(metaImage).pathname : null,
    };
    if (res.status !== 200 || !(size?.width === 1200 && size?.height === 630)) {
      warn(`${ogPath} → ${res.status} ${size ? `${size.width}x${size.height}` : 'not a PNG'}`);
    }
  }
  // Unknown-slug OG behaviour (baseline returns a generic card, not 404).
  const unknownOg = {};
  for (const ogPath of [
    '/services/not-a-real-service/opengraph-image',
    '/companies/not-a-real-company/opengraph-image',
    '/locations/not-a-real-location/opengraph-image',
    '/insights/not-a-real-article/opengraph-image',
  ]) {
    const res = await request(ogPath);
    unknownOg[ogPath] = { status: res.status, contentType: res.headers['content-type'] ?? null };
  }

  // ── Redirects ──
  console.log('  redirects …');
  const hostRedirects = [];
  for (const host of REDIRECT_HOSTS) {
    for (const p of REDIRECT_PATHS) {
      const res = await request(p, { host });
      hostRedirects.push({ host, path: p, status: res.status, location: res.headers.location ?? null });
    }
  }
  const controlHosts = [];
  for (const host of CONTROL_HOSTS) {
    const res = await request('/about', { host });
    controlHosts.push({
      host,
      path: '/about',
      status: res.status,
      location: res.headers.location ?? null,
      xRobotsTag: res.headers['x-robots-tag'] ?? null,
    });
  }
  const trailingSlash = [];
  for (const p of TRAILING_SLASH_PATHS) {
    const res = await request(p);
    trailingSlash.push({ path: p, status: res.status, location: res.headers.location ?? null });
  }
  const redirects = { hostRedirects, controlHosts, trailingSlash };

  // ── Assets, downloads, API, 404s ──
  console.log('  assets, downloads, api, 404s …');
  const assetHeaders = {};
  const assets = {};
  for (const p of [...STATIC_ASSETS, ...DOWNLOADS]) {
    const res = await request(p);
    assetHeaders[p] = pickHeaders(res.headers, [...SECURITY_HEADERS, ...CACHE_HEADERS]);
    assets[p] = {
      status: res.status,
      contentType: res.headers['content-type'] ?? null,
      bytes: res.body.length,
      sha256: sha256(res.body),
      ...(p.endsWith('.png') ? { png: pngSize(res.body) } : {}),
    };
  }
  const healthRes = await request('/api/health');
  let healthJson = null;
  try {
    healthJson = JSON.parse(healthRes.body.toString('utf8'));
  } catch {
    /* recorded as null */
  }
  const enquiriesGet = await request('/api/enquiries');
  const api = {
    health: {
      status: healthRes.status,
      contentType: healthRes.headers['content-type'] ?? null,
      cacheControl: healthRes.headers['cache-control'] ?? null,
      keys: healthJson ? Object.keys(healthJson).sort() : null,
      status_field: healthJson?.status ?? null,
      service: healthJson?.service ?? null,
      timestampIsIso: healthJson ? !Number.isNaN(Date.parse(healthJson.timestamp)) : null,
    },
    enquiriesGet: { status: enquiriesGet.status, allow: enquiriesGet.headers.allow ?? null },
  };

  const notFound = {};
  for (const p of NOT_FOUND_PATHS) {
    const res = await request(p);
    await page.goto(`${BASE_URL}${p}`, { waitUntil: 'load' });
    const dom = await page.evaluate(() => ({
      title: document.title,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
      h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
      internalLinks: [
        ...new Set(
          [...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute('href')),
        ),
      ].sort(),
    }));
    notFound[p] = { status: res.status, cacheControl: res.headers['cache-control'] ?? null, ...dom };
  }

  await browser.close();

  const headers = { routes: routeHeaders, assets: assetHeaders };
  const misc = { notFound, unknownOgImages: unknownOg, api, assets };

  await mkdir(OUT_DIR, { recursive: true });
  const write = (name, data) => writeFile(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await write('routes.json', routes);
  await write('metadata-routes.json', metadataRoutes);
  await write('headers.json', headers);
  await write('redirects.json', redirects);
  await write('og-images.json', ogImages);
  await write('misc.json', misc);
  await write('snapshot-meta.json', {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    label: LABEL || null,
    note: NOTE || null,
    routeCount: SITEMAP_PATHS.length,
    problems,
  });

  console.log(`Done: ${SITEMAP_PATHS.length} routes, ${Object.keys(ogImages).length} OG images, ${problems.length} problem(s).`);
  if (problems.some((p) => /returned|sitemap/.test(p))) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
