/**
 * The three legally independent operating companies of Itemba Group.
 * Order is the public order everywhere: Mwanjalisi Oil, Westsides, Itemba Enterprises.
 */
import 'server-only';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanyId, CompanySlug, ContentIcon, Faq, SectorVisual, SplitHeadline, TypeVisual } from './types';

/** A tile's visual: a photograph, or a typographic panel where no strong photograph exists. */
export type CompanyVisual = MediaImage | TypeVisual;

/** True when the visual is a photograph (a registry image), not a typographic panel. */
export function isPhoto(visual: CompanyVisual): visual is MediaImage {
  return !('kind' in visual);
}

/** Something the company does: a cell of the "What we do" bento on its page. */
export type CompanyOffering = {
  icon: ContentIcon;
  title: string;
  body: string;
  /** The service page that covers it, when there is one. */
  serviceSlug?: string;
};

/** A trading brand, branch or site the company runs ("Brands and sites"). */
export type CompanySite = {
  name: string;
  /** What it is: "Filling station", "Tunduma Main Branch". */
  kind: string;
  detail: string;
  /** A photograph of the site. Without one the card is typographic, drawn with `icon`. */
  image?: MediaImage;
  icon?: ContentIcon;
  /**
   * A typographic card among photographs sets this figure large in the
   * photograph's place ("3", "planned").
   */
  figure?: { value: string; label: string };
};

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
  /**
   * Public name used in titles and the breadcrumb data, e.g. "Mwanjalisi
   * Oil Co Ltd" (the metadata title is a baseline contract).
   */
  name: string;
  /**
   * Registered name as it appears on legal documents. The one legal form a
   * company page shows ("At a glance"); the page's h1 is the short name.
   * Which form is right for Mwanjalisi Oil is an open owner question.
   */
  legalName: string;
  shortName: string;
  /** Accent token key. */
  accent: CompanyId;
  sector: string;
  eyebrow: string;
  visual: SectorVisual;
  /** The long summary (company profile, print, FAQ index). */
  summary: string;
  /** The long description (company profile and print). */
  detail: string;
  /**
   * The page hero's lede: one sentence of 110 characters or fewer, so it
   * sets in at most three lines on a phone and the photograph follows.
   */
  lede: string;
  /**
   * "What we do": the company in one sentence, then a short list (its
   * sites, or the markets it serves) under a small label.
   */
  overview: { lead: string; label: string; points: readonly string[] };
  services: readonly string[];
  highlights: readonly string[];
  image: MediaImage;
  gallery: readonly MediaFigure[];
  /**
   * The company's visual on its home tile: a photograph (a portrait one is
   * set beside the text, a landscape one runs across the tile) or, where no
   * strong photograph exists, a typographic panel.
   */
  tileVisual: CompanyVisual;
  /**
   * The page hero's photograph: the strongest the company has, and never
   * the one its home tile shows.
   */
  heroImage: MediaImage;
  /**
   * The visual of the page's one cinema tile (key strengths): a photograph
   * shown nowhere else on the page and not on the company's home tile (one
   * click away), or a typographic panel.
   */
  strengthsVisual: CompanyVisual;
  /**
   * One headline figure, for the "What we do" bento. `restates` names the
   * highlight that says the same thing in words; the key strengths leave it
   * out rather than repeat the figure.
   */
  keyStat: { value: string; label: string; note?: string; restates?: string };
  /** Three things the company does ("What we do"). */
  offerings: readonly CompanyOffering[];
  sites: readonly CompanySite[];
  /** Branch list, where the company runs branches (Westsides; company profile §7). */
  branches?: readonly { name: string; detail: string }[];
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
    eyebrow: 'Petroleum retail and parking',
    visual: 'fuel',
    summary:
      "Tanzania's petroleum retail and corridor support arm within Itemba Group, managing high-visibility ITEMBA-branded filling stations and UZUNGUNI PARKING YARD for motorists, fleet operators, and logistics customers across Songwe Region.",
    detail:
      "Positioned along major transport routes near the Tanzania–Zambia border, Mwanjalisi Oil manages retail fuel station operations that trade publicly under the ITEMBA location brand, including ITEMBA-MPEMBA near the Tunduma Bus Station and ITEMBA-UZUNGUNI along the TANZAM Highway. It also manages UZUNGUNI PARKING YARD in Uzunguni Area, Mpemba-Tunduma for corridor motorists and logistics operators.",
    lede: 'Fuel, lubricants and truck parking for motorists and fleets on the Tanzania–Zambia corridor.',
    overview: {
      lead: "Tanzania's petroleum retail and corridor support arm within Itemba Group, serving motorists, fleet operators and logistics customers across Songwe Region.",
      label: 'Sites',
      points: [
        'ITEMBA-MPEMBA, near the Tunduma Bus Station',
        'ITEMBA-UZUNGUNI, along the TANZAM Highway',
        'UZUNGUNI PARKING YARD, in Uzunguni Area, Mpemba',
      ],
    },
    services: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Commercial fleet supply enquiries'],
    highlights: [
      'Runs the ITEMBA stations and UZUNGUNI PARKING YARD',
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
    tileVisual: mediaImage('mpemba-dusk'),
    heroImage: mediaImage('mpemba-station-roadside', {
      alt: 'An ITEMBA filling station and a corridor tanker, seen from the highway under a wide Songwe sky',
    }),
    // Its strong photographs are all forecourts (the hero and the site cards
    // already show three) or the home tile's dusk shot: the strengths tile is typographic.
    strengthsVisual: {
      kind: 'type',
      icon: 'energy',
      statement: 'Fuel and parking where the TANZAM Highway meets the border.',
      caption: 'Diesel · Petrol · Kerosene · Lubricants',
    },
    keyStat: {
      value: '2',
      label: 'Operating ITEMBA stations',
      restates: 'Two operating stations with three upcoming fuel locations',
    },
    offerings: [
      {
        icon: 'energy',
        title: 'Diesel, petrol and kerosene',
        body: 'Retail fuel for motorists, buses, trucks and fleets at the ITEMBA filling stations.',
        serviceSlug: 'fuel-and-lubricants',
      },
      {
        icon: 'droplet',
        title: 'Lubricants and fleet supply',
        body: 'Lubricants at the forecourt, and business fuel enquiries for commercial fleets and transport operators.',
        serviceSlug: 'fuel-and-lubricants',
      },
      {
        icon: 'map-pin',
        title: 'Parking and vehicle staging',
        body: 'Truck and logistics parking at UZUNGUNI PARKING YARD for corridor motorists and transport operators.',
        serviceSlug: 'fuel-and-lubricants',
      },
    ],
    sites: [
      {
        name: 'ITEMBA-MPEMBA',
        kind: 'Filling station',
        detail: 'Near the Tunduma Bus Station, along the Tunduma-Ileje Highway.',
        image: mediaImage('mpemba-truck-canopy', { alt: 'Trucks refuelling under the ITEMBA-MPEMBA canopy' }),
      },
      {
        name: 'ITEMBA-UZUNGUNI',
        kind: 'Filling station',
        detail: 'Along the TANZAM Highway in Uzunguni Area, Mpemba.',
        image: mediaImage('uzunguni-forecourt-wide'),
      },
      {
        name: 'UZUNGUNI PARKING YARD',
        kind: 'Parking and vehicle staging',
        detail: 'Truck and vehicle parking in Uzunguni Area, Mpemba-Tunduma.',
        image: mediaImage('parking-truck-line'),
      },
      {
        name: 'New ITEMBA stations',
        kind: 'Planned expansion',
        detail: 'Three more stations will carry the ITEMBA-location name, under Mwanjalisi Oil management.',
        icon: 'energy',
        figure: { value: '3', label: 'planned' },
      },
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
    eyebrow: 'Wholesale and retail trade',
    visual: 'trade',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN operations for stockists, bars, night clubs, contractors, hospitality customers, and cross-border bulk buyers.',
    detail:
      "Westsides Company Ltd manages the group's trading and hospitality brands, including wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN. Its market includes more than 50 stockists across Songwe Region, bars and night clubs in urban centres such as Tunduma, Mlowo, and Vwawa, international bulk buyers moving goods through Tunduma border, and construction companies serving the growing real estate and infrastructure market.",
    lede: 'Beverage wholesale, hardware and hospitality for stockists, builders and travellers in Songwe.',
    overview: {
      lead: "The group's trading and hospitality company: wholesale beverages, ITEMBA-HARDWARE and UZUNGUNI INN.",
      label: 'Markets',
      points: [
        'Stockists across Songwe Region',
        'Bars and night clubs in Tunduma, Mlowo and Vwawa',
        'Bulk buyers moving goods through the Tunduma border',
        'Construction companies in real estate and infrastructure',
      ],
    },
    services: ['Wholesale beverages', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', 'Construction equipment sales'],
    highlights: [
      'More than 50 beverage stockists across Songwe Region',
      'Serves bars, night clubs, and hospitality outlets',
      'Bulk supply for cross-border buyers at Tunduma',
      'Construction supply through ITEMBA-HARDWARE',
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
    // No Westsides photograph is strong enough for a home tile: its tile is typographic.
    tileVisual: {
      kind: 'type',
      icon: 'trade',
      statement: 'Four branches across Songwe Region.',
      caption: 'Mpemba · Mlowo · Sogea · Tunduma',
    },
    // The one frame that names the company: the WESTSIDES COMPANY LIMITED signboard.
    heroImage: mediaImage('hardware-storefront', {
      alt: 'The WESTSIDES COMPANY LIMITED signboard above the ITEMBA-HARDWARE storefront and its stock',
    }),
    strengthsVisual: mediaImage('westsides-order-truck'),
    keyStat: {
      value: '50+',
      label: 'Beverage stockists across Songwe Region',
      restates: 'More than 50 beverage stockists across Songwe Region',
    },
    offerings: [
      {
        icon: 'trade',
        title: 'Wholesale beverages',
        body: 'Beer, spirits, soft drinks and bottled water in volume for stockists, bars, night clubs and bulk buyers.',
        serviceSlug: 'trade-and-distribution',
      },
      {
        icon: 'construction',
        title: 'Building materials and tools',
        body: 'Roofing sheets, wire nails, pipes, beams, paints and construction equipment through ITEMBA-HARDWARE.',
        serviceSlug: 'construction-supplies-and-hardware',
      },
      {
        icon: 'hospitality',
        title: 'Hospitality',
        body: 'Lodging, restaurant and bar services at UZUNGUNI INN in Mpemba-Tunduma.',
        serviceSlug: 'hospitality-and-lodging',
      },
    ],
    sites: [
      {
        name: 'Wholesale beverages',
        kind: 'Mpemba, Mlowo and Sogea branches',
        detail: 'Beverage distribution for more than 50 stockists, bars, night clubs and cross-border bulk buyers.',
        image: mediaImage('westsides-warehouse-stock'),
      },
      {
        name: 'ITEMBA-HARDWARE',
        kind: 'Tunduma Main Branch',
        detail: 'Hardware and construction equipment, supported by warehouses in Tunduma town and the Sogea area.',
        image: mediaImage('hardware-paint-stock', {
          alt: 'Paint and construction supply stock at ITEMBA-HARDWARE, run by Westsides Company Ltd',
        }),
      },
      {
        name: 'UZUNGUNI INN',
        kind: 'Lodging, restaurant and bar',
        detail: 'Lodging, a restaurant and a bar for travellers and corridor traders in Mpemba-Tunduma.',
        image: mediaImage('inn-bar-restaurant'),
      },
    ],
    branches: [
      { name: 'Mpemba Main Branch', detail: 'Beverage distribution in wholesale only, for Mpemba and the surrounding business area.' },
      { name: 'Mlowo Branch', detail: 'Beverage distribution centre for Mlowo town and its neighbouring villages and wards.' },
      { name: 'Sogea Branch', detail: 'Beverage distribution for Sogea and Tunduma town as a whole.' },
      { name: 'Tunduma Main Branch', detail: 'Hardware and construction equipment sales across Songwe Region.' },
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
    eyebrow: 'Logistics and cross-border transit',
    visual: 'logistics',
    summary:
      "The group's logistics and emerging-business company, anchored by Dar es Salaam-to-Southern Highlands movement and cross-border transit through the Tunduma corridor.",
    detail:
      'Itemba Enterprises focuses on logistics services, cross-border transit, and emerging businesses after trading and hospitality operations were placed under Westsides Company Ltd and UZUNGUNI PARKING YARD came under Mwanjalisi Oil Co Ltd management. Its logistics target market includes local businesses sourcing goods from Dar es Salaam into the Southern Highlands regions of Songwe, Mbeya, Rukwa, Ruvuma, and Iringa, plus transit customers moving goods to and from Zambia, DRC, Zimbabwe, and Malawi.',
    lede: 'Logistics from Dar es Salaam to the Southern Highlands, and cross-border transit via Tunduma.',
    overview: {
      lead: "The group's logistics and emerging-business company, moving goods for local businesses and transit customers.",
      label: 'Markets',
      points: [
        'Local businesses sourcing goods from Dar es Salaam',
        'The Southern Highlands: Songwe, Mbeya, Rukwa, Ruvuma and Iringa',
        'Transit customers for Zambia, DRC, Zimbabwe and Malawi',
      ],
    },
    services: ['Local logistics', 'Cross-border transit', 'Emerging businesses'],
    highlights: [
      'Dar es Salaam to Southern Highlands logistics',
      'Transit routes to Zambia, DRC, Zimbabwe, and Malawi',
      'Direct access to the Tunduma border corridor',
      'Emerging businesses and Itemba Estate in one company',
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
    tileVisual: mediaImage('logistics-truck-front', {
      alt: 'An Itemba Enterprises truck with ITEMBA ENERGY across its windscreen, seen from the front',
    }),
    heroImage: mediaImage('logistics-tanker', {
      alt: 'An Itemba Enterprises tanker truck in Itemba livery at a filling station',
    }),
    // The remaining fleet photographs repeat the home tile's truck: the strengths tile is typographic.
    strengthsVisual: {
      kind: 'type',
      icon: 'logistics',
      statement: 'The corridor that moves the south.',
      caption: 'Itemba Logistics, from Dar es Salaam to the Tunduma border.',
    },
    keyStat: {
      value: '4',
      label: 'Countries of cross-border transit',
      note: 'Zambia, DRC, Zimbabwe and Malawi',
      restates: 'Transit routes to Zambia, DRC, Zimbabwe, and Malawi',
    },
    offerings: [
      {
        icon: 'logistics',
        title: 'Local logistics',
        body: 'Goods movement from Dar es Salaam into Songwe, Mbeya, Rukwa, Ruvuma and Iringa.',
        serviceSlug: 'logistics-and-cross-border-transit',
      },
      {
        icon: 'globe',
        title: 'Cross-border transit',
        body: 'Transit to and from Zambia, DRC, Zimbabwe and Malawi through the Tunduma corridor.',
        serviceSlug: 'logistics-and-cross-border-transit',
      },
      {
        icon: 'realestate',
        title: 'Real estate and property',
        body: 'Property development and property-related services through Itemba Estate.',
        serviceSlug: 'real-estate-and-property',
      },
    ],
    sites: [
      {
        name: 'Itemba Logistics',
        kind: 'Flagship',
        detail: 'Dar es Salaam to the Southern Highlands, and cross-border transit through Tunduma.',
        icon: 'logistics',
      },
      {
        name: 'Itemba Estate',
        kind: 'Real estate and property',
        detail: 'Property development, real estate and property-related services.',
        icon: 'realestate',
      },
      {
        name: 'Emerging businesses',
        kind: 'New opportunities',
        detail: 'Emerging business activities, developed under the Itemba Enterprises structure.',
        icon: 'arrow-up-right',
      },
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
export const companyAreaServed = ['Songwe Region', 'Tunduma', 'Tanzania–Zambia corridor'] as const;

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
    lede: 'Each company is legally and operationally independent, with its own identity and market, under one group structure.',
  },
  /** Accessible name of the hero's row of links to the three company tiles. */
  jumpLabel: 'Jump to a company',
} as const;

/** /companies/[slug] copy. */
export const companyPageCopy = {
  /** The sticky sub-nav: section anchors and the Enquire pill. */
  nav: {
    /** Follows the company's short name: "Mwanjalisi Oil sections". */
    labelSuffix: 'sections',
    whatWeDo: 'What we do',
    sites: 'Brands & sites',
    strengths: 'Strengths',
    faq: 'FAQ',
    enquire: 'Enquire',
    /** The chevron beside the company name on phones, which lists the anchors above. */
    menu: 'Show sections',
  },
  hero: {
    enquire: 'Enquire',
    /** The company's ready-made profile PDF (a download link: the verb is implied). */
    download: 'Company profile',
    downloadFormat: 'PDF',
  },
  glance: {
    title: 'At a glance',
    registeredName: 'Registered name',
    incorporated: 'Incorporated',
    status: 'Status',
  },
  servicesHeading: 'What we do',
  /** Above the company's headline figure in the "What we do" bento. */
  keyFigure: 'Key figure',
  /** The chevron link on an offering that has a service page. */
  offeringAction: 'Learn more',
  sitesHeading: 'Brands and sites',
  branchesHeading: 'Branches',
  faqHeading: 'Frequently asked questions',
  strengthsHeading: 'Key strengths',
  sectorLabel: 'Sector',
  facts: [
    { label: 'Structure', value: 'Subsidiary of Itemba Group' },
    { label: 'Location', value: 'Songwe Region, Tanzania' },
  ],
  enquire: {
    eyebrow: 'Enquire',
    /** The group's routing promise, beside the form. */
    body: 'One group office routes every enquiry to the right company.',
    /** How an enquiry travels, as numbered steps under the promise. */
    stepsLabel: 'How it works',
    steps: [
      { title: 'Choose who it is for', body: 'The form starts with this company. Pick another, or General, at any time.' },
      { title: 'Say how to reach you', body: 'A phone number, email or WhatsApp number, and a short message.' },
      { title: 'The group office routes it', body: 'Your enquiry reaches the right company team through one front door.' },
    ],
  },
} as const;
