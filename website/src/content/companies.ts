/**
 * The three legally independent operating companies of Itemba Group.
 * Order is the public order everywhere: Mwanjalisi Oil, Westsides, Itemba Enterprises.
 */
import 'server-only';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanyId, CompanySlug, Faq, SectorVisual, SplitHeadline } from './types';

export type CompanyLegal = {
  tin: string;
  incorporationDate: string;
  incorporationNumber: string;
  status: string;
  directors: readonly string[];
};

export type Company = {
  /** Also the enquiry intent id that routes to this company. */
  id: CompanyId;
  slug: CompanySlug;
  /** Public name used in titles, e.g. "Mwanjalisi Oil Co Ltd". */
  name: string;
  /** Registered name as it appears on legal documents. */
  legalName: string;
  shortName: string;
  /** Accent token key. */
  accent: CompanyId;
  sector: string;
  eyebrow: string;
  visual: SectorVisual;
  summary: string;
  detail: string;
  services: readonly string[];
  highlights: readonly string[];
  image: MediaImage;
  gallery: readonly MediaFigure[];
  enquiryLabel: string;
  faqs: readonly Faq[];
  metaDescription: string;
  /** The company's band on the /companies index. */
  band: {
    sector: string;
    summary: string;
    chips: readonly string[];
    image: MediaImage;
  };
  legal: CompanyLegal;
  updatedAt: string;
};

export const companies: readonly Company[] = [
  {
    id: 'mwanjalisi',
    slug: 'mwanjalisi-oil',
    name: 'Mwanjalisi Oil Co Ltd',
    legalName: 'Mwanjalisi Oil Company Ltd',
    shortName: 'Mwanjalisi Oil',
    accent: 'mwanjalisi',
    sector: 'Energy, Fuel & Parking',
    eyebrow: 'Petroleum Retail & Parking',
    visual: 'fuel',
    summary:
      "Tanzania's petroleum retail and corridor support arm within Itemba Group, managing high-visibility ITEMBA-branded filling stations and UZUNGUNI PARKING YARD for motorists, fleet operators, and logistics customers across Songwe Region.",
    detail:
      "Positioned along major transport routes near the Tanzania-Zambia border, Mwanjalisi Oil manages retail fuel station operations that trade publicly under the ITEMBA location brand, including ITEMBA-MPEMBA near the Tunduma Bus Station and ITEMBA-UZUNGUNI along the TANZAM Highway. It also manages UZUNGUNI PARKING YARD in Uzunguni Area, Mpemba-Tunduma for corridor motorists and logistics operators.",
    services: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Commercial fleet supply enquiries'],
    highlights: [
      'ITEMBA-branded stations managed by Mwanjalisi Oil',
      'UZUNGUNI PARKING YARD managed by Mwanjalisi Oil',
      'Located along major corridor routes and near a major bus stand',
      'Serves motorists, fleets, and logistics operators',
      'Two operating stations with three upcoming fuel locations',
    ],
    image: mediaImage('mpemba-station-wide', {
      alt: 'ITEMBA-MPEMBA filling station forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
    }),
    gallery: [
      mediaFigure('mpemba-station-wide', {
        alt: 'ITEMBA filling station forecourt and canopy',
        caption: 'ITEMBA-branded fuel station presence under Mwanjalisi Oil management.',
      }),
      mediaFigure('mpemba-truck-canopy', {
        alt: 'Truck refuelling under the ITEMBA-MPEMBA canopy',
        caption: 'Forecourt access for trucks, buses, motorists, and corridor logistics operators.',
      }),
      mediaFigure('parking-yard-trucks', {
        alt: 'Truck parking at Uzunguni Parking Yard',
        caption: 'UZUNGUNI PARKING YARD supports corridor vehicle staging and parking.',
      }),
    ],
    enquiryLabel: 'Fuel supply enquiry',
    faqs: [
      {
        question: 'What products does Mwanjalisi Oil supply?',
        answer:
          'Mwanjalisi Oil manages ITEMBA-branded filling stations supplying diesel, petrol, kerosene, and lubricants, and also manages UZUNGUNI PARKING YARD for motorists, transport operators, and corridor logistics customers.',
      },
      {
        question: 'Where is Mwanjalisi Oil located?',
        answer:
          'The company operates from Songwe Region. Its current public-facing station brands include ITEMBA-MPEMBA near the Tunduma Bus Station and ITEMBA-UZUNGUNI in Uzunguni Area, Mpemba, with UZUNGUNI PARKING YARD also located in Uzunguni Area, Mpemba-Tunduma.',
      },
      {
        question: 'Can business fuel enquiries be submitted online?',
        answer:
          'Yes. Business customers can contact Itemba Group by phone, WhatsApp, or email and the enquiry will be routed to the relevant Mwanjalisi Oil team.',
      },
    ],
    metaDescription:
      'Mwanjalisi Oil Co Ltd manages ITEMBA-branded filling stations including ITEMBA-MPEMBA and ITEMBA-UZUNGUNI plus UZUNGUNI PARKING YARD, serving fuel, lubricants, and parking customers in Songwe Region, Tanzania.',
    band: {
      sector: 'Energy, Fuel & Parking',
      summary:
        "Tanzania's petroleum retail and corridor parking arm — managing ITEMBA-branded filling stations and UZUNGUNI PARKING YARD for businesses, transport operators, and communities across Songwe Region.",
      chips: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'Diesel', 'Petrol', 'Lubricants'],
      image: mediaImage('mpemba-station-wide', {
        alt: 'ITEMBA-MPEMBA forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
      }),
    },
    legal: {
      tin: '134-036-206',
      incorporationDate: '2 May 2017',
      incorporationNumber: '134897',
      status: 'Private company registered by BRELA',
      directors: [
        'Roman M Mwampuwa - Managing Director',
        'Japhary Roman Mwampuwa - Director',
        'Lucy Lendison Mgalla - Director',
      ],
    },
    updatedAt: contentUpdatedAt,
  },
  {
    id: 'westsides',
    slug: 'westsides-company',
    name: 'Westsides Company Ltd',
    legalName: 'Westsides Company Ltd',
    shortName: 'Westsides',
    accent: 'westsides',
    sector: 'Trade & Distribution',
    eyebrow: 'Wholesale & Retail Trade',
    visual: 'trade',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN operations for stockists, bars, night clubs, contractors, hospitality customers, and cross-border bulk buyers.',
    detail:
      "Westsides Company Ltd manages the group's trading and hospitality brands, including wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN. Its market includes more than 50 stockists across Songwe Region, bars and night clubs in urban centres such as Tunduma, Mlowo, and Vwawa, international bulk buyers moving goods through Tunduma border, and construction companies serving the growing real estate and infrastructure market.",
    services: ['Wholesale beverages', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', 'Construction equipment sales'],
    highlights: [
      'More than 50 beverage stockists across Songwe Region',
      'Serves bars, night clubs, and hospitality outlets',
      'Supports cross-border bulk buyers and construction companies',
    ],
    image: mediaImage('westsides-warehouse-stock', {
      alt: 'Westsides Company Ltd wholesale beverage warehouse stock for distribution customers',
    }),
    gallery: [
      mediaFigure('westsides-order-truck', {
        alt: 'Customer beverage order loaded on a truck for Westsides distribution',
        caption: 'Customer orders prepared for stockists and bulk buyers across Songwe Region.',
      }),
      mediaFigure('westsides-softdrinks', {
        alt: 'Soft drink stock inside a Westsides beverage warehouse',
        caption: 'Soft drink stock handled through Westsides wholesale distribution.',
      }),
      mediaFigure('hardware-paint-stock', {
        alt: 'ITEMBA-HARDWARE paint and construction supply stock',
        caption: 'ITEMBA-HARDWARE supports contractors, real estate, and infrastructure customers.',
      }),
      mediaFigure('inn-bar-restaurant', {
        alt: 'UZUNGUNI INN restaurant and bar seating',
        caption: 'UZUNGUNI INN adds lodging, restaurant, and bar services under Westsides.',
      }),
    ],
    enquiryLabel: 'Trade supply enquiry',
    faqs: [
      {
        question: 'What does Westsides Company distribute?',
        answer:
          'Westsides Company handles wholesale beverages and manages ITEMBA-HARDWARE for building materials, tools, construction equipment, and related supplies.',
      },
      {
        question: 'Who does Westsides Company serve?',
        answer:
          'The company serves more than 50 beverage stockists across Songwe Region, bars and night clubs in urban centres, international bulk buyers, contractors, construction companies, lodging and restaurant customers, and regional trade customers.',
      },
      {
        question: 'How should supplier or bulk purchase enquiries be sent?',
        answer:
          'Supplier and bulk purchase enquiries can be sent through the group phone, WhatsApp, or email channels listed on the contact page.',
      },
    ],
    metaDescription:
      'Westsides Company Ltd manages wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN for Songwe stockists, bars, cross-border buyers, and construction customers in Tanzania.',
    band: {
      sector: 'Trade & Distribution',
      summary:
        'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN — serving 50+ stockists, bars, night clubs, cross-border bulk buyers, and construction customers across Songwe Region.',
      chips: ['Wholesale beverages', '50+ stockists', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', 'Cross-border bulk sales'],
      image: mediaImage('westsides-warehouse-stock', {
        alt: 'Westsides Company Ltd beverage warehouse stock for wholesale distribution',
      }),
    },
    legal: {
      tin: '136-065-580',
      incorporationDate: '9 June 2017',
      incorporationNumber: '135764',
      status: 'Private company registered by BRELA',
      directors: [
        'Roman M Mwampuwa - Managing Director',
        'Isaac Roman Mwampuwa - Director',
        'Magreth Shale Mgalla - Director',
      ],
    },
    updatedAt: contentUpdatedAt,
  },
  {
    id: 'enterprises',
    slug: 'itemba-enterprises',
    name: 'Itemba Enterprises Co Ltd',
    legalName: 'Itemba Enterprises Co Ltd',
    shortName: 'Itemba Enterprises',
    accent: 'enterprises',
    sector: 'Logistics and Transit Operations',
    eyebrow: 'Logistics and Cross-Border Transit',
    visual: 'logistics',
    summary:
      "The group's logistics and emerging-business company, anchored by Dar es Salaam-to-Southern Highlands movement and cross-border transit through the Tunduma corridor.",
    detail:
      'Itemba Enterprises focuses on logistics services, cross-border transit, and emerging businesses after trading and hospitality operations were placed under Westsides Company Ltd and UZUNGUNI PARKING YARD came under Mwanjalisi Oil Co Ltd management. Its logistics target market includes local businesses sourcing goods from Dar es Salaam into the Southern Highlands regions of Songwe, Mbeya, Rukwa, Ruvuma, and Iringa, plus transit customers moving goods to and from Zambia, DRC, Zimbabwe, and Malawi.',
    services: ['Local logistics', 'Cross-border transit', 'Emerging businesses'],
    highlights: [
      'Dar es Salaam to Southern Highlands logistics',
      'Transit routes to Zambia, DRC, Zimbabwe, and Malawi',
      'Direct access to the Tunduma border corridor',
    ],
    image: mediaImage('logistics-tanker', {
      alt: 'Itemba Logistics fuel tanker supporting goods movement and transit operations',
    }),
    gallery: [
      mediaFigure('logistics-tanker', {
        alt: 'Itemba Logistics tanker truck under station canopy',
        caption: 'Itemba Logistics anchors local and cross-border movement for the group.',
      }),
      mediaFigure('logistics-truck-front', {
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet visibility for Southern Highlands and corridor operations.',
      }),
      mediaFigure('logistics-truck-yard', {
        alt: 'Itemba Logistics truck in a yard',
        caption: 'Yard-based movement support for local businesses and transit customers.',
      }),
    ],
    enquiryLabel: 'Operations enquiry',
    faqs: [
      {
        question: 'What are the Itemba Enterprises divisions?',
        answer: 'Itemba Enterprises focuses on Itemba Logistics, cross-border transit, and emerging business opportunities.',
      },
      {
        question: 'Does Itemba Enterprises handle cross-border logistics?',
        answer:
          'Yes. Logistics is the flagship activity and focuses on local goods movement from Dar es Salaam to the Southern Highlands, plus cross-border transit to and from Zambia, DRC, Zimbabwe, and Malawi through the Tunduma corridor.',
      },
      {
        question: 'Can one enquiry cover multiple divisions?',
        answer:
          'Yes. Send the enquiry through the group contact channels and it can be routed to the relevant operating division or divisions.',
      },
    ],
    metaDescription:
      'Itemba Enterprises Co Ltd operates logistics from Dar es Salaam to the Southern Highlands and cross-border transit services through Tunduma to Zambia, DRC, Zimbabwe, and Malawi.',
    band: {
      sector: 'Logistics & Transit',
      summary:
        "The group's logistics and emerging-business company — anchored by Dar es Salaam-to-Southern Highlands goods movement and cross-border transit through the Tunduma corridor.",
      chips: ['Dar → Southern Highlands', 'Cross-border transit', 'Emerging businesses'],
      image: mediaImage('logistics-tanker', {
        alt: 'Itemba Logistics tanker truck supporting local and transit movement',
      }),
    },
    legal: {
      tin: '116-321-378',
      incorporationDate: '20 January 2012',
      incorporationNumber: '88774',
      status: 'Private company registered under the Companies Act, 2002',
      directors: [
        'Roman M Mwampuwa - Managing Director',
        'Magreth Shale Mgalla - Director',
        'Lucy Lendison Mgalla - Director',
      ],
    },
    updatedAt: contentUpdatedAt,
  },
];

export function getCompanyBySlug(slug: string): Company | undefined {
  return companies.find((company) => company.slug === slug);
}

export function getCompanyById(id: string): Company | undefined {
  return companies.find((company) => company.id === id);
}

/** Mail subject for a company-specific enquiry (companies index). */
export function companyEnquirySubject(company: Pick<Company, 'name'>) {
  return `${company.name} business enquiry`;
}

/** Places a company serves, for its LocalBusiness JSON-LD. */
export const companyAreaServed = ['Songwe Region', 'Tunduma', 'Tanzania-Zambia corridor'] as const;

/** /companies index copy. */
export const companiesPage = {
  meta: {
    title: 'Our Companies',
    description:
      'Explore Itemba Group subsidiaries: Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.',
    ogTitle: 'Itemba Group Companies',
    ogDescription:
      'Three independent companies operating across energy, trade, logistics, hospitality, real estate, and construction.',
  },
  hero: {
    eyebrow: 'Our subsidiaries',
    headline: { lead: 'Three companies.', accent: 'Six sectors.' } satisfies SplitHeadline,
    lede:
      'Each subsidiary is legally and operationally independent — with its own identity, focus and market — unified under the Itemba Group structure on the Tanzania-Zambia corridor.',
  },
  actions: {
    profile: 'Open company profile',
    enquire: 'Send enquiry',
  },
} as const;

/** /companies/[slug] copy. */
export const companyPageCopy = {
  backLink: 'All companies',
  servicesHeading: 'Services & market focus',
  faqHeading: 'Frequently asked questions',
  strengthsHeading: 'Key strengths',
  sectorLabel: 'Sector',
  facts: [
    { label: 'Structure', value: 'Subsidiary of Itemba Group' },
    { label: 'Location', value: 'Songwe Region, Tanzania' },
  ],
} as const;
