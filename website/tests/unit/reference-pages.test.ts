/**
 * The two reference pages every later page copies (stage B6): home and the
 * company template. Server-rendered markup contracts:
 *
 * - Home: its own metadata (the site title stands alone; the flag-resolved
 *   description), one h1 with the lead line verbatim, the plan's section
 *   order, the three company tiles (legal name, accent, Explore › and
 *   Enquire › straight to the company's form), six sectors with the company
 *   that runs each, the typographic estate tile, no divisions figure, and
 *   the closing call to action with the classified contact hrefs; one link
 *   colour (group gold) with the company only in dots and icons; an h1
 *   that leads every other heading on a phone.
 * - Company pages: the metadata and JSON-LD contracts, the sticky sub-nav
 *   whose anchors all land, the form preset to the company, the profile
 *   PDF, the visible breadcrumb trail matching its BreadcrumbList, and a
 *   404 for any other slug; the short name as h1 with one legal-name form
 *   on the page, a one-sentence lede, one hero template, and a cinema tile
 *   that carries a photograph.
 * - Neither page renders anything at opacity 0, and the server HTML never
 *   mentions manufacturing (flags.mentionManufacturing).
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked
 * for the EnquiryRouter island.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { companies, type Company } from '@/content/companies';
import { contact } from '@/content/contact';
import { enquiryFormCopy, enquiryIntents } from '@/content/enquiry';
import { flags } from '@/content/flags';
import { homeClosing, homeCompanyTiles, homeHero, homeNumbers, homeSectors, homeStatement } from '@/content/home';
import { profilePdfHref } from '@/content/profile/cover';
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
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
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

describe('home: metadata', () => {
  const { metadata } = HomeModule;

  it('stands alone under the site title, with its own canonical and openGraph', () => {
    expect(metadata.title).toEqual({ absolute: site.title });
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/'));
    expect(metadata.openGraph).toMatchObject({ title: site.title, description: site.shortDescription, url: absoluteUrl('/') });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('uses the flag-resolved description (no manufacturing by default)', () => {
    expect(metadata.description).toBe(site.description);
    expect(flags.mentionManufacturing).toBe(false);
    expect(String(metadata.description)).not.toMatch(/manufactur/i);
  });
});

describe('home: page', () => {
  const html = renderToStaticMarkup(h(HomeModule.default));
  const text = textOf(html);

  it('has one h1: the lead line, verbatim', () => {
    expect(tags(html, 'h1')).toEqual([headlineText(homeHero.headline)]);
  });

  it('follows the plan order: hero, statement, companies, sectors, corridor, numbers, insights, closing', () => {
    const order = [
      headlineText(homeHero.headline),
      headlineText(homeStatement.headline),
      ...homeCompanyTiles.map((tile) => tile.name),
      homeSectors.title,
      'Where Tanzania meets Zambia.',
      'Itemba Group, by the numbers.',
      'Insights for suppliers, buyers & partners.',
      homeClosing.title,
    ];
    const headings = [...tags(html, 'h1'), ...tags(html, 'h2')];
    const positions = order.map((title) => text.indexOf(title));
    for (const title of order) expect(headings, title).toContain(title);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows each company as a tile: accent, legal name, Explore › and Enquire › to its form', () => {
    for (const tile of homeCompanyTiles) {
      const company = companies.find((c) => c.slug === tile.companySlug)!;
      const section = html.match(new RegExp(`<section[^>]*aria-labelledby="tile-${company.slug}"[\\s\\S]*?</section>`))?.[0] ?? '';
      expect(section, company.slug).toContain(`data-accent="${company.accent}"`);
      expect(textOf(section)).toContain(company.legalName);
      expect(hrefs(section)).toEqual(expect.arrayContaining([`/companies/${company.slug}`, `/companies/${company.slug}#enquire`]));
      expect(textOf(section)).toContain(`Explore ${tile.name}`);
      expect(textOf(section)).toContain(`Enquire ${tile.name}`);
    }
    // Light, cinema and alt: the energy tile carries the dusk photograph on black.
    expect(html).toMatch(/aria-labelledby="tile-mwanjalisi-oil" data-tone="cinema"/);
  });

  it('keeps one link colour: group gold everywhere, the company only in its dots and icons', () => {
    // Company tiles: the eyebrow and both links are gold, never the accent text colour.
    for (const tile of homeCompanyTiles) {
      const company = companies.find((c) => c.slug === tile.companySlug)!;
      const section = html.match(new RegExp(`<section[^>]*aria-labelledby="tile-${company.slug}"[\\s\\S]*?</section>`))?.[0] ?? '';
      expect(section, company.slug).not.toContain('text-accent-fg');
      expect(section.match(/text-gold-fg/g), company.slug).toHaveLength(3);
      expect(section, company.slug).toContain('bg-accent');
    }
    // Sector cells: "Explore ›" is gold; the icon and the dot carry the company.
    const sectors = html.match(/<section[^>]*aria-labelledby="sectors-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    const cells = sectors.split(/(?=data-accent="(?:mwanjalisi|westsides|enterprises)")/).slice(1);
    expect(cells).toHaveLength(homeSectors.items.length);
    for (const cell of cells) {
      const own = cell.split(/data-tone="cinema"/)[0] ?? '';
      expect(own).not.toContain('text-accent-fg');
      expect(own).toContain('text-gold-fg');
      expect(own).toContain('text-accent');
    }
  });

  it('lists the six sectors with the company that runs each; Itemba Estate stays typographic', () => {
    for (const item of homeSectors.items) expect(hrefs(html)).toContain(`/services/${item.serviceSlug}`);
    expect(text).toContain(`${homeSectors.runBy} Mwanjalisi Oil`);
    expect(text).toContain(`${homeSectors.runBy} Itemba Enterprises`);
    expect(text).toContain(homeSectors.routing.title);
    expect(flags.estateImagery).toBe('typographic');
    expect(html).not.toMatch(/real-estate\/[^"]*\.webp/);
  });

  it('shows the confirmed figures only (no divisions stat by default)', () => {
    expect(flags.showDivisionsStat).toBe(false);
    const numbers = html.match(/aria-labelledby="numbers-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(tags(numbers, 'dt')).toEqual(homeNumbers.filter((stat) => !stat.requires).map((stat) => stat.label));
  });

  it('closes with the Enquire pill, WhatsApp and Call, in the hrefs ConversionTracker classifies', () => {
    const closing = html.match(/aria-labelledby="closing-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hrefs(closing)).toEqual(expect.arrayContaining(['/partnerships', contact.whatsapp, `tel:${contact.primaryPhone}`]));
    expect(contact.whatsapp).toContain('wa.me/');
  });

  it('renders nothing hidden and never mentions manufacturing', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    expect(text).not.toMatch(/manufactur/i);
    // Only the photographs may fade up: no text in a data-reveal block.
    for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
      expect(textOf(block[1] ?? '').trim()).toBe('');
    }
  });

  it('ranks its headings: the hero alone at display-xl, the statement and closing at display, chapters below', () => {
    const sizeOf = (id: string) => new RegExp(`<h[12] id="${id}" class="(text-[a-z0-9-]+)`).exec(html)?.[1];
    expect(sizeOf('page-title')).toBe('text-display-xl');
    expect(html.match(/class="text-display-xl /g)).toHaveLength(1);
    expect([sizeOf('statement-title'), sizeOf('closing-title')]).toEqual(['text-display', 'text-display']);
    for (const tile of homeCompanyTiles) {
      const company = companies.find((c) => c.slug === tile.companySlug)!;
      expect(sizeOf(`tile-${company.slug}`), company.slug).toBe('text-h1');
    }
    expect([sizeOf('sectors-title'), sizeOf('corridor-title'), sizeOf('numbers-title')]).toEqual(['text-h1', 'text-h1', 'text-h2']);
  });

  it('keeps the h1 in the lead on phones: the statement and closing lines step down there', () => {
    // The h1 is about 40px at 360px; chapters are 32px (the h1 token) and the
    // display lines 33px (`statement`), so it leads each by at least 1.2x.
    const classOf = (id: string) => new RegExp(`<h2 id="${id}" class="([^"]*)"`).exec(html)?.[1] ?? '';
    for (const id of ['statement-title', 'closing-title']) {
      expect(classOf(id), id).toContain('max-md:text-[length:clamp(2.0625rem,1.341rem_+_3.206vw,2.875rem)]');
    }
  });

  it('sets the lead line in two lines on a desktop, and never splits "Tanzania–Zambia" on a phone', () => {
    const h1 = /<h1 id="page-title" class="([^"]*)">([\s\S]*?)<\/h1>/.exec(html);
    expect(h1?.[1]).toContain('max-w-[74rem]');
    // On phones the size is display-xl where the compound (about 7.6em wide)
    // fits the line, and fitted to it below that, so it always stays whole.
    expect(h1?.[1]).toContain('max-md:text-[length:min(max(3rem,8vw),calc((100vw_-_2.75rem)_/_7.8))]');
    expect(h1?.[2]).toContain('<span class="whitespace-nowrap">Tanzania–Zambia</span>');
  });

  it('crops the hero photograph tighter on phones, with sizes that cover the crop', () => {
    const hero = html.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    const img = hero.match(/<img\b[^>]*>/)?.[0] ?? '';
    expect(hero).toContain('aspect-[4/3] md:aspect-[21/9]');
    // 1.5x about the canopy (the registry's focus), below `md` only.
    expect(hero).toMatch(/class="absolute inset-0 max-md:\[transform:scale\(var\(--lead-zoom\)\)\]" style="--lead-zoom:1.5;transform-origin:45% 55%"/);
    // A 1.42:1 master in a 4:3 frame draws 1.06 frames wide; zoomed, 1.59.
    expect(decode(img)).toMatch(/sizes="\(min-width: 1484px\) 1440px, \(min-width: 768px\) calc\(100vw - 44px\), calc\(\(100vw - 44px\) \* 1\.59\)"/);
  });

  it('shows no photograph twice', () => {
    const shown = photos(html);
    expect(shown.length).toBeGreaterThanOrEqual(4);
    expect(repeated(shown)).toEqual([]);
  });
});

async function renderCompany(company: Company) {
  const element = await CompanyModule.default({ params: Promise.resolve({ slug: company.slug }) });
  return renderToStaticMarkup(element);
}

describe('company pages', () => {
  it('exist for exactly the three companies, and no other slug', async () => {
    expect(CompanyModule.dynamicParams).toBe(false);
    expect(CompanyModule.generateStaticParams()).toEqual(companies.map((c) => ({ slug: c.slug })));
    await expect(CompanyModule.default({ params: Promise.resolve({ slug: 'unknown' }) })).rejects.toThrow();
  });

  it.each(companies.map((c) => [c.slug, c] as const))('%s: metadata', async (_slug, company) => {
    const metadata = await CompanyModule.generateMetadata({ params: Promise.resolve({ slug: company.slug }) });
    expect(metadata.title).toBe(company.name);
    expect(metadata.description).toBe(company.metaDescription);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(`/companies/${company.slug}`));
    expect(metadata.openGraph).toMatchObject({ title: `${company.name} | ${site.name}`, description: company.metaDescription });
  });

  it.each(companies.map((c) => [c.slug, c] as const))('%s: page', async (_slug, company) => {
    const html = await renderCompany(company);
    const text = textOf(html);
    const pageIds = ids(html);

    // The h1 is the short name; the page shows one legal-name form, the
    // registered name in "At a glance" (the metadata title keeps company.name).
    // The form's "Routed to …" line is left aside: it is the routeTo string
    // the enquiry payload and analytics carry (a contract).
    expect(tags(html, 'h1')).toEqual([company.shortName]);
    const intent = enquiryIntents.find((i) => i.id === company.id)!;
    const visible = textOf(html.replace(/<script\b[\s\S]*?<\/script>/g, '')).replace(
      `${enquiryFormCopy.routedToPrefix} ${intent.routeTo}`,
      '',
    );
    expect(visible.split(company.legalName).length - 1, 'registered name shown once').toBe(1);
    if (company.name !== company.legalName) expect(visible).not.toContain(company.name);

    // The hero lede: one sentence of 110 characters or fewer (three lines on a phone).
    const hero = html.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(company.lede.length).toBeLessThanOrEqual(110);
    expect(company.lede.slice(0, -1)).not.toMatch(/[.!?]\s/);
    expect(textOf(hero)).toContain(company.lede);
    // One hero template: a 2400px landscape framed in the content width, or a photograph beside the text.
    expect(hero).not.toContain('max-w-wide');
    const heroImg = decode(hero.match(/<img\b[^>]*>/)?.[0] ?? '');
    if (heroFrame(company.heroImage).layout === 'framed') expect(heroImg).toMatch(/sizes="\(min-width: 1112px\) 1068px, /);
    else expect(heroImg).toMatch(/sizes="\(min-width: 1024px\) \d+px, /);

    // "What we do": a one-sentence lead and a short list, not the long description.
    const whatWeDo = html.match(/<section[^>]*aria-labelledby="what-we-do-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(textOf(whatWeDo)).toContain(company.overview.lead);
    expect(tags(whatWeDo, 'li')).toEqual(company.overview.points.map((point) => point));
    expect(text).not.toContain(company.detail);

    // The sub-nav: named, in the company accent, every anchor lands on the page.
    const subnav = html.match(/<nav[^>]*data-subnav[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(subnav).toContain(`aria-label="${company.shortName} sections"`);
    expect(subnav).toContain(`data-accent="${company.accent}"`);
    // (#main-content, the title's target, is the layout's <main>.)
    for (const href of hrefs(subnav).filter((href) => href.startsWith('#') && href !== '#main-content')) {
      expect(pageIds, href).toContain(href.slice(1));
    }
    expect(hrefs(subnav)).toContain('#enquire');

    // The form, preset to this company.
    expect(html).toContain(`data-default-intent="${company.id}"`);
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);

    // The ready-made profile PDF, as a download.
    expect(html).toMatch(new RegExp(`href="${profilePdfHref(company.id)}"[^>]*download`));

    // Phones reach the same anchors through the chevron menu beside the name.
    const menu = subnav.match(/<div id="subnav-sections" popover="auto"[\s\S]*?<\/ul>/)?.[0] ?? '';
    // (HTML attribute names are case-insensitive; React writes popoverTarget as given.)
    expect(subnav).toMatch(/<button type="button" popovertarget="subnav-sections"/i);
    expect(hrefs(menu)).toEqual(hrefs(subnav.replace(menu, '')).filter((href) => href.startsWith('#') && href !== '#main-content' && href !== '#enquire'));

    // Every site and question is on the page.
    for (const site of company.sites) expect(text).toContain(site.name);
    for (const faq of company.faqs) expect(tags(html, 'h3')).toContain(faq.question);
    // Every strength, except the one the key figure already states.
    const strengths = html.match(/aria-labelledby="strengths-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    for (const highlight of company.highlights) {
      if (highlight === company.keyStat.restates) expect(textOf(strengths)).not.toContain(highlight);
      else expect(textOf(strengths)).toContain(highlight);
    }
    if (company.keyStat.restates) expect(company.highlights).toContain(company.keyStat.restates);
    expect(text).toContain(company.keyStat.label);
    // The one cinema tile carries a photograph, and at least three strengths.
    expect(strengths).toContain('data-tone="cinema"');
    expect(photos(strengths)).toEqual([company.strengthsImage.src]);
    expect(tags(strengths, 'li').length).toBeGreaterThanOrEqual(3);

    // One photograph per place: the hero is never the home tile's, and nothing repeats on the page.
    expect(company.heroImage.media).not.toBe(company.tileImage.media);
    const shown = photos(html);
    expect(shown).toContain(company.heroImage.src);
    expect(repeated(shown)).toEqual([]);

    // JSON-LD: the company as a LocalBusiness under the group, its FAQs, and the visible trail.
    const ld = jsonLd(html);
    const business = ld.find((e) => e['@type'] === 'LocalBusiness');
    expect(business?.['@id']).toBe(`${absoluteUrl(`/companies/${company.slug}`)}#business`);
    expect(business?.parentOrganization).toEqual({ '@id': `${absoluteUrl('/')}#organization` });
    const faqPage = ld.find((e) => e['@type'] === 'FAQPage');
    expect((faqPage?.mainEntity as unknown[]).length).toBe(company.faqs.length);
    const crumbs = ld.find((e) => e['@type'] === 'BreadcrumbList');
    const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
    const names = (crumbs?.itemListElement as Array<{ name: string }>).map((item) => item.name);
    expect(names).toEqual(['Home', 'Companies', company.shortName]);
    expect(tags(trail, 'li')).toEqual(names);

    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    expect(text).not.toMatch(/manufactur/i);
  });

  it('lists the Westsides branches', async () => {
    const westsides = companies.find((c) => c.id === 'westsides')!;
    const text = textOf(await renderCompany(westsides));
    for (const branch of westsides.branches ?? []) expect(text).toContain(branch.name);
    expect(westsides.branches?.length).toBe(4);
  });
});
