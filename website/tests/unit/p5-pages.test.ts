/**
 * Page group P5: /capabilities and /partnerships, the Apple support-style
 * pages. Server-rendered markup contracts:
 *
 * - Metadata through pageMetadata: the baseline title, canonical and
 *   og:url, the origin/main description and og copy, twitter from og.
 * - One h1 with the lead line verbatim; no skipped heading levels.
 * - JSON-LD: the baseline CollectionPage / WebPage @id with its ItemList
 *   (six services / four routes), the FAQPage matching the visible
 *   questions, and one BreadcrumbList matching the visible trail.
 * - The full EnquiryRouter (name and organisation fields), general by
 *   default, inside #enquire, with the page's own title; every in-page
 *   link lands on an id that exists.
 * - Photography discipline: at most one photograph, none a canopy, none
 *   repeated; no text in a data-reveal block; nothing at opacity 0; no
 *   manufacturing sector; one cinema tile and the tone rhythm (the last tile white).
 * - General Enquire actions never point at /partnerships from /capabilities
 *   except the named partnership-routes link.
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked
 * for the EnquiryRouter island.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { capabilitiesPage, partnerChecklist, verificationSignals } from '@/content/capabilities';
import { enquiryPrompts } from '@/content/enquiry';
import { partnershipFaqs } from '@/content/faqs';
import { getMedia, media, type MediaId } from '@/content/media';
import { partnershipAreas, partnershipsPage } from '@/content/partnerships';
import { serviceAreas } from '@/content/services';
import { absoluteUrl } from '@/content/site';
import { headlineText } from '@/content/types';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/capabilities',
}));

const CapabilitiesModule = await import('@/app/capabilities/page');
const PartnershipsModule = await import('@/app/partnerships/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1] ?? 'null') as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  });
const photos = (html: string) =>
  [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)]
    .map((m) => {
      const src = decode(m[1] ?? '');
      return src.startsWith('/_next/image') ? (new URL(src, 'http://x').searchParams.get('url') ?? '') : src;
    })
    .filter((src) => src.startsWith('/images/'));
const idBySrc = new Map(Object.entries(media).map(([id, entry]) => [entry.src as string, id as MediaId]));
/** Heading levels in document order. */
const outline = (html: string) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
/** data-tone of each top-level tile (<section> or the trail's div), in order. */
const tones = (html: string) => [...html.matchAll(/<section\b[^>]*data-tone="(light|alt|cinema)"/g)].map((m) => m[1]);

type PageCase = {
  path: string;
  module: typeof CapabilitiesModule;
  h1: string;
  meta: { title: string; description: string; ogTitle: string; ogDescription: string };
  pageType: string;
  pageId: string;
  items: number;
  routerTitle: string;
  crumbName: string;
};

const cases: PageCase[] = [
  {
    path: '/capabilities',
    module: CapabilitiesModule,
    h1: headlineText(capabilitiesPage.hero.headline),
    meta: capabilitiesPage.meta,
    pageType: 'CollectionPage',
    pageId: `${absoluteUrl('/capabilities')}#capabilities`,
    items: serviceAreas.length,
    routerTitle: enquiryPrompts.capabilities.title,
    crumbName: 'Capabilities',
  },
  {
    path: '/partnerships',
    module: PartnershipsModule,
    h1: headlineText(partnershipsPage.hero.headline),
    meta: partnershipsPage.meta,
    pageType: 'WebPage',
    pageId: `${absoluteUrl('/partnerships')}#partnerships`,
    items: partnershipAreas.length,
    routerTitle: enquiryPrompts.partnerships.title,
    crumbName: 'Partnerships',
  },
];

describe.each(cases)('$path', (page) => {
  const html = renderToStaticMarkup(h(page.module.default));
  const text = textOf(html);
  const ld = jsonLd(html);

  it('keeps the baseline metadata through pageMetadata', () => {
    const { metadata } = page.module;
    expect(metadata.title).toBe(page.meta.title);
    expect(metadata.description).toBe(page.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(page.path));
    expect(metadata.openGraph).toMatchObject({ title: page.meta.ogTitle, description: page.meta.ogDescription, url: absoluteUrl(page.path) });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('has one h1, the lead line verbatim, and never skips a heading level', () => {
    expect(tags(html, 'h1')).toEqual([page.h1]);
    const levels = outline(html);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `h${levels[i - 1]} then h${levels[i]}`).toBeLessThanOrEqual(1);
  });

  it('keeps the baseline JSON-LD entity with its list, and one BreadcrumbList matching the trail', () => {
    const entity = ld.find((block) => block['@id'] === page.pageId);
    expect(entity?.['@type']).toBe(page.pageType);
    expect(entity?.about).toEqual({ '@id': `${absoluteUrl('/')}#organization` });
    const list = entity?.mainEntity as { itemListElement: Array<{ url: string }> } | undefined;
    expect(list?.itemListElement).toHaveLength(page.items);
    const crumbs = ld.filter((block) => block['@type'] === 'BreadcrumbList');
    expect(crumbs).toHaveLength(1);
    const items = (crumbs[0]?.itemListElement ?? []) as Array<{ name: string; item: string }>;
    expect(items.map((item) => [item.name, item.item])).toEqual([
      ['Home', absoluteUrl('/')],
      [page.crumbName, absoluteUrl(page.path)],
    ]);
    // The visible trail says the same.
    const trail = html.match(/<nav[^>]*aria-label="Breadcrumb"[\s\S]*?<\/nav>/i)?.[0] ?? '';
    expect(textOf(trail)).toContain(page.crumbName);
  });

  it('places the full enquiry form, general by default, inside #enquire', () => {
    const section = html.match(/<section[^>]*id="enquire"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('data-enquiry-router=""');
    expect(section).toContain('data-default-intent="general"');
    expect(section).toContain('name="organization"');
    expect(textOf(section)).toContain(page.routerTitle);
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    // The no-JS guard: the submit button is disabled in the server HTML.
    expect(section).toMatch(/<button type="submit" disabled=""/);
  });

  it('lands every in-page link on an id that exists', () => {
    const present = ids(html);
    const fragments = hrefs(html).filter((href) => href.startsWith('#')).map((href) => href.slice(1));
    expect(fragments.length).toBeGreaterThan(4);
    for (const fragment of fragments) expect(present.has(fragment), `#${fragment}`).toBe(true);
  });

  it('uses photography sparingly: at most one photograph, not a canopy, never repeated', () => {
    const shown = photos(html);
    expect(shown.length).toBeLessThanOrEqual(1);
    expect(new Set(shown).size).toBe(shown.length);
    for (const src of shown) expect(getMedia(idBySrc.get(src)!).canopy, src).toBeFalsy();
  });

  it('keeps the tone rhythm: a light hero, one cinema tile never beside another, a light last tile', () => {
    const order = tones(html);
    expect(order[0]).toBe('light');
    expect(order.at(-1)).toBe('light');
    expect(order.filter((tone) => tone === 'cinema')).toHaveLength(1);
    for (let i = 1; i < order.length; i++) {
      if (order[i] !== 'cinema' && order[i - 1] !== 'cinema') expect(order[i], `tile ${i}`).not.toBe(order[i - 1]);
    }
  });

  it('renders nothing hidden, animates only photographs and never mentions manufacturing', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    // The sector (flags.mentionManufacturing); the suppliers route's third-party "manufacturers" is verbatim copy.
    expect(text).not.toMatch(/manufacturing/i);
    for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
      expect(textOf(block[1] ?? '')).toBe('');
    }
  });
});

describe('/capabilities content', () => {
  const html = renderToStaticMarkup(h(CapabilitiesModule.default));
  const text = textOf(html);

  it('shows the four verification signals, the six services with their owners, and the partner checklist', () => {
    for (const signal of verificationSignals) expect(tags(html, 'h3')).toContain(signal.title);
    for (const service of serviceAreas) {
      expect(tags(html, 'h3')).toContain(service.title);
      expect(hrefs(html)).toContain(`/services/${service.slug}`);
      expect(hrefs(html)).toContain(`/companies/${service.companySlug}`);
    }
    for (const item of partnerChecklist) expect(text).toContain(item);
  });

  it('offers the group profile PDF and the two profiles to read first', () => {
    expect(html).toMatch(/href="\/downloads\/itemba-group-profile\.pdf"[^>]*download=""|download=""[^>]*href="\/downloads\/itemba-group-profile\.pdf"/);
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/company-profile', '/locations/songwe-tunduma', '/partnerships']));
  });
});

describe('/partnerships content', () => {
  const html = renderToStaticMarkup(h(PartnershipsModule.default));

  it('shows the four routes, each an anchor the hero shortcuts and the WebPage list point at', () => {
    const present = ids(html);
    for (const area of partnershipAreas) {
      expect(present.has(area.id), area.id).toBe(true);
      expect(tags(html, 'h3')).toContain(area.title);
      expect(hrefs(html)).toContain(`#${area.id}`);
    }
    const page = jsonLd(html).find((block) => block['@type'] === 'WebPage');
    const list = (page?.mainEntity as { itemListElement: Array<{ url: string }> }).itemListElement;
    expect(list.map((item) => item.url)).toEqual(partnershipAreas.map((area) => absoluteUrl(`/partnerships#${area.id}`)));
  });

  it('shows how enquiries move in four steps, with the anchor the capability page links to', () => {
    expect(ids(html).has('how-enquiries-move')).toBe(true);
    for (const step of partnershipsPage.process.steps) expect(tags(html, 'h3')).toContain(step.title);
    const capabilities = renderToStaticMarkup(h(CapabilitiesModule.default));
    expect(hrefs(capabilities)).toContain('/partnerships#how-enquiries-move');
  });

  it('lists exactly the questions its FAQPage carries', () => {
    const faq = jsonLd(html).find((block) => block['@type'] === 'FAQPage');
    const questions = (faq?.mainEntity as Array<{ name: string }>).map((q) => q.name);
    expect(questions).toEqual(partnershipFaqs.map((q) => q.question));
    expect(html.match(/<details\b/g)).toHaveLength(partnershipFaqs.length);
  });
});
