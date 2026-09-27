/**
 * FAQs: the group and partnership sets, plus the 12 topic sections of /faq
 * (partnerships, group, each company, each service, each location) with the
 * anchor ids other pages link to.
 */
import 'server-only';
import { companies, getCompanyBySlug } from './companies';
import { flags } from './flags';
import { locationProfiles } from './locations';
import { serviceAreas, serviceIcons } from './services';
import { companyUrl, locationUrl, serviceUrl } from './site';
import type { AccentKey, ContentIcon, Faq, SplitHeadline } from './types';

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

/** The four families of /faq topics, in page order. */
export type FaqSectionKind = 'group' | 'company' | 'service' | 'location';

export type FaqSection = {
  /** Anchor id on /faq (stable: other pages and JSON-LD link to it). */
  id: string;
  kind: FaqSectionKind;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  /** The topic's line icon and accent (the company that runs it; group gold for the group). */
  icon: ContentIcon;
  accent: AccentKey;
  faqs: readonly Faq[];
};

/**
 * The /faq topic sections in page order: the group family (partnerships,
 * the group), the three companies, the six sectors and the location. /faq
 * renders the flag-resolved group set; `groupFaqs` overrides it for a
 * caller that must show another wording (the legacy origin/main set).
 */
export function faqSections(options: { groupFaqs?: readonly Faq[] } = {}): FaqSection[] {
  return [
    {
      id: 'partnerships',
      kind: 'group',
      eyebrow: 'Partnerships',
      title: 'Partnerships and Supplier Enquiries',
      description: 'Questions for suppliers, bulk buyers, logistics customers, contractors, and regional business partners.',
      href: '/partnerships',
      linkLabel: 'View partnerships',
      icon: 'document',
      accent: 'group',
      faqs: partnershipFaqs,
    },
    {
      id: 'group',
      kind: 'group',
      eyebrow: 'Group',
      title: 'Itemba Group',
      description: 'Core questions about the group structure, sectors, and enquiry channels.',
      href: '/company-profile',
      linkLabel: 'View company profile',
      icon: 'globe',
      accent: 'group',
      faqs: options.groupFaqs ?? groupFaqs,
    },
    ...companies.map(
      (company): FaqSection => ({
        id: `company-${company.slug}`,
        kind: 'company',
        eyebrow: company.eyebrow,
        title: company.name,
        // The one-sentence lede: the long summary reads as a national claim for Mwanjalisi Oil.
        description: company.lede,
        href: companyUrl(company.slug),
        linkLabel: 'View company',
        icon: serviceIcons[company.visual],
        accent: company.accent,
        faqs: company.faqs,
      }),
    ),
    ...serviceAreas.map((service): FaqSection => {
      const company = getCompanyBySlug(service.companySlug);
      return {
        id: `service-${service.slug}`,
        kind: 'service',
        // The company that runs the sector, by its short name (as on home).
        eyebrow: company?.shortName ?? service.companyName,
        title: service.title,
        description: service.summary,
        href: serviceUrl(service.slug),
        linkLabel: 'View service',
        icon: serviceIcons[service.visual],
        accent: company?.accent ?? 'group',
        faqs: service.faqs,
      };
    }),
    ...locationProfiles.map(
      (location): FaqSection => ({
        id: `location-${location.slug}`,
        kind: 'location',
        eyebrow: location.eyebrow,
        title: location.title,
        description: location.summary,
        href: locationUrl(location.slug),
        linkLabel: 'View location',
        icon: 'map-pin',
        accent: 'group',
        faqs: location.faqs,
      }),
    ),
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
    /** The hero's link to the enquiry form at the foot of the page. */
    ask: 'Ask the group office',
  },
  /** The breadcrumb trail's name for the page. */
  crumb: 'FAQ',
  topicsHeading: 'Browse topics',
  /** Under each topic tile: "4 questions". */
  questions: { one: 'question', other: 'questions' },
  /** The four topic families, as the page's chapters, in page order. */
  groups: {
    group: 'One group.',
    company: 'Three companies.',
    service: 'Six sectors.',
    location: 'One corridor.',
  } satisfies Record<FaqSectionKind, string>,
} as const;

/** The "Common Questions" block on /company-profile. */
export const profileFaqCopy = {
  title: 'Common Questions',
  body: 'Quick answers for customers, suppliers, and partners reviewing the group profile.',
} as const;
