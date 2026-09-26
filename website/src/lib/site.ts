/**
 * Legacy barrel: the origin/main `@/lib/site` API, same export names, now
 * re-exported from src/content/*. The frozen POST /api/enquiries handler
 * (contact, enquiryIntents) and og-card (site) depend on it, so it stays.
 *
 * New code imports from `@/content/*` directly. Values here are the
 * origin/main ones: where a content flag changes copy (see
 * src/content/legacy.ts), this barrel pins the origin/main text so the
 * legacy pages render unchanged until their rebuild. The legacy Tailwind
 * accent classes on `companyProfiles` live here, not in content, and go
 * with the legacy pages (WP3.1).
 *
 * Server-only in practice (it re-exports server-only content modules);
 * client components import `@/content/contact` and `@/content/enquiry`.
 */
import { companies, type Company } from '@/content/companies';
import { groupFaqs as contentGroupFaqs } from '@/content/faqs';
import { legacyCopy } from '@/content/legacy';
import { absoluteUrl, site as contentSite } from '@/content/site';
import type { CompanyId, Faq } from '@/content/types';

export type { Faq } from '@/content/types';
export type { EnquiryIntent } from '@/content/enquiry';
export type { ServiceArea } from '@/content/services';
export type { LocationProfile } from '@/content/locations';
export type { PartnershipArea } from '@/content/partnerships';
export type { InsightArticle } from '@/content/insights';

export { contact, mailtoWithSubject, whatsappWithMessage } from '@/content/contact';
export { enquiryIntents } from '@/content/enquiry';
export { absoluteUrl, companyUrl, coreRoutes, insightUrl, locationUrl, serviceUrl } from '@/content/site';
export { capabilityAreas } from '@/content/capabilities';
export { partnershipFaqs } from '@/content/faqs';
export { insightArticles } from '@/content/insights';
export { locationProfiles } from '@/content/locations';
export { partnershipAreas } from '@/content/partnerships';
export { serviceAreas } from '@/content/services';

/** origin/main `site` (description pinned to the legacy wording). */
export const site = {
  ...contentSite,
  description: legacyCopy.siteDescription,
};

/** origin/main group FAQs (the sectors answer pinned to the legacy wording). */
export const groupFaqs: Faq[] = contentGroupFaqs.map((faq) =>
  faq.question === 'Which sectors does Itemba Group operate in?' ? { ...faq, answer: legacyCopy.groupSectorsAnswer } : faq,
);

/** Legacy Tailwind accent classes per company (origin/main values). */
const legacyCompanyAccent: Record<CompanyId, { accentBg: string; accentClass: string; accentBorder: string }> = {
  mwanjalisi: { accentBg: 'bg-amber-500', accentClass: 'text-amber-400', accentBorder: 'border-amber-500/30' },
  westsides: { accentBg: 'bg-blue-500', accentClass: 'text-blue-400', accentBorder: 'border-blue-500/30' },
  enterprises: { accentBg: 'bg-emerald-500', accentClass: 'text-emerald-400', accentBorder: 'border-emerald-500/30' },
};

export type LegacyCompanyProfile = Company & { accentBg: string; accentClass: string; accentBorder: string };

/** origin/main `companyProfiles`: the content companies plus their legacy accent classes. */
export const companyProfiles: readonly LegacyCompanyProfile[] = companies.map((company) => ({
  ...company,
  ...legacyCompanyAccent[company.id],
}));

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
