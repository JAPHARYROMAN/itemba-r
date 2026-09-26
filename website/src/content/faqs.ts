/**
 * FAQs: the group and partnership sets, plus the 12 topic sections of /faq
 * (partnerships, group, each company, each service, each location) with the
 * anchor ids other pages link to.
 */
import 'server-only';
import { companies } from './companies';
import { flags } from './flags';
import { locationProfiles } from './locations';
import { serviceAreas } from './services';
import { companyUrl, locationUrl, serviceUrl } from './site';
import type { Faq, SplitHeadline } from './types';

export type { Faq } from './types';

/** Flag-resolved (`mentionManufacturing`). */
const groupSectorsAnswer = flags.mentionManufacturing
  ? 'The group operates across energy, trade, logistics, construction supplies, hospitality, parking, real estate, and manufacturing-related activities.'
  : 'The group operates across energy, trade, logistics, construction supplies, hospitality, parking, and real estate.';

export const groupFaqs: Faq[] = [
  {
    question: 'What is Itemba Group?',
    answer: 'Itemba Group is a Tanzanian multi-industry holding group headquartered in Mpemba-Tunduma, Songwe Region.',
  },
  {
    question: 'Which companies are part of Itemba Group?',
    answer: 'The group includes Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.',
  },
  {
    question: 'Which sectors does Itemba Group operate in?',
    answer: groupSectorsAnswer,
  },
  {
    question: 'How can business enquiries be submitted?',
    answer: 'Business enquiries can be submitted by phone, WhatsApp, or email through the contact details listed on the website.',
  },
];

export const partnershipFaqs: Faq[] = [
  {
    question: 'Can suppliers introduce products to Itemba Group?',
    answer:
      'Yes. Suppliers can submit introductions through the partnerships page or contact channels, and the enquiry can be routed to the relevant company or division.',
  },
  {
    question: 'Which partnership enquiries are most relevant?',
    answer:
      'Relevant enquiries include supplier introductions, bulk purchase requests, fuel and fleet enquiries, logistics customers, construction supply enquiries, hospitality, property, and local service opportunities.',
  },
  {
    question: 'How are partnership enquiries routed?',
    answer:
      'The group office reviews the enquiry type and routes it to Mwanjalisi Oil, Westsides Company, Itemba Enterprises, or a specific operating division.',
  },
  {
    question: 'Can one partnership enquiry cover multiple sectors?',
    answer:
      'Yes. If an enquiry covers multiple sectors, it can be submitted once and routed internally to the relevant operating teams.',
  },
];

export type FaqSection = {
  /** Anchor id on /faq (stable: other pages and JSON-LD link to it). */
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  faqs: readonly Faq[];
};

/**
 * The /faq topic sections in page order. `groupFaqs` overrides the group set
 * (the legacy page passes the verbatim origin/main copy).
 */
export function faqSections(options: { groupFaqs?: readonly Faq[] } = {}): FaqSection[] {
  return [
    {
      id: 'partnerships',
      eyebrow: 'Partnerships',
      title: 'Partnerships and Supplier Enquiries',
      description: 'Questions for suppliers, bulk buyers, logistics customers, contractors, and regional business partners.',
      href: '/partnerships',
      linkLabel: 'View partnerships',
      faqs: partnershipFaqs,
    },
    {
      id: 'group',
      eyebrow: 'Group',
      title: 'Itemba Group',
      description: 'Core questions about the group structure, sectors, and enquiry channels.',
      href: '/company-profile',
      linkLabel: 'View company profile',
      faqs: options.groupFaqs ?? groupFaqs,
    },
    ...companies.map((company) => ({
      id: `company-${company.slug}`,
      eyebrow: 'Company',
      title: company.name,
      description: company.summary,
      href: companyUrl(company.slug),
      linkLabel: 'View company',
      faqs: company.faqs,
    })),
    ...serviceAreas.map((service) => ({
      id: `service-${service.slug}`,
      eyebrow: 'Service',
      title: service.title,
      description: service.summary,
      href: serviceUrl(service.slug),
      linkLabel: 'View service',
      faqs: service.faqs,
    })),
    ...locationProfiles.map((location) => ({
      id: `location-${location.slug}`,
      eyebrow: 'Location',
      title: location.title,
      description: location.summary,
      href: locationUrl(location.slug),
      linkLabel: 'View location',
      faqs: location.faqs,
    })),
  ];
}

/** /faq page copy. */
export const faqPage = {
  meta: {
    title: 'Frequently Asked Questions',
    description:
      'Answers to common questions about Itemba Group, its companies, services, location, and business enquiry channels in Tanzania.',
    ogTitle: 'Itemba Group Frequently Asked Questions',
    ogDescription:
      'Answers about Itemba Group companies, fuel, trade, logistics, construction supplies, hospitality, real estate, and Songwe-Tunduma operations.',
  },
  hero: {
    eyebrow: 'Frequently asked questions',
    headline: { lead: 'Answers for', accent: 'customers and partners.' } satisfies SplitHeadline,
    lede: 'Quick answers about Itemba Group companies, services, location, and how to route business enquiries to the right operating team.',
  },
  topicsHeading: 'Browse topics',
} as const;

/** The "Common Questions" block on /company-profile. */
export const profileFaqCopy = {
  title: 'Common Questions',
  body: 'Quick answers for customers, suppliers, and partners reviewing the group profile.',
} as const;
