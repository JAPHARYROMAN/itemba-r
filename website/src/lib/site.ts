export const site = {
  name: 'Itemba Group',
  url: 'https://www.itembagrouptz.com',
  domain: 'itembagrouptz.com',
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
    sector: 'Energy & Fuel Distribution',
    eyebrow: 'Petroleum Retail',
    accentBg: 'bg-amber-500',
    accentClass: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    visual: 'fuel',
    summary:
      "Tanzania's petroleum retail arm within Itemba Group, delivering reliable fuel supply to businesses, transport operators, and communities across Songwe Region.",
    detail:
      "Positioned in a high-traffic corridor near the Tanzania-Zambia border, Mwanjalisi Oil serves individual motorists, transport operators, and commercial fleet customers through fuel station operations designed around reliability, safety, and operational efficiency.",
    services: ['Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Commercial fleet supply enquiries'],
    highlights: ['Located on the Tunduma corridor', 'Serves retail and business customers', 'Supports transport and local trade'],
    enquiryLabel: 'Fuel supply enquiry',
    faqs: [
      {
        question: 'What products does Mwanjalisi Oil supply?',
        answer:
          'Mwanjalisi Oil handles petroleum retail products including diesel, petrol, kerosene, and lubricants for motorists, transport operators, and business customers.',
      },
      {
        question: 'Where is Mwanjalisi Oil located?',
        answer:
          'The company operates from Songwe Region, with group headquarters at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma.',
      },
      {
        question: 'Can business fuel enquiries be submitted online?',
        answer:
          'Yes. Business customers can contact Itemba Group by phone, WhatsApp, or email and the enquiry will be routed to the relevant Mwanjalisi Oil team.',
      },
    ],
    metaDescription:
      'Mwanjalisi Oil Co Ltd is the Itemba Group petroleum retail company serving fuel, diesel, petrol, kerosene, lubricants, and business fuel enquiries in Songwe Region, Tanzania.',
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
      'Wholesale and retail distribution covering beverages and construction goods for consumer markets, contractors, retailers, and hospitality businesses across the region.',
    detail:
      "Westsides bridges two high-demand markets: beverage distribution and construction supply. Its network reaches retailers, contractors, and hospitality businesses, making it a practical distribution hub in the region's trade ecosystem.",
    services: ['Alcoholic beverages', 'Non-alcoholic beverages', 'Building materials', 'Hand and power tools', 'Electrical supplies'],
    highlights: ['Serves retailers and contractors', 'Combines beverage and construction supply', 'Supports Songwe regional trade'],
    enquiryLabel: 'Trade supply enquiry',
    faqs: [
      {
        question: 'What does Westsides Company distribute?',
        answer:
          'Westsides Company handles wholesale and retail distribution across beverages, building materials, tools, and electrical supplies.',
      },
      {
        question: 'Who does Westsides Company serve?',
        answer:
          'The company serves consumer markets, retailers, contractors, hospitality businesses, and regional trade customers in and around Songwe Region.',
      },
      {
        question: 'How should supplier or bulk purchase enquiries be sent?',
        answer:
          'Supplier and bulk purchase enquiries can be sent through the group phone, WhatsApp, or email channels listed on the contact page.',
      },
    ],
    metaDescription:
      'Westsides Company Ltd handles wholesale and retail distribution for beverages, building materials, tools, and electrical supplies in Songwe Region, Tanzania.',
  },
  {
    id: 'enterprises',
    slug: 'itemba-enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Multi-Sector Operations',
    eyebrow: 'Logistics, Property & Hospitality',
    accentBg: 'bg-emerald-500',
    accentClass: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    visual: 'logistics',
    summary:
      "The group's multi-sector flagship, anchored by local logistics and cross-border transit alongside hardware, property, hospitality, and parking yard services.",
    detail:
      'Itemba Enterprises acts as the group growth engine across multiple consumer and service markets. Logistics is its largest line of business, leveraging the strategic Tunduma corridor for local distribution and cross-border transit between Tanzania, Zambia, and the wider region.',
    services: ['Local logistics', 'Cross-border transit', 'Itemba Hardware', 'Itemba Estate', 'Uzunguni Inn', 'Uzunguni Parking Yard'],
    highlights: ['Flagship logistics operation', 'Five specialised divisions', 'Direct access to the Tanzania-Zambia corridor'],
    enquiryLabel: 'Operations enquiry',
    faqs: [
      {
        question: 'What are the Itemba Enterprises divisions?',
        answer:
          'Itemba Enterprises operates Itemba Logistics, Itemba Hardware, Itemba Estate, Uzunguni Inn, and Uzunguni Parking Yard.',
      },
      {
        question: 'Does Itemba Enterprises handle cross-border logistics?',
        answer:
          'Yes. Logistics is the flagship activity and focuses on local distribution and cross-border transit through the Tunduma corridor.',
      },
      {
        question: 'Can one enquiry cover multiple divisions?',
        answer:
          'Yes. Send the enquiry through the group contact channels and it can be routed to the relevant operating division or divisions.',
      },
    ],
    metaDescription:
      'Itemba Enterprises Co Ltd operates logistics, cross-border transit, hardware, real estate, hospitality, and parking yard services under Itemba Group in Tanzania.',
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
    title: 'Energy and Fuel',
    company: 'Mwanjalisi Oil Co Ltd',
    summary: 'Petroleum retail operations for fuel and lubricant customers in Songwe Region.',
    points: ['Diesel, petrol, kerosene, and lubricants', 'Retail and business fuel enquiries', 'Strategic corridor location in Mpemba-Tunduma'],
  },
  {
    title: 'Trade and Distribution',
    company: 'Westsides Company Ltd',
    summary: 'Wholesale and retail distribution for beverage and construction supply customers.',
    points: ['Alcoholic and non-alcoholic beverages', 'Building materials, tools, and electrical supplies', 'Retailer, contractor, and hospitality customer support'],
  },
  {
    title: 'Logistics and Multi-Sector Operations',
    company: 'Itemba Enterprises Co Ltd',
    summary: 'Local distribution, cross-border transit, hardware, property, hospitality, and parking yard services.',
    points: ['Local logistics and cross-border transit', 'Itemba Hardware, Itemba Estate, Uzunguni Inn, and Uzunguni Parking Yard', 'Operations aligned with the Tanzania-Zambia trade corridor'],
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
      'The group operates across energy, trade, logistics, construction supplies, hospitality, real estate, and manufacturing-related activities.',
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
      'For retailers, contractors, hospitality operators, and institutional buyers seeking beverage, construction, tool, or electrical supply support.',
    goodFit: ['Retail buyers', 'Contractors', 'Hospitality businesses', 'Institutional purchasers'],
    serviceSlugs: ['trade-and-distribution', 'construction-supplies-and-hardware'],
    companySlugs: ['westsides-company'],
  },
  {
    id: 'fuel-logistics',
    title: 'Fuel, Fleet, and Logistics Customers',
    routeTo: 'Mwanjalisi Oil Co Ltd and Itemba Enterprises Co Ltd',
    intentId: 'mwanjalisi',
    summary:
      'For transport operators, commercial fleets, traders, and cross-border customers that need fuel, lubricants, local logistics, or transit support.',
    goodFit: ['Transport operators', 'Commercial fleets', 'Regional traders', 'Import and export customers'],
    serviceSlugs: ['fuel-and-lubricants', 'logistics-and-cross-border-transit'],
    companySlugs: ['mwanjalisi-oil', 'itemba-enterprises'],
  },
  {
    id: 'property-hospitality',
    title: 'Property, Hospitality, and Local Services',
    routeTo: 'Itemba Enterprises Co Ltd',
    intentId: 'enterprises',
    summary:
      'For enquiries connected to hospitality, lodging, parking, property, estate services, and related local business opportunities.',
    goodFit: ['Business guests', 'Property stakeholders', 'Parking and corridor customers', 'Local service partners'],
    serviceSlugs: ['hospitality-and-lodging', 'real-estate-and-property'],
    companySlugs: ['itemba-enterprises'],
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
          'Fuel or lubricant enquiries usually align with Mwanjalisi Oil Co Ltd.',
          'Beverage, construction goods, tools, and electrical supply enquiries usually align with Westsides Company Ltd.',
          'Logistics, cross-border transit, hardware, estate, hospitality, and parking enquiries usually align with Itemba Enterprises Co Ltd.',
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
          'Trade and construction supply enquiries connect to regional buyer demand.',
          'Logistics and transit enquiries connect to local and cross-border movement.',
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
          'Mwanjalisi Oil is the petroleum retail arm of Itemba Group, serving fuel, diesel, petrol, kerosene, lubricants, and business fuel enquiries.',
      },
      {
        heading: 'Westsides Company Ltd',
        body:
          'Westsides Company handles wholesale and retail distribution across beverages, building materials, tools, and electrical supplies for regional customers.',
      },
      {
        heading: 'Itemba Enterprises Co Ltd',
        body:
          'Itemba Enterprises covers local logistics, cross-border transit, hardware, estate, hospitality, and parking yard services through specialised divisions.',
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
          'For bulk purchase requests, include quantities, timing, and preferred fulfilment location.',
          'For construction supply enquiries, mention materials, tools, or electrical categories clearly.',
        ],
      },
      {
        heading: 'Choose the closest route',
        body:
          'Westsides Company is usually the closest match for beverage, construction goods, tools, and electrical supply enquiries. Itemba Enterprises may be relevant for hardware, hospitality, parking, property, and logistics-related opportunities.',
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
    summary: 'Diesel, petrol, kerosene, lubricants, and business fuel supply enquiries.',
    accentClass: 'bg-amber-500',
    ringClass: 'border-amber-400 bg-amber-50 text-amber-700',
  },
  {
    id: 'westsides',
    label: 'Trade and distribution',
    shortLabel: 'Trade',
    subject: 'Westsides Company trade supply enquiry',
    routeTo: 'Westsides Company Ltd',
    summary: 'Beverages, building materials, tools, electrical supplies, and bulk purchase enquiries.',
    accentClass: 'bg-blue-500',
    ringClass: 'border-blue-400 bg-blue-50 text-blue-700',
  },
  {
    id: 'enterprises',
    label: 'Logistics and operations',
    shortLabel: 'Logistics',
    subject: 'Itemba Enterprises operations enquiry',
    routeTo: 'Itemba Enterprises Co Ltd',
    summary: 'Local logistics, cross-border transit, hardware, estate, hospitality, and parking yard enquiries.',
    accentClass: 'bg-emerald-500',
    ringClass: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  },
];

export const serviceAreas: ServiceArea[] = [
  {
    slug: 'fuel-and-lubricants',
    title: 'Fuel and Lubricants',
    shortTitle: 'Fuel Supply',
    eyebrow: 'Energy and Petroleum Retail',
    intentId: 'mwanjalisi',
    companySlug: 'mwanjalisi-oil',
    companyName: 'Mwanjalisi Oil Co Ltd',
    visual: 'fuel',
    summary:
      'Petroleum retail services for motorists, commercial transport operators, local businesses, and corridor customers in Songwe Region.',
    detail:
      'Mwanjalisi Oil supports everyday mobility and business movement through diesel, petrol, kerosene, lubricants, and fuel-related enquiries from the Mpemba-Tunduma corridor.',
    metaDescription:
      'Fuel and lubricant supply from Mwanjalisi Oil Co Ltd under Itemba Group, serving motorists, businesses, and transport operators in Songwe Region, Tanzania.',
    keywords: ['diesel', 'petrol', 'kerosene', 'lubricants', 'fuel supply', 'Songwe fuel station'],
    offerings: ['Diesel and petrol retail', 'Kerosene supply', 'Lubricants', 'Business fuel enquiries'],
    audience: ['Motorists', 'Transport operators', 'Commercial customers', 'Local businesses'],
    faqs: [
      {
        question: 'Which fuel products are available through Itemba Group?',
        answer:
          'Mwanjalisi Oil handles diesel, petrol, kerosene, and lubricants for retail customers and business enquiries.',
      },
      {
        question: 'Can transport operators submit fuel enquiries?',
        answer:
          'Yes. Transport operators can contact the group office by phone, WhatsApp, or email and the enquiry will be routed to Mwanjalisi Oil.',
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
      'Wholesale and retail distribution across beverages, building materials, tools, and electrical supplies for regional customers.',
    detail:
      'Westsides Company connects retail, hospitality, contractor, and consumer markets with practical distribution coverage across beverage and construction supply categories.',
    metaDescription:
      'Trade and distribution services from Westsides Company Ltd, including beverages, building materials, tools, and electrical supplies in Songwe Region, Tanzania.',
    keywords: ['beverage distribution', 'building materials', 'tools', 'electrical supplies', 'wholesale Tanzania'],
    offerings: ['Alcoholic and non-alcoholic beverages', 'Building materials', 'Tools', 'Electrical supplies'],
    audience: ['Retailers', 'Contractors', 'Hospitality businesses', 'Bulk buyers'],
    faqs: [
      {
        question: 'What products does Westsides Company distribute?',
        answer:
          'Westsides Company distributes beverages, building materials, tools, and electrical supplies through wholesale and retail channels.',
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
      'Local distribution and cross-border transit support connected to the Tanzania-Zambia trade corridor through Tunduma.',
    detail:
      "Itemba Enterprises anchors the group logistics capability, supporting local goods movement and cross-border transit around one of Tanzania's most active border corridors.",
    metaDescription:
      'Logistics and cross-border transit services from Itemba Enterprises Co Ltd on the Tunduma corridor in Songwe Region, Tanzania.',
    keywords: ['Tunduma logistics', 'cross-border transit', 'local distribution', 'Tanzania Zambia corridor'],
    offerings: ['Local logistics', 'Cross-border transit', 'Goods movement support', 'Corridor operations enquiries'],
    audience: ['Traders', 'Transporters', 'Importers and exporters', 'Regional businesses'],
    faqs: [
      {
        question: 'Does Itemba Group handle cross-border logistics?',
        answer:
          'Itemba Enterprises handles logistics-related enquiries focused on local distribution and cross-border transit through the Tunduma corridor.',
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
    eyebrow: 'Building Materials and Tools',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'hardware',
    summary:
      'Hardware, tools, electrical goods, and construction supply support for contractors, homeowners, and retail buyers.',
    detail:
      'Through its hardware and trade operations, Itemba Group supports practical construction demand with building materials, hand tools, power tools, and electrical supplies.',
    metaDescription:
      'Construction supplies, building materials, hardware, tools, and electrical goods from Itemba Group companies in Songwe Region, Tanzania.',
    keywords: ['hardware Tanzania', 'building materials', 'construction supplies', 'electrical supplies', 'tools'],
    offerings: ['Building materials', 'Hand and power tools', 'Electrical supplies', 'Contractor supply enquiries'],
    audience: ['Contractors', 'Retail customers', 'Property owners', 'Construction buyers'],
    faqs: [
      {
        question: 'Which construction goods are available?',
        answer:
          'Relevant group companies handle building materials, hand and power tools, and electrical supplies.',
      },
      {
        question: 'Which company handles hardware enquiries?',
        answer:
          'Hardware and construction supply enquiries can be routed to the relevant Westsides Company or Itemba Enterprises team.',
      },
    ],
  },
  {
    slug: 'hospitality-and-lodging',
    title: 'Hospitality and Lodging',
    shortTitle: 'Hospitality',
    eyebrow: 'Uzunguni Inn',
    intentId: 'enterprises',
    companySlug: 'itemba-enterprises',
    companyName: 'Itemba Enterprises Co Ltd',
    visual: 'hospitality',
    summary:
      'Hospitality, lodging, restaurant, and traveller support services connected to Itemba Enterprises operations.',
    detail:
      'Uzunguni Inn supports travellers, business guests, and regional customers through accommodation and hospitality services within the group ecosystem.',
    metaDescription:
      'Hospitality and lodging services through Uzunguni Inn under Itemba Enterprises Co Ltd in Songwe Region, Tanzania.',
    keywords: ['Uzunguni Inn', 'lodging Songwe', 'hospitality Tunduma', 'hotel services'],
    offerings: ['Accommodation', 'Restaurant services', 'Business guest support', 'Traveller services'],
    audience: ['Travellers', 'Business guests', 'Regional visitors', 'Transport corridor customers'],
    faqs: [
      {
        question: 'Which Itemba Group division handles hospitality?',
        answer:
          'Hospitality and lodging services are handled through Uzunguni Inn under Itemba Enterprises.',
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
