/**
 * Typed JSON-LD builders (schema-dts). One group Organization, identified by
 * ORG_ID, is declared once per page by the root layout; every other entity
 * refers to it with `{ '@id': ORG_ID }` instead of re-declaring it.
 *
 * - URLs are absolute on www.itembagrouptz.com (absoluteUrl).
 * - Telephones are canonical E.164 with no separators.
 * - Entity ids are `<page url>#<fragment>` and stay stable across builds,
 *   so search engines can join the graph between pages.
 *
 * Render the results with <StructuredData> (src/ui/StructuredData.tsx),
 * which passes them to the frozen JsonLd component.
 *
 * Server-only: it reads the content modules.
 */
import 'server-only';
import type {
  Article,
  Blog,
  BreadcrumbList,
  ContactPoint,
  FAQPage,
  IdReference,
  LocalBusiness,
  Offer,
  Organization,
  Place,
  PostalAddress,
  Service,
  WebPage,
  WebSite,
  WithContext,
} from 'schema-dts';
import { companies, companyAreaServed, type Company } from '@/content/companies';
import { contact } from '@/content/contact';
import type { InsightArticle } from '@/content/insights';
import { locationAreaServed, type LocationProfile } from '@/content/locations';
import { serviceAreaServed, serviceAreas, type ServiceArea } from '@/content/services';
import { absoluteUrl, companyUrl, insightUrl, locationUrl, serviceUrl, site } from '@/content/site';
import type { Faq } from '@/content/types';

const CONTEXT = 'https://schema.org' as const;

/** The group Organization's @id: https://www.itembagrouptz.com/#organization */
export const ORG_ID = `${absoluteUrl('/')}#organization`;
/** The WebSite's @id: https://www.itembagrouptz.com/#website */
export const WEBSITE_ID = `${absoluteUrl('/')}#website`;

/** A reference to the group Organization. */
export const orgRef: IdReference = { '@id': ORG_ID };

/** `<absolute page url>#<fragment>` */
export function entityId(path: string, fragment: string): string {
  return `${absoluteUrl(path)}#${fragment}`;
}

/** @id of a company's LocalBusiness (its company page); shared by the group's subOrganization entry. */
export function companyEntityId(slug: string): string {
  return entityId(companyUrl(slug), 'business');
}

/** The contactType every group ContactPoint uses. */
export const CONTACT_TYPE = 'business enquiries';

/** The Songwe-Tunduma page's LocalBusiness name (distinct from the group, so the group is not re-declared). */
export const HEAD_OFFICE_NAME = `${site.name} Head Office`;

/** The head office as a PostalAddress. */
export function postalAddress(): PostalAddress {
  return {
    '@type': 'PostalAddress',
    streetAddress: contact.address.street,
    addressLocality: contact.address.locality,
    addressRegion: contact.address.region,
    addressCountry: contact.address.countryCode,
    postOfficeBoxNumber: contact.address.postOfficeBox,
  };
}

function groupContactPoint(): ContactPoint {
  return {
    '@type': 'ContactPoint',
    telephone: contact.primaryPhone,
    email: contact.email,
    contactType: CONTACT_TYPE,
    areaServed: [...contact.areaServed],
    availableLanguage: [...contact.availableLanguages],
  };
}

function serviceOffers(names: readonly string[]): Offer[] {
  return names.map((name) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name } }));
}

/* ── Site-wide (root layout) ──────────────────────────────────────────── */

/** The group. Rendered once per page, by the root layout. */
export function organizationJsonLd(): WithContext<Organization> {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': ORG_ID,
    name: site.name,
    url: site.url,
    // The navy lockup: the white /logo.png is invisible on a white background.
    logo: absoluteUrl('/logo-print.png'),
    email: contact.email,
    telephone: [contact.primaryPhone, contact.secondaryPhone],
    address: postalAddress(),
    contactPoint: [groupContactPoint()],
    subOrganization: companies.map((company) => ({
      '@type': 'Organization',
      '@id': companyEntityId(company.slug),
      name: company.name,
      legalName: company.legalName,
      url: absoluteUrl(companyUrl(company.slug)),
    })),
  };
}

export function websiteJsonLd(): WithContext<WebSite> {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: site.name,
    url: site.url,
    inLanguage: site.language,
    publisher: orgRef,
  };
}

/* ── Page furniture ───────────────────────────────────────────────────── */

export type BreadcrumbItem = { name: string; path: string };

/**
 * The BreadcrumbList for a visible trail. Home first, the page itself last;
 * <Breadcrumbs> renders both from the same items.
 */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): WithContext<BreadcrumbList> {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * FAQPage for the questions rendered on the page (every question must be
 * visible; the contract test checks).
 */
export function faqPageJsonLd(faqs: readonly Faq[]): WithContext<FAQPage> {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

type WebPageType = 'WebPage' | 'AboutPage' | 'ContactPage' | 'CollectionPage';

export type WebPageInput = {
  type: WebPageType;
  name: string;
  path: string;
  /** @id fragment; defaults to the page type in lower case ("aboutpage"). */
  fragment?: string;
  description?: string;
  /** An ordered list of the things the page lists (CollectionPage). */
  items?: ReadonlyArray<{ name: string; path: string; description?: string }>;
  /** Contact points (ContactPage); defaults to the group's. */
  withContactPoint?: boolean;
};

/** A page about the group: AboutPage, ContactPage, CollectionPage or WebPage. */
export function webPageJsonLd(input: WebPageInput): WithContext<WebPage> {
  const url = absoluteUrl(input.path);
  const page: Record<string, unknown> = {
    '@context': CONTEXT,
    '@type': input.type,
    '@id': entityId(input.path, input.fragment ?? input.type.toLowerCase()),
    name: input.name,
    url,
    about: orgRef,
    isPartOf: { '@id': WEBSITE_ID },
  };
  if (input.description) page.description = input.description;
  if (input.items) {
    page.mainEntity = {
      '@type': 'ItemList',
      itemListElement: input.items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        url: absoluteUrl(item.path),
      })),
    };
  }
  if (input.withContactPoint) page.contactPoint = [groupContactPoint()];
  // The page type is chosen at run time, which schema-dts' per-type unions cannot express.
  return page as unknown as WithContext<WebPage>;
}

/* ── Entities ─────────────────────────────────────────────────────────── */

/** A company page's LocalBusiness, a child of the group. */
export function companyJsonLd(company: Company): WithContext<LocalBusiness> {
  return {
    '@context': CONTEXT,
    '@type': 'LocalBusiness',
    '@id': companyEntityId(company.slug),
    name: company.name,
    legalName: company.legalName,
    url: absoluteUrl(companyUrl(company.slug)),
    image: absoluteUrl(company.image.src),
    description: company.metaDescription,
    parentOrganization: orgRef,
    address: postalAddress(),
    telephone: contact.primaryPhone,
    email: contact.email,
    areaServed: [...companyAreaServed],
    makesOffer: serviceOffers(company.services),
  };
}

/** A service page's Service, provided by the company that runs it. */
export function serviceJsonLd(service: ServiceArea): WithContext<Service> {
  const url = absoluteUrl(serviceUrl(service.slug));
  return {
    '@context': CONTEXT,
    '@type': 'Service',
    '@id': `${url}#service`,
    name: service.title,
    serviceType: service.eyebrow,
    description: service.metaDescription,
    url,
    ...(service.image ? { image: absoluteUrl(service.image.src) } : {}),
    provider: {
      '@type': 'Organization',
      '@id': companyEntityId(service.companySlug),
      name: service.companyName,
      url: absoluteUrl(companyUrl(service.companySlug)),
      parentOrganization: orgRef,
    },
    areaServed: [...serviceAreaServed],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${service.title} offerings`,
      itemListElement: serviceOffers(service.offerings),
    },
  };
}

/** A location page's Place. */
export function placeJsonLd(location: LocationProfile): WithContext<Place> {
  const url = absoluteUrl(locationUrl(location.slug));
  return {
    '@context': CONTEXT,
    '@type': 'Place',
    '@id': `${url}#place`,
    name: location.title,
    url,
    description: location.metaDescription,
    ...(location.image ? { image: absoluteUrl(location.image.src) } : {}),
    address: postalAddress(),
    containedInPlace: { '@type': 'AdministrativeArea', name: contact.address.regionName },
  };
}

/**
 * The head office as a LocalBusiness on the location page. It is named
 * "Itemba Group Head Office" and points at the group as its parent, so the
 * group itself is only ever declared by the layout.
 */
export function headOfficeJsonLd(location: LocationProfile): WithContext<LocalBusiness> {
  const offered = serviceAreas.filter((service) => location.serviceSlugs.includes(service.slug));
  return {
    '@context': CONTEXT,
    '@type': 'LocalBusiness',
    '@id': entityId(locationUrl(location.slug), 'business'),
    name: HEAD_OFFICE_NAME,
    url: absoluteUrl(locationUrl(location.slug)),
    ...(location.image ? { image: absoluteUrl(location.image.src) } : {}),
    telephone: contact.primaryPhone,
    email: contact.email,
    address: postalAddress(),
    parentOrganization: orgRef,
    areaServed: [...locationAreaServed],
    makesOffer: offered.map((service) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: service.title, url: absoluteUrl(serviceUrl(service.slug)) },
    })),
  };
}

/**
 * The insights index as a Blog (@id `<path>#insights`, the baseline's),
 * part of the WebSite and published by the group, listing each article as
 * a BlogPosting with its dates and its OG card as the image.
 */
export function blogJsonLd(input: {
  name: string;
  description: string;
  path: string;
  articles: readonly InsightArticle[];
}): WithContext<Blog> {
  return {
    '@context': CONTEXT,
    '@type': 'Blog',
    '@id': entityId(input.path, 'insights'),
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    inLanguage: site.language,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: orgRef,
    blogPost: input.articles.map((article) => {
      const path = insightUrl(article.slug);
      return {
        '@type': 'BlogPosting',
        headline: article.title,
        description: article.metaDescription,
        url: absoluteUrl(path),
        image: absoluteUrl(`${path}/opengraph-image`),
        datePublished: article.publishedAt,
        dateModified: article.updatedAt,
        author: orgRef,
        publisher: orgRef,
      };
    }),
  };
}

/**
 * An insight article. Its dates must also be shown on the page, in a
 * `<time datetime>`. `image` defaults to the article's own OG card.
 */
export function articleJsonLd(article: InsightArticle, options: { image?: string } = {}): WithContext<Article> {
  const path = insightUrl(article.slug);
  const url = absoluteUrl(path);
  const about = serviceAreas.filter((service) => article.serviceSlugs.includes(service.slug));
  return {
    '@context': CONTEXT,
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: article.title,
    description: article.metaDescription,
    url,
    image: absoluteUrl(options.image ?? `${path}/opengraph-image`),
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: orgRef,
    publisher: orgRef,
    mainEntityOfPage: url,
    inLanguage: site.language,
    ...(about.length
      ? { about: about.map((service) => ({ '@type': 'Service' as const, name: service.title, url: absoluteUrl(serviceUrl(service.slug)) })) }
      : {}),
  };
}
