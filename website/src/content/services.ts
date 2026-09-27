/**
 * The six service areas (sectors) and the company that runs each one.
 * Order is the sitemap and navigation order.
 */
import 'server-only';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanySlug, Faq, IconKey, IntentId, SectorVisual, SplitHeadline } from './types';

export type ServiceArea = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  intentId: IntentId;
  companySlug: CompanySlug;
  companyName: string;
  visual: SectorVisual;
  summary: string;
  detail: string;
  metaDescription: string;
  keywords: string[];
  offerings: string[];
  audience: string[];
  image?: MediaImage;
  gallery?: MediaFigure[];
  faqs: Faq[];
  updatedAt: string;
};

export const serviceAreas: ServiceArea[] = [
  {
    slug: 'fuel-and-lubricants',
    title: 'Fuel and Lubricants',
    shortTitle: 'Fuel supply',
    eyebrow: 'Energy, Petroleum Retail and Parking',
    intentId: 'mwanjalisi',
    companySlug: 'mwanjalisi-oil',
    companyName: 'Mwanjalisi Oil Co Ltd',
    visual: 'fuel',
    summary:
      'Petroleum retail and parking services through high-visibility ITEMBA-branded stations and UZUNGUNI PARKING YARD managed by Mwanjalisi Oil Company Ltd for motorists, commercial transport operators, local businesses, and corridor customers.',
    detail:
      'Mwanjalisi Oil manages the legal and operational side of the fuel business, while the public filling station names use the ITEMBA brand with the location name. ITEMBA-MPEMBA is positioned near the Tunduma Bus Station along the Tunduma-Ileje Highway, while ITEMBA-UZUNGUNI serves the TANZAM Highway corridor in Uzunguni Area, Mpemba. UZUNGUNI PARKING YARD is also managed by Mwanjalisi Oil for corridor motorists, buses, trucks, and logistics companies.',
    metaDescription:
      'Fuel, lubricant, and UZUNGUNI PARKING YARD services from ITEMBA-MPEMBA and ITEMBA-UZUNGUNI, managed by Mwanjalisi Oil Co Ltd under Itemba Group in Songwe Region, Tanzania.',
    keywords: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'diesel', 'petrol', 'kerosene', 'lubricants', 'parking', 'fuel supply', 'Songwe fuel station'],
    offerings: ['ITEMBA-MPEMBA filling station', 'ITEMBA-UZUNGUNI filling station', 'UZUNGUNI PARKING YARD', 'Diesel and petrol retail', 'Kerosene supply', 'Lubricants', 'Business fuel enquiries', 'Fleet, logistics, and parking support'],
    audience: ['Motorists', 'Transport operators', 'Commercial customers', 'Local businesses', 'Cross-border logistics companies', 'Parking and vehicle-staging customers'],
    image: mediaImage('mpemba-station-wide', {
      alt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd',
      caption: 'ITEMBA-MPEMBA and ITEMBA-UZUNGUNI are managed by Mwanjalisi Oil Company Ltd.',
    }),
    faqs: [
      {
        question: 'Which fuel products are available through Itemba Group?',
        answer:
          'ITEMBA-MPEMBA and ITEMBA-UZUNGUNI, managed by Mwanjalisi Oil, handle diesel, petrol, kerosene, and lubricants for retail customers and business enquiries. Mwanjalisi Oil also manages UZUNGUNI PARKING YARD for corridor parking and vehicle staging.',
      },
      {
        question: 'Can transport operators submit fuel or parking enquiries?',
        answer:
          'Yes. Transport operators can contact the group office by phone, WhatsApp, or email and fuel or UZUNGUNI PARKING YARD enquiries will be routed to Mwanjalisi Oil.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
  {
    slug: 'trade-and-distribution',
    title: 'Trade and Distribution',
    shortTitle: 'Distribution',
    eyebrow: 'Wholesale and Retail Supply',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'trade',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and hospitality trade support for stockists, bars, night clubs, cross-border bulk buyers, and construction customers.',
    detail:
      'Westsides Company connects more than 50 stockists across Songwe Region with large-volume beverage supply at distributor pricing. A stockist is a wholesale customer with area-based distribution ability who depends on Westsides as a distributor specialist. The same trade platform serves bars and night clubs in Tunduma, Mlowo, Vwawa, and other urban centres, international customers buying beverages and hardware for cross-border movement, and construction companies serving the growing real estate, filling station, residential, commercial, and public infrastructure markets.',
    metaDescription:
      'Trade and distribution services from Westsides Company Ltd for Songwe stockists, bars, night clubs, cross-border bulk buyers, and construction customers in Tanzania.',
    keywords: ['beverage distribution', 'Songwe stockists', 'bars and night clubs', 'building materials', 'tools', 'electrical supplies', 'wholesale Tanzania', 'Tunduma border trade'],
    offerings: ['Wholesale beverage supply for stockists', 'Alcoholic and non-alcoholic beverages', 'ITEMBA-HARDWARE materials', 'Building materials', 'Tools and construction equipment', 'Cross-border bulk purchase support'],
    audience: ['More than 50 Songwe stockists', 'Bars and night clubs', 'International bulk buyers', 'Construction companies', 'Real estate developers', 'Hospitality businesses'],
    image: mediaImage('westsides-warehouse-stock', {
      alt: 'Westsides Company Ltd wholesale beverage stock prepared for distribution customers',
      caption: 'Westsides Company Ltd supplies high-volume beverage stockists and bulk buyers across Songwe Region.',
    }),
    gallery: [
      mediaFigure('westsides-warehouse-stock', {
        alt: 'Large Westsides beverage warehouse stock for wholesale distribution',
        caption: 'Large-volume beverage stock handled for area-based stockists and retailers.',
      }),
      mediaFigure('westsides-order-truck', {
        alt: 'Customer beverage order loaded on a delivery truck',
        caption: 'Customer orders prepared for wholesale buyers and cross-border movement.',
      }),
      mediaFigure('westsides-softdrinks', {
        alt: 'Soft drinks stacked in a Westsides warehouse',
        caption: 'Soft drink supply for stockists, bars, restaurants, and retail customers.',
      }),
      mediaFigure('westsides-crates', {
        alt: 'Coca-Cola crates stored for Westsides distribution',
        caption: 'Branded beverage crates held for wholesale distribution channels.',
      }),
    ],
    faqs: [
      {
        question: 'What products does Westsides Company distribute?',
        answer:
          'Westsides Company distributes beverages in wholesale and manages ITEMBA-HARDWARE for building materials, tools, construction equipment, and related supply categories.',
      },
      {
        question: 'Who are the main Westsides target customers?',
        answer:
          'The main target customers include more than 50 stockists across Songwe Region, bars and night clubs in urban centres such as Tunduma, Mlowo, and Vwawa, international bulk buyers using the Tunduma border, and construction companies serving the real estate and infrastructure market.',
      },
      {
        question: 'Can bulk purchase enquiries be sent online?',
        answer: 'Yes. Bulk purchase and supplier enquiries can be submitted through the contact page, WhatsApp, or email.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
  {
    slug: 'logistics-and-cross-border-transit',
    title: 'Logistics and Cross-Border Transit',
    shortTitle: 'Logistics',
    eyebrow: 'Tunduma Corridor Operations',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'logistics',
    summary:
      'Local logistics from Dar es Salaam to the Southern Highlands and cross-border transit support connected to the Tunduma corridor.',
    detail:
      'Itemba Enterprises anchors the group logistics capability for local businesses that buy or source goods from Dar es Salaam and need movement into Songwe, Mbeya, Rukwa, Ruvuma, and Iringa. The company also supports a growing transit market to and from neighbouring countries including Zambia, DRC, Zimbabwe, and Malawi through the Tunduma corridor.',
    metaDescription:
      'Logistics from Dar es Salaam to Songwe, Mbeya, Rukwa, Ruvuma, and Iringa plus cross-border transit from Itemba Enterprises Co Ltd through Tunduma.',
    keywords: ['Tunduma logistics', 'Dar es Salaam logistics', 'Southern Highlands transport', 'Songwe logistics', 'Mbeya logistics', 'Rukwa logistics', 'Ruvuma logistics', 'Iringa logistics', 'cross-border transit'],
    offerings: ['Dar es Salaam to Southern Highlands logistics', 'Local goods movement support', 'Cross-border transit', 'Transit to and from Zambia, DRC, Zimbabwe, and Malawi', 'Corridor operations enquiries'],
    audience: ['Local businesses sourcing from Dar es Salaam', 'Southern Highlands traders', 'Importers and exporters', 'Transit customers to Zambia', 'Transit customers to DRC', 'Transit customers to Zimbabwe and Malawi'],
    image: mediaImage('logistics-tanker', {
      alt: 'Itemba Logistics tanker supporting Dar es Salaam to Southern Highlands and transit movement',
      caption: 'Itemba Logistics supports local movement and cross-border transit through the Tunduma corridor.',
    }),
    gallery: [
      mediaFigure('logistics-tanker', {
        alt: 'Itemba Logistics tanker under station canopy',
        caption: 'Corridor-ready logistics support connected to the Tunduma border.',
      }),
      mediaFigure('logistics-truck-front', {
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet presence for Dar es Salaam to Southern Highlands movement.',
      }),
      mediaFigure('logistics-truck-yard', {
        alt: 'Itemba Logistics truck parked in yard',
        caption: 'Yard-based support for local traders and transit customers.',
      }),
    ],
    faqs: [
      {
        question: 'Does Itemba Group handle cross-border logistics?',
        answer:
          'Itemba Enterprises handles logistics-related enquiries focused on local distribution from Dar es Salaam into the Southern Highlands and cross-border transit through the Tunduma corridor.',
      },
      {
        question: 'Which logistics routes are most relevant?',
        answer:
          'The key local route is Dar es Salaam to Southern Highlands regions including Songwe, Mbeya, Rukwa, Ruvuma, and Iringa. The growing transit market connects to and from Zambia, DRC, Zimbabwe, and Malawi.',
      },
      {
        question: 'Where are the logistics operations based?',
        answer: 'The group is headquartered in Mpemba-Tunduma, Songwe Region, close to the Tanzania–Zambia border corridor.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
  {
    slug: 'construction-supplies-and-hardware',
    title: 'Construction Supplies and Hardware',
    shortTitle: 'Hardware',
    eyebrow: 'ITEMBA-HARDWARE',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'hardware',
    summary:
      'Hardware, tools, construction equipment, and construction supply support under the ITEMBA-HARDWARE brand managed by Westsides Company Ltd for contractors and the growing real estate market.',
    detail:
      'ITEMBA-HARDWARE is the public hardware and construction supply brand managed by Westsides Company Ltd, supporting demand from construction companies, contractors, property developers, cross-border bulk buyers, and the growing real estate market, including filling stations, residential homes, commercial properties, and public infrastructure.',
    metaDescription:
      'ITEMBA-HARDWARE under Westsides Company Ltd supplies construction materials, hardware, tools, and construction equipment in Songwe Region, Tanzania.',
    keywords: ['ITEMBA-HARDWARE', 'hardware Tanzania', 'building materials', 'construction supplies', 'electrical supplies', 'tools'],
    offerings: ['Nondo', 'Roofing sheets', 'Wire nails', 'Paints of all types', 'Square pipes', 'Round pipes', 'H-beams', 'I-beams', 'U-channels', 'Contractor supply enquiries'],
    audience: ['Construction companies', 'Contractors', 'Real estate developers', 'Filling station builders', 'Residential and commercial property customers', 'Cross-border bulk buyers'],
    image: mediaImage('hardware-storefront', {
      alt: 'ITEMBA-HARDWARE storefront and construction supply stock managed by Westsides Company Ltd',
      caption: 'ITEMBA-HARDWARE supplies construction materials and equipment under Westsides Company Ltd.',
    }),
    gallery: [
      mediaFigure('hardware-storefront', {
        alt: 'ITEMBA-HARDWARE storefront and construction stock',
        caption: 'ITEMBA-HARDWARE serves contractors, developers, and bulk hardware buyers.',
      }),
      mediaFigure('hardware-paint-stock', {
        alt: 'Paint and hardware stock inside ITEMBA-HARDWARE',
        caption: 'Paints and construction supplies stocked for the regional market.',
      }),
    ],
    faqs: [
      {
        question: 'Which construction goods are available?',
        answer:
          'ITEMBA-HARDWARE handles Nondo, roofing sheets, wire nails, paints, square pipes, round pipes, H-beams, I-beams, U-channels, and related construction supplies.',
      },
      {
        question: 'Which company handles hardware enquiries?',
        answer: 'Hardware and construction supply enquiries are handled through ITEMBA-HARDWARE under Westsides Company Ltd.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
  {
    slug: 'hospitality-and-lodging',
    title: 'Hospitality and Lodging',
    shortTitle: 'Hospitality',
    eyebrow: 'Uzunguni Inn',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'hospitality',
    summary: 'Hospitality, lodging, restaurant, and bar services through UZUNGUNI INN under Westsides Company Ltd.',
    detail:
      'UZUNGUNI INN is the group hospitality brand for lodging, restaurant, and bar services at Mpemba-Tunduma, managed by Westsides Company Ltd.',
    metaDescription:
      'Hospitality, lodging, restaurant, and bar services through UZUNGUNI INN under Westsides Company Ltd in Songwe Region, Tanzania.',
    keywords: ['Uzunguni Inn', 'lodging Songwe', 'hospitality Tunduma', 'hotel services'],
    offerings: ['Accommodation', 'Restaurant services', 'Business guest support', 'Traveller services'],
    audience: ['Travellers', 'Business guests', 'Regional visitors', 'Transport corridor customers'],
    image: mediaImage('inn-lodge-room', {
      alt: 'UZUNGUNI INN lodging room managed by Westsides Company Ltd',
      caption: 'UZUNGUNI INN provides lodging, restaurant, and bar services in Mpemba-Tunduma.',
    }),
    gallery: [
      mediaFigure('inn-lodge-room', {
        alt: 'UZUNGUNI INN lodging room',
        caption: 'Accommodation for regional visitors and corridor business guests.',
      }),
      mediaFigure('inn-bar-restaurant', {
        alt: 'UZUNGUNI INN bar and restaurant seating',
        caption: 'Restaurant and bar services for local and travelling customers.',
      }),
      mediaFigure('inn-bar-night', {
        alt: 'UZUNGUNI INN bar area at night',
        caption: 'Evening hospitality environment at UZUNGUNI INN.',
      }),
    ],
    faqs: [
      {
        question: 'Which Itemba Group division handles hospitality?',
        answer: 'Hospitality, lodging, restaurant, and bar services are handled through UZUNGUNI INN under Westsides Company Ltd.',
      },
      {
        question: 'How can hospitality enquiries be made?',
        answer: 'Hospitality enquiries can be sent through the group contact channels and routed to the relevant division.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
  {
    slug: 'real-estate-and-property',
    title: 'Real Estate and Property',
    shortTitle: 'Real estate',
    eyebrow: 'Itemba Estate',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'estate',
    summary: 'Property development, real estate, and property-related services through Itemba Estate under Itemba Enterprises.',
    detail: "Itemba Estate supports the group's property interests and real estate-related services in the Songwe Region business ecosystem.",
    metaDescription:
      'Real estate, property development, and property-related services through Itemba Estate under Itemba Enterprises Co Ltd in Tanzania.',
    keywords: ['Itemba Estate', 'real estate Songwe', 'property development Tanzania', 'property services'],
    offerings: ['Property development', 'Real estate enquiries', 'Property-related services', 'Estate operations'],
    audience: ['Property customers', 'Business partners', 'Regional investors', 'Local stakeholders'],
    image: mediaImage('estate-construction-wide', {
      alt: 'Modern low-rise residential estate construction site with multiple homes',
      caption: 'Modern residential estate construction progress with roads, staged homes, and active site works.',
    }),
    gallery: [
      mediaFigure('estate-construction', {
        alt: 'Aerial view of multiple low-rise homes under construction in a residential estate',
        caption: 'Estate construction progress across multiple modern low-rise residential units.',
      }),
      mediaFigure('estate-housing-development', {
        alt: 'Modern low-rise housing development with repeated residential units',
        caption: 'Finished low-rise residential estate layout with internal access roads and shared amenities.',
      }),
      mediaFigure('estate-white-villa', {
        alt: 'Finished modern residential home in Tanzania',
        caption: 'Finished modern residential home for private property and estate enquiries.',
      }),
      mediaFigure('estate-coastal-aerial', {
        alt: 'Aerial view of residential houses and roads in a Tanzanian coastal town',
        caption: 'Residential housing and road layout in a Tanzanian coastal settlement.',
      }),
    ],
    faqs: [
      {
        question: 'Which division handles real estate?',
        answer: 'Real estate and property-related services are handled through Itemba Estate under Itemba Enterprises.',
      },
      {
        question: 'Can property enquiries be submitted through the website?',
        answer: 'Yes. Property enquiries can be sent through the group contact channels and routed to Itemba Estate.',
      },
    ],
    updatedAt: contentUpdatedAt,
  },
];

export function getServiceBySlug(slug: string): ServiceArea | undefined {
  return serviceAreas.find((service) => service.slug === slug);
}

/** Line icon for a service's sector visual. */
export const serviceIcons: Record<SectorVisual, IconKey> = {
  fuel: 'energy',
  trade: 'trade',
  logistics: 'logistics',
  hardware: 'construction',
  estate: 'realestate',
  hospitality: 'hospitality',
  parking: 'logistics',
};

/** Places a service area serves, for its Service JSON-LD. */
export const serviceAreaServed = ['Songwe Region', 'Tunduma', 'Tanzania'] as const;

/** /services index copy. */
export const servicesPage = {
  meta: {
    title: 'Services',
    description:
      'Explore Itemba Group services across fuel, trade distribution, logistics, construction supplies, hospitality, and real estate in Tanzania.',
    ogTitle: 'Itemba Group Services',
    ogDescription:
      'Fuel, trade distribution, logistics, construction supplies, hospitality, and property services from Itemba Group companies.',
  },
  hero: {
    eyebrow: 'Services & capabilities',
    headline: { lead: 'Find the service.', accent: 'Meet the team behind it.' } satisfies SplitHeadline,
    lede:
      'Fuel and energy, trade and distribution, logistics, hospitality, real estate and construction supply — each handled by the operating company that runs it.',
    facts: ['6 service areas', '3 operating companies', 'Songwe · Tunduma corridor'],
  },
  directory: {
    eyebrow: 'Capability directory',
    title: 'Services people search for',
    cardAction: 'View service',
  },
  delivery: {
    title: 'Company-led delivery',
    body:
      'Every service area maps back to one of the group operating companies, keeping enquiries clear and accountable from the first contact.',
  },
} as const;

/** /services/[slug] copy. */
export const servicePageCopy = {
  backLink: 'All services',
  coversHeading: 'What this covers',
  galleryHeading: 'Operations gallery',
  audienceHeading: 'Who it serves',
  faqHeading: 'Frequently asked questions',
  operator: {
    eyebrow: 'Operating company',
    /** Followed by the company name. */
    bodyPrefix: 'This service area is handled through the relevant operating team under',
    action: 'View company profile',
  },
} as const;

/** The fuel service page's "Fuel business presence" showcase. */
export const fuelShowcase = {
  serviceSlug: 'fuel-and-lubricants',
  eyebrow: 'Fuel business presence',
  title: 'ITEMBA stations built for corridor movement',
  body:
    'ITEMBA-MPEMBA and ITEMBA-UZUNGUNI trade publicly under the ITEMBA location brand while remaining managed by Mwanjalisi Oil Company Ltd — visible station brands, practical access, and high-traffic route positioning.',
  images: [
    mediaFigure('mpemba-station-wide', {
      alt: 'ITEMBA-MPEMBA filling station forecourt near Tunduma Bus Station',
      caption: 'ITEMBA-MPEMBA: a public ITEMBA station brand managed by Mwanjalisi Oil Company Ltd.',
    }),
    mediaFigure('mpemba-truck-canopy', {
      alt: 'Trucks refuelling at an ITEMBA station canopy',
      caption: 'Forecourt access supports buses, trucks, private motorists, and corridor logistics operators.',
    }),
    mediaFigure('uzunguni-forecourt-wide', {
      alt: 'ITEMBA-UZUNGUNI fuel station canopy and forecourt',
      caption: 'Forecourt visibility supports daily motorists, fleets, and cross-border transport demand.',
    }),
  ],
  positioning: [
    {
      label: 'Route Advantage',
      value: 'Stations positioned along major routes, including the TANZAM Highway and the Tunduma-Ileje Highway.',
    },
    {
      label: 'Transit Demand',
      value: 'Fuel access for motorists, buses, trucks, and logistics operators moving through the Tunduma corridor.',
    },
    {
      label: 'Expansion Pipeline',
      value: 'Two operating ITEMBA-branded stations with three upcoming locations under Mwanjalisi Oil management.',
    },
  ],
} as const;
