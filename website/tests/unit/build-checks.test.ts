/**
 * The build-output checkers behind `npm run budget` (scripts/check-budgets.mjs,
 * check-html.mjs, check-client-allowlist.mjs): their pure parsing and budget
 * logic, plus an end-to-end run of each CLI against a tiny fake build so the
 * exit codes (0 clean or --report-only, 1 findings, 2 no input) stay honest.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  extractPageAssets,
  iterateStartTags,
  listBuiltHtml,
  parseCheckerArgs,
  routeFromHtmlPath,
  staticAssetPath,
} from '../../scripts/lib/build-output.mjs';
import { BUDGETS, evaluateBudgets, formatBudgetMarkdown, formatBudgetTable } from '../../scripts/lib/budgets.mjs';
import { hasUseClientDirective, isClientAllowed } from '../../scripts/lib/client-directive.mjs';
import { findInlineZeroOpacity, isZeroOpacity, splitDeclarations } from '../../scripts/lib/html-scan.mjs';
import { SITEMAP_PATHS } from '../../scripts/lib/routes.mjs';

const ROOT = path.resolve(__dirname, '../..');
const BOM = String.fromCharCode(0xfeff);

describe('build output: page assets', () => {
  const html = [
    '<!DOCTYPE html><html><head>',
    '<link rel="stylesheet" href="/_next/static/css/a.css" data-precedence="next"/>',
    '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack-1.js"/>',
    '<link rel="preload" href="/_next/static/media/inter.woff2" as="font" type="font/woff2" crossorigin=""/>',
    '<script src="/_next/static/chunks/main-app-1.js" async=""></script>',
    '<script src="/_next/static/chunks/app/companies/%5Bslug%5D/page-1.js?dpl=abc" async=""></script>',
    '<script src="/_next/static/chunks/polyfills-1.js" noModule=""></script>',
    '<script src="https://www.googletagmanager.com/gtag/js?id=G-X" async=""></script>',
    '<script src="/_next/static/chunks/webpack-1.js" id="_R_" async=""></script>',
    '</head><body>',
    // RSC payload text: markup-looking strings, never markup (Next escapes any "</script" inside).
    '<script>self.__next_f.push([1,"<script src=\\"/_next/static/chunks/fake.js\\" async><form>"])</script>',
    '<main id="main-content"><h1>Hi</h1></main></body></html>',
  ].join('');

  it('lists first-load scripts, stylesheets and preloaded fonts once each', () => {
    const assets = extractPageAssets(html);
    expect(assets.scripts).toEqual([
      'static/chunks/webpack-1.js',
      'static/chunks/main-app-1.js',
      'static/chunks/app/companies/[slug]/page-1.js',
    ]);
    expect(assets.stylesheets).toEqual(['static/css/a.css']);
    expect(assets.fonts).toEqual(['static/media/inter.woff2']);
  });

  it('ignores markup that only appears inside script contents', () => {
    expect(extractPageAssets(html).scripts).not.toContain('static/chunks/fake.js');
    expect(extractPageAssets(html).hasEnquiryForm).toBe(false);
  });

  it('detects the enquiry form by marker or by a form element', () => {
    expect(extractPageAssets('<div data-enquiry-router data-default-intent="general"></div>').hasEnquiryForm).toBe(true);
    expect(extractPageAssets('<section><form class="x"><textarea></textarea></form></section>').hasEnquiryForm).toBe(true);
    expect(extractPageAssets('<section><p>No form here</p></section>').hasEnquiryForm).toBe(false);
  });

  it('maps prerendered HTML files to routes', () => {
    expect(routeFromHtmlPath('index.html')).toBe('/');
    expect(routeFromHtmlPath('about.html')).toBe('/about');
    expect(routeFromHtmlPath('_not-found.html')).toBe('/_not-found');
    expect(routeFromHtmlPath('companies/westsides-company.html')).toBe('/companies/westsides-company');
    expect(routeFromHtmlPath('services\\fuel-and-lubricants.html')).toBe('/services/fuel-and-lubricants');
  });

  it('maps asset URLs to .next-relative paths', () => {
    expect(staticAssetPath('/_next/static/css/a.css?dpl=1#x')).toBe('static/css/a.css');
    expect(staticAssetPath('/_next/static/chunks/app/%5Bslug%5D/page.js')).toBe('static/chunks/app/[slug]/page.js');
    expect(staticAssetPath('/images/hero.webp')).toBeNull();
  });

  it('parses start tags with quoted ">" values, unquoted values, entities and comments', () => {
    const tags = [
      ...iterateStartTags('<!-- <div style="opacity:0"> --><a title="a > b" href=/x data-x=&quot;y>t</a><img alt="&quot;q&quot; &amp; r">'),
    ];
    expect(tags.map((t) => t.name)).toEqual(['a', 'img']);
    expect(tags[0]?.attrs).toEqual({ title: 'a > b', href: '/x', 'data-x': '"y' });
    expect(tags[1]?.attrs.alt).toBe('"q" & r');
  });

  it('parses the shared checker flags', () => {
    expect(parseCheckerArgs(['--report-only', '--dist', 'out/.next', '--json=r.json', '--nope'])).toEqual({
      reportOnly: true,
      dist: 'out/.next',
      json: 'r.json',
      root: null,
      unknown: ['--nope'],
    });
  });
});

describe('budgets', () => {
  type Page = Parameters<typeof evaluateBudgets>[0]['pages'][number];
  const page = (route: string, extra: Partial<Page> = {}): Page => ({
    route,
    scripts: ['framework.js', 'layout.js', `${route}.js`],
    stylesheets: ['site.css'],
    fonts: [],
    hasEnquiryForm: false,
    htmlGzip: 10_000,
    ...extra,
  });
  const sizes: Record<string, number> = {
    'framework.js': 60_000,
    'layout.js': 20_000,
    '/.js': 10_000,
    '/about.js': 16_000,
    '/contact.js': 20_000,
    '/company-profile.js': 24_000,
    'site.css': 12_000,
    'big.css': 25_000,
    'a.woff2': 40_000,
    'b.woff2': 40_000,
    'c.woff2': 30_000,
  };

  it('measures the scripts every page shares, and each route on top of them', () => {
    const report = evaluateBudgets({ pages: [page('/'), page('/about'), page('/contact')], sizes });
    expect(report.sharedJs.files.map((f) => f.file)).toEqual(['framework.js', 'layout.js']);
    expect(report.sharedJs.bytes).toBe(80_000);
    const about = report.rows.find((r) => r.route === '/about')!;
    expect(about.routeJs).toBe(16_000);
    expect(about.firstLoadJs).toBe(96_000);
    expect(about.css).toBe(12_000);
  });

  it('gives the 25 kB route allowance to enquiry pages and /company-profile only', () => {
    const report = evaluateBudgets({
      pages: [page('/'), page('/about'), page('/contact', { hasEnquiryForm: true }), page('/company-profile')],
      sizes,
    });
    const limit = (route: string) => report.rows.find((r) => r.route === route)!.routeJsLimit;
    expect(limit('/')).toBe(BUDGETS.routeJs);
    expect(limit('/contact')).toBe(BUDGETS.routeJsLarge);
    expect(limit('/company-profile')).toBe(BUDGETS.routeJsLarge);
    // /about's 16 kB is over 15 kB; /contact's 20 kB and /company-profile's 24 kB fit 25 kB.
    expect(report.violations.map((v) => `${v.metric} ${v.route}`)).toEqual(['route-js /about']);
  });

  it('flags shared JS, CSS, fonts, HTML and unmeasured sitemap routes', () => {
    const report = evaluateBudgets({
      pages: [
        page('/', { stylesheets: ['site.css', 'big.css'], fonts: ['a.woff2', 'b.woff2', 'c.woff2'], htmlGzip: 41_000 }),
        page('/company-profile', { htmlGzip: 89_000 }),
      ],
      sizes: { ...sizes, 'framework.js': 100_000 },
      expectedRoutes: ['/', '/company-profile', '/faq'],
    });
    expect(report.violations.map((v) => `${v.metric} ${v.route ?? ''}`.trim()).sort()).toEqual(
      ['coverage /faq', 'css /', 'font-bytes /', 'font-files /', 'html /', 'shared-js'].sort(),
    );
  });

  it('passes a build that is inside every budget', () => {
    const report = evaluateBudgets({ pages: [page('/'), page('/contact', { hasEnquiryForm: true })], sizes, expectedRoutes: ['/', '/contact'] });
    expect(report.violations).toEqual([]);
    expect(formatBudgetTable(report)).toContain('Shared first-load JS: 80.0 kB / 110.0 kB');
    expect(formatBudgetMarkdown(report, { reportOnly: true })).toContain('0 violation(s).');
  });

  it('refuses to guess: no pages or an unmeasured asset is an error', () => {
    expect(() => evaluateBudgets({ pages: [], sizes })).toThrow(/no prerendered pages/);
    expect(() => evaluateBudgets({ pages: [page('/missing-size')], sizes })).toThrow(/no size recorded/);
  });
});

describe('html scan: inline opacity 0', () => {
  it('recognises every spelling of a zero opacity', () => {
    for (const v of ['0', ' 0 ', '0.0', '.0', '-0', '+0', '0%', '0 !important', '00.00']) expect(isZeroOpacity(v)).toBe(true);
    for (const v of ['1', '0.5', '0.001', '.01', 'var(--o)', 'calc(0)', '']) expect(isZeroOpacity(v)).toBe(false);
  });

  it('splits declarations without breaking quoted or bracketed values', () => {
    expect(splitDeclarations('background:url("a;b.png");opacity:0; ;color:red')).toEqual([
      'background:url("a;b.png")',
      'opacity:0',
      'color:red',
    ]);
  });

  it('finds framer-motion style SSR output and other zero opacities', () => {
    const html =
      '<div style="opacity:0;transform:translateY(12px)"><h1 class="x" style="OPACITY: .0 !important">T</h1></div>' +
      "<p style='color:red; opacity:0%'>p</p>";
    const hits = findInlineZeroOpacity(html);
    expect(hits.map((h) => h.tag)).toEqual(['div', 'h1', 'p']);
    expect(hits[0]?.snippet).toBe('<div style="opacity:0;transform:translateY(12px)">');
  });

  it('leaves visible styles, other properties, scripts, styles and comments alone', () => {
    const html = [
      '<div style="opacity:1"></div>',
      '<div style="opacity:0.4;transition:opacity 0s"></div>',
      '<svg><path style="fill-opacity:0;stroke-opacity:0" opacity="0"></path></svg>',
      '<div style="--reveal-opacity:0"></div>',
      '<style>@keyframes r{from{opacity:0}}[data-reveal]{opacity:0}</style>',
      '<script>self.__next_f.push([1,"<div style=\\"opacity:0\\">"])</script>',
      '<!-- <div style="opacity:0"> -->',
      '<noscript><p style="opacity:1">ok</p></noscript>',
    ].join('');
    expect(findInlineZeroOpacity(html)).toEqual([]);
  });

  it('still scans noscript content, which no-JS visitors see', () => {
    expect(findInlineZeroOpacity('<noscript><p style="opacity:0">hidden</p></noscript>')).toHaveLength(1);
  });
});

describe("client components: 'use client' directive", () => {
  it('detects the directive in the prologue in every legal form', () => {
    for (const src of [
      "'use client'\nimport x from 'y';",
      '"use client";\nexport default 1;',
      "// Button island\n/* multi\n line */\n'use client';\nexport {};",
      "'use strict';\n'use client'\nexport {};",
      `${BOM}'use client';`,
      "#!/usr/bin/env node\n'use client';",
      "'use client'",
      "/** doc */ 'use client' // trailing comment\nexport {};",
    ]) {
      expect(hasUseClientDirective(src), src).toBe(true);
    }
  });

  it('ignores mentions that are not a directive', () => {
    for (const src of [
      "import x from 'y';\n'use client';",
      "// 'use client'\nexport {};",
      "/* 'use client' */\nexport {};",
      "'use client'.length;",
      "'use client' + suffix;",
      "'use client'\n.concat('x');",
      "'use server';\nexport async function act() {}",
      "'use  client';",
      "const s = 'use client';",
      '',
    ]) {
      expect(hasUseClientDirective(src), src).toBe(false);
    }
  });

  it('allows islands, the frozen client files and Next error boundaries only', () => {
    for (const p of [
      'src/islands/EnquiryRouter.tsx',
      'src/islands/nav/SiteNav.tsx',
      'src/components/ConversionTracker.tsx',
      'src/components/CompanyProfilePrintScope.tsx',
      'src/app/error.tsx',
      'src/app/company-profile/error.tsx',
      'src/app/global-error.tsx',
      'src\\islands\\QuickContact.tsx',
    ]) {
      expect(isClientAllowed(p), p).toBe(true);
    }
    for (const p of [
      'src/app/page.tsx',
      'src/components/Navbar.tsx',
      'src/components/PrintProfileButton.tsx',
      'src/ui/Button.tsx',
      'src/islandsX/Thing.tsx',
      'src/app/error-page.tsx',
      'src/app/about/global-error.tsx',
      'islands/Thing.tsx',
    ]) {
      expect(isClientAllowed(p), p).toBe(false);
    }
  });
});

describe('checker CLIs against a fake build', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'itemba-build-checks-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const write = (rel: string, content: string) => {
    const full = path.join(tmp, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const run = (script: string, args: string[]) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });

  const dist = path.join(tmp, 'dist');
  const doc = (body: string) =>
    `<html><head><script src="/_next/static/chunks/main.js" async=""></script></head><body>${body}</body></html>`;
  write('dist/static/chunks/main.js', 'console.log(1);');
  write('dist/server/app/index.html', doc('<main><h1>Home</h1></main>'));
  write('dist/server/app/about.html', doc('<main><div style="opacity:0"><h1>About</h1></div></main>'));

  it('lists the prerendered pages', () => {
    expect(listBuiltHtml(dist).map((p) => p.route)).toEqual(['/', '/about']);
  });

  it('check-html fails on findings, passes with --report-only, and errors without a build', () => {
    const strict = run('check-html.mjs', ['--dist', dist]);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toContain('/about (about.html): 1');
    expect(run('check-html.mjs', ['--dist', dist, '--report-only']).status).toBe(0);
    expect(run('check-html.mjs', ['--dist', path.join(tmp, 'missing'), '--report-only']).status).toBe(2);
  });

  it('check-budgets reports unmeasured sitemap routes and honours --report-only', () => {
    const strict = run('check-budgets.mjs', ['--dist', dist, '--json', path.join(tmp, 'budgets.json')]);
    expect(strict.status).toBe(1);
    // Only / and /about exist in the fake build; the other sitemap URLs are unmeasured.
    expect(strict.stdout).toContain(`${SITEMAP_PATHS.length - 2} violation(s)`);
    expect(run('check-budgets.mjs', ['--dist', dist, '--report-only']).status).toBe(0);
    expect(run('check-budgets.mjs', ['--dist', path.join(tmp, 'missing')]).status).toBe(2);
  });

  it('check-budgets treats a page that references a missing asset as a broken build', () => {
    write('broken/server/app/index.html', doc(''));
    expect(run('check-budgets.mjs', ['--dist', path.join(tmp, 'broken'), '--report-only']).status).toBe(2);
  });

  it('check-client-allowlist flags client modules outside the allowlist', () => {
    write('site/src/islands/Nav.tsx', "'use client';\nexport default function Nav() { return null; }\n");
    write('site/src/ui/Card.tsx', "// server component; never 'use client'\nexport const Card = 1;\n");
    write('site/src/components/Legacy.tsx', '"use client"\nexport default 1;\n');
    const strict = run('check-client-allowlist.mjs', ['--root', path.join(tmp, 'site')]);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toContain('- src/components/Legacy.tsx');
    expect(strict.stdout).not.toContain('- src/ui/Card.tsx');
    expect(run('check-client-allowlist.mjs', ['--root', path.join(tmp, 'site'), '--report-only']).status).toBe(0);
  });
});
