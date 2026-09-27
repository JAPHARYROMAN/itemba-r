/**
 * /company-profile (page group P6): the annual-report screen view and the
 * print documents behind it. Server-rendered markup contracts:
 *
 * - metadata through pageMetadata (the baseline title, canonical and copy);
 * - one h1; the 17 outline ids on the page, in outline order, as the
 *   contents sheet lists them; the sticky sub-nav with the ProfileNav island
 *   and an Enquire pill whose target exists;
 * - the four committed PDFs as download links, and the print picker;
 * - one compact EnquiryRouter (print-hidden, general) at #enquire;
 * - JSON-LD: the AboutPage (#profile) about the group, the FAQPage of the
 *   questions shown, and one BreadcrumbList matching the visible trail;
 * - the print documents: one root, the four articles in picker order, every
 *   photo a lazy plain <img src="/images/…">, and no h1;
 * - photographs: nothing twice, at most two canopies, none of the retired
 *   frames, and nothing from the print documents shown through next/image
 *   in a way that would fetch a print path;
 * - tone rhythm: no two cinema tiles side by side, light before the footer;
 * - history in chronological order; nothing at opacity 0; no manufacturing;
 *   no text inside a data-reveal block.
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked
 * for the EnquiryRouter island.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { enquiryPrompts } from '@/content/enquiry';
import { groupFaqs } from '@/content/faqs';
import { flags } from '@/content/flags';
import { getMedia, media, type MediaId } from '@/content/media';
import {
  history,
  legalCompanyProfiles,
  outline,
  printableProfiles,
  printProfileOptions,
  profileCover,
  profileMeta,
  profilePdfHref,
} from '@/content/profile';
import { absoluteUrl, site } from '@/content/site';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/company-profile',
}));

const PageModule = await import('@/app/company-profile/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1] ?? 'null') as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  });
/** The /images/… photograph each <img> shows (next/image routes them through /_next/image?url=…). */
const photos = (html: string) =>
  [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)]
    .map((m) => {
      const src = decode(m[1] ?? '');
      return src.startsWith('/_next/image') ? (new URL(src, 'http://x').searchParams.get('url') ?? '') : src;
    })
    .filter((src) => src.startsWith('/images/'));
const repeated = (list: readonly string[]) => [...new Set(list.filter((item, index) => list.indexOf(item) !== index))];
const idBySrc = new Map(Object.entries(media).map(([id, entry]) => [entry.src as string, id as MediaId]));

const html = renderToStaticMarkup(h(PageModule.default));
const printStart = html.indexOf('<div class="print-document-root"');
/** The screen view: everything before the hidden print documents. */
const screen = html.slice(0, printStart);
const print = html.slice(printStart);

describe('/company-profile: metadata', () => {
  const { metadata } = PageModule;

  it('keeps the baseline title, canonical and copy, through pageMetadata', () => {
    expect(metadata.title).toBe(profileMeta.title);
    expect(metadata.description).toBe(profileMeta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/company-profile'));
    expect(metadata.openGraph).toMatchObject({
      title: profileMeta.ogTitle,
      description: profileMeta.ogDescription,
      url: absoluteUrl('/company-profile'),
      siteName: site.name,
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });
});

describe('/company-profile: the screen view', () => {
  it('has one h1, the two-tone title', () => {
    expect(tags(html, 'h1')).toEqual([`${profileCover.headline.lead} ${profileCover.headline.accent}`]);
  });

  it('carries the 17 outline ids, in outline order, each chapter titled by its h2', () => {
    const positions = outline.map((item) => screen.indexOf(` id="${item.id}"`));
    for (const [index, item] of outline.entries()) expect(positions[index], item.id).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const item of outline.slice(1)) {
      expect(screen, item.id).toMatch(new RegExp(`<section id="${item.id}" aria-labelledby="${item.id}-title"`));
      expect(tags(screen, 'h2')).toContain(item.title);
    }
  });

  it('has the sticky sub-nav with the contents sheet and an Enquire pill that lands on the form', () => {
    const subnav = screen.match(/<nav[^>]*data-subnav[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(subnav).toContain('aria-label="Company profile sections"');
    expect(subnav).toContain('class="profile-contents"');
    for (const item of outline) expect(hrefs(subnav)).toContain(`#${item.id}`);
    expect(hrefs(subnav)).toContain('#enquire');
    expect(screen).toContain(' id="enquire"');
  });

  it('offers the four PDFs as downloads, the group one as the hero pill, and the print picker', () => {
    for (const option of printProfileOptions) {
      expect(screen).toMatch(new RegExp(`href="${profilePdfHref(option.id)}"[^>]*download`));
    }
    const hero = screen.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hero).toMatch(new RegExp(`href="${profilePdfHref('group')}"[^>]*download`));
    expect(screen).toMatch(/<div class="print-hidden[^"]*"[^>]*>[\s\S]*?<select/);
    for (const option of printProfileOptions) expect(screen).toMatch(new RegExp(`<option value="${option.id}"`));
  });

  it('has one compact enquiry form at #enquire: general, print-hidden', () => {
    expect(screen.match(/data-enquiry-router=""/g)).toHaveLength(1);
    const enquire = screen.slice(screen.indexOf(' id="enquire"'));
    const form = /^[^>]*>\s*(<form\b[^>]*>)/.exec(enquire)?.[1] ?? '';
    expect(form).toContain('data-enquiry-router=""');
    expect(form).toMatch(/class="[^"]*\bprint-hidden\b/);
    expect(screen).toContain('data-default-intent="general"');
    expect(textOf(enquire)).toContain(enquiryPrompts.companyProfile.title);
  });

  it('publishes the legal identifiers (flags.publishLegalIdentifiers) and every group question', () => {
    expect(flags.publishLegalIdentifiers).toBe(true);
    const text = textOf(screen);
    for (const company of legalCompanyProfiles) {
      expect(text).toContain(company.tin);
      expect(text).toContain(company.incorporationNumber);
    }
    for (const faq of groupFaqs) expect(tags(screen, 'h3')).toContain(faq.question);
  });

  it('lists the history in chronological order', () => {
    const order = history.map((item) => item.date);
    expect(order.indexOf('2017 onward')).toBeGreaterThan(order.indexOf('9 June 2017'));
    const years = order.map((date) => Number(/\d{4}/.exec(date)?.[0]));
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    const text = textOf(screen);
    const positions = history.map((item) => text.indexOf(item.title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('keeps the tone rhythm: no two cinema tiles side by side, and white before the grey footer', () => {
    const tones = [...screen.matchAll(/<section\b[^>]*\bdata-tone="(light|alt|cinema)"/g)].map((m) => m[1]);
    expect(tones.length).toBeGreaterThanOrEqual(19);
    expect(tones.filter((tone) => tone === 'cinema')).toHaveLength(3);
    tones.forEach((tone, index) => {
      if (tone === 'cinema') expect(tones[index + 1], `section ${index + 1}`).not.toBe('cinema');
    });
    expect(tones.at(-1)).toBe('light');
  });

  it('shows each photograph once, at most two canopies, and never a retired frame', () => {
    const shown = photos(screen);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(repeated(shown)).toEqual([]);
    const ids = shown.map((src) => idBySrc.get(src)!);
    expect(ids.filter((id) => getMedia(id).canopy).length).toBeLessThanOrEqual(2);
    for (const retired of ['mpemba-coach-canopy', 'westsides-beer-delivery']) expect(ids).not.toContain(retired);
    // Every screen photograph goes through the optimiser: none is a plain /images/ request.
    expect(screen).not.toMatch(/<img\b[^>]*\ssrc="\/images\//);
    expect(photos(screen.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '')).toEqual([
      profileCover.image.src,
    ]);
  });

  it('matches its structured data to the page', () => {
    const ld = jsonLd(html);
    const about = ld.find((e) => e['@type'] === 'AboutPage');
    expect(about?.['@id']).toBe(`${absoluteUrl('/company-profile')}#profile`);
    expect(about?.about).toEqual({ '@id': `${absoluteUrl('/')}#organization` });
    const faqPage = ld.find((e) => e['@type'] === 'FAQPage');
    expect((faqPage?.mainEntity as unknown[]).length).toBe(groupFaqs.length);
    expect(screen.match(/<details\b/g)).toHaveLength(groupFaqs.length);
    const crumbs = ld.filter((e) => e['@type'] === 'BreadcrumbList');
    expect(crumbs).toHaveLength(1);
    const names = (crumbs[0]?.itemListElement as Array<{ name: string }>).map((item) => item.name);
    expect(names).toEqual(['Home', profileMeta.title]);
    const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(tags(trail, 'li')).toEqual(names);
  });

  it('renders nothing hidden, no manufacturing, and no text in a fade-up block', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    // (The beverage suppliers are "national manufacturers"; the group itself has no manufacturing line.)
    expect(textOf(screen)).not.toMatch(/manufacturing/i);
    for (const block of screen.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
      expect(textOf(block[1] ?? '').trim()).toBe('');
    }
  });
});

describe('/company-profile: the print documents', () => {
  it('keeps the root and the four articles, in picker order, after the screen view', () => {
    expect(html.match(/class="print-document-root"/g)).toHaveLength(1);
    expect(print).toMatch(/^<div class="print-document-root" aria-hidden="true">/);
    expect([...print.matchAll(/<article class="print-profile-document" data-profile="([^"]+)"/g)].map((m) => m[1])).toEqual(
      printableProfiles.map((p) => p.id),
    );
    expect(print).not.toMatch(/<h1\b/);
  });

  it('keeps every print photo a lazy, plain /images/ (or logo) <img>', () => {
    const imgs = [...print.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThan(8);
    for (const img of imgs) {
      expect(img).toContain('loading="lazy"');
      expect(img).toMatch(/src="(\/images\/[^"]+|\/logo-print\.png)"/);
    }
  });
});
