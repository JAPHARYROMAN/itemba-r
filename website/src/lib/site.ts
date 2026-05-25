export const site = {
  name: 'Itemba Group',
  url: 'https://www.itembagrouptz.com',
  domain: 'www.itembagrouptz.com',
  title: "Itemba Group | Tanzania's Diversified Business Group",
  description:
    'Itemba Group is a Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region, operating across energy, trade, logistics, construction, hospitality, real estate, and manufacturing.',
  shortDescription: 'A multi-industry business ecosystem in Tanzania.',
  locale: 'en_TZ',
};

export const contact = {
  email: 'info@itembagrouptz.com',
  primaryPhone: '+255758793511',
  secondaryPhone: '+255745215047',
  primaryPhoneDisplay: '+255 758 793 511',
  secondaryPhoneDisplay: '+255 745 215 047',
  whatsapp: 'https://wa.me/255758793511?text=Hello%20Itemba%20Group%2C%20I%20would%20like%20to%20make%20a%20business%20enquiry.',
  headOffice: 'Itemba Filling Station, Along Tunduma-Ileje Highway, Mpemba, Tunduma',
  postal: 'P.O. Box 132, Tunduma-Songwe, Tanzania',
  mapQuery: 'Itemba Filling Station Mpemba Tunduma Tanzania',
};

export type Faq = {
  question: string;
  answer: string;
};

export type EnquiryIntent = {
  id: string;
  label: string;
  shortLabel: string;
  subject: string;
  routeTo: string;
  summary: string;
  accentClass: string;
  ringClass: string;
};

export type ServiceArea = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  intentId: string;
  companySlug: string;
  companyName: string;
  visual: 'fuel' | 'trade' | 'logistics' | 'hardware' | 'estate' | 'hospitality' | 'parking';
  summary: string;
  detail: string;
  metaDescription: string;
  keywords: string[];
  offerings: string[];
  audience: string[];
  image?: {
    src: string;
    alt: string;
    caption?: string;
  };
  gallery?: Array<{
    src: string;
    alt: string;
    caption: string;
  }>;
  faqs: Faq[];
};

export type LocationProfile = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  detail: string;
  metaDescription: string;
  visual: 'corridor' | 'operations' | 'logistics';
  image?: {
    src: string;
    alt: string;
    caption?: string;
  };
  addressLines: string[];
  searchTerms: string[];
  advantages: Array<{ title: string; summary: string }>;
  serviceSlugs: string[];
  companySlugs: string[];
  faqs: Faq[];
};

export type PartnershipArea = {
  id: string;
  title: string;
  routeTo: string;
  intentId: string;
  summary: string;
  goodFit: string[];
  serviceSlugs: string[];
  companySlugs: string[];
};

export type InsightArticle = {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  metaDescription: string;
  keywords: string[];
  publishedAt: string;
  updatedAt: string;
  readingTime: string;
  audience: string[];
  serviceSlugs: string[];
  companySlugs: string[];
  locationSlugs: string[];
  sections: Array<{
    heading: string;
    body: string;
    points?: string[];
  }>;
  cta: {
    label: string;
    href: string;
  };
};

export const companyProfiles = [
  {
    id: 'mwanjalisi',
    slug: 'mwanjalisi-oil',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Energy, Fuel & Parking',
    eyebrow: 'Petroleum Retail & Parking',
    accentBg: 'bg-amber-500',
    accentClass: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    visual: 'fuel',
    summary:
      "Tanzania's petroleum retail and corridor support arm within Itemba Group, managing high-visibility ITEMBA-branded filling stations and UZUNGUNI PARKING YARD for motorists, fleet operators, and logistics customers across Songwe Region.",
    detail:
      "Positioned along major transport routes near the Tanzania-Zambia border, Mwanjalisi Oil manages retail fuel station operations that trade publicly under the ITEMBA location brand, including ITEMBA-MPEMBA near the Tunduma Bus Station and ITEMBA-UZUNGUNI along the TANZAM Highway. It also manages UZUNGUNI PARKING YARD in Uzunguni Area, Mpemba-Tunduma for corridor motorists and logistics operators.",
    services: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'UZUNGUNI PARKING YARD', 'Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Commercial fleet supply enquiries'],
    highlights: ['ITEMBA-branded stations managed by Mwanjalisi Oil', 'UZUNGUNI PARKING YARD managed by Mwanjalisi Oil', 'Located along major corridor routes and near a major bus stand', 'Serves motorists, fleets, and logistics operators', 'Two operating stations with three upcoming fuel locations'],
    image: {
      src: '/images/fuel-stations/itemba-filling-station-wide.webp',
      alt: 'ITEMBA-MPEMBA filling station forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
    },
    gallery: [
      {
        src: '/images/fuel-stations/itemba-filling-station-wide.webp',
        alt: 'ITEMBA filling station forecourt and canopy',
        caption: 'ITEMBA-branded fuel station presence under Mwanjalisi Oil management.',
      },
      {
        src: '/images/fuel-stations/itemba-mpemba-truck-canopy.webp',
        alt: 'Truck refuelling under the ITEMBA-MPEMBA canopy',
        caption: 'Forecourt access for trucks, buses, motorists, and corridor logistics operators.',
      },
      {
        src: '/images/parking/uzunguni-parking-yard-trucks.webp',
        alt: 'Truck parking at Uzunguni Parking Yard',
        caption: 'UZUNGUNI PARKING YARD supports corridor vehicle staging and parking.',
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
  },
  {
    id: 'westsides',
    slug: 'westsides-company',
    name: 'Westsides Company Ltd',
    sector: 'Trade & Distribution',
    eyebrow: 'Wholesale & Retail Trade',
    accentBg: 'bg-blue-500',
    accentClass: 'text-blue-400',
    accentBorder: 'border-blue-500/30',
    visual: 'trade',
    summary:
      'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN operations for stockists, bars, night clubs, contractors, hospitality customers, and cross-border bulk buyers.',
    detail:
      "Westsides Company Ltd manages the group's trading and hospitality brands, including wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN. Its market includes more than 50 stockists across Songwe Region, bars and night clubs in urban centres such as Tunduma, Mlowo, and Vwawa, international bulk buyers moving goods through Tunduma border, and construction companies serving the growing real estate and infrastructure market.",
    services: ['Wholesale beverages', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', 'Construction equipment sales'],
    highlights: ['More than 50 beverage stockists across Songwe Region', 'Serves bars, night clubs, and hospitality outlets', 'Supports cross-border bulk buyers and construction companies'],
    image: {
      src: '/images/beverages/westsides-warehouse-stock-wide.webp',
      alt: 'Westsides Company Ltd wholesale beverage warehouse stock for distribution customers',
    },
    gallery: [
      {
        src: '/images/beverages/westsides-customer-order-truck.webp',
        alt: 'Customer beverage order loaded on a truck for Westsides distribution',
        caption: 'Customer orders prepared for stockists and bulk buyers across Songwe Region.',
      },
      {
        src: '/images/beverages/westsides-softdrinks-warehouse.webp',
        alt: 'Soft drink stock inside a Westsides beverage warehouse',
        caption: 'Soft drink stock handled through Westsides wholesale distribution.',
      },
      {
        src: '/images/hardware/itemba-hardware-paint-stock.webp',
        alt: 'ITEMBA-HARDWARE paint and construction supply stock',
        caption: 'ITEMBA-HARDWARE supports contractors, real estate, and infrastructure customers.',
      },
      {
        src: '/images/hospitality/uzunguni-bar-restaurant.webp',
        alt: 'UZUNGUNI INN restaurant and bar seating',
        caption: 'UZUNGUNI INN adds lodging, restaurant, and bar services under Westsides.',
      },
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
  },
  {
    id: 'enterprises',
    slug: 'itemba-enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Logistics and Transit Operations',
    eyebrow: 'Logistics and Cross-Border Transit',
    accentBg: 'bg-emerald-500',
    accentClass: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    visual: 'logistics',
    summary:
      "The group's logistics and emerging-business company, anchored by Dar es Salaam-to-Southern Highlands movement and cross-border transit through the Tunduma corridor.",
    detail:
      'Itemba Enterprises focuses on logistics services, cross-border transit, and emerging businesses after trading and hospitality operations were placed under Westsides Company Ltd and UZUNGUNI PARKING YARD came under Mwanjalisi Oil Co Ltd management. Its logistics target market includes local businesses sourcing goods from Dar es Salaam into the Southern Highlands regions of Songwe, Mbeya, Rukwa, Ruvuma, and Iringa, plus transit customers moving goods to and from Zambia, DRC, Zimbabwe, and Malawi.',
    services: ['Local logistics', 'Cross-border transit', 'Emerging businesses'],
    highlights: ['Dar es Salaam to Southern Highlands logistics', 'Transit routes to Zambia, DRC, Zimbabwe, and Malawi', 'Direct access to the Tunduma border corridor'],
    image: {
      src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
      alt: 'Itemba Logistics fuel tanker supporting goods movement and transit operations',
    },
    gallery: [
      {
        src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
        alt: 'Itemba Logistics tanker truck under station canopy',
        caption: 'Itemba Logistics anchors local and cross-border movement for the group.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-front.webp',
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet visibility for Southern Highlands and corridor operations.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-yard.webp',
        alt: 'Itemba Logistics truck in a yard',
        caption: 'Yard-based movement support for local businesses and transit customers.',
      },
    ],
    enquiryLabel: 'Operations enquiry',
    faqs: [
      {
        question: 'What are the Itemba Enterprises divisions?',
        answer:
          'Itemba Enterprises focuses on Itemba Logistics, cross-border transit, and emerging business opportunities.',
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
  },
] as const;

export const coreRoutes = [
  { path: '/', priority: 1 },
  { path: '/about', priority: 0.85 },
  { path: '/services', priority: 0.88 },
  { path: '/locations', priority: 0.82 },
  { path: '/companies', priority: 0.9 },
  { path: '/capabilities', priority: 0.84 },
  { path: '/insights', priority: 0.76 },
  { path: '/company-profile', priority: 0.86 },
  { path: '/partnerships', priority: 0.82 },
  { path: '/faq', priority: 0.78 },
  { path: '/contact', priority: 0.8 },
] as const;

export const capabilityAreas = [
  {
    title: 'Energy, Fuel and Parking',
    company: 'Mwanjalisi Oil Co Ltd',
    summary: 'Petroleum retail and parking operations for fuel, lubricant, and corridor customers in Songwe Region.',
    points: ['Diesel, petrol, kerosene, lubricants, and UZUNGUNI PARKING YARD', 'Retail, business fuel, and parking enquiries', 'Strategic corridor location in Mpemba-Tunduma'],
  },
  {
    title: 'Trade and Distribution',
    company: 'Westsides Company Ltd',
    summary: 'Wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN operations for stockists, hospitality outlets, bulk buyers, and construction customers.',
    points: ['More than 50 stockists across Songwe Region', 'Bars, night clubs, restaurants, and hospitality outlets in Tunduma, Mlowo, Vwawa, and other centres', 'International bulk buyers and construction companies buying hardware and materials'],
  },
  {
    title: 'Logistics and Multi-Sector Operations',
    company: 'Itemba Enterprises Co Ltd',
    summary: 'Local logistics and cross-border transit for businesses sourcing goods into the Southern Highlands and neighbouring countries.',
    points: ['Dar es Salaam to Songwe, Mbeya, Rukwa, Ruvuma, and Iringa logistics', 'Transit business to and from Zambia, DRC, Zimbabwe, and Malawi', 'Operations aligned with the Tunduma border corridor'],
  },
] as const;

export const groupFaqs: Faq[] = [
  {
    question: 'What is Itemba Group?',
    answer:
      'Itemba Group is a Tanzanian multi-industry holding group headquartered in Mpemba-Tunduma, Songwe Region.',
  },
  {
    question: 'Which companies are part of Itemba Group?',
    answer:
      'The group includes Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.',
  },
  {
    question: 'Which sectors does Itemba Group operate in?',
    answer:
      'The group operates across energy, trade, logistics, construction supplies, hospitality, parking, real estate, and manufacturing-related activities.',
  },
  {
    question: 'How can business enquiries be submitted?',
    answer:
      'Business enquiries can be submitted by phone, WhatsApp, or email through the contact details listed on the website.',
  },
];

export const partnershipAreas: PartnershipArea[] = [
  {
    id: 'suppliers',
    title: 'Supplier and Distributor Introductions',
    routeTo: 'Itemba Group office',
    intentId: 'general',
    summary:
      'For suppliers, manufacturers, and distributors looking to introduce products, supply categories, or regional business opportunities.',
    goodFit: ['Beverage suppliers', 'Construction goods suppliers', 'Hardware and electrical product suppliers', 'Regional distributors'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware'],
    companySlugs: ['westsides-company', 'itemba-enterprises'],
  },
  {
    id: 'bulk-buyers',
    title: 'Bulk Purchase and Commercial Supply',
    routeTo: 'Westsides Company Ltd',
    intentId: 'westsides',
    summary:
      'For stockists, bars, night clubs, cross-border bulk buyers, contractors, construction companies, hospitality operators, and institutional buyers seeking beverage, construction, tool, or electrical supply support.',
    goodFit: ['Songwe stockists', 'Bars and night clubs', 'Cross-border bulk buyers', 'Construction companies', 'Hospitality businesses'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware'],
    companySlugs: ['westsides-company'],
  },
  {
    id: 'fuel-logistics',
    title: 'Fuel, Parking, Fleet, and Logistics Customers',
    routeTo: 'Mwanjalisi Oil Co Ltd and Itemba Enterprises Co Ltd',
    intentId: 'mwanjalisi',
    summary:
      'For transport operators, commercial fleets, traders, local businesses sourcing goods from Dar es Salaam, and cross-border customers that need fuel, lubricants, UZUNGUNI PARKING YARD access, local logistics, or transit support.',
    goodFit: ['Transport operators', 'Dar es Salaam sourcing customers', 'Southern Highlands businesses', 'Parking and corridor customers', 'Cross-border traders'],
    serviceSlugs: ['fuel-and-lubricants', 'logistics-and-cross-border-transit'],
    companySlugs: ['mwanjalisi-oil', 'itemba-enterprises'],
  },
  {
    id: 'property-hospitality',
    title: 'Hospitality, Parking, Property, and Local Services',
    routeTo: 'Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd',
    intentId: 'general',
    summary:
      'For enquiries connected to UZUNGUNI PARKING YARD under Mwanjalisi Oil, UZUNGUNI INN under Westsides, property, estate services, and related local business opportunities.',
    goodFit: ['Business guests', 'Property stakeholders', 'Parking and corridor customers', 'Local service partners'],
    serviceSlugs: ['hospitality-and-lodging', 'real-estate-and-property'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
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

export const insightArticles: InsightArticle[] = [
  {
    slug: 'route-business-enquiry-itemba-group',
    title: 'How to Route a Business Enquiry to Itemba Group',
    eyebrow: 'Business Enquiries',
    summary:
      'A practical guide to choosing the right Itemba Group contact route for fuel, trade, logistics, construction supply, hospitality, property, and partnership enquiries.',
    metaDescription:
      'Learn how to route a business enquiry to Itemba Group companies and divisions across fuel, trade, logistics, construction supply, hospitality, and property services.',
    keywords: ['Itemba Group enquiry', 'business enquiry Tanzania', 'Songwe business services', 'Tunduma services'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Customers', 'Suppliers', 'Contractors', 'Transport operators'],
    serviceSlugs: ['fuel-and-lubricants', 'trade-and-distribution', 'logistics-and-cross-border-transit'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    sections: [
      {
        heading: 'Start with the business need',
        body:
          'The fastest route is to identify the operating area first. Fuel and lubricants, trade distribution, logistics, hardware, hospitality, and property enquiries each point to different teams within the group.',
        points: [
          'Fuel, lubricant, and UZUNGUNI PARKING YARD enquiries usually align with Mwanjalisi Oil Co Ltd.',
          'Stockist, bar, night club, beverage, construction goods, tools, and electrical supply enquiries usually align with Westsides Company Ltd.',
          'Dar es Salaam-to-Southern Highlands logistics and cross-border transit enquiries usually align with Itemba Enterprises Co Ltd. ITEMBA-HARDWARE and UZUNGUNI INN enquiries align with Westsides Company Ltd.',
        ],
      },
      {
        heading: 'Use the service pages as the routing map',
        body:
          'Each service page explains the offer, the likely audience, and the operating company connected to that area. This helps a visitor prepare a focused message before contacting the group office.',
      },
      {
        heading: 'Send enough context for internal routing',
        body:
          'A good enquiry should include the service area, the company or division you think is relevant, the location or delivery context, and the preferred contact method.',
        points: [
          'For urgent requests, use phone or WhatsApp.',
          'For detailed commercial requests, include the scope, timing, and contact details in the enquiry form or email.',
          'For multi-sector requests, use the partnerships page so the group office can route it internally.',
        ],
      },
    ],
    cta: {
      label: 'Route an enquiry',
      href: '/partnerships',
    },
  },
  {
    slug: 'tunduma-corridor-fuel-trade-logistics',
    title: 'Why the Tunduma Corridor Matters for Fuel, Trade, and Logistics',
    eyebrow: 'Location Advantage',
    summary:
      'How Itemba Group location in Mpemba-Tunduma supports regional fuel, distribution, logistics, and cross-border business enquiries.',
    metaDescription:
      'Understand why Itemba Group location in Mpemba-Tunduma, Songwe Region, matters for fuel, trade distribution, logistics, and cross-border transit enquiries.',
    keywords: ['Tunduma corridor', 'Songwe logistics', 'Tanzania Zambia corridor', 'Mpemba Tunduma business'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Transport operators', 'Regional traders', 'Fleet customers', 'Suppliers'],
    serviceSlugs: ['fuel-and-lubricants', 'logistics-and-cross-border-transit', 'trade-and-distribution'],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    sections: [
      {
        heading: 'A practical operating base',
        body:
          'Itemba Group is headquartered at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma. This gives the group a clear regional point of contact for customers and partners in Songwe Region.',
      },
      {
        heading: 'Useful for multiple service lines',
        body:
          'The same location context supports fuel customers, regional trade, construction supply demand, logistics enquiries, hospitality customers, and property-related services.',
        points: [
          'Fuel enquiries connect to corridor movement and transport activity.',
          'Trade and construction supply enquiries connect to Songwe stockists, bars, night clubs, cross-border bulk buyers, and the real estate construction market.',
          'Logistics and transit enquiries connect Dar es Salaam sourcing routes to the Southern Highlands and neighbouring countries.',
        ],
      },
      {
        heading: 'What to confirm before contacting',
        body:
          'Customers should mention the origin, destination, preferred timing, product or service category, and whether the enquiry is local, regional, or cross-border.',
      },
    ],
    cta: {
      label: 'View location profile',
      href: '/locations/songwe-tunduma',
    },
  },
  {
    slug: 'choose-right-itemba-company',
    title: 'Choosing the Right Itemba Group Company for Your Enquiry',
    eyebrow: 'Company Guide',
    summary:
      'A simple guide to Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd so visitors can contact the right operating team.',
    metaDescription:
      'Compare Itemba Group companies and learn which operating company fits fuel, trade distribution, logistics, hardware, hospitality, real estate, and parking enquiries.',
    keywords: ['Itemba Group companies', 'Mwanjalisi Oil', 'Westsides Company', 'Itemba Enterprises'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '5 min read',
    audience: ['Business customers', 'Partners', 'Suppliers', 'Local service customers'],
    serviceSlugs: [
      'fuel-and-lubricants',
      'trade-and-distribution',
      'construction-supplies-and-hardware',
      'hospitality-and-lodging',
      'real-estate-and-property',
    ],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    sections: [
      {
        heading: 'Mwanjalisi Oil Co Ltd',
        body:
          'Mwanjalisi Oil is the petroleum retail and parking arm of Itemba Group, serving fuel, diesel, petrol, kerosene, lubricants, UZUNGUNI PARKING YARD, and business fuel enquiries.',
      },
      {
        heading: 'Westsides Company Ltd',
        body:
          'Westsides Company handles wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN for more than 50 Songwe stockists, bars and night clubs, international bulk buyers, and construction companies serving the growing real estate market.',
      },
      {
        heading: 'Itemba Enterprises Co Ltd',
        body:
          'Itemba Enterprises covers local logistics, cross-border transit, and emerging businesses. Its logistics market includes customers sourcing goods from Dar es Salaam to the Southern Highlands and transit customers moving to and from Zambia, DRC, Zimbabwe, and Malawi. ITEMBA-HARDWARE and UZUNGUNI INN are managed under Westsides Company Ltd, while UZUNGUNI PARKING YARD is managed under Mwanjalisi Oil Co Ltd.',
      },
      {
        heading: 'If the enquiry spans more than one company',
        body:
          'Use the general business enquiry or partnerships route. The group office can review the enquiry type and route it to the most relevant company or division.',
      },
    ],
    cta: {
      label: 'Compare capabilities',
      href: '/capabilities',
    },
  },
  {
    slug: 'supplier-bulk-purchase-enquiries',
    title: 'What Suppliers and Bulk Buyers Should Prepare Before Contacting Itemba Group',
    eyebrow: 'Partnership Readiness',
    summary:
      'A checklist for supplier introductions, bulk purchase requests, construction supply enquiries, hospitality customers, and commercial partners.',
    metaDescription:
      'Prepare supplier introductions and bulk purchase enquiries for Itemba Group with the right product, volume, delivery, company, and contact details.',
    keywords: ['supplier enquiry Tanzania', 'bulk purchase Songwe', 'construction supply enquiry', 'Itemba partnerships'],
    publishedAt: '2026-05-14',
    updatedAt: '2026-05-14',
    readingTime: '4 min read',
    audience: ['Suppliers', 'Bulk buyers', 'Contractors', 'Hospitality businesses'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware', 'hospitality-and-lodging'],
    companySlugs: ['westsides-company', 'itemba-enterprises'],
    locationSlugs: ['songwe-tunduma'],
    sections: [
      {
        heading: 'Prepare the commercial basics',
        body:
          'A clear enquiry should include product category, expected volume, delivery or pickup context, timing, and the business contact person.',
        points: [
          'For supplier introductions, include product categories and supply coverage.',
          'For stockist or bulk purchase requests, include quantities, timing, preferred fulfilment location, and distribution area.',
          'For construction supply enquiries, mention the project type, such as filling stations, residential homes, commercial properties, or public infrastructure.',
        ],
      },
      {
        heading: 'Choose the closest route',
        body:
          'Westsides Company is usually the closest match for stockists, bars, night clubs, beverage, ITEMBA-HARDWARE, UZUNGUNI INN, construction goods, tools, and electrical supply enquiries. Mwanjalisi Oil is the closest match for fuel and UZUNGUNI PARKING YARD enquiries, while Itemba Enterprises is the route for Dar es Salaam-to-Southern Highlands logistics and cross-border transit opportunities.',
      },
      {
        heading: 'Use partnerships for multi-sector opportunities',
        body:
          'If an opportunity touches multiple services or companies, the partnerships page is the best starting point because it is designed for internal routing.',
      },
    ],
    cta: {
      label: 'Open partnerships page',
      href: '/partnerships',
    },
  },
];

export const enquiryIntents: EnquiryIntent[] = [
  {
    id: 'general',
    label: 'General business enquiry',
    shortLabel: 'General',
    subject: 'General business enquiry',
    routeTo: 'Itemba Group office',
    summary: 'Partnerships, group information, supplier introductions, and other business matters.',
    accentClass: 'bg-gold-500',
    ringClass: 'border-gold-400 bg-gold-50 text-gold-700',
  },
  {
    id: 'mwanjalisi',
    label: 'Fuel and petroleum supply',
    shortLabel: 'Fuel',
    subject: 'Mwanjalisi Oil fuel supply enquiry',
    routeTo: 'Mwanjalisi Oil Co Ltd',
    summary: 'Diesel, petrol, kerosene, lubricants, UZUNGUNI PARKING YARD, and business fuel supply enquiries.',
    accentClass: 'bg-amber-500',
    ringClass: 'border-amber-400 bg-amber-50 text-amber-700',
  },
  {
    id: 'westsides',
    label: 'Trade and distribution',
    shortLabel: 'Trade',
    subject: 'Westsides Company trade supply enquiry',
    routeTo: 'Westsides Company Ltd',
    summary: 'Stockists, bars, night clubs, beverages, building materials, tools, electrical supplies, and bulk purchase enquiries.',
    accentClass: 'bg-blue-500',
    ringClass: 'border-blue-400 bg-blue-50 text-blue-700',
  },
  {
    id: 'enterprises',
    label: 'Logistics and operations',
    shortLabel: 'Logistics',
    subject: 'Itemba Enterprises operations enquiry',
    routeTo: 'Itemba Enterprises Co Ltd',
    summary: 'Dar es Salaam-to-Southern Highlands logistics, cross-border transit, and emerging-business enquiries.',
    accentClass: 'bg-emerald-500',
    ringClass: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  },
];

export const serviceAreas: ServiceArea[] = [
  {
    slug: 'fuel-and-lubricants',
    title: 'Fuel and Lubricants',
    shortTitle: 'Fuel Supply',
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
    image: {
      src: '/images/fuel-stations/itemba-filling-station-wide.webp',
      alt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd',
      caption: 'ITEMBA-MPEMBA and ITEMBA-UZUNGUNI are managed by Mwanjalisi Oil Company Ltd.',
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
    image: {
      src: '/images/beverages/westsides-warehouse-stock-wide.webp',
      alt: 'Westsides Company Ltd wholesale beverage stock prepared for distribution customers',
      caption: 'Westsides Company Ltd supplies high-volume beverage stockists and bulk buyers across Songwe Region.',
    },
    gallery: [
      {
        src: '/images/beverages/westsides-warehouse-stock-wide.webp',
        alt: 'Large Westsides beverage warehouse stock for wholesale distribution',
        caption: 'Large-volume beverage stock handled for area-based stockists and retailers.',
      },
      {
        src: '/images/beverages/westsides-customer-order-truck.webp',
        alt: 'Customer beverage order loaded on a delivery truck',
        caption: 'Customer orders prepared for wholesale buyers and cross-border movement.',
      },
      {
        src: '/images/beverages/westsides-softdrinks-warehouse.webp',
        alt: 'Soft drinks stacked in a Westsides warehouse',
        caption: 'Soft drink supply for stockists, bars, restaurants, and retail customers.',
      },
      {
        src: '/images/beverages/westsides-cocacola-crates.webp',
        alt: 'Coca-Cola crates stored for Westsides distribution',
        caption: 'Branded beverage crates held for wholesale distribution channels.',
      },
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
        answer:
          'Yes. Bulk purchase and supplier enquiries can be submitted through the contact page, WhatsApp, or email.',
      },
    ],
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
    image: {
      src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
      alt: 'Itemba Logistics tanker supporting Dar es Salaam to Southern Highlands and transit movement',
      caption: 'Itemba Logistics supports local movement and cross-border transit through the Tunduma corridor.',
    },
    gallery: [
      {
        src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
        alt: 'Itemba Logistics tanker under station canopy',
        caption: 'Corridor-ready logistics support connected to the Tunduma border.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-front.webp',
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet presence for Dar es Salaam to Southern Highlands movement.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-yard.webp',
        alt: 'Itemba Logistics truck parked in yard',
        caption: 'Yard-based support for local traders and transit customers.',
      },
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
        answer:
          'The group is headquartered in Mpemba-Tunduma, Songwe Region, close to the Tanzania-Zambia border corridor.',
      },
    ],
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
    image: {
      src: '/images/hardware/itemba-hardware-storefront.webp',
      alt: 'ITEMBA-HARDWARE storefront and construction supply stock managed by Westsides Company Ltd',
      caption: 'ITEMBA-HARDWARE supplies construction materials and equipment under Westsides Company Ltd.',
    },
    gallery: [
      {
        src: '/images/hardware/itemba-hardware-storefront.webp',
        alt: 'ITEMBA-HARDWARE storefront and construction stock',
        caption: 'ITEMBA-HARDWARE serves contractors, developers, and bulk hardware buyers.',
      },
      {
        src: '/images/hardware/itemba-hardware-paint-stock.webp',
        alt: 'Paint and hardware stock inside ITEMBA-HARDWARE',
        caption: 'Paints and construction supplies stocked for the regional market.',
      },
    ],
    faqs: [
      {
        question: 'Which construction goods are available?',
        answer:
          'ITEMBA-HARDWARE handles Nondo, roofing sheets, wire nails, paints, square pipes, round pipes, H-beams, I-beams, U-channels, and related construction supplies.',
      },
      {
        question: 'Which company handles hardware enquiries?',
        answer:
          'Hardware and construction supply enquiries are handled through ITEMBA-HARDWARE under Westsides Company Ltd.',
      },
    ],
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
    summary:
      'Hospitality, lodging, restaurant, and bar services through UZUNGUNI INN under Westsides Company Ltd.',
    detail:
      'UZUNGUNI INN is the group hospitality brand for lodging, restaurant, and bar services at Mpemba-Tunduma, managed by Westsides Company Ltd.',
    metaDescription:
      'Hospitality, lodging, restaurant, and bar services through UZUNGUNI INN under Westsides Company Ltd in Songwe Region, Tanzania.',
    keywords: ['Uzunguni Inn', 'lodging Songwe', 'hospitality Tunduma', 'hotel services'],
    offerings: ['Accommodation', 'Restaurant services', 'Business guest support', 'Traveller services'],
    audience: ['Travellers', 'Business guests', 'Regional visitors', 'Transport corridor customers'],
    image: {
      src: '/images/hospitality/uzunguni-lodge-room.webp',
      alt: 'UZUNGUNI INN lodging room managed by Westsides Company Ltd',
      caption: 'UZUNGUNI INN provides lodging, restaurant, and bar services in Mpemba-Tunduma.',
    },
    gallery: [
      {
        src: '/images/hospitality/uzunguni-lodge-room.webp',
        alt: 'UZUNGUNI INN lodging room',
        caption: 'Accommodation for regional visitors and corridor business guests.',
      },
      {
        src: '/images/hospitality/uzunguni-bar-restaurant.webp',
        alt: 'UZUNGUNI INN bar and restaurant seating',
        caption: 'Restaurant and bar services for local and travelling customers.',
      },
      {
        src: '/images/hospitality/uzunguni-bar-night.webp',
        alt: 'UZUNGUNI INN bar area at night',
        caption: 'Evening hospitality environment at UZUNGUNI INN.',
      },
    ],
    faqs: [
      {
        question: 'Which Itemba Group division handles hospitality?',
        answer:
          'Hospitality, lodging, restaurant, and bar services are handled through UZUNGUNI INN under Westsides Company Ltd.',
      },
      {
        question: 'How can hospitality enquiries be made?',
        answer:
          'Hospitality enquiries can be sent through the group contact channels and routed to the relevant division.',
      },
    ],
  },
  {
    slug: 'real-estate-and-property',
    title: 'Real Estate and Property',
    shortTitle: 'Real Estate',
    eyebrow: 'Itemba Estate',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'estate',
    summary:
      'Property development, real estate, and property-related services through Itemba Estate under Itemba Enterprises.',
    detail:
      "Itemba Estate supports the group's property interests and real estate-related services in the Songwe Region business ecosystem.",
    metaDescription:
      'Real estate, property development, and property-related services through Itemba Estate under Itemba Enterprises Co Ltd in Tanzania.',
    keywords: ['Itemba Estate', 'real estate Songwe', 'property development Tanzania', 'property services'],
    offerings: ['Property development', 'Real estate enquiries', 'Property-related services', 'Estate operations'],
    audience: ['Property customers', 'Business partners', 'Regional investors', 'Local stakeholders'],
    image: {
      src: '/images/real-estate/modern-african-estate-construction-wide.webp',
      alt: 'Modern low-rise residential estate construction site with multiple homes',
      caption: 'Modern residential estate construction progress with roads, staged homes, and active site works.',
    },
    gallery: [
      {
        src: '/images/real-estate/modern-african-estate-construction.webp',
        alt: 'Aerial view of multiple low-rise homes under construction in a residential estate',
        caption: 'Estate construction progress across multiple modern low-rise residential units.',
      },
      {
        src: '/images/real-estate/modern-african-housing-development-wide.webp',
        alt: 'Modern low-rise housing development with repeated residential units',
        caption: 'Finished low-rise residential estate layout with internal access roads and shared amenities.',
      },
      {
        src: '/images/real-estate/modern-tanzania-white-villa-wide.webp',
        alt: 'Finished modern residential home in Tanzania',
        caption: 'Finished modern residential home for private property and estate enquiries.',
      },
      {
        src: '/images/real-estate/zanzibar-residential-houses-aerial-wide.webp',
        alt: 'Aerial view of residential houses and roads in a Tanzanian coastal town',
        caption: 'Residential housing and road layout in a Tanzanian coastal settlement.',
      },
    ],
    faqs: [
      {
        question: 'Which division handles real estate?',
        answer:
          'Real estate and property-related services are handled through Itemba Estate under Itemba Enterprises.',
      },
      {
        question: 'Can property enquiries be submitted through the website?',
        answer:
          'Yes. Property enquiries can be sent through the group contact channels and routed to Itemba Estate.',
      },
    ],
  },
];

export const locationProfiles: LocationProfile[] = [
  {
    slug: 'songwe-tunduma',
    title: 'Songwe Region and Tunduma Corridor',
    shortTitle: 'Songwe-Tunduma',
    eyebrow: 'Mpemba, Tunduma, Tanzania',
    summary:
      'Itemba Group is headquartered in Mpemba-Tunduma, Songwe Region, a practical operating base for fuel, trade, logistics, construction supply, hospitality, and property services.',
    detail:
      'The group location places its companies close to regional customers, transport movement, construction demand, and the Tanzania-Zambia border corridor. This position supports both local business activity and cross-border commercial enquiries.',
    metaDescription:
      'Itemba Group location in Mpemba-Tunduma, Songwe Region, Tanzania, serving fuel, trade, logistics, construction supply, hospitality, and real estate enquiries.',
    visual: 'corridor',
    image: {
      src: '/images/locations/songwe-region-landscape.webp',
      alt: 'Fields and mountains in Songwe Region, Tanzania',
      caption: 'Songwe Region landscape, Richard grivas / Wikimedia Commons, CC BY-SA 4.0.',
    },
    addressLines: [
      'Itemba Filling Station',
      'Along Tunduma-Ileje Highway',
      'Mpemba, Tunduma',
      'Songwe Region, Tanzania',
    ],
    searchTerms: [
      'Itemba Group Tunduma',
      'Songwe Region business group',
      'Mpemba Tunduma fuel and logistics',
      'Tanzania Zambia corridor services',
      'Tunduma trade and construction supplies',
    ],
    advantages: [
      {
        title: 'Border Corridor Access',
        summary:
          'The Tunduma area connects local businesses with cross-border trade movement between Tanzania, Zambia, and wider regional markets.',
      },
      {
        title: 'Multi-Sector Coverage',
        summary:
          'One group location supports enquiries across fuel, wholesale supply, logistics, hardware, hospitality, parking, and property services.',
      },
      {
        title: 'Local Operating Presence',
        summary:
          'The Mpemba-Tunduma headquarters gives customers and partners a clear regional point of contact for Itemba Group companies.',
      },
    ],
    serviceSlugs: [
      'fuel-and-lubricants',
      'trade-and-distribution',
      'logistics-and-cross-border-transit',
      'construction-supplies-and-hardware',
      'hospitality-and-lodging',
      'real-estate-and-property',
    ],
    companySlugs: ['mwanjalisi-oil', 'westsides-company', 'itemba-enterprises'],
    faqs: [
      {
        question: 'Where is Itemba Group located?',
        answer:
          'Itemba Group is headquartered at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma, Songwe Region, Tanzania.',
      },
      {
        question: 'Why is Tunduma important for Itemba Group operations?',
        answer:
          'Tunduma is a strategic border corridor area that supports regional trade, transport movement, logistics, and customer access for the group companies.',
      },
      {
        question: 'Which services are available from the Songwe-Tunduma location?',
        answer:
          'The group supports enquiries across fuel, trade distribution, logistics, construction supplies, hospitality, real estate, and related services.',
      },
    ],
  },
];

export function absoluteUrl(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${site.url}${normalized}`;
}

export function companyUrl(slug: string) {
  return `/companies/${slug}`;
}

export function serviceUrl(slug: string) {
  return `/services/${slug}`;
}

export function locationUrl(slug: string) {
  return `/locations/${slug}`;
}

export function insightUrl(slug: string) {
  return `/insights/${slug}`;
}

export function mailtoWithSubject(subject: string, body?: string) {
  const query = new URLSearchParams({ subject });
  if (body) {
    query.set('body', body);
  }

  return `mailto:${contact.email}?${query.toString()}`;
}

export function whatsappWithMessage(message: string) {
  return `https://wa.me/${contact.primaryPhone.replace('+', '')}?text=${encodeURIComponent(message)}`;
}

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
