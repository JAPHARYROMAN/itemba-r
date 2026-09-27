/**
 * /contact page copy. Contact details themselves (numbers, email, addresses)
 * come from ./contact, the one place they are spelled out.
 */
import 'server-only';
import type { ContentIcon, Gated, LinkItem, SplitHeadline } from './types';

export type ContextCard = Gated & {
  id: 'location' | 'connections' | 'growth';
  icon: ContentIcon;
  title: string;
  summary: string;
};

export type HelpLink = LinkItem & {
  description: string;
};

export const contactPage = {
  meta: {
    title: 'Contact',
    description:
      'Contact Itemba Group for business enquiries, partnerships, fuel, trade, logistics, hospitality, real estate, and group information.',
    ogTitle: 'Contact Itemba Group',
    ogDescription:
      'Reach Itemba Group headquarters in Mpemba-Tunduma, Songwe Region, Tanzania.',
  },
  hero: {
    eyebrow: 'Get in touch',
    headline: { lead: 'Contact', accent: 'Itemba Group' } satisfies SplitHeadline,
    lede: 'Reach out for business enquiries, partnerships, or general information about our companies and operations.',
    /** The pill: down to the enquiry form on this page. */
    enquire: 'Start an enquiry',
  },
  /** The enquiry form's section: the routing promise and how an enquiry travels, beside the full form. */
  enquire: {
    eyebrow: 'Enquire',
    title: 'Tell us what you need.',
    body: 'One group office routes every enquiry to the right company.',
    stepsLabel: 'How it works',
    steps: [
      { title: 'Choose who it is for', body: 'Start with General, or pick the company you already know you need.' },
      { title: 'Say how to reach you', body: 'Your name, a phone number, email or WhatsApp number, and a short message.' },
      { title: 'The group office routes it', body: 'Your enquiry reaches the right company team through one front door.' },
    ],
  },
  findUs: {
    eyebrow: 'Find us',
    title: 'Group headquarters',
    headOfficeLabel: 'Head office',
    postalLabel: 'Postal address',
    phoneLabel: 'Phone',
    emailLabel: 'Email',
    whatsappLabel: 'WhatsApp',
    /** The WhatsApp card's link (the prepared general-enquiry message). */
    whatsappAction: 'Message the group office',
  },
  quickActions: {
    call: 'Call',
    whatsapp: 'WhatsApp',
    email: 'Email',
  },
  mapTitle: 'Itemba Group headquarters map',
  companies: {
    heading: 'Our companies',
    lede: 'Three legally independent companies, one group office. Every enquiry reaches the right company team through it.',
    action: 'Learn more',
  },
  /** Where to go next for what the form does not cover (the legacy "Business enquiries" links, plus the profile). */
  help: {
    heading: 'More ways we can help',
    action: 'Learn more',
    links: [
      {
        label: 'Partnership enquiry routes',
        href: '/partnerships',
        description: 'Supplier introductions, bulk purchase enquiries and partnership opportunities with the group.',
      },
      {
        label: 'Frequently asked questions',
        href: '/faq',
        description: 'Answers about the companies, their services and the Songwe-Tunduma base.',
      },
      {
        label: 'Company profile',
        href: '/company-profile',
        description: 'The group profile and capability statement for banks and partners, with PDF downloads.',
      },
    ] satisfies readonly HelpLink[],
  },
  contextHeading: 'Why Mpemba-Tunduma',
  contextCards: [
    {
      id: 'location',
      icon: 'map-pin',
      title: 'Strategic location',
      summary: 'Mpemba-Tunduma sits on the Tanzania–Zambia border, on the Tunduma trade corridor.',
    },
    {
      id: 'connections',
      icon: 'logistics',
      title: 'Regional connections',
      summary: 'Direct access to cross-border trade flows and a wide network of regional business partners.',
    },
    {
      id: 'growth',
      icon: 'trade',
      title: 'Growing economy',
      summary: "Songwe Region is one of Tanzania's fastest-growing regions, driven by trade and infrastructure investment.",
      requires: 'songweGrowthClaim',
    },
  ] satisfies readonly ContextCard[],
} as const;
