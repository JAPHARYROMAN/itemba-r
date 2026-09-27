/**
 * Page group P1: /about and /companies, rebuilt as server components on
 * the reference pages' patterns. Server-rendered markup contracts:
 *
 * - /about: its metadata (title, canonical, openGraph), one h1 with the
 *   lead line "Built for Tanzania. Built to last.", the plan's chapters in
 *   order (structure, why diversification, milestones, leadership, head
 *   office, closing), the group structure as nested lists with SVG
 *   connectors (no ASCII tree, no emoji), a milestones strip from 2012 to
 *   2025 in chronological order that covers the company history once,
 *   leadership as typographic cards (no portraits), the AboutPage and
 *   BreadcrumbList JSON-LD matching the visible trail, one photograph with
 *   its CC BY-SA credit, and the flag defaults (no manufacturing, no growth
 *   claim, the head office not equated with ITEMBA-MPEMBA).
 * - /companies: its metadata, one h1, the three company tiles (home's
 *   component) inside the original anchors #mwanjalisi, #westsides and
 *   #enterprises with a jump row to each, "At a glance" in each company's
 *   accent, general enquiries to /contact, and the CollectionPage and
 *   BreadcrumbList JSON-LD.
 * - Neither page has an enquiry form (the quick-contact bar stays), renders
 *   anything at opacity 0, or shows a photograph twice.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { aboutPage } from '@/content/about';
import { companies, companiesPage, companyPageCopy } from '@/content/companies';
import { flags } from '@/content/flags';
import { homeClosing, homeCompanyTiles } from '@/content/home';
import { getMedia, media, type MediaId } from '@/content/media';
import { history, leadershipTeam } from '@/content/profile';
import { absoluteUrl } from '@/content/site';
import { headlineText } from '@/content/types';

const AboutModule = await import('@/app/about/page');
const CompaniesModule = await import('@/app/companies/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? '').trim());
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
const idBySrc = new Map(Object.entries(media).map(([id, entry]) => [entry.src as string, id as MediaId]));
/** The visible breadcrumb trail: its link and current-page names. */
const trail = (html: string) => {
  const nav = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
  return tags(nav, 'li');
};
const EMOJI = /\p{Extended_Pictographic}/u;

/** Chronological sort key for a company-history date ("2017 onward" falls after 9 June 2017). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function historyKey(date: string): number {
  const year = Number(date.match(/\d{4}/)?.[0]);
  const day = date.match(/^(\d{1,2}) (\w+) \d{4}$/);
  if (day) return year * 10_000 + (MONTHS.indexOf(day[2] ?? '') + 1) * 100 + Number(day[1]);
  if (/onward/.test(date)) return year * 10_000 + 1300;
  return year * 10_000;
}

describe('/about: metadata', () => {
  const { metadata } = AboutModule;

  it('keeps the title, canonical and openGraph copy', () => {
    expect(metadata.title).toBe('About Us');
    expect(metadata.description).toBe(aboutPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/about'));
    expect(metadata.openGraph).toMatchObject({
      title: 'About Itemba Group',
      description: aboutPage.meta.ogDescription,
      url: absoluteUrl('/about'),
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });
});

describe('/about: page', () => {
  const html = renderToStaticMarkup(h(AboutModule.default));
  const text = textOf(html);

  it('has one h1: the lead line, verbatim', () => {
    expect(tags(html, 'h1')).toEqual(['Built for Tanzania. Built to last.']);
    expect(headlineText(aboutPage.hero.headline)).toBe('Built for Tanzania. Built to last.');
  });

  it('runs the plan chapters in order, each an h2', () => {
    const order = [
      aboutPage.organisation.title,
      aboutPage.approach.title,
      aboutPage.timeline.title,
      aboutPage.leadership.title,
      aboutPage.headquarters.title,
      homeClosing.title,
    ];
    const h2 = tags(html, 'h2');
    for (const title of order) expect(h2, title).toContain(title);
    const positions = order.map((title) => text.indexOf(title));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('never skips a heading level', () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    levels.forEach((level, index) => {
      if (index) expect(level - (levels[index - 1] ?? 1), `h${level} after h${levels[index - 1]}`).toBeLessThanOrEqual(1);
    });
  });

  it('draws the group structure as nested lists with SVG connectors: no ASCII tree, no emoji', () => {
    const structure = section(html, 'structure-title');
    const { structure: tree } = aboutPage.organisation;
    for (const company of tree.companies) {
      expect(hrefs(structure), company.name).toContain(`/companies/${company.companySlug}`);
      expect(structure).toContain(`data-accent="${company.companyId}"`);
      for (const unit of company.units) expect(textOf(structure), unit.name).toContain(unit.name);
    }
    expect(tree.companies.flatMap((c) => c.units)).toHaveLength(9);
    expect(textOf(structure)).toContain(tree.root.name);
    expect(structure).toMatch(/<svg aria-hidden="true"/);
    expect(structure).not.toMatch(/[├└│]|font-mono|→|★/);
    expect(text).not.toMatch(EMOJI);
  });

  it('gives the reasons to diversify as a bento, the six sectors linked, no manufacturing', () => {
    const approach = section(html, 'approach-title');
    for (const pillar of aboutPage.approach.pillars) expect(tags(approach, 'h3')).toContain(pillar.title);
    expect(hrefs(approach).filter((href) => href.startsWith('/services/'))).toHaveLength(6);
    expect(flags.mentionManufacturing).toBe(false);
    expect(text).not.toMatch(/manufactur/i);
  });

  it('lays the milestones out oldest first, 2012 to 2025, covering the company history once', () => {
    const { milestones } = aboutPage.timeline;
    const years = milestones.map((m) => Number(m.year));
    expect(years[0]).toBe(2012);
    expect(years.at(-1)).toBe(2025);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    expect(new Set(years).size).toBe(years.length);

    const covered = milestones.flatMap((m) => [...m.covers]);
    expect([...covered].sort()).toEqual(history.map((entry) => entry.date).sort());
    const keys = covered.map(historyKey);
    expect([...keys].sort((a, b) => a - b), 'covered dates, in page order').toEqual(keys);
    for (const m of milestones) for (const date of m.covers) expect(date, m.year).toContain(m.year);

    const strip = section(html, 'timeline-title');
    const times = [...strip.matchAll(/<time dateTime="([^"]*)">(\d{4})<\/time>/g)].map((m) => m[2]);
    expect(times).toEqual(milestones.map((m) => m.year));
  });

  it('shows the leadership as typographic cards, in profile order, with no portraits', () => {
    expect(flags.publishLegalIdentifiers).toBe(true);
    const team = section(html, 'leadership-title');
    expect(tags(team, 'h3')).toEqual(leadershipTeam.map((person) => person.name));
    expect(team).not.toMatch(/<img\b/);
  });

  it('places the head office without the unconfirmed claims, with directions and the location page', () => {
    const hq = section(html, 'hq-title');
    expect(hq).toContain('data-tone="cinema"');
    expect(textOf(hq)).toContain('Itemba Filling Station');
    expect(textOf(hq)).not.toContain('ITEMBA-MPEMBA');
    expect(flags.songweGrowthClaim).toBe(false);
    expect(text).not.toContain(aboutPage.headquarters.growth.text);
    expect(hrefs(hq)).toEqual(expect.arrayContaining(['/locations/songwe-tunduma']));
    expect(hrefs(hq).some((href) => href.startsWith('https://www.google.com/maps'))).toBe(true);
    expect(hq).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });

  it('shows one photograph, the Songwe landscape, with its CC BY-SA credit; no canopy', () => {
    const shown = photos(html);
    expect(shown).toEqual([media['songwe-landscape'].src]);
    for (const src of shown) expect(getMedia(idBySrc.get(src)!).canopy ?? false, src).toBe(false);
    expect(text).toContain('Richard grivas / Wikimedia Commons');
    expect(text).toContain('CC BY-SA 4.0');
  });

  it('has no enquiry form, and every general enquiry goes to /contact', () => {
    expect(html).not.toMatch(/<form\b/);
    expect(hrefs(html)).not.toContain('/partnerships');
    expect(hrefs(html)).toContain('/contact');
  });

  it('adds an AboutPage and one BreadcrumbList matching the visible trail', () => {
    const ld = jsonLd(html);
    const about = ld.find((e) => e['@type'] === 'AboutPage');
    expect(about).toMatchObject({
      '@id': `${absoluteUrl('/about')}#aboutpage`,
      url: absoluteUrl('/about'),
      about: { '@id': `${absoluteUrl('/')}#organization` },
    });
    const crumbs = ld.filter((e) => e['@type'] === 'BreadcrumbList');
    expect(crumbs).toHaveLength(1);
    const items = (crumbs[0]?.itemListElement ?? []) as Array<{ name: string; item: string }>;
    expect(items.map((i) => i.name)).toEqual(['Home', 'About']);
    expect(items.map((i) => i.item)).toEqual([absoluteUrl('/'), absoluteUrl('/about')]);
    expect(trail(html)).toEqual(['Home', 'About']);
  });

  it('renders nothing hidden, and no text fades in', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
      expect(textOf(block[1] ?? '').trim()).toBe('');
    }
  });
});

describe('/companies: metadata', () => {
  const { metadata } = CompaniesModule;

  it('keeps the title, canonical and openGraph copy', () => {
    expect(metadata.title).toBe('Our Companies');
    expect(metadata.description).toBe(companiesPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/companies'));
    expect(metadata.openGraph).toMatchObject({
      title: 'Itemba Group Companies',
      description: companiesPage.meta.ogDescription,
      url: absoluteUrl('/companies'),
    });
  });
});

describe('/companies: page', () => {
  const html = renderToStaticMarkup(h(CompaniesModule.default));
  const text = textOf(html);

  it('has one h1: "Three companies. Six sectors."', () => {
    expect(tags(html, 'h1')).toEqual(['Three companies. Six sectors.']);
  });

  it('keeps the anchors #mwanjalisi, #westsides and #enterprises, each around its company tile', () => {
    const found = ids(html);
    for (const company of companies) {
      expect(found.has(company.id), company.id).toBe(true);
      expect(html).toMatch(new RegExp(`<div id="${company.id}"><section[^>]*aria-labelledby="tile-${company.slug}"`));
    }
    expect(hrefs(html)).toEqual(expect.arrayContaining(['#mwanjalisi', '#westsides', '#enterprises']));
  });

  it('reuses the home tiles: Explore › to the company, Enquire › to its form', () => {
    for (const tile of homeCompanyTiles) {
      const company = companies.find((c) => c.slug === tile.companySlug)!;
      const tileHtml = section(html, `tile-${company.slug}`);
      expect(textOf(tileHtml)).toContain(company.legalName);
      expect(hrefs(tileHtml)).toEqual(expect.arrayContaining([`/companies/${company.slug}`, `/companies/${company.slug}#enquire`]));
    }
    expect(html).toMatch(/aria-labelledby="tile-mwanjalisi-oil" data-tone="cinema"/);
  });

  it('compares the three at a glance, each card in its own accent', () => {
    const glance = section(html, 'glance-title');
    expect(tags(glance, 'h2')).toEqual([companyPageCopy.glance.title]);
    for (const company of companies) {
      expect(glance).toContain(`data-tone="alt" data-accent="${company.accent}"`);
      expect(textOf(glance)).toContain(company.legalName);
      expect(textOf(glance)).toContain(company.legal.incorporationDate);
      expect(textOf(glance)).toContain(company.keyStat.label);
    }
    expect(glance).toContain('text-accent-fg');
  });

  it('sends general enquiries to /contact, never /partnerships, and has no form', () => {
    expect(hrefs(html)).toContain('/contact');
    expect(hrefs(html)).not.toContain('/partnerships');
    expect(html).not.toMatch(/<form\b/);
  });

  it('never shows a photograph twice', () => {
    const shown = photos(html);
    expect(shown.length).toBeGreaterThan(0);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('adds a CollectionPage of the three companies and one BreadcrumbList matching the trail', () => {
    const ld = jsonLd(html);
    const collection = ld.find((e) => e['@type'] === 'CollectionPage') as
      | { '@id': string; mainEntity: { itemListElement: Array<{ position: number; name: string; url: string }> } }
      | undefined;
    expect(collection?.['@id']).toBe(`${absoluteUrl('/companies')}#collectionpage`);
    expect(collection?.mainEntity.itemListElement.map((i) => [i.position, i.name, i.url])).toEqual(
      companies.map((c, index) => [index + 1, c.name, absoluteUrl(`/companies/${c.slug}`)]),
    );
    const crumbs = ld.filter((e) => e['@type'] === 'BreadcrumbList');
    expect(crumbs).toHaveLength(1);
    expect(trail(html)).toEqual(['Home', 'Companies']);
  });

  it('renders nothing hidden and no emoji', () => {
    expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
    expect(text).not.toMatch(EMOJI);
  });
});
