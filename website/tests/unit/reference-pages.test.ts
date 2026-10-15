/**
 * Public home and company-page contracts for the approved editorial rebuild.
 * Content, route ownership, downloads, visible server markup and verified
 * imagery are checked independently of exact Tailwind classes or line breaks.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { companies, isPhoto, type Company } from '@/content/companies';
import { contact } from '@/content/contact';
import { enquiryIntents } from '@/content/enquiry';
import { flags, isEnabled, withFlags } from '@/content/flags';
import {
  homeClosing, homeCompanyTiles, homeCorridor, homeHero, homeInsights,
  homeNumbers, homeNumbersCopy, homeProfile, homeSectors, homeStatement,
} from '@/content/home';
import { getMedia, media, type MediaId } from '@/content/media';
import { headerCta } from '@/content/nav';
import { profilePdfHref } from '@/content/profile/cover';
import { serviceAreas } from '@/content/services';
import { absoluteUrl, site } from '@/content/site';
import { headlineText } from '@/content/types';
import { heroFrame } from '@/sections/company/LeadPhoto';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/',
}));

const HomeModule = await import('@/app/page');
const CompanyModule = await import('@/app/companies/[slug]/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const withoutScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/g, '');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
const section = (html: string, titleId: string) =>
  html.match(new RegExp(`<section[^>]*aria-labelledby="${titleId}"[\\s\\S]*?</section>`))?.[0] ?? '';
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1] ?? 'null') as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  });
const photoSrc = (src: string) => src.startsWith('/_next/image') ? (new URL(src, 'http://x').searchParams.get('url') ?? '') : src;
const photos = (html: string) => [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)]
  .map((m) => photoSrc(decode(m[1] ?? ''))).filter((src) => src.startsWith('/images/'));
const repeated = (list: readonly string[]) => [...new Set(list.filter((item, index) => list.indexOf(item) !== index))];
const idBySrc = new Map(Object.entries(media).map(([id, entry]) => [entry.src as string, id as MediaId]));
const canopies = (srcs: readonly string[]) => srcs.filter((src) => getMedia(idBySrc.get(src)!).canopy);

function verifiedMediaChecks(html: string) {
  for (const src of photos(html)) {
    const id = idBySrc.get(src);
    expect(id, `registered media: ${src}`).toBeDefined();
    const entry = getMedia(id!);
    expect(entry.provenance, src).not.toBe('unknown');
    expect(isEnabled(entry.requires), src).toBe(true);
    expect(entry.width, src).toBeGreaterThan(0);
    expect(entry.height, src).toBeGreaterThan(0);
    if (entry.credit) expect(textOf(withoutScripts(html)), src).toContain(entry.credit);
  }
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const image = decode(match[0]);
    const src = photoSrc(image.match(/\ssrc="([^"]*)"/)?.[1] ?? '');
    if (!src.startsWith('/images/')) continue;
    expect(image, src).toMatch(/\salt="[^"]+"/);
    expect(image, src).toMatch(/\ssizes="[^"]+"/);
  }
  expect(repeated(photos(html))).toEqual([]);
}

function publicContentChecks(html: string) {
  const visible = textOf(withoutScripts(html));
  expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
  expect(visible).not.toMatch(/manufactur|fastest-growing/i);
  expect(flags.publishLegalIdentifiers).toBe(false);
  for (const company of companies) {
    for (const value of [company.legal.tin, company.legal.incorporationDate, company.legal.incorporationNumber, ...company.legal.directors]) {
      if (value) expect(visible, `unverified legal detail: ${value}`).not.toContain(value);
    }
  }
  for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
    expect(textOf(block[1] ?? '')).toBe('');
  }
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  levels.forEach((level, index) => {
    if (index) expect(level - levels[index - 1]!, 'no skipped heading levels').toBeLessThanOrEqual(1);
  });
}

describe('home: metadata', () => {
  const { metadata } = HomeModule;

  it('stands alone under the site title, with its canonical and social metadata', () => {
    expect(metadata.title).toEqual({ absolute: site.title });
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/'));
    expect(metadata.openGraph).toMatchObject({ title: site.title, description: site.shortDescription, url: absoluteUrl('/') });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
    expect(metadata.description).toBe(site.description);
    expect(flags.mentionManufacturing).toBe(false);
    expect(String(metadata.description)).not.toMatch(/manufactur/i);
  });
});

describe('home: page', () => {
  const html = renderToStaticMarkup(h(HomeModule.default));
  const text = textOf(withoutScripts(html));

  it('has one h1 containing the complete group headline', () => {
    expect(tags(html, 'h1')).toEqual([headlineText(homeHero.headline)]);
  });

  it('runs hero, facts, introduction, companies, sectors, corridor, profile, insights and enquiry in order', () => {
    const order = [
      'page-title', 'numbers-title', 'statement-title',
      ...homeCompanyTiles.map((tile) => `tile-${tile.companySlug}`),
      'sectors-title', 'corridor-title', 'profile-title', 'insights-title', 'closing-title',
    ];
    expect([...html.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1])).toEqual(order);
    for (const title of [homeNumbersCopy.title, headlineText(homeStatement.headline), homeSectors.title, homeCorridor.title, homeProfile.title, homeInsights.title, homeClosing.title]) {
      expect(tags(html, 'h2')).toContain(title);
    }
  });

  it('names each operating company and links its page and enquiry form', () => {
    for (const tile of homeCompanyTiles) {
      const company = companies.find((c) => c.slug === tile.companySlug)!;
      const chapter = section(html, `tile-${company.slug}`);
      expect(chapter, company.slug).toContain(`data-accent="${company.accent}"`);
      expect(tags(chapter, 'h2')).toEqual([tile.name]);
      expect(textOf(chapter)).toContain(tile.summary);
      expect(hrefs(chapter)).toEqual(expect.arrayContaining([`/companies/${company.slug}`, `/companies/${company.slug}#enquire`]));
      expect(textOf(chapter)).toContain(`Explore ${tile.name}`);
      expect(textOf(chapter)).toContain(`Enquire ${tile.name}`);
    }
  });

  it('links all six services and names the operating company behind each', () => {
    const sectors = section(html, 'sectors-title');
    for (const item of homeSectors.items) expect(hrefs(sectors)).toContain(`/services/${item.serviceSlug}`);
    for (const company of companies) expect(textOf(sectors)).toContain(`${homeSectors.runBy} ${company.shortName}`);
    expect(hrefs(sectors)).toContain(homeSectors.routing.link.href);
    expect(flags.estateImagery).toBe('typographic');
    expect(html).not.toMatch(/real-estate\/[^\"]*\.webp/);
  });

  it('shows only enabled group figures', () => {
    expect(flags.showDivisionsStat).toBe(false);
    expect(tags(section(html, 'numbers-title'), 'dt')).toEqual(withFlags(homeNumbers).map((stat) => stat.label));
  });

  it('provides a group profile download and a route to the full profile', () => {
    const profile = section(html, 'profile-title');
    expect(profile).toMatch(new RegExp(`href="${profilePdfHref('group')}"[^>]*download`));
    expect(hrefs(profile)).toContain('/company-profile');
    expect(textOf(profile)).toContain(homeProfile.body);
  });

  it('routes general enquiries to Contact and retains classified phone and WhatsApp links', () => {
    expect(headerCta).toEqual({ href: '/contact', label: 'Enquire' });
    expect(homeHero.actions.map((action) => action.href)).toEqual(['/companies', '/contact']);
    expect(homeSectors.routing.link.href).toBe('/contact');
    expect(hrefs(html)).not.toContain('/partnerships');
    expect(hrefs(section(html, 'closing-title'))).toEqual(expect.arrayContaining(['/contact', contact.whatsapp, `tel:${contact.primaryPhone}`]));
  });

  it('uses verified, distinct photographs with at most two station canopies', () => {
    verifiedMediaChecks(html);
    expect(photos(html)).toContain(homeHero.image.src);
    expect(photos(html).length).toBeGreaterThanOrEqual(4);
    expect(canopies(photos(html)).length).toBeLessThanOrEqual(2);
    const hero = section(html, 'page-title');
    expect(getMedia(homeHero.image.media).width).toBeGreaterThanOrEqual(2000);
    expect(hero).not.toContain('loading="lazy"');
    expect(hero).not.toContain('data-reveal');
    for (const tile of homeCompanyTiles) {
      const chapter = section(html, `tile-${tile.companySlug}`);
      expect(photos(chapter), tile.companySlug).toHaveLength(1);
    }
  });

  it('keeps all approved text visible in server markup and omits unverified claims', () => {
    publicContentChecks(html);
    expect(text).toContain(homeHero.lede);
    expect(text).toContain(homeStatement.body);
    expect(text).toContain(homeCorridor.body);
  });
});

async function renderCompany(company: Company) {
  return renderToStaticMarkup(await CompanyModule.default({ params: Promise.resolve({ slug: company.slug }) }));
}

describe('company pages', () => {
  it('exist for exactly the three companies, and reject any other slug', async () => {
    expect(CompanyModule.dynamicParams).toBe(false);
    expect(CompanyModule.generateStaticParams()).toEqual(companies.map((company) => ({ slug: company.slug })));
    await expect(CompanyModule.default({ params: Promise.resolve({ slug: 'unknown' }) })).rejects.toThrow();
  });

  it.each(companies.map((company) => [company.slug, company] as const))('%s: metadata', async (_slug, company) => {
    const metadata = await CompanyModule.generateMetadata({ params: Promise.resolve({ slug: company.slug }) });
    expect(metadata.title).toBe(company.name);
    expect(metadata.description).toBe(company.metaDescription);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(`/companies/${company.slug}`));
    expect(metadata.openGraph).toMatchObject({ title: `${company.name} | ${site.name}`, description: company.metaDescription });
  });

  it.each(companies.map((company) => [company.slug, company] as const))('%s: content, routing, downloads and verified media', async (_slug, company) => {
    const html = await renderCompany(company);
    const text = textOf(withoutScripts(html));
    const pageIds = ids(html);
    expect(tags(html, 'h1')).toEqual([company.shortName]);
    expect(textOf(section(html, 'page-title'))).toContain(company.lede);
    expect(textOf(section(html, 'glance-title'))).toContain(company.name);
    publicContentChecks(html);
    const chapters = ['page-title', 'glance-title', 'what-we-do-title', 'sites-title', 'strengths-title', 'gallery-title', 'downloads-title', 'faq-title', 'enquire-title'];
    const positions = chapters.map((id) => html.indexOf(`aria-labelledby="${id}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const overview = section(html, 'what-we-do-title');
    expect(textOf(overview)).toContain(company.overview.lead);
    for (const point of company.overview.points) expect(tags(overview, 'li')).toContain(point);
    for (const service of serviceAreas.filter((service) => service.companySlug === company.slug)) {
      expect(hrefs(html)).toContain(`/services/${service.slug}`);
    }
    for (const site of company.sites) expect(text).toContain(site.name);
    for (const faq of company.faqs) expect(tags(html, 'h3')).toContain(faq.question);
    expect(text).toContain(company.keyStat.label);

    const strengths = section(html, 'strengths-title');
    for (const highlight of company.highlights) {
      if (highlight === company.keyStat.restates) expect(textOf(strengths)).not.toContain(highlight);
      else expect(textOf(strengths)).toContain(highlight);
    }
    expect(strengths).toContain('data-tone="cinema"');
    if (isPhoto(company.strengthsVisual)) expect(photos(strengths)).toEqual([company.strengthsVisual.src]);
    else expect(textOf(strengths)).toContain(company.strengthsVisual.statement);

    const subnav = html.match(/<nav[^>]*data-subnav[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(subnav).toContain(`aria-label="${company.shortName} sections"`);
    expect(subnav).toContain(`data-accent="${company.accent}"`);
    for (const href of hrefs(html).filter((href) => href.startsWith('#') && href !== '#main-content')) {
      expect(pageIds, href).toContain(href.slice(1));
    }
    expect(hrefs(subnav)).toContain('#enquire');
    expect(subnav).toMatch(/<button type="button" popovertarget="subnav-sections"/i);
    const menu = subnav.match(/<div id="subnav-sections" popover="auto"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(hrefs(menu)).toEqual(hrefs(subnav.replace(menu, '')).filter((href) => href.startsWith('#') && href !== '#main-content' && href !== '#enquire'));
    const intent = enquiryIntents.find((item) => item.id === company.id)!;
    expect(html).toContain(`data-default-intent="${intent.id}"`);
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`href="${profilePdfHref(company.id)}"[^>]*download`));
    expect(textOf(section(html, 'downloads-title'))).toBeTruthy();

    verifiedMediaChecks(html);
    expect(photos(html)).toContain(company.heroImage.src);
    const frame = heroFrame(company.heroImage);
    const master = getMedia(company.heroImage.media);
    if (frame.layout === 'framed') expect(master.width).toBeGreaterThanOrEqual(2000);
    else expect(frame.width).toBe('split');
    expect(['mpemba-coach-canopy', 'westsides-beer-delivery']).not.toContain(company.heroImage.media);

    const ld = jsonLd(html);
    const business = ld.find((entry) => entry['@type'] === 'LocalBusiness');
    expect(business?.['@id']).toBe(`${absoluteUrl(`/companies/${company.slug}`)}#business`);
    expect(business?.parentOrganization).toEqual({ '@id': `${absoluteUrl('/')}#organization` });
    expect(business?.legalName).toBeUndefined();
    const faqPage = ld.find((entry) => entry['@type'] === 'FAQPage');
    expect((faqPage?.mainEntity as unknown[]).length).toBe(company.faqs.length);
    const crumbs = ld.find((entry) => entry['@type'] === 'BreadcrumbList');
    const names = (crumbs?.itemListElement as Array<{ name: string }>).map((item) => item.name);
    expect(names).toEqual(['Home', 'Companies', company.shortName]);
    const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(tags(trail, 'li')).toEqual(names);
  });

  it('lists every Westsides branch', async () => {
    const westsides = companies.find((company) => company.id === 'westsides')!;
    const text = textOf(await renderCompany(westsides));
    for (const branch of westsides.branches ?? []) expect(text).toContain(branch.name);
    expect(westsides.branches).toHaveLength(4);
  });
});
