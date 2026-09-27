/**
 * /contact page copy. Contact details themselves come from ./contact.
 */
import 'server-only';
import type { Gated, SplitHeadline } from './types';

export type ContextCard = Gated & {
  id: 'location' | 'connections' | 'growth';
  title: string;
  summary: string;
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
  },
  findUs: {
    eyebrow: 'Find us',
    title: 'Group headquarters',
    headOfficeLabel: 'Head office',
    postalLabel: 'Postal address',
    phoneLabel: 'Phone',
    emailLabel: 'Email',
  },
  businessNote: {
    title: 'Business enquiries',
    /**
     * origin/main wording. The plan drops this sentence in the rebuilt page
     * (one group office routes every enquiry); kept verbatim until then.
     */
    body:
      'For sector-specific enquiries, we recommend contacting the relevant subsidiary company directly. Each company operates with its own team and management structure.',
    links: [
      { label: 'Partnership enquiry routes', href: '/partnerships' },
      { label: 'Browse frequently asked questions', href: '/faq' },
    ],
  },
  quickActions: {
    call: 'Call',
    whatsapp: 'WhatsApp',
    email: 'Email',
  },
  mapTitle: 'Itemba Group headquarters map',
  companiesHeading: 'Our companies',
  contextCards: [
    {
      id: 'location',
      title: 'Strategic location',
      summary: "Mpemba-Tunduma sits on the Tanzania–Zambia border — one of East Africa's most active trade corridors.",
    },
    {
      id: 'connections',
      title: 'Regional connections',
      summary: 'Direct access to cross-border trade flows and a wide network of regional business partners.',
    },
    {
      id: 'growth',
      title: 'Growing economy',
      summary: "Songwe Region is one of Tanzania's fastest-growing regions, driven by trade and infrastructure investment.",
      requires: 'songweGrowthClaim',
    },
  ] satisfies readonly ContextCard[],
} as const;
