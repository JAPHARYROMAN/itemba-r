/**
 * The six service areas (sectors) and the company that runs each one.
 * Order is the sitemap and navigation order.
 */
import 'server-only';
import type { CompanySite, CompanyVisual } from './companies';
import { flags } from './flags';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from './media';
import { contentUpdatedAt } from './site';
import type { CompanySlug, ContentIcon, Faq, IconKey, IntentId, LinkItem, SectorVisual, SplitHeadline } from './types';

/**
 * A service page's visual (its hero, or the company tile): a photograph, or
 * a typographic panel where no strong photograph exists (owner decision).
 */
export type ServiceVisual = CompanyVisual;

/** Something the service covers: a cell of the "What it covers" bento. */
export type ServiceFeature = {
  icon: ContentIcon;
  title: string;
  body: string;
  /** Another service page that covers it in full, when there is one. */
  serviceSlug?: string;
};

/** A stop on a route (the logistics page's "Where it runs"). */
export type ServiceRouteStop = { name: string; detail: string };

export type ServiceArea = {
  slug: string;
  title: string;
  shortTitle: string;
  /**
   * The page's name in its sub-nav: short enough to sit beside the section
   * menu and the Enquire pill on a 360px phone (about 168px of 19px type),
   * as Apple's product bars use short names: "Fuel & Lubricants", "Hardware".
   */
  navTitle: string;
  eyebrow: string;
  intentId: IntentId;
  companySlug: CompanySlug;
  companyName: string;
  visual: SectorVisual;
  /** The long summary (OG card, other pages' cards). */
  summary: string;
  detail: string;
  /**
   * The page hero's lede and the /services card text: one sentence of 110
   * characters or fewer, so it sets in at most three lines on a phone.
   */
  lede: string;
  /** A short line of what it covers, for the /services card: "Diesel · Petrol · …". */
  tags: string;
  /** "What it covers": the service in one sentence, above who it serves. */
  overview: string;
  metaDescription: string;
  keywords: string[];
  /** Everything the service covers (the Service JSON-LD offer catalogue). */
  offerings: string[];
  audience: string[];
  /** The Service JSON-LD image, and other pages' cards. */
  image?: MediaImage;
  gallery?: MediaFigure[];
  /**
   * The page hero's visual: a 2000px landscape master runs under the text;
   * any other photograph, or a typographic panel, stands beside it. Never a
   * hazy or low-resolution frame, never third-party beverage branding.
   */
  heroVisual: ServiceVisual;
  /** A confirmed headline figure for the "What it covers" bento. */
  keyStat?: { value: string; label: string };
  /** Three things the service covers, which together cover `offerings`. */
  features: readonly ServiceFeature[];
  /** "Where it runs": the sub-nav label, the section title and an optional line under it. */
  where: { nav: string; heading: string; body?: string };
  /** The sites (stations, branches, yards) that deliver the service. */
  sites?: readonly CompanySite[];
  /** Or, for a service that moves goods, the stops of its route. */
  route?: readonly ServiceRouteStop[];
  /**
   * The visual of the page's one cinema tile, "The company behind it": a
   * photograph the page shows nowhere else, or a typographic panel.
   */
  companyVisual: ServiceVisual;
  faqs: Faq[];
  updatedAt: string;
};

export const serviceAreas: ServiceArea[] = [
  {
    slug: 'fuel-and-lubricants',
    title: 'Fuel and Lubricants',
    shortTitle: 'Fuel supply',
    navTitle: 'Fuel & Lubricants',
    eyebrow: 'Energy, Petroleum Retail and Parking',
    intentId: 'mwanjalisi',
    companySlug: 'mwanjalisi-oil',
    companyName: 'Mwanjalisi Oil Co Ltd',
    visual: 'fuel',
    summary:
      'Petroleum retail and parking services through high-visibility ITEMBA-branded stations and UZUNGUNI PARKING YARD managed by Mwanjalisi Oil Company Ltd for motorists, commercial transport operators, local businesses, and corridor customers.',
    detail:
      'Mwanjalisi Oil manages the legal and operational side of the fuel business, while the public filling station names use the ITEMBA brand with the location name. ITEMBA-MPEMBA is positioned near the Tunduma Bus Station along the Tunduma-Ileje Highway, while ITEMBA-UZUNGUNI serves the TANZAM Highway corridor in Uzunguni Area, Mpemba. UZUNGUNI PARKING YARD is also managed by Mwanjalisi Oil for corridor motorists, buses, trucks, and logistics companies.',
    lede: 'Diesel, petrol, kerosene and lubricants at the ITEMBA stations, and truck parking at UZUNGUNI PARKING YARD.',
    tags: 'Diesel · Petrol · Kerosene · Lubricants · Parking',
    overview:
      'Mwanjalisi Oil manages the fuel business; its filling stations trade publicly under the ITEMBA name and their location.',
    metaDescription:
      'Fuel, lubricant, and UZUNGUNI PARKING YARD services from ITEMBA-MPEMBA and ITEMBA-UZUNGUNI, managed by Mwanjalisi Oil Co Ltd under Itemba Group in Songwe Region, Tanzania.',
    keywords: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'diesel', 'petrol', 'kerosene', 'lubricants', 'parking', 'fuel supply', 'Songwe fuel station'],
    offerings: ['ITEMBA-MPEMBA filling station', 'ITEMBA-UZUNGUNI filling station', 'UZUNGUNI PARKING YARD', 'Diesel and petrol retail', 'Kerosene supply', 'Lubricants', 'Business fuel enquiries', 'Fleet, logistics, and parking support'],
    audience: ['Motorists', 'Transport operators', 'Commercial customers', 'Local businesses', 'Cross-border logistics companies', 'Parking and vehicle-staging customers'],
    image: mediaImage('mpemba-station-wide', {
      alt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd',
      caption: 'ITEMBA-MPEMBA and ITEMBA-UZUNGUNI are managed by Mwanjalisi Oil Company Ltd.',
    }),
    // The dusk "24 hours" frame, a 2400px master: the plan's lead for energy.
    heroVisual: mediaImage('mpemba-dusk'),
    keyStat: { value: '2', label: 'Operating ITEMBA stations' },
    features: [
      {
        icon: 'energy',
        title: 'Diesel, petrol and kerosene',
        body: 'Retail fuel for motorists, buses, trucks and fleets at ITEMBA-MPEMBA and ITEMBA-UZUNGUNI.',
      },
      {
        icon: 'droplet',
        title: 'Lubricants and business fuel',
        body: 'Lubricants at the forecourt, and business fuel enquiries for fleets and transport operators.',
      },
      {
        icon: 'map-pin',
        title: 'Parking and vehicle staging',
        body: 'Truck and vehicle parking at UZUNGUNI PARKING YARD for buses, trucks and logistics companies.',
      },
    ],
    where: {
      nav: 'Stations',
      heading: 'ITEMBA stations built for corridor movement',
      body: "Visible station brands, practical access and high-traffic positions on the corridor's main routes.",
    },
    // One station photograph only: the dusk hero is already ITEMBA-MPEMBA, so
    // its card is typographic and ITEMBA-UZUNGUNI's is the page's second and
    // last canopy (docs/PAGE-GUIDE.md, "Photographs").
    sites: [
      {
        name: 'ITEMBA-MPEMBA',
        kind: 'Filling station',
        detail: 'Near the Tunduma Bus Station, along the Tunduma-Ileje Highway.',
        icon: 'energy',
      },
      {
        name: 'ITEMBA-UZUNGUNI',
        kind: 'Filling station',
        detail: 'Along the TANZAM Highway in Uzunguni Area, Mpemba.',
        image: mediaImage('uzunguni-pump-island', { alt: 'The ITEMBA-UZUNGUNI canopy and pump islands' }),
      },
      {
        name: 'UZUNGUNI PARKING YARD',
        kind: 'Parking and vehicle staging',
        detail: 'Truck and vehicle parking in Uzunguni Area, Mpemba-Tunduma.',
        image: mediaImage('parking-container-trucks', { alt: 'Container trucks parked at UZUNGUNI PARKING YARD' }),
      },
      {
        name: 'New ITEMBA stations',
        kind: 'Planned expansion',
        detail: 'Three more stations will carry the ITEMBA-location name, under Mwanjalisi Oil management.',
        icon: 'energy',
        figure: { value: '3', label: 'planned' },
      },
    ],
    // Its strong photographs are all forecourts, and the page already shows two: typographic.
    companyVisual: {
      kind: 'type',
      icon: 'energy',
      statement: 'Fuel and parking where the TANZAM Highway meets the border.',
    },
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
    navTitle: 'Distribution',
    eyebrow: 'Wholesale and Retail Supply',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'trade',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and hospitality trade support for stockists, bars, night clubs, cross-border bulk buyers, and construction customers.',
    detail:
      'Westsides Company connects more than 50 stockists across Songwe Region with large-volume beverage supply at distributor pricing. A stockist is a wholesale customer with area-based distribution ability who depends on Westsides as a distributor specialist. The same trade platform serves bars and night clubs in Tunduma, Mlowo, Vwawa, and other urban centres, international customers buying beverages and hardware for cross-border movement, and construction companies serving the growing real estate, filling station, residential, commercial, and public infrastructure markets.',
    lede: 'Wholesale beverages at distributor pricing for stockists, bars, night clubs and cross-border bulk buyers.',
    tags: 'Beer · Spirits · Soft drinks · Bottled water',
    overview:
      'Westsides supplies beverages in volume to stockists: wholesale customers who distribute across their own areas and rely on Westsides as their distributor.',
    metaDescription:
      'Trade and distribution services from Westsides Company Ltd for Songwe stockists, bars, night clubs, cross-border bulk buyers, and construction customers in Tanzania.',
    keywords: ['beverage distribution', 'Songwe stockists', 'bars and night clubs', 'building materials', 'tools', 'electrical supplies', 'wholesale Tanzania', 'Tunduma border trade'],
    offerings: ['Wholesale beverage supply for stockists', 'Alcoholic and non-alcoholic beverages', 'ITEMBA-HARDWARE materials', 'Building materials', 'Tools and construction equipment', 'Cross-border bulk purchase support'],
    audience: ['Stockists across Songwe Region', 'Bars and night clubs in Tunduma, Mlowo and Vwawa', 'International bulk buyers', 'Construction companies and developers', 'Hospitality businesses'],
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
    // A crisp, unbranded frame of a customer order; the warehouse shots are too dim to lead.
    heroVisual: mediaImage('westsides-order-truck', {
      alt: 'A customer beverage order loaded on a truck for Westsides wholesale distribution',
    }),
    keyStat: { value: '50+', label: 'Beverage stockists across Songwe Region' },
    features: [
      {
        icon: 'trade',
        title: 'Wholesale beverages',
        body: 'Alcoholic and non-alcoholic beverages in volume, for stockists, bars and night clubs.',
      },
      {
        icon: 'globe',
        title: 'Cross-border bulk buying',
        body: 'Bulk purchase support for international buyers moving goods through the Tunduma border.',
      },
      {
        icon: 'construction',
        title: 'Building materials and tools',
        body: 'Materials, tools and construction equipment through ITEMBA-HARDWARE.',
        serviceSlug: 'construction-supplies-and-hardware',
      },
    ],
    where: { nav: 'Branches', heading: 'Beverage branches across Songwe' },
    sites: [
      {
        name: 'Mpemba Main Branch',
        kind: 'Wholesale only',
        detail: 'Beverage distribution for Mpemba and the surrounding business area.',
        icon: 'map-pin',
      },
      {
        name: 'Mlowo Branch',
        kind: 'Distribution centre',
        detail: 'Beverage distribution for Mlowo town and its neighbouring villages and wards.',
        icon: 'map-pin',
      },
      {
        name: 'Sogea Branch',
        kind: 'Distribution',
        detail: 'Beverage distribution for Sogea and Tunduma town as a whole.',
        icon: 'map-pin',
      },
    ],
    // The one frame that names the company: the WESTSIDES COMPANY LIMITED signboard.
    companyVisual: mediaImage('hardware-storefront', {
      alt: 'The WESTSIDES COMPANY LIMITED signboard above the ITEMBA-HARDWARE storefront',
    }),
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
    navTitle: 'Logistics & Transit',
    eyebrow: 'Tunduma Corridor Operations',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'logistics',
    summary:
      'Local logistics from Dar es Salaam to the Southern Highlands and cross-border transit support connected to the Tunduma corridor.',
    detail:
      'Itemba Enterprises anchors the group logistics capability for local businesses that buy or source goods from Dar es Salaam and need movement into Songwe, Mbeya, Rukwa, Ruvuma, and Iringa. The company also supports a growing transit market to and from neighbouring countries including Zambia, DRC, Zimbabwe, and Malawi through the Tunduma corridor.',
    lede: 'Moving goods from Dar es Salaam into the Southern Highlands, and across the border at Tunduma.',
    tags: 'Dar es Salaam · Southern Highlands · Tunduma',
    overview:
      "Itemba Enterprises anchors the group's logistics, for local businesses that buy or source their goods in Dar es Salaam and for a growing transit market.",
    metaDescription:
      'Logistics from Dar es Salaam to Songwe, Mbeya, Rukwa, Ruvuma, and Iringa plus cross-border transit from Itemba Enterprises Co Ltd through Tunduma.',
    keywords: ['Tunduma logistics', 'Dar es Salaam logistics', 'Southern Highlands transport', 'Songwe logistics', 'Mbeya logistics', 'Rukwa logistics', 'Ruvuma logistics', 'Iringa logistics', 'cross-border transit'],
    offerings: ['Dar es Salaam to Southern Highlands logistics', 'Local goods movement support', 'Cross-border transit', 'Transit to and from Zambia, DRC, Zimbabwe, and Malawi', 'Corridor operations enquiries'],
    audience: ['Local businesses sourcing from Dar es Salaam', 'Southern Highlands traders', 'Importers and exporters', 'Cross-border transit customers'],
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
    // Not the tanker under a forecourt canopy that leads the Itemba Enterprises
    // page: the fleet's own truck, with no canopy, so the sibling pages differ.
    heroVisual: mediaImage('logistics-truck-front', {
      alt: 'An Itemba Logistics truck with ITEMBA ENERGY across its windscreen, seen from the front',
    }),
    keyStat: { value: '4', label: 'Countries of cross-border transit' },
    features: [
      {
        icon: 'logistics',
        title: 'Local logistics',
        body: 'Goods bought or sourced in Dar es Salaam, moved to businesses across the Southern Highlands.',
      },
      {
        icon: 'globe',
        title: 'Cross-border transit',
        body: 'A growing transit market to and from neighbouring countries, through the Tunduma corridor.',
      },
      {
        icon: 'map-pin',
        title: 'Corridor operations',
        body: 'Operations enquiries, handled from the group base in Mpemba-Tunduma, close to the border.',
      },
    ],
    where: { nav: 'Route', heading: 'From the coast to the border, and beyond.' },
    route: [
      { name: 'Dar es Salaam', detail: 'Where local businesses buy or source their goods.' },
      { name: 'Southern Highlands', detail: 'Songwe, Mbeya, Rukwa, Ruvuma and Iringa.' },
      { name: 'Tunduma', detail: 'The group base at Mpemba-Tunduma, close to the Tanzania–Zambia border.' },
      { name: 'Beyond the border', detail: 'Transit to and from Zambia, DRC, Zimbabwe and Malawi.' },
    ],
    // The other fleet photographs repeat the tanker or the Enterprises home tile: typographic.
    companyVisual: {
      kind: 'type',
      icon: 'logistics',
      statement: 'The corridor that moves the south.',
    },
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
    navTitle: 'Hardware',
    eyebrow: 'ITEMBA-HARDWARE',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'hardware',
    summary:
      'Hardware, tools, construction equipment, and construction supply support under the ITEMBA-HARDWARE brand managed by Westsides Company Ltd for contractors and the growing real estate market.',
    detail:
      'ITEMBA-HARDWARE is the public hardware and construction supply brand managed by Westsides Company Ltd, supporting demand from construction companies, contractors, property developers, cross-border bulk buyers, and the growing real estate market, including filling stations, residential homes, commercial properties, and public infrastructure.',
    lede: 'Steel, roofing, paints and tools from ITEMBA-HARDWARE, for contractors, builders and developers.',
    tags: 'Steel · Roofing · Paints · Tools',
    overview:
      "ITEMBA-HARDWARE is the group's hardware and construction supply brand, run by Westsides for a growing real estate and construction market.",
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
    heroVisual: mediaImage('hardware-paint-stock', {
      alt: 'Paint and construction supply stock at ITEMBA-HARDWARE, run by Westsides Company Ltd',
    }),
    features: [
      {
        icon: 'construction',
        title: 'Steel and sections',
        body: 'Nondo, square and round pipes, H-beams, I-beams and U-channels.',
      },
      {
        icon: 'realestate',
        title: 'Roofing and fixings',
        body: 'Roofing sheets and wire nails for homes, commercial buildings and filling stations.',
      },
      {
        icon: 'droplet',
        title: 'Paints and tools',
        body: 'Paints of all types, with tools and construction equipment for contractors.',
      },
    ],
    where: { nav: 'Sites', heading: 'Branch and warehouses' },
    sites: [
      {
        name: 'ITEMBA-HARDWARE',
        kind: 'Tunduma Main Branch',
        detail: 'Hardware and construction equipment sales across Songwe Region.',
        image: mediaImage('hardware-storefront', {
          alt: 'The ITEMBA-HARDWARE storefront under the WESTSIDES COMPANY LIMITED signboard',
        }),
      },
      {
        name: 'Supply warehouses',
        kind: 'Tunduma town and Sogea',
        detail: 'Hardware and construction supply warehouses that support the branch.',
        icon: 'construction',
      },
    ],
    companyVisual: {
      kind: 'type',
      icon: 'trade',
      statement: 'Four branches across Songwe Region.',
      caption: 'Mpemba · Mlowo · Sogea · Tunduma',
    },
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
    navTitle: 'Hospitality',
    eyebrow: 'Uzunguni Inn',
    intentId: 'westsides',
    companySlug: 'westsides-company',
    companyName: 'Westsides Company Ltd',
    visual: 'hospitality',
    summary: 'Hospitality, lodging, restaurant, and bar services through UZUNGUNI INN under Westsides Company Ltd.',
    detail:
      'UZUNGUNI INN is the group hospitality brand for lodging, restaurant, and bar services at Mpemba-Tunduma, managed by Westsides Company Ltd.',
    lede: 'Lodging, a restaurant and a bar at UZUNGUNI INN, for travellers and business guests on the corridor.',
    tags: 'Lodging · Restaurant · Bar',
    overview: "The group's hospitality brand, run by Westsides alongside its beverage and hardware businesses.",
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
    // The room photograph is 600px wide, stock-looking and unconfirmed
    // (flags.useUnverifiedHospitalityPhotos), the restaurant frame carries
    // third-party beverage branding and the night bar is soft and blue-cast:
    // the page shows none of them. Typographic.
    heroVisual: {
      kind: 'type',
      icon: 'hospitality',
      statement: 'A place to stay on the corridor.',
      caption: 'UZUNGUNI INN · Mpemba-Tunduma',
    },
    features: [
      {
        icon: 'hospitality',
        title: 'Accommodation',
        body: 'Rooms for regional visitors, business guests and travellers on the corridor.',
      },
      {
        icon: 'droplet',
        title: 'Restaurant and bar',
        body: 'Restaurant and bar services for local and travelling customers.',
      },
      {
        icon: 'globe',
        title: 'Guest support',
        body: 'Business guest support and traveller services in Mpemba-Tunduma.',
      },
    ],
    where: { nav: 'Location', heading: 'Where to find it' },
    sites: [
      {
        name: 'UZUNGUNI INN',
        kind: 'Lodging, restaurant and bar',
        detail: 'In Mpemba-Tunduma, Songwe Region, managed by Westsides Company Ltd.',
        // No INN frame is strong enough (the night bar is soft and blue-cast): an icon card beside the group base's.
        icon: 'hospitality',
      },
    ],
    companyVisual: {
      kind: 'type',
      icon: 'trade',
      statement: 'Four branches across Songwe Region.',
      caption: 'Mpemba · Mlowo · Sogea · Tunduma',
    },
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
    navTitle: 'Real Estate',
    eyebrow: 'Itemba Estate',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'estate',
    summary: 'Property development, real estate, and property-related services through Itemba Estate under Itemba Enterprises.',
    detail: "Itemba Estate supports the group's property interests and real estate-related services in the Songwe Region business ecosystem.",
    lede: 'Property development and property-related services through Itemba Estate, part of Itemba Enterprises.',
    tags: 'Property development · Estate operations',
    overview: "Itemba Estate supports the group's property interests and real estate-related services in the Songwe Region business ecosystem.",
    metaDescription:
      'Real estate, property development, and property-related services through Itemba Estate under Itemba Enterprises Co Ltd in Tanzania.',
    keywords: ['Itemba Estate', 'real estate Songwe', 'property development Tanzania', 'property services'],
    offerings: ['Property development', 'Real estate enquiries', 'Property-related services', 'Estate operations'],
    audience: ['Property customers', 'Business partners', 'Regional investors', 'Local stakeholders'],
    // flags.estateImagery: these are external images with no licence recorded
    // and not Itemba projects, so while the estate is typographic they are
    // left out altogether (the Service JSON-LD image and other pages' cards too).
    ...(flags.estateImagery === 'current'
      ? {
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
        }
      : {}),
    // flags.estateImagery: no photograph is implied to be an Itemba project, so the page is typographic.
    heroVisual: {
      kind: 'type',
      icon: 'realestate',
      statement: "The group's property interests, in Songwe Region.",
      caption: 'Itemba Estate · Itemba Enterprises',
    },
    features: [
      {
        icon: 'realestate',
        title: 'Property development',
        body: 'Property development under the Itemba Estate name.',
      },
      {
        icon: 'document',
        title: 'Property-related services',
        body: 'Property-related services and estate operations for customers and partners.',
      },
      {
        icon: 'map-pin',
        title: 'Real estate enquiries',
        body: 'Property enquiries, routed by the group office to Itemba Estate.',
      },
    ],
    where: { nav: 'Sites', heading: 'Where it operates' },
    sites: [
      {
        name: 'Itemba Estate',
        kind: 'Real estate and property',
        detail: 'Property interests and property-related services, from the group base in Songwe Region.',
        icon: 'realestate',
      },
    ],
    companyVisual: {
      kind: 'type',
      icon: 'logistics',
      statement: 'Logistics and Itemba Estate, in one company.',
      caption: 'Itemba Logistics · Itemba Estate · Emerging businesses',
    },
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

/** The other service areas the same company runs, in public order. */
export function siblingServices(service: Pick<ServiceArea, 'slug' | 'companySlug'>): ServiceArea[] {
  return serviceAreas.filter((other) => other.companySlug === service.companySlug && other.slug !== service.slug);
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
    lede: 'Six service areas, each run by one of the three Itemba Group companies, so every enquiry has a clear owner.',
    actions: [
      { label: 'Meet the companies', href: '/companies' },
      { label: 'Start a business enquiry', href: '/contact' },
    ] satisfies LinkItem[],
  },
  directory: {
    /** The directory section's accessible name (its headings are the company names). */
    label: 'Services by company',
    /**
     * The directory's one photograph, on the first card (the fuel service,
     * the only one Mwanjalisi Oil runs, set full width): a crisp ITEMBA
     * canopy under a blue sky. The other cards are typographic.
     */
    feature: {
      serviceSlug: 'fuel-and-lubricants',
      image: mediaImage('uzunguni-pump-island', {
        alt: 'The ITEMBA-UZUNGUNI filling station canopy and pump islands under a blue sky',
      }),
    },
    /** Before the company's short name: "Explore Westsides". */
    explore: 'Explore',
    /** The decorative call to action at the foot of each service card. */
    cardAction: 'Learn more',
  },
  closing: {
    title: 'Every sector. One front door.',
    body: 'One group office routes every enquiry to the right company.',
    action: { label: 'Start a business enquiry', href: '/contact' } satisfies LinkItem,
    channels: { whatsapp: 'WhatsApp', call: 'Call' },
  },
} as const;

/** /services/[slug] copy. */
export const servicePageCopy = {
  /** The sticky sub-nav: section anchors and the Enquire pill. */
  nav: {
    /** Follows the service's sector name: "Fuel & Lubricants sections". */
    labelSuffix: 'sections',
    offerings: 'Overview',
    company: 'Company',
    faq: 'FAQ',
    enquire: 'Enquire',
    /** The chevron beside the name on phones, which lists the anchors above. */
    menu: 'Show sections',
  },
  hero: {
    enquire: 'Enquire',
    /** Before the company's short name: "Run by Mwanjalisi Oil". */
    runBy: 'Run by',
  },
  offeringsHeading: 'What it covers',
  audienceLabel: 'Who it serves',
  /** Above the service's headline figure in the "What it covers" bento. */
  keyFigure: 'Key figure',
  /** The chevron link on a feature that has its own service page. */
  featureAction: 'Learn more',
  /** Under "Where it runs": the group's location profile. */
  locationLink: 'Explore the Songwe-Tunduma location',
  /**
   * Beside a service's one typographic site (Itemba Estate), the group base
   * as a card of its own, so the site does not stand alone.
   */
  locationCard: {
    kind: 'Group base',
    detail: 'Mpemba-Tunduma, Songwe Region, close to the Tanzania–Zambia border.',
    action: 'Explore the location',
  },
  company: {
    eyebrow: 'The company behind it',
    registeredName: 'Registered name',
    incorporated: 'Incorporated',
    /** Above the company's other service areas: "Also from Westsides". */
    alsoFrom: 'Also from',
    /** Before the company's short name: "Explore Westsides". */
    explore: 'Explore',
    /** The company's ready-made profile PDF (a download link: the verb is implied). */
    download: 'Company profile',
    downloadFormat: 'PDF',
  },
  faqHeading: 'Frequently asked questions',
  enquire: {
    eyebrow: 'Enquire',
    /** The group's routing promise, beside the form. */
    body: 'One group office routes every enquiry to the right company.',
    /** How an enquiry travels, as numbered steps under the promise. */
    stepsLabel: 'How it works',
    steps: [
      {
        title: 'Choose who it is for',
        body: 'The form starts with the company that runs this service. Pick another, or General, at any time.',
      },
      { title: 'Say how to reach you', body: 'A phone number, email or WhatsApp number, and a short message.' },
      { title: 'The group office routes it', body: 'Your enquiry reaches the right company team through one front door.' },
    ],
  },
} as const;
