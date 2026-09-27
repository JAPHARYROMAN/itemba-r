/**
 * The /services page group (stage P2), server-rendered markup contracts:
 *
 * - /services: its metadata, one h1, every service grouped under the
 *   company that runs it (company h2s, service h3s), the CollectionPage
 *   with its baseline @id and the six service pages, the visible trail
 *   matching its BreadcrumbList, no enquiry form, and the closing call to
 *   action with the classified contact hrefs; general enquiries go to
 *   /contact, never /partnerships.
 * - /services/[slug]: the six slugs only; metadata and JSON-LD (Service
 *   under its company, FAQPage matching the visible questions, the trail);
 *   the sub-nav whose anchors all land; the form preset to service.intentId;
 *   the company behind it, linked; its sites or route; the tone rhythm.
 * - Photographs (owner decision): none repeats on a page; at most two
 *   canopies, except the stations' own cards on the fuel page; no retired,
 *   low-resolution, unconfirmed or third-party-branded frame in a hero;
 *   no stock estate imagery (flags.estateImagery); a typographic panel
 *   where no strong photograph exists.
 * - Nothing renders at opacity 0, no text sits in a fade-up block, and the
 *   pages never mention manufacturing.
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked
 * for the EnquiryRouter island.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { companies, getCompanyBySlug, isPhoto } from '@/content/companies';
import { contact } from '@/content/contact';
import { flags } from '@/content/flags';
import { getMedia, media, type MediaId } from '@/content/media';
import { profilePdfHref } from '@/content/profile/cover';
import { serviceAreas, servicesPage, siblingServices, type ServiceArea } from '@/content/services';
import { absoluteUrl, site } from '@/content/site';
import { headlineText } from '@/content/types';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/services',
}));

const IndexModule = await import('@/app/services/page');
const ServiceModule = await import('@/app/services/[slug]/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
const section = (html: string, labelledBy: string) =>
  html.match(new RegExp(`<section[^>]*aria-labelledby="${labelledBy}"[\\s\\S]*?</section>`))?.[0] ?? '';
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
const canopies = (srcs: readonly string[]) => srcs.filter((src) => getMedia(idBySrc.get(src)!).canopy);
/** Section tones in page order. */
const tones = (html: string) => [...html.matchAll(/<section\b[^>]*data-tone="(light|alt|cinema)"/g)].map((m) => m[1]);

/** Frames that may never lead a page: retired (hazy, tilted), low-resolution and unconfirmed, or third-party branded. */
const NEVER_A_HERO: readonly MediaId[] = [
  'mpemba-coach-canopy',
  'westsides-beer-delivery',
  'inn-lodge-room',
  'inn-bar-restaurant',
  'westsides-crates',
  'westsides-softdrinks',
];

function expectCalm(html: string) {
  expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
  expect(textOf(html)).not.toMatch(/manufactur/i);
  // Only photographs fade up: no text in a data-reveal block.
  for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
    expect(textOf(block[1] ?? '').trim()).toBe('');
  }
}

function expectTrail(html: string, names: readonly string[]) {
  const crumbs = jsonLd(html).filter((e) => e['@type'] === 'BreadcrumbList');
  expect(crumbs).toHaveLength(1);
  const listed = (crumbs[0]?.itemListElement as Array<{ name: string }>).map((item) => item.name);
  expect(listed).toEqual(names);
  const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
  expect(tags(trail, 'li')).toEqual(names);
}

describe('/services', () => {
  const html = renderToStaticMarkup(h(IndexModule.default));
  const text = textOf(html);

  it('keeps its metadata', () => {
    const { metadata } = IndexModule;
    expect(metadata.title).toBe(servicesPage.meta.title);
    expect(metadata.description).toBe(servicesPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/services'));
    expect(metadata.openGraph).toMatchObject({
      title: servicesPage.meta.ogTitle,
      description: servicesPage.meta.ogDescription,
      url: absoluteUrl('/services'),
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('has one h1, and every service under the company that runs it', () => {
    expect(tags(html, 'h1')).toEqual([headlineText(servicesPage.hero.headline)]);
    const companyHeadings = tags(html, 'h2');
    for (const company of companies) {
      const own = serviceAreas.filter((s) => s.companySlug === company.slug);
      expect(companyHeadings, company.slug).toContain(company.shortName);
      expect(hrefs(html)).toContain(`/companies/${company.slug}`);
      // The company's services follow its heading, before the next company's.
      const start = text.indexOf(company.shortName);
      for (const service of own) expect(text.indexOf(service.title, start), service.slug).toBeGreaterThan(start);
    }
    for (const service of serviceAreas) {
      expect(tags(html, 'h3')).toContain(service.title);
      expect(hrefs(html)).toContain(`/services/${service.slug}`);
      expect(text).toContain(service.lede);
    }
  });

  it('keeps the CollectionPage @id, lists the six services, and closes with the visible trail', () => {
    const page = jsonLd(html).find((e) => e['@type'] === 'CollectionPage');
    expect(page?.['@id']).toBe(`${absoluteUrl('/services')}#services`);
    expect(page?.about).toEqual({ '@id': `${absoluteUrl('/')}#organization` });
    const items = (page?.mainEntity as { itemListElement: Array<{ name: string; url: string }> }).itemListElement;
    expect(items.map((item) => item.url)).toEqual(serviceAreas.map((s) => absoluteUrl(`/services/${s.slug}`)));
    expectTrail(html, ['Home', 'Services']);
  });

  it('has no enquiry form, and sends general enquiries to /contact with WhatsApp and Call beside', () => {
    expect(html).not.toContain('data-enquiry-router');
    const closing = section(html, 'closing-title');
    expect(hrefs(closing)).toEqual(expect.arrayContaining(['/contact', contact.whatsapp, `tel:${contact.primaryPhone}`]));
    expect(hrefs(html)).not.toContain('/partnerships');
  });

  it('shows one photograph, and no stock estate imagery', () => {
    const shown = photos(html);
    expect(shown).toEqual([servicesPage.directory.feature.image.src]);
    expect(canopies(shown).length).toBeLessThanOrEqual(2);
    expect(html).not.toMatch(/real-estate\/[^"]*\.webp/);
  });

  it('keeps one link colour, as home: group gold, the company in its dots and icons', () => {
    const directory = html.match(/<section[^>]*aria-label="Services by company"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(directory).not.toContain('text-accent-fg');
    expect(directory).toContain('text-gold-fg');
    expect(directory).toContain('text-accent');
  });

  it('renders calmly', () => expectCalm(html));
});

async function renderService(service: ServiceArea) {
  const element = await ServiceModule.default({ params: Promise.resolve({ slug: service.slug }) });
  return renderToStaticMarkup(element);
}

describe('/services/[slug]', () => {
  it('exists for exactly the six services, and no other slug', async () => {
    expect(ServiceModule.dynamicParams).toBe(false);
    expect(ServiceModule.generateStaticParams()).toEqual(serviceAreas.map((s) => ({ slug: s.slug })));
    await expect(ServiceModule.default({ params: Promise.resolve({ slug: 'unknown' }) })).rejects.toThrow();
    expect(await ServiceModule.generateMetadata({ params: Promise.resolve({ slug: 'unknown' }) })).toEqual({});
  });

  it.each(serviceAreas.map((s) => [s.slug, s] as const))('%s: metadata', async (_slug, service) => {
    const metadata = await ServiceModule.generateMetadata({ params: Promise.resolve({ slug: service.slug }) });
    expect(metadata.title).toBe(service.title);
    expect(metadata.description).toBe(service.metaDescription);
    expect(metadata.keywords).toEqual(service.keywords);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(`/services/${service.slug}`));
    expect(metadata.openGraph).toMatchObject({
      title: `${service.title} | ${site.name}`,
      description: service.metaDescription,
      url: absoluteUrl(`/services/${service.slug}`),
      type: 'website',
    });
  });

  it.each(serviceAreas.map((s) => [s.slug, s] as const))('%s: page', async (_slug, service) => {
    const company = getCompanyBySlug(service.companySlug)!;
    const html = await renderService(service);
    const pageIds = ids(html);

    // One h1, the service; a one-sentence lede of 110 characters or fewer.
    expect(tags(html, 'h1')).toEqual([service.title]);
    expect(service.lede.length).toBeLessThanOrEqual(110);
    expect(service.lede.slice(0, -1)).not.toMatch(/[.!?]\s/);
    const hero = section(html, 'page-title');
    expect(textOf(hero)).toContain(service.lede);
    expect(hrefs(hero)).toEqual(expect.arrayContaining(['#enquire', `/companies/${company.slug}`]));

    // The sub-nav: named, in the company accent, every anchor lands on the page.
    const subnav = html.match(/<nav[^>]*data-subnav[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(decode(subnav)).toContain(`aria-label="${service.navTitle} sections"`);
    expect(subnav).toContain(`data-accent="${company.accent}"`);
    const anchors = hrefs(subnav).filter((href) => href.startsWith('#') && href !== '#main-content');
    expect(anchors).toEqual(expect.arrayContaining(['#offerings', '#sites', '#company', '#faq', '#enquire']));
    for (const href of anchors) expect(pageIds, href).toContain(href.slice(1));

    // The form, preset to the company that runs the service: one per page.
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html).toContain(`data-default-intent="${service.intentId}"`);
    expect(section(html, 'enquire-title')).toContain('data-enquiry-router');

    // What it covers: the overview, who it serves, and every feature.
    const covers = section(html, 'offerings-title');
    expect(textOf(covers)).toContain(service.overview);
    for (const audience of service.audience) expect(tags(covers, 'li')).toContain(audience);
    for (const feature of service.features) expect(tags(covers, 'h3')).toContain(feature.title);
    if (service.keyStat) expect(textOf(covers)).toContain(service.keyStat.label);

    // Where it runs: its sites or its route, and the location profile.
    const where = section(html, 'sites-title');
    for (const site of service.sites ?? []) expect(textOf(where)).toContain(site.name);
    for (const stop of service.route ?? []) expect(tags(where, 'h3')).toContain(stop.name);
    expect(hrefs(where)).toContain('/locations/songwe-tunduma');

    // The company behind it: its page, its profile PDF and its other services.
    const behind = section(html, 'company-title');
    expect(behind).toContain('data-tone="cinema"');
    expect(tags(behind, 'h2')).toEqual([company.shortName]);
    expect(hrefs(behind)).toContain(`/companies/${company.slug}`);
    expect(behind).toMatch(new RegExp(`href="${profilePdfHref(company.id)}"[^>]*download`));
    for (const sibling of siblingServices(service)) expect(hrefs(behind)).toContain(`/services/${sibling.slug}`);
    const visual = service.companyVisual;
    if (isPhoto(visual)) expect(photos(behind)).toEqual([visual.src]);
    else expect(textOf(behind)).toContain(visual.statement);

    // The questions: visible disclosure rows matching the FAQPage.
    const ld = jsonLd(html);
    const faqPage = ld.find((e) => e['@type'] === 'FAQPage');
    expect((faqPage?.mainEntity as unknown[]).length).toBe(service.faqs.length);
    expect(html.match(/<details\b/g)).toHaveLength(service.faqs.length);
    for (const faq of service.faqs) expect(tags(html, 'h3')).toContain(faq.question);

    // The Service keeps its baseline @id, provided by the company under the group.
    const entity = ld.find((e) => e['@type'] === 'Service');
    expect(entity?.['@id']).toBe(`${absoluteUrl(`/services/${service.slug}`)}#service`);
    expect(entity?.provider).toMatchObject({
      '@id': `${absoluteUrl(`/companies/${company.slug}`)}#business`,
      parentOrganization: { '@id': `${absoluteUrl('/')}#organization` },
    });
    expectTrail(html, ['Home', 'Services', service.title]);

    // The rhythm: hero light, then grey, white, the one cinema tile, grey, and a white form above the grey footer.
    expect(tones(html)).toEqual(['light', 'alt', 'light', 'cinema', 'alt', 'light']);

    // Photographs: none repeats; at most two canopies outside the stations' own cards.
    const shown = photos(html);
    expect(repeated(shown)).toEqual([]);
    const stationCards = (service.sites ?? []).filter((s) => s.image && getMedia(s.image.media).canopy).map((s) => s.image!.src);
    expect(canopies(shown).filter((src) => !stationCards.includes(src)).length).toBeLessThanOrEqual(2);

    // The hero: a strong photograph, or a typographic panel.
    const heroVisual = service.heroVisual;
    if (isPhoto(heroVisual)) {
      expect(NEVER_A_HERO).not.toContain(heroVisual.media);
      expect(photos(hero)).toEqual([heroVisual.src]);
      // The LCP image: priority (never lazy), with no blur placeholder.
      const img = hero.match(/<img\b[^>]*>/)?.[0] ?? '';
      expect(img).not.toContain('loading="lazy"');
      expect(img).not.toContain('background-image');
    } else {
      expect(hero).toContain('data-type-panel=""');
      expect(photos(hero)).toEqual([]);
      expect(textOf(hero)).toContain(heroVisual.statement);
    }

    expectCalm(html);
  });

  it('keeps the hospitality room photograph out of the hero, and real estate typographic', async () => {
    const hospitality = serviceAreas.find((s) => s.slug === 'hospitality-and-lodging')!;
    const hero = section(await renderService(hospitality), 'page-title');
    expect(hero).not.toContain(getMedia('inn-lodge-room').src);

    expect(flags.estateImagery).toBe('typographic');
    const estate = serviceAreas.find((s) => s.slug === 'real-estate-and-property')!;
    const html = await renderService(estate);
    expect(html).not.toMatch(/real-estate\/[^"]*\.webp/);
    expect(photos(html)).toEqual([]);
  });

  it('rebuilds the fuel showcase with next/image: the stations and the yard, each on its own card', async () => {
    const fuel = serviceAreas.find((s) => s.slug === 'fuel-and-lubricants')!;
    const where = section(await renderService(fuel), 'sites-title');
    expect(textOf(where)).toContain(fuel.where.heading);
    const imgs = [...where.matchAll(/<img\b[^>]*>/g)].map((m) => decode(m[0]));
    expect(imgs.length).toBe((fuel.sites ?? []).filter((s) => s.image).length);
    for (const img of imgs) expect(img).toMatch(/src="\/_next\/image\?url=/);
    for (const name of ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD']) expect(tags(where, 'h3')).toContain(name);
  });
});
