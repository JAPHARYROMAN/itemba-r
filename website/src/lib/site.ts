/**
 * The origin/main `@/lib/site` API, same export names, re-exported from
 * src/content/*. The frozen POST /api/enquiries handler reads `contact` and
 * `enquiryIntents` through it, so it stays (API-frozen: the names and their
 * behaviour; the values are the flag-resolved content every page shows).
 *
 * New code imports from `@/content/*` directly. Server-only in practice (it
 * re-exports server-only content modules); client components import
 * `@/content/contact` and `@/content/enquiry`.
 */
import { companies, type Company } from '@/content/companies';
import { absoluteUrl } from '@/content/site';
import type { Faq } from '@/content/types';

export type { Faq } from '@/content/types';
export type { EnquiryIntent } from '@/content/enquiry';
export type { ServiceArea } from '@/content/services';
export type { LocationProfile } from '@/content/locations';
export type { PartnershipArea } from '@/content/partnerships';
export type { InsightArticle } from '@/content/insights';

export { contact, mailtoWithSubject, whatsappWithMessage } from '@/content/contact';
export { enquiryIntents } from '@/content/enquiry';
export { absoluteUrl, companyUrl, coreRoutes, insightUrl, locationUrl, serviceUrl, site } from '@/content/site';
export { capabilityAreas } from '@/content/capabilities';
export { groupFaqs, partnershipFaqs } from '@/content/faqs';
export { insightArticles } from '@/content/insights';
export { locationProfiles } from '@/content/locations';
export { partnershipAreas } from '@/content/partnerships';
export { serviceAreas } from '@/content/services';

/** origin/main `companyProfiles`: the three companies, in public order. */
export const companyProfiles: readonly Company[] = companies;

/** origin/main BreadcrumbList builder (the typed builders arrive in src/lib/jsonld.ts). */
export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** origin/main FAQPage builder. */
export function faqJsonLd(faqs: readonly Faq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}
