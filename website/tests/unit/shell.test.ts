/**
 * The site shell (WP1.2b): server-rendered markup contracts for the global
 * nav, the footer and the quick-contact bar, and the print stylesheet's
 * shape-independent rules.
 *
 * - QuickContact keeps origin/main's route matrix and contact targets
 *   (checked against tests/baseline/routes.json for all 25 URLs).
 * - The nav marks the current section, and its mobile menu is a native
 *   popover the menu button opens without JavaScript.
 * - The footer links the whole site with contact hrefs from src/content.
 * - print.css hides site chrome by class and keeps every hook the PDF script
 *   and the print documents rely on.
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contact } from '@/content/contact';
import { footerDirectory, headerCta, headerLinks, shellCopy } from '@/content/nav';
import { normaliseContactHref } from '../e2e/support/baseline';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const { default: QuickContact, hasInlineEnquiry } = await import('@/islands/QuickContact');
const { SiteHeader } = await import('@/shell/SiteHeader');
const { SiteFooter, FooterTrail } = await import('@/shell/SiteFooter');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

type BaselineRoutes = Record<string, { quickContact: { present: boolean; links: { href: string }[] } }>;
const baselineRoutes = JSON.parse(read('tests/baseline/routes.json')) as BaselineRoutes;

/** Every href in the markup, entity-decoded. */
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(([, href = '']) => href.replace(/&amp;/g, '&'));

beforeEach(() => {
  route.pathname = '/';
});

describe('QuickContact bar', () => {
  it.each(Object.keys(baselineRoutes))('%s keeps the origin/main visibility and targets', (pathname) => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(h(QuickContact));
    const expected = baselineRoutes[pathname]!.quickContact;

    expect(html.includes('data-quick-contact'), `bar on ${pathname}`).toBe(expected.present);
    expect(hasInlineEnquiry(pathname)).toBe(!expected.present);
    if (!expected.present) {
      expect(html).toBe('');
      return;
    }
    const got = new Set(hrefsOf(html).map(normaliseContactHref));
    for (const link of expected.links) expect(got, link.href).toContain(normaliseContactHref(link.href));
  });

  it('is a slim phone-only bar: Call, WhatsApp and Email as quiet actions, then the Enquire pill to the form', () => {
    const html = renderToStaticMarkup(h(QuickContact));
    expect(html).toMatch(/<aside aria-label="Quick contact" data-quick-contact="" data-print="hide" class="fixed [^"]*md:hidden/);
    expect(html).toContain(`href="tel:${contact.primaryPhone}"`);
    expect(html).toContain('>Call<');
    expect(html).toContain('>WhatsApp<');
    // Email keeps the mailto: ConversionTracker counts, as a quiet action (not a pill).
    expect(html).toMatch(/<a href="mailto:[^"]*" aria-label="Email Itemba Group" class="[^"]*"><svg[\s\S]*?<\/svg><span>Email<\/span><\/a>/);
    expect(html).not.toMatch(/<a href="mailto:[^"]*"[^>]*rounded-pill/);
    // The one pill (plan: Call · WhatsApp · Enquire) is Enquire, to the enquiry form, last in the bar.
    const pills = [...html.matchAll(/<a [^>]*class="[^"]*rounded-pill[^"]*"[^>]*>([^<]*)<\/a>/g)];
    expect(pills.map((m) => m[1])).toEqual([headerCta.label]);
    expect(html).toMatch(new RegExp(`<a class="[^"]*rounded-pill[^"]*" href="${headerCta.href}">${headerCta.label}</a></div></aside>$`));
    expect(headerCta.href).toBe('/contact');
    expect(html).toMatch(/^<div aria-hidden="true" data-print="hide" class="h-\[calc\(var\(--quickbar-height\)/);
    expect(html).not.toMatch(/opacity:\s*0/);
  });
});

describe('SiteHeader', () => {
  it('renders the crest, the seven primary links in order and the Enquire pill', () => {
    const html = renderToStaticMarkup(h(SiteHeader));
    // Nothing before the header: in particular no image preload for the crest.
    expect(html).toMatch(/^<header class="site-header material-nav sticky top-0 z-nav">/);
    const crest = html.match(/<img [^>]*>/)?.[0] ?? '';
    expect(crest).toContain('loading="eager"');
    expect(crest).toMatch(/fetchPriority="low"/i);
    expect(crest).toContain('w=96');
    // The nav mark (the shield and ITEMBA): the full lockup's GROUP line would be about 5px tall here.
    expect(crest).toContain('logo-nav.png');
    expect(crest).toContain('height="30"');
    expect(html).toContain(`<nav aria-label="${shellCopy.navLabel}"`);
    expect(html).toMatch(/<a aria-label="Itemba Group home" class="[^"]*" href="\/">/);

    const bar = html.slice(html.indexOf('site-nav-links'), html.indexOf('site-menu-toggle'));
    const barLinks = [...bar.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map(([, href, label]) => ({ href, label }));
    expect(barLinks.slice(0, headerLinks.length)).toEqual(headerLinks.map(({ href, label }) => ({ href, label })));
    expect(bar).toContain(`href="${headerCta.href}"`);
    expect(bar).toContain(`>${headerCta.label}<`);
  });

  it('opens the mobile menu as a native popover, with no script needed', () => {
    const html = renderToStaticMarkup(h(SiteHeader));
    // React writes popoverTarget in camel case; HTML attribute names are case-insensitive.
    expect(html).toMatch(/<button type="button" popovertarget="site-menu" aria-label="Menu"/i);
    expect(html).toMatch(/<div id="site-menu" popover="auto" data-tone="light" class="site-menu">/);
    expect(html).toMatch(/popovertarget="site-menu" popovertargetaction="hide" aria-label="Close menu"/i);
    const sheet = html.slice(html.indexOf('id="site-menu"'));
    for (const link of headerLinks) expect(sheet).toContain(`href="${link.href}"`);
    // The popover element never sets its own display (the UA hides it while closed).
    expect(html).not.toMatch(/popover="auto"[^>]*class="[^"]*\b(?:flex|block|grid)\b/);
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it.each([
    ['/about', '/about'],
    ['/companies/westsides-company', '/companies'],
    ['/services/fuel-and-lubricants', '/services'],
    ['/company-profile', '/company-profile'],
  ])('%s marks %s as the current section in the bar and the sheet', (pathname, current) => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(h(SiteHeader));
    const marked = [...html.matchAll(/<a aria-current="page"[^>]*href="([^"]+)"/g)].map(([, href]) => href);
    expect(marked).toEqual([current, current]);
  });

  it('marks nothing current on home', () => {
    expect(renderToStaticMarkup(h(SiteHeader))).not.toContain('aria-current');
  });
});

describe('SiteFooter', () => {
  const html = renderToStaticMarkup(h(SiteFooter));
  const hrefs = new Set(hrefsOf(html));

  it('is the Apple-dense 12px footer on the alt tile', () => {
    expect(html).toMatch(/^<footer data-tone="alt" class="site-footer text-legal text-fg-muted">/);
    expect(html).toContain(`<nav aria-label="${footerDirectory.label}">`);
    expect(html).toContain(`Copyright © ${new Date().getFullYear()} Itemba Group. All rights reserved.`);
    expect(html).toContain('www.itembagrouptz.com');
    // Short names: each company's registered name appears on its own page.
    expect(html).toContain('Mwanjalisi Oil, Westsides and Itemba Enterprises are legally independent companies of Itemba Group.');
    // The shield-and-ITEMBA mark, 30px tall: the full lockup's GROUP line would be about 3px at footer size.
    const crest = html.match(/<img [^>]*>/)?.[0] ?? '';
    expect(crest).toContain('logo-nav.png');
    expect(crest).toContain('height="30"');
  });

  it('sets its directory labels in sentence case', () => {
    const labels = [...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1] ?? '');
    expect(labels).toContain('Company profile');
    expect(labels).toContain('Fuel supply');
    expect(labels).toContain('Real estate');
    // Only proper nouns are capitalised after the first word.
    const properNouns = /^(?:Itemba|Group|Songwe|Tunduma|Mwanjalisi|Oil|Westsides|Enterprises|FAQ|WhatsApp)$/;
    for (const label of new Set(labels)) {
      const [, ...rest] = label.split(/[\s-]+/);
      for (const word of rest) if (/^[A-Z]/.test(word)) expect(word, label).toMatch(properNouns);
    }
  });

  it('links every section of the site', () => {
    for (const href of [
      '/',
      '/about',
      '/capabilities',
      '/partnerships',
      '/locations',
      '/locations/songwe-tunduma',
      '/companies',
      '/companies/mwanjalisi-oil',
      '/companies/westsides-company',
      '/companies/itemba-enterprises',
      '/services',
      '/services/fuel-and-lubricants',
      '/services/trade-and-distribution',
      '/services/logistics-and-cross-border-transit',
      '/services/construction-supplies-and-hardware',
      '/services/hospitality-and-lodging',
      '/services/real-estate-and-property',
      '/insights',
      '/company-profile',
      '/faq',
      '/contact',
    ]) {
      expect(hrefs, href).toContain(href);
    }
  });

  it('uses the content contact targets that ConversionTracker classifies', () => {
    expect(hrefs).toContain(`tel:${contact.primaryPhone}`);
    expect(hrefs).toContain(contact.whatsapp);
    expect([...hrefs].some((href) => href.startsWith(`mailto:${contact.email}?subject=`))).toBe(true);
    expect(html).toMatch(/href="https:\/\/www\.google\.com\/maps\?q=[^"]+" target="_blank" rel="noopener noreferrer"/);
  });

  it('has column headings on wide screens and disclosure rows on phones', () => {
    expect(html.match(/<h2 /g)).toHaveLength(5);
    expect(html.match(/<details /g)).toHaveLength(5);
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it('FooterTrail draws the page trail and its BreadcrumbList from the same items', () => {
    const trail = renderToStaticMarkup(
      h(FooterTrail, {
        items: [
          { name: 'Home', path: '/' },
          { name: 'Companies', path: '/companies' },
        ],
      }),
    );
    expect(trail).toMatch(/^<div data-tone="alt" data-print="hide">/);
    expect(trail).toContain('<nav aria-label="Breadcrumb">');
    expect(trail).toContain('"@type":"BreadcrumbList"');
  });
});

describe('print.css', () => {
  const css = read('src/styles/print.css');
  const printBlock = css.slice(css.indexOf('@media print'));

  it('no longer depends on a wrapper inside <main>', () => {
    expect(css).not.toMatch(/#main-content\s*>\s*div/);
    expect(printBlock).toMatch(
      /#main-content\s*:not\(\.print-document-root, \.print-document-root \*, :has\(\.print-document-root\)\)\s*\{\s*display: none !important;/,
    );
  });

  it('hides site chrome by class or marker, not by element name', () => {
    const chrome = printBlock.match(/\n  \.site-header,[\s\S]*?\{\s*display: none !important;\s*\}/)?.[0] ?? '';
    for (const selector of ['.site-header', '.site-footer', '[data-subnav]', "[data-print='hide']", '.print-hidden', '.skip-link', '.fixed']) {
      expect(chrome, selector).toContain(selector);
    }
    expect(printBlock).not.toMatch(/\n  header,\n|\n  footer,\n/);
  });

  it('keeps the print hooks the PDF script and the pages set', () => {
    for (const hook of [
      "body[data-print-scope='company-profile']",
      'body.printing-company-profile',
      'body[data-print-profile]',
      "body[data-print-scope='company-profile']:not([data-print-profile]) .print-profile-document[data-profile='group']",
    ]) {
      expect(printBlock, hook).toContain(hook);
    }
    for (const id of ['group', 'westsides', 'mwanjalisi', 'enterprises']) {
      expect(printBlock).toContain(`body.printing-company-profile[data-print-profile='${id}'] .print-profile-document[data-profile='${id}']`);
      expect(printBlock).toContain(`body[data-print-profile='${id}'] .print-profile-document[data-profile='${id}']`);
    }
    expect(css).toMatch(/^\.print-document-root \{\s*display: none;/m);
  });

  it('styles every print-* class the print documents use', () => {
    const used = new Set([...read('src/print/ProfileDocuments.tsx').matchAll(/\bprint-[a-z-]+/g)].map(([name]) => name));
    used.delete('print-document-root'); // styled outside the print block
    for (const name of used) expect(printBlock, name).toContain(`.${name}`);
    expect(used.has('print-cover-title')).toBe(true);
  });
});
