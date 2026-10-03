/**
 * src/lib/seo.ts and src/lib/jsonld.ts (architecture §6).
 *
 * pageMetadata: absolute canonical and og:url (the root resolves to the bare
 * origin, as in the baseline), a complete openGraph object with no `images`
 * key (so the route's opengraph-image file applies), twitter card only.
 *
 * JSON-LD: one group @id, referenced rather than re-declared; E.164
 * telephones; the logo that is visible on white; company, service, place,
 * head office and article entities joined to the group.
 */
import { describe, expect, it } from 'vitest';
import { resolveAbsoluteUrlWithPathname } from 'next/dist/lib/metadata/resolvers/resolve-url';
import { companies } from '@/content/companies';
import { contact } from '@/content/contact';
import { insightArticles } from '@/content/insights';
import { locationProfiles } from '@/content/locations';
import { serviceAreas } from '@/content/services';
import { absoluteUrl, site } from '@/content/site';
import {
  HEAD_OFFICE_NAME,
  ORG_ID,
  WEBSITE_ID,
  articleJsonLd,
  breadcrumbJsonLd,
  companyEntityId,
  companyJsonLd,
  faqPageJsonLd,
  headOfficeJsonLd,
  organizationJsonLd,
  placeJsonLd,
  serviceJsonLd,
  webPageJsonLd,
  websiteJsonLd,
} from '@/lib/jsonld';
import { documentTitle, pageMetadata } from '@/lib/seo';

const E164 = /^\+[1-9]\d{7,14}$/;

describe('pageMetadata', () => {
  const about = pageMetadata({
    title: 'About Us',
    description: 'About the group.',
    path: '/about',
    ogTitle: 'About Itemba Group',
    keywords: ['Itemba', 'Songwe'],
  });

  it('sets an absolute canonical and og:url', () => {
    expect(about.alternates?.canonical).toBe(`${site.url}/about`);
    expect(about.openGraph).toMatchObject({ url: `${site.url}/about`, siteName: site.name, locale: site.locale, type: 'website' });
  });

  it('resolves the home canonical to the bare origin, as the baseline has it', () => {
    const home = pageMetadata({ title: { absolute: site.title }, description: 'd', path: '/' });
    const resolved = resolveAbsoluteUrlWithPathname(home.alternates!.canonical as string, new URL(site.url), '/', { trailingSlash: false, isStaticMetadataRouteFile: false });
    expect(resolved).toBe('https://www.itembagrouptz.com');
    expect(home.title).toEqual({ absolute: site.title });
    expect(home.openGraph?.title).toBe(site.title);
  });

  it('never owns openGraph.images, so the file-based card applies', () => {
    expect(Object.prototype.hasOwnProperty.call(about.openGraph, 'images')).toBe(false);
    const article = pageMetadata({ title: 't', description: 'd', path: '/insights/x', type: 'article', publishedTime: '2026-05-14' });
    expect(Object.prototype.hasOwnProperty.call(article.openGraph, 'images')).toBe(false);
  });

  it('lets twitter inherit from openGraph (card only)', () => {
    expect(about.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('defaults og copy to the document title and description', () => {
    const page = pageMetadata({ title: 'Contact', description: 'Reach the group office.', path: '/contact' });
    expect(page.openGraph?.title).toBe(`Contact | ${site.name}`);
    expect(page.openGraph?.description).toBe('Reach the group office.');
    expect(documentTitle('Contact')).toBe(`Contact | ${site.name}`);
    expect(about.openGraph?.title).toBe('About Itemba Group');
    expect(about.keywords).toEqual(['Itemba', 'Songwe']);
  });

  it('carries article dates and noindex', () => {
    const article = pageMetadata({
      title: 'A',
      description: 'd',
      path: '/insights/a',
      type: 'article',
      publishedTime: '2026-05-14',
      modifiedTime: '2026-06-01',
    });
    expect(article.openGraph).toMatchObject({ type: 'article', publishedTime: '2026-05-14', modifiedTime: '2026-06-01' });
    expect(pageMetadata({ title: 'x', description: 'd', path: '/x', noindex: true }).robots).toEqual({ index: false, follow: true });
    expect(about.robots).toBeUndefined();
  });
});

describe('JSON-LD: the group', () => {
  const org = organizationJsonLd() as unknown as Record<string, unknown>;

  it('has one stable @id', () => {
    expect(ORG_ID).toBe('https://www.itembagrouptz.com/#organization');
    expect(WEBSITE_ID).toBe('https://www.itembagrouptz.com/#website');
    expect(org['@id']).toBe(ORG_ID);
    expect(org['@context']).toBe('https://schema.org');
    expect((websiteJsonLd() as unknown as Record<string, unknown>).publisher).toEqual({ '@id': ORG_ID });
  });

  it('uses E.164 telephones, the numeric PO box and the logo that shows on white', () => {
    expect(org.telephone).toEqual([contact.primaryPhone, contact.secondaryPhone]);
    for (const phone of org.telephone as string[]) expect(phone).toMatch(E164);
    expect(org.logo).toBe(absoluteUrl('/logo-print.png'));
    expect(org.address).toMatchObject({ postOfficeBoxNumber: '132', addressCountry: 'TZ' });
  });

  it('lists the three companies with the same @id their pages use', () => {
    const subs = org.subOrganization as Array<Record<string, unknown>>;
    expect(subs.map((s) => s['@id'])).toEqual(companies.map((c) => companyEntityId(c.slug)));
    for (const company of companies) {
      expect((companyJsonLd(company) as unknown as Record<string, unknown>)['@id']).toBe(companyEntityId(company.slug));
    }
  });
});

describe('JSON-LD: entities reference the group, never re-declare it', () => {
  const entities: Array<Record<string, unknown>> = [
    ...companies.map((c) => companyJsonLd(c)),
    ...serviceAreas.map((s) => serviceJsonLd(s)),
    ...locationProfiles.map((l) => placeJsonLd(l)),
    ...locationProfiles.map((l) => headOfficeJsonLd(l)),
    ...insightArticles.map((a) => articleJsonLd(a)),
    webPageJsonLd({ type: 'ContactPage', name: 'Contact Itemba Group', path: '/contact', withContactPoint: true }),
  ] as unknown as Array<Record<string, unknown>>;

  function walk(node: unknown, visit: (n: Record<string, unknown>) => void) {
    if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
    else if (node && typeof node === 'object') {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  }

  it('every entity has @context and @type, and absolute URLs', () => {
    for (const e of entities) {
      expect(e['@context']).toBe('https://schema.org');
      expect(typeof e['@type']).toBe('string');
      walk(e, (n) => {
        for (const key of ['url', 'item', 'image', 'mainEntityOfPage']) {
          if (typeof n[key] === 'string') expect(n[key] as string).toMatch(/^https:\/\/www\.itembagrouptz\.com\//);
        }
      });
    }
  });

  it('no inline Organization named like the group; telephones are E.164', () => {
    for (const e of entities) {
      walk(e, (n) => {
        if (n['@type'] === 'Organization' || n['@type'] === 'LocalBusiness') expect(n.name).not.toBe(site.name);
        if (typeof n.telephone === 'string') expect(n.telephone).toMatch(E164);
      });
    }
    expect((headOfficeJsonLd(locationProfiles[0]!) as unknown as Record<string, unknown>).name).toBe(HEAD_OFFICE_NAME);
  });

  it('children point at the group by @id', () => {
    const company = companyJsonLd(companies[0]!) as unknown as Record<string, unknown>;
    expect(company.parentOrganization).toEqual({ '@id': ORG_ID });
    const service = serviceJsonLd(serviceAreas[0]!) as unknown as { provider: Record<string, unknown> };
    expect(service.provider.parentOrganization).toEqual({ '@id': ORG_ID });
    expect(service.provider['@id']).toBe(companyEntityId(serviceAreas[0]!.companySlug));
  });

  it('articles carry an image and ISO dates', () => {
    for (const article of insightArticles) {
      const ld = articleJsonLd(article) as unknown as Record<string, unknown>;
      expect(ld.image).toBe(absoluteUrl(`/insights/${article.slug}/opengraph-image`));
      expect(ld.datePublished).toBe(article.publishedAt);
      expect(Number.isNaN(Date.parse(ld.datePublished as string))).toBe(false);
      expect(ld.author).toEqual({ '@id': ORG_ID });
    }
  });
});

describe('JSON-LD: page furniture', () => {
  it('BreadcrumbList positions and absolute items', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Services', path: '/services' },
    ]) as unknown as { itemListElement: Array<Record<string, unknown>> };
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.itembagrouptz.com/' },
      { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://www.itembagrouptz.com/services' },
    ]);
  });

  it('FAQPage questions and answers', () => {
    const ld = faqPageJsonLd([{ question: 'Q?', answer: 'A.' }]) as unknown as { mainEntity: unknown[] };
    expect(ld.mainEntity).toEqual([{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } }]);
  });

  it('web pages are about the group and part of the site', () => {
    const ld = webPageJsonLd({
      type: 'CollectionPage',
      name: 'Capabilities',
      path: '/capabilities',
      fragment: 'capabilities',
      items: [{ name: 'Fuel', path: '/services/fuel-and-lubricants' }],
    }) as unknown as Record<string, unknown>;
    expect(ld['@id']).toBe('https://www.itembagrouptz.com/capabilities#capabilities');
    expect(ld.about).toEqual({ '@id': ORG_ID });
    expect(ld.isPartOf).toEqual({ '@id': WEBSITE_ID });
    expect(ld.mainEntity).toMatchObject({ '@type': 'ItemList', itemListElement: [{ position: 1, url: absoluteUrl('/services/fuel-and-lubricants') }] });
  });
});
