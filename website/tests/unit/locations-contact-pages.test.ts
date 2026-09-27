/**
 * Page group P3: /locations, /locations/songwe-tunduma and /contact.
 * Server-rendered markup contracts, following the reference pages' tests:
 *
 * - Metadata through pageMetadata (the title, canonical and og:url are
 *   baseline contracts; the location keeps its keywords and its og:title).
 * - One h1 each; JSON-LD coverage (CollectionPage, Place, the head office's
 *   LocalBusiness, FAQPage, ContactPage) with the group referenced by @id;
 *   the visible breadcrumb trail and its BreadcrumbList.
 * - EnquiryRouter placement (PAGE-GUIDE §5): none on /locations; compact
 *   and general on the location; full and general on /contact.
 * - The map facade: a closed <details> with a lazy iframe, so nothing
 *   loads from Google until it is opened, and the directions link outside
 *   it, always visible.
 * - The Songwe landscape's CC BY-SA credit is rendered wherever the
 *   photograph shows; no photograph shows twice on a page.
 * - /contact: every contact target from src/content/contact.ts, the
 *   companies linked, and no advice to contact the subsidiaries directly.
 * - Nothing server-rendered at opacity 0; the unconfirmed growth claim
 *   stays out (flags.songweGrowthClaim).
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked
 * for the EnquiryRouter island.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { companies } from '@/content/companies';
import { contact, mailtoWithSubject, mapsDirectionsUrl, mapsEmbedUrl, telHref } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { businessEnquirySubject } from '@/content/enquiry';
import { flags } from '@/content/flags';
import { locationProfiles, locationsPage } from '@/content/locations';
import { getMedia, media, type MediaId } from '@/content/media';
import { absoluteUrl, companyUrl, site } from '@/content/site';
import { headlineText } from '@/content/types';
import { HEAD_OFFICE_NAME, ORG_ID } from '@/lib/jsonld';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/contact',
}));

const LocationsModule = await import('@/app/locations/page');
const LocationModule = await import('@/app/locations/[slug]/page');
const ContactModule = await import('@/app/contact/page');

const location = locationProfiles[0]!;

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const withoutScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/g, '');
const textOf = (html: string) => decode(withoutScripts(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? '').trim());
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1] ?? 'null') as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  });
const ofType = (html: string, type: string) => jsonLd(html).filter((e) => e['@type'] === type);
/** The /images/… photograph each <img> shows (next/image routes them through /_next/image?url=…). */
const photos = (html: string) =>
  [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)]
    .map((m) => {
      const src = decode(m[1] ?? '');
      return src.startsWith('/_next/image') ? (new URL(src, 'http://x').searchParams.get('url') ?? '') : src;
    })
    .filter((src) => src.startsWith('/images/'));
const idBySrc = new Map(Object.entries(media).map(([id, entry]) => [entry.src as string, id as MediaId]));
const repeated = (list: readonly string[]) => [...new Set(list.filter((item, index) => list.indexOf(item) !== index))];
/** Tones of the page's tiles, in order (sections only: the footer trail is a div). */
const sectionTones = (html: string) => [...html.matchAll(/<section\b[^>]*\sdata-tone="([a-z]+)"/g)].map((m) => m[1] ?? '');
const detailsBlocks = (html: string) => [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)].map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '' }));

const SONGWE_CREDIT = 'Songwe Region landscape, Richard grivas / Wikimedia Commons, CC BY-SA 4.0';

/** Checks shared by the three pages. */
function commonChecks(html: string, crumbs: readonly string[]) {
  // Nothing hidden before paint, nothing unconfirmed.
  expect(html).not.toMatch(/opacity:\s*0/);
  expect(textOf(html)).not.toMatch(/manufactur/i);
  expect(textOf(html)).not.toMatch(/fastest-growing/i);
  expect(flags.songweGrowthClaim).toBe(false);

  // One h1.
  expect(tags(html, 'h1')).toHaveLength(1);

  // No photograph twice; every credited photograph shows its credit.
  const shown = photos(html);
  expect(repeated(shown)).toEqual([]);
  for (const src of shown) {
    const entry = getMedia(idBySrc.get(src)!);
    if (entry.credit) expect(textOf(html), src).toContain(entry.credit);
  }
  if (shown.includes(media['songwe-landscape'].src)) {
    expect(textOf(html)).toContain(SONGWE_CREDIT);
    expect(html).toMatch(/<a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/" rel="license noopener"/);
  }

  // Every in-page anchor lands.
  const pageIds = ids(html);
  for (const href of hrefs(html).filter((h) => h.startsWith('#'))) expect(pageIds.has(href.slice(1)), href).toBe(true);

  // The group is declared by the layout and referenced here, never re-declared.
  expect(jsonLd(html).filter((e) => e['@id'] === ORG_ID)).toEqual([]);

  // The visible trail and its BreadcrumbList, from the same items.
  const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
  expect(tags(trail, 'li')).toEqual(crumbs);
  const [breadcrumbs] = ofType(html, 'BreadcrumbList');
  const items = (breadcrumbs?.itemListElement ?? []) as Array<{ name: string }>;
  expect(items.map((item) => item.name)).toEqual(crumbs);

  // The last tile before the grey footer is white; no two tiles in a row share a tone.
  const tones = sectionTones(html);
  expect(tones.at(-1)).toBe('light');
  return tones;
}

/** The map facade: closed, lazy, the embed URL; directions outside it. */
function mapFacadeChecks(html: string) {
  const maps = detailsBlocks(html).filter((d) => d.body.includes('<iframe'));
  expect(maps).toHaveLength(1);
  const [map] = maps;
  expect(map!.attrs).not.toMatch(/\bopen\b/);
  const iframe = map!.body.match(/<iframe\b[^>]*>/)?.[0] ?? '';
  expect(iframe).toContain('loading="lazy"');
  expect(decode(iframe)).toContain(`src="${mapsEmbedUrl()}"`);
  expect(iframe).toMatch(/title="[^"]+"/);
  // No iframe outside the facade (nothing from Google on load).
  expect(html.match(/<iframe\b/g)).toHaveLength(1);

  const outside = html.replace(/<details\b[\s\S]*?<\/details>/g, '');
  expect(decode(outside)).toContain(`href="${mapsDirectionsUrl()}" target="_blank" rel="noopener noreferrer"`);
}

describe('/locations', () => {
  const html = renderToStaticMarkup(LocationsModule.default());
  const text = textOf(html);

  it('keeps its metadata', () => {
    const { metadata } = LocationsModule;
    expect(metadata.title).toBe(locationsPage.meta.title);
    expect(metadata.description).toBe(locationsPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/locations'));
    expect(metadata.openGraph).toMatchObject({
      title: locationsPage.meta.ogTitle,
      description: locationsPage.meta.ogDescription,
      url: absoluteUrl('/locations'),
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('leads with "Based in Songwe. Connected through Tunduma." and the credited Songwe landscape', () => {
    const tones = commonChecks(html, ['Home', 'Locations']);
    expect(tags(html, 'h1')).toEqual([headlineText(locationsPage.hero.headline)]);
    const hero = html.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(photos(hero)).toEqual([location.image!.src]);
    expect(textOf(hero)).toContain(SONGWE_CREDIT);
    // The hero photograph is the LCP image: eager (priority), never faded in.
    expect(hero).not.toContain('loading="lazy"');
    expect(hero).not.toContain('data-reveal');
    expect(tones).toEqual(['light', 'alt', 'light', 'alt', 'light']);
  });

  it('tells the corridor story (the home section, reused) and lists the head office', () => {
    expect(text).toContain('Where Tanzania meets Zambia.');
    expect(html).toContain('class="corridor-story');
    expect(tags(html, 'h2')).toContain(location.title);
    for (const line of location.addressLines) expect(text).toContain(line);
    expect(hrefs(html)).toContain(`/locations/${location.slug}`);
    for (const company of companies) expect(hrefs(html)).toContain(companyUrl(company.slug));
    // No map on the index (nothing from Google on load): the directions link is enough.
    expect(html).not.toContain('<iframe');
    expect(decode(html)).toContain(`href="${mapsDirectionsUrl()}" target="_blank" rel="noopener noreferrer"`);
  });

  it('links every connected service, and has no enquiry form', () => {
    for (const slug of location.serviceSlugs) expect(hrefs(html)).toContain(`/services/${slug}`);
    expect(html).not.toContain('data-enquiry-router');
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/contact', contact.whatsapp, telHref(contact.primaryPhone)]));
  });

  it('describes itself as a CollectionPage of the location profiles', () => {
    const [page] = ofType(html, 'CollectionPage');
    expect(page).toMatchObject({ '@id': `${absoluteUrl('/locations')}#locations`, name: locationsPage.meta.ogTitle, about: { '@id': ORG_ID } });
    const list = (page!.mainEntity as { itemListElement: Array<{ url: string }> }).itemListElement;
    expect(list.map((item) => item.url)).toEqual(locationProfiles.map((l) => absoluteUrl(`/locations/${l.slug}`)));
  });
});

describe('/locations/[slug]', () => {
  it('exists for the location profiles only', async () => {
    expect(LocationModule.dynamicParams).toBe(false);
    expect(LocationModule.generateStaticParams()).toEqual(locationProfiles.map((l) => ({ slug: l.slug })));
    await expect(LocationModule.default({ params: Promise.resolve({ slug: 'unknown' }) })).rejects.toThrow();
  });

  it('keeps its metadata, keywords and og:title', async () => {
    const metadata = await LocationModule.generateMetadata({ params: Promise.resolve({ slug: location.slug }) });
    expect(metadata.title).toBe(location.shortTitle);
    expect(metadata.description).toBe(location.metaDescription);
    expect(metadata.keywords).toEqual(location.searchTerms);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(`/locations/${location.slug}`));
    expect(metadata.openGraph).toMatchObject({ title: `${location.title} | ${site.name}`, type: 'website', url: absoluteUrl(`/locations/${location.slug}`) });
  });

  it('renders the profile: hero, facts, the map facade, the advantages, services, companies, FAQs and the form', async () => {
    const html = renderToStaticMarkup(await LocationModule.default({ params: Promise.resolve({ slug: location.slug }) }));
    const text = textOf(html);
    const tones = commonChecks(html, ['Home', 'Locations', location.shortTitle]);
    expect(tags(html, 'h1')).toEqual([location.title]);
    expect(location.lede.length).toBeLessThanOrEqual(110);
    expect(tones.slice(2)).toEqual(['alt', 'light', 'alt', 'light', 'alt', 'light']);

    // The hero's visual is typographic (no photograph of the head office itself).
    const hero = html.match(/<section[^>]*aria-labelledby="page-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hero).toContain('data-type-panel=""');
    expect(photos(hero)).toEqual([]);

    for (const fact of location.facts) expect(text).toContain(fact.value);
    for (const advantage of location.advantages) expect(tags(html, 'h3')).toContain(advantage.title);
    for (const slug of location.serviceSlugs) expect(hrefs(html)).toContain(`/services/${slug}`);
    for (const slug of location.companySlugs) expect(hrefs(html)).toContain(companyUrl(slug));
    mapFacadeChecks(html);

    // The compact form, general intent, in #enquire.
    const enquire = html.match(/<section[^>]*id="enquire"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(enquire.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(enquire).toContain('data-default-intent="general"');
    expect(enquire).not.toContain('name="organization"');
    expect(hrefs(html)).toContain('#enquire');

    // Every FAQ is a visible question, and the FAQPage lists exactly those.
    const [faqPage] = ofType(html, 'FAQPage');
    const questions = (faqPage!.mainEntity as Array<{ name: string }>).map((q) => q.name);
    expect(questions).toEqual(location.faqs.map((f) => f.question));
    for (const question of questions) expect(tags(html, 'h3')).toContain(question);
  });

  it('describes the place and the head office, each pointing at the group', async () => {
    const html = renderToStaticMarkup(await LocationModule.default({ params: Promise.resolve({ slug: location.slug }) }));
    const url = absoluteUrl(`/locations/${location.slug}`);
    expect(ofType(html, 'Place')[0]).toMatchObject({ '@id': `${url}#place`, name: location.title, url });
    const business = ofType(html, 'LocalBusiness')[0]!;
    expect(business).toMatchObject({ '@id': `${url}#business`, name: HEAD_OFFICE_NAME, parentOrganization: { '@id': ORG_ID } });
    expect(business.makesOffer).toHaveLength(location.serviceSlugs.length);
  });
});

describe('/contact', () => {
  const html = renderToStaticMarkup(ContactModule.default());
  const text = textOf(html);

  it('keeps its metadata', () => {
    const { metadata } = ContactModule;
    expect(metadata.title).toBe(contactPage.meta.title);
    expect(metadata.description).toBe(contactPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/contact'));
    expect(metadata.openGraph).toMatchObject({ title: contactPage.meta.ogTitle, description: contactPage.meta.ogDescription });
  });

  it('puts the full enquiry form (general intent) straight after the hero', () => {
    const tones = commonChecks(html, ['Home', 'Contact']);
    expect(tags(html, 'h1')).toEqual([headlineText(contactPage.hero.headline)]);
    expect(tones).toEqual(['light', 'alt', 'light', 'alt', 'light']);
    const sections = [...html.matchAll(/<section\b([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(sections[1]).toContain('id="enquire"');
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html).toContain('data-default-intent="general"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="organization"');
  });

  it('shows the contact cards from src/content/contact.ts, in the forms ConversionTracker classifies', () => {
    const links = hrefs(html);
    expect(links).toEqual(
      expect.arrayContaining([
        telHref(contact.primaryPhone),
        telHref(contact.secondaryPhone),
        contact.whatsapp,
        mailtoWithSubject(businessEnquirySubject),
      ]),
    );
    for (const value of [contact.primaryPhoneDisplay, contact.secondaryPhoneDisplay, contact.email, ...contact.headOfficeLines, ...contact.postalLines]) {
      expect(text).toContain(value);
    }
    mapFacadeChecks(html);
  });

  it('links the companies and the other routes, and never sends visitors to the subsidiaries directly', () => {
    for (const company of companies) expect(hrefs(html)).toContain(companyUrl(company.slug));
    for (const link of contactPage.help.links) expect(hrefs(html)).toContain(link.href);
    expect(text).not.toMatch(/subsidiary company directly|contacting the relevant subsidiary/i);
  });

  it('describes itself as a ContactPage with the group contact point', () => {
    const [page] = ofType(html, 'ContactPage');
    expect(page).toMatchObject({ '@id': `${absoluteUrl('/contact')}#contact`, name: contactPage.meta.ogTitle, about: { '@id': ORG_ID } });
    expect((page!.contactPoint as Array<Record<string, unknown>>)[0]).toMatchObject({ telephone: contact.primaryPhone, email: contact.email });
  });
});
