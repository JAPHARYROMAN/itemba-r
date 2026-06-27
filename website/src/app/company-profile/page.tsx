import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AnimatedSection from '@/components/AnimatedSection';
import EnquiryRouter from '@/components/EnquiryRouter';
import FaqList from '@/components/FaqList';
import JsonLd from '@/components/JsonLd';
import PrintProfileButton from '@/components/PrintProfileButton';
import CompanyProfilePrintScope from '@/components/CompanyProfilePrintScope';
import CinematicImage from '@/components/cine/CinematicImage';
import ProfileNav from '@/components/cine/ProfileNav';
import Timeline from '@/components/cine/Timeline';
import OrgChart from '@/components/cine/OrgChart';
import LeadershipCard from '@/components/cine/LeadershipCard';
import SectorIcon from '@/components/SectorIcon';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  contact,
  faqJsonLd,
  groupFaqs,
  site,
} from '@/lib/site';

export const metadata: Metadata = {
  title: 'Company Profile',
  description:
    'Itemba Group company profile covering overview, vision, activities, products, target markets, operations, ownership, assets, compliance, banking purpose, and contact information.',
  alternates: { canonical: absoluteUrl('/company-profile') },
  openGraph: {
    title: 'Itemba Group Company Profile',
    description:
      'A full company profile and capability statement for Itemba Group in Songwe Region, Tanzania.',
    url: absoluteUrl('/company-profile'),
  },
};

const profileJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': `${absoluteUrl('/company-profile')}#profile`,
  name: 'Itemba Group Company Profile',
  url: absoluteUrl('/company-profile'),
  about: {
    '@id': `${site.url}/#organization`,
  },
};

const outline = [
  { id: 'cover-page', title: 'Cover Page' },
  { id: 'company-overview', title: 'Company Overview' },
  { id: 'vision-mission', title: 'Vision and Mission' },
  { id: 'business-activities', title: 'Business Activities' },
  { id: 'products-services', title: 'Products and Services' },
  { id: 'target-market', title: 'Target Market' },
  { id: 'operations-branches', title: 'Operations and Branches' },
  { id: 'management-ownership', title: 'Management and Ownership' },
  { id: 'company-history', title: 'Company History' },
  { id: 'assets-capacity', title: 'Assets and Capacity' },
  { id: 'financial-overview', title: 'Financial Overview' },
  { id: 'compliance-information', title: 'Compliance Information' },
  { id: 'competitive-strengths', title: 'Competitive Strengths' },
  { id: 'future-plans', title: 'Future Plans' },
  { id: 'banking-purpose', title: 'Purpose of Banking Relationship' },
  { id: 'contact-information', title: 'Contact Information' },
  { id: 'attachments', title: 'Attachments' },
] as const;

const coverFacts = [
  { label: 'Group', value: 'Itemba Group' },
  { label: 'Head Office', value: 'Mpemba-Tunduma, Songwe Region' },
  { label: 'Companies', value: '3 independent subsidiaries' },
  { label: 'Sectors', value: 'Fuel, parking, wholesale beverages, hardware, lodging, restaurant, bar, and logistics' },
];

const visionMission = [
  {
    title: 'Vision',
    body:
      'To build a resilient Tanzanian business group that supports regional trade, mobility, infrastructure, property, and community services from a strong Songwe operating base.',
  },
  {
    title: 'Mission',
    body:
      'To operate legally independent companies with practical market focus, shared group governance, and reliable service delivery across fuel, distribution, logistics, construction supply, hospitality, parking, real estate, and related sectors.',
  },
];

const targetMarkets = [
  'Long-haul motorists, truck drivers, fleet operators, and logistics companies moving through the Tunduma corridor toward Zambia, Zimbabwe, DRC, and Malawi.',
  'Transit logistics companies that need reliable fuel supply, vehicle staging, secure parking, and driver stopover points before or after border clearance.',
  'Private motorists, buses, taxis, regional transporters, and commercial fleets requiring diesel, petrol, lubricants, and corridor fuel support.',
  'More than 50 beverage stockists across Songwe Region, serving populated towns, villages, urban centres, and rural trading locations through wholesale supply at distributor pricing.',
  'Bars, night clubs, restaurants, and hospitality outlets concentrated in urban centres such as Tunduma, Mlowo, and Vwawa.',
  'International bulk buyers purchasing beverages and ITEMBA-HARDWARE materials in wholesale quantities before moving goods through the Tunduma border to neighbouring countries.',
  'Construction companies, contractors, builders, hardware retailers, and property developers serving the growing real estate market, filling station construction, residential homes, commercial properties, and public infrastructure.',
  'Local businesses sourcing goods from Dar es Salaam into the Southern Highlands, including Songwe, Mbeya, Rukwa, Ruvuma, and Iringa.',
  'Importers, exporters, traders, and cross-border customers requiring local logistics, transit support, and routes to or from Zambia, DRC, Zimbabwe, and Malawi.',
  'Travellers, business guests, lodging customers, restaurant customers, bar customers, property stakeholders, and local service customers.',
  'Suppliers, distributors, financial institutions, and strategic partners seeking a regional operating group.',
];

const targetMarketGroups = [
  {
    company: 'Westsides Company Ltd',
    title: 'Wholesale Beverage, Hardware, and Construction Markets',
    points: [
      'More than 50 stockists across Songwe Region. These are wholesale customers with their own area-based distribution ability who depend on Westsides as a distributor specialist for large-volume beverage supply.',
      'Bars, night clubs, restaurants, and hospitality outlets, especially in Tunduma, Mlowo, Vwawa, and other active urban centres.',
      'International bulk customers buying beverages and hardware materials for onward transport through the Tunduma border into neighbouring countries.',
      'Construction companies and real estate customers building filling stations, residential homes, commercial properties, and public infrastructure.',
    ],
  },
  {
    company: 'Itemba Enterprises Co Ltd',
    title: 'Local and Cross-Border Logistics Markets',
    points: [
      'Local businesses that buy or source goods from Dar es Salaam and need transport into the Southern Highlands, including Songwe, Mbeya, Rukwa, Ruvuma, and Iringa.',
      'Transit customers moving goods to and from neighbouring countries, especially Zambia, DRC, Zimbabwe, and Malawi.',
      'Importers, exporters, and traders who require practical corridor support through Tunduma and the wider Southern Highlands trade route.',
    ],
  },
] as const;

const businessActivities = [
  {
    company: 'Mwanjalisi Oil Co Ltd',
    title: 'Petroleum Retail, Fuel Supply, and Parking',
    summary:
      'Fuel retail operations and parking facilities serving motorists, transport operators, commercial customers, and corridor traffic in Songwe Region.',
    points: ['Diesel and petrol supply', 'Kerosene and lubricants', 'UZUNGUNI PARKING YARD', 'Retail, business fuel, and parking enquiries'],
  },
  {
    company: 'Westsides Company Ltd',
    title: 'Three Major Operating Divisions',
    summary:
      'Westsides Company Ltd manages three major group trading and customer-service divisions: beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
    divisions: [
      {
        name: 'Beverage distribution in wholesale',
        detail:
          'Wholesale distribution of beer, hard liquor and spirits, soft drinks, and bottled water.',
      },
      {
        name: 'ITEMBA-HARDWARE',
        detail:
          'Hardware and construction equipment sales under the ITEMBA-HARDWARE brand, managed by Westsides Company Ltd.',
      },
      {
        name: 'UZUNGUNI INN',
        detail:
          'Lodging, restaurant, and bar services through UZUNGUNI INN at Mpemba-Tunduma, managed by Westsides Company Ltd.',
      },
    ],
  },
  {
    company: 'Itemba Enterprises Co Ltd',
    title: 'Logistics and Emerging Businesses',
    summary:
      'Local distribution, cross-border transit, logistics services, and emerging businesses after trading and hospitality activities moved under Westsides Company Ltd.',
    points: ['Local logistics', 'Cross-border transit', 'Emerging business opportunities'],
  },
] as const;

const profileProductsServices = [
  {
    eyebrow: 'Westsides Company Ltd',
    title: 'Wholesale Beverage Distribution',
    summary:
      'Beverage distribution in wholesale for regional customers, retailers, hospitality operators, and bulk buyers.',
    offerings: [
      'Beer, including Safari Lager, Kilimanjaro Lager, and Castle Lite',
      'Hard liquor and spirits',
      'Soft drinks, including bottled Coca-Cola and Pepsi',
      'Bottled water',
    ],
  },
  {
    eyebrow: 'Westsides Company Ltd',
    title: 'ITEMBA-HARDWARE',
    summary:
      'Hardware and construction supply under the ITEMBA-HARDWARE brand, managed by Westsides Company Ltd for contractors, builders, property customers, and retail buyers.',
    offerings: [
      'Nondo',
      'Roofing sheets',
      'Wire nails',
      'Paints of all types',
      'Square pipes',
      'Round pipes',
      'H-beams',
      'I-beams',
      'U-channels',
    ],
  },
  {
    eyebrow: 'Westsides Company Ltd',
    title: 'UZUNGUNI INN',
    summary:
      'Lodging, restaurant, and bar services through UZUNGUNI INN at Mpemba-Tunduma, managed by Westsides Company Ltd.',
    offerings: ['Lodging', 'Restaurant services', 'Bar services', 'Business guest support'],
  },
  {
    eyebrow: 'Mwanjalisi Oil Co Ltd',
    title: 'UZUNGUNI PARKING YARD',
    summary:
      'Parking facilities under the UZUNGUNI PARKING YARD brand, managed by Mwanjalisi Oil Co Ltd for corridor motorists and logistics operators.',
    offerings: ['Vehicle parking', 'Truck and logistics parking', 'Corridor vehicle staging', 'Parking facility enquiries'],
  },
  {
    eyebrow: 'Mwanjalisi Oil Co Ltd',
    title: 'Fuel and Lubricants',
    summary:
      'Petroleum retail services managed by Mwanjalisi Oil Company Ltd, with fuel stations carrying the public ITEMBA location brand.',
    offerings: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Business fuel enquiries'],
  },
  {
    eyebrow: 'Itemba Enterprises Co Ltd',
    title: 'Logistics and Emerging Businesses',
    summary:
      'Local logistics, cross-border transit, and emerging business activities managed through Itemba Enterprises Co Ltd.',
    offerings: ['Local logistics', 'Cross-border transit', 'Emerging business opportunities'],
  },
] as const;

const profileCompanyOperations = [
  {
    slug: 'mwanjalisi-oil',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Petroleum Retail, Fuel Supply, and Parking',
    accentBg: 'bg-amber-500',
    detail:
      'Petroleum retail and parking operations managed by Mwanjalisi Oil Company Ltd. The public-facing filling station brands are ITEMBA-MPEMBA and ITEMBA-UZUNGUNI, while the parking facility trades as UZUNGUNI PARKING YARD.',
  },
  {
    slug: 'westsides-company',
    name: 'Westsides Company Ltd',
    sector: 'Beverages, ITEMBA-HARDWARE, and UZUNGUNI INN',
    accentBg: 'bg-blue-500',
    detail:
      'Westsides Company Ltd manages beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
  },
  {
    slug: 'itemba-enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Logistics and Emerging Businesses',
    accentBg: 'bg-emerald-500',
    detail:
      'Local logistics, cross-border transit, and emerging business activities after trading and hospitality operations moved under Westsides Company Ltd and UZUNGUNI PARKING YARD came under Mwanjalisi Oil Company Ltd management.',
  },
] as const;

const branchOperations = [
  {
    company: 'Westsides Company Ltd',
    summary:
      'Westsides Company Ltd operates four main branches within Songwe Region across wholesale beverage distribution, hardware, and construction equipment sales.',
    branches: [
      {
        name: 'Mpemba Main Branch',
        focus: 'Beverage distribution in wholesale only.',
        coverage: 'Wholesale beverage customers in Mpemba and the surrounding business area.',
        image: '/images/beverages/westsides-customer-order-truck.webp',
        imageAlt: 'Customer beverage order loaded for Westsides Company Ltd wholesale distribution',
      },
      {
        name: 'Mlowo Branch',
        focus: 'Beverage distribution centre.',
        coverage: 'Mlowo town and its neighboring villages and wards.',
        image: '/images/beverages/westsides-warehouse-stock-wide.webp',
        imageAlt: 'Large beverage stock supplied through Westsides Company Ltd Mlowo Branch',
      },
      {
        name: 'Sogea Branch',
        focus: 'Beverage distribution branch.',
        coverage: 'Sogea and Tunduma town as a whole.',
        image: '/images/beverages/westsides-softdrinks-warehouse.webp',
        imageAlt: 'Soft drink stock supplied through Westsides Company Ltd Sogea Branch',
      },
      {
        name: 'Tunduma Main Branch',
        focus: 'Hardware and construction equipment sales.',
        coverage:
          'Songwe Region, supported by warehouses in Tunduma town and the Sogea area.',
        image: '/images/hardware/itemba-hardware-storefront.webp',
        imageAlt: 'ITEMBA-HARDWARE storefront and construction supply stock in Tunduma',
      },
    ],
  },
  {
    company: 'Mwanjalisi Oil Company Ltd',
    summary:
      'Mwanjalisi Oil Company Ltd manages the retail fuel station business. Each filling station carries the ITEMBA brand name followed by its location name only.',
    branches: [
      {
        name: 'ITEMBA-UZUNGUNI',
        focus: 'Operating retail fuel station managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located along the TANZAM Highway in Uzunguni Area, Mpemba.',
        image: '/images/fuel-stations/itemba-uzunguni-pump-island.webp',
        imageAlt: 'ITEMBA-UZUNGUNI filling station managed by Mwanjalisi Oil Company Ltd',
      },
      {
        name: 'ITEMBA-MPEMBA',
        focus: 'Operating retail fuel station managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located near the Tunduma Bus Station along the Tunduma-Ileje Highway.',
        image: '/images/fuel-stations/itemba-mpemba-service-yard.webp',
        imageAlt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd',
      },
      {
        name: 'Three Upcoming ITEMBA-Branded Fuel Station Locations',
        focus: 'Planned expansion locations.',
        coverage: 'Additional retail fuel station locations will follow the ITEMBA-location naming system while remaining under Mwanjalisi Oil Company Ltd management.',
      },
    ],
  },
  {
    company: 'Mwanjalisi Oil Company Ltd - Parking Facilities',
    summary:
      'Parking facilities trade publicly as UZUNGUNI PARKING YARD and are managed by Mwanjalisi Oil Company Ltd for corridor movement and fuel customers.',
    branches: [
      {
        name: 'UZUNGUNI PARKING YARD',
        focus: 'Parking yard facility managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located in Uzunguni Area, Mpemba-Tunduma.',
        image: '/images/parking/uzunguni-parking-container-trucks.webp',
        imageAlt: 'Container trucks parked at UZUNGUNI PARKING YARD',
      },
    ],
  },
] as const;

const ownershipSummary = [
  'Each Itemba Group operating company is legally registered by BRELA as a private company.',
  'Itemba Group provides central strategic oversight, governance, and coordination across the companies.',
  'Formal ownership, directorship, and statutory records are maintained in the company legal records and can be shared with authorized reviewers when required.',
];

const leadershipTeam = [
  {
    name: 'Roman M Mwampuwa',
    groupRole: 'Chairman of the Group and M.D',
    companyRole: 'M.D of each of the three operating companies',
  },
  {
    name: 'Isaac Roman Mwampuwa',
    groupRole: 'CEO of the Group',
    companyRole: 'Director for Westsides Company Ltd',
  },
  {
    name: 'Japhary Roman Mwampuwa',
    groupRole: 'Group CFO',
    companyRole: 'Director for Mwanjalisi Oil Company Ltd',
  },
  {
    name: 'Joshua M Mwampuwa',
    groupRole: 'G.M of the Group',
    companyRole:
      'Operating Manager for Mwanjalisi Oil Company Ltd and Logistics Manager for Itemba Enterprises Co Ltd',
  },
  {
    name: 'Nsajigwa Mwaipopo',
    groupRole: 'Operating leadership',
    companyRole: 'Operating Manager for Westsides Company Ltd',
  },
] as const;

const history = [
  {
    date: '20 January 2012',
    title: 'Itemba Enterprises Co Ltd incorporated',
    body:
      'Itemba Group started with Itemba Enterprises Co Ltd, initially running the hardware business only. The company was incorporated under the Companies Act, 2002 as a private limited company on 20 January 2012 with incorporation number 88774.',
  },
  {
    date: '2013',
    title: 'Parking facilities opened',
    body:
      'The business expanded into parking facilities with the opening of Uzunguni Yard in 2013.',
  },
  {
    date: '2014',
    title: 'Beverage distribution introduced',
    body:
      'Beverage distribution began in 2014, first through the Sogea Branch for retail sales only, followed by the Vwawa Branch for wholesale operations after major contract agreements with Tanzania Breweries Ltd and Tanzania Distilleries Ltd.',
  },
  {
    date: '2015',
    title: 'Fuel and hospitality businesses launched',
    body:
      'The first fuel station opened in 2015 at Uzunguni-Mpemba-Tunduma and now trades publicly as ITEMBA-UZUNGUNI under Mwanjalisi Oil Company Ltd management. The group also entered the hospitality business in 2015 with the opening of Uzunguni Inn.',
  },
  {
    date: '2 May 2017',
    title: 'Mwanjalisi Oil Company Ltd incorporated',
    body:
      'For improved administrative and financial efficiency, Mwanjalisi Oil Company Ltd was incorporated under the Companies Act, 2002 as a private limited company on 2 May 2017 with incorporation number 134897. The fuel station business was transferred from Itemba Enterprises Co Ltd to Mwanjalisi Oil Company Ltd.',
  },
  {
    date: '2017 onward',
    title: 'Mwanjalisi Oil expansion',
    body:
      'Mwanjalisi Oil Company Ltd later opened the ITEMBA-MPEMBA outlet at Mpemba near the Tunduma Bus Station along the Tunduma-Ileje Highway, with more ITEMBA-branded outlets planned.',
  },
  {
    date: '9 June 2017',
    title: 'Westsides Company Ltd incorporated',
    body:
      'Westsides Company Ltd was incorporated on 9 June 2017 with incorporation number 135764 to strengthen sales and beverage distribution across the entire Songwe Region.',
  },
  {
    date: '2021',
    title: 'Logistics business entered',
    body:
      'Itemba Enterprises Co Ltd entered the logistics business in 2021, expanding the group into corridor transport and related logistics services.',
  },
  {
    date: '1 November 2025',
    title: 'Trading and hospitality activities reorganized',
    body:
      'On 1 November 2025, all trading businesses, including hardware and beverage distribution, were placed under Westsides Company Ltd. Hospitality was also managed under Westsides Company Ltd, leaving Itemba Enterprises Co Ltd to focus on logistics services and emerging businesses.',
  },
] as const;

const assetCapacity = [
  {
    title: 'Head office and regional presence',
    body:
      'A clear group contact point at Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba, Tunduma.',
  },
  {
    title: 'Fuel retail capability',
    body:
      'Petroleum retail operations through Mwanjalisi Oil Co Ltd, with stations trading publicly as ITEMBA-MPEMBA and ITEMBA-UZUNGUNI while covering diesel, petrol, kerosene, lubricants, and business fuel enquiries.',
  },
  {
    title: 'Trade and supply capability',
    body:
      'Westsides Company Ltd wholesale and retail channels covering beverages, hardware, construction materials, pipes, beams, paints, roofing sheets, and related bulk purchase enquiries.',
  },
  {
    title: 'Branch and warehouse coverage',
    body:
      'Four main Westsides branches across Mpemba, Mlowo, Sogea, and Tunduma, with hardware and construction supply warehouses in Tunduma town and the Sogea area.',
  },
  {
    title: 'Fuel and parking corridor capability',
    body:
      'Two operating ITEMBA-branded fuel stations managed by Mwanjalisi Oil Company Ltd, three upcoming fuel locations, and UZUNGUNI PARKING YARD under Mwanjalisi Oil Company Ltd serving motorists and logistics operators in Mpemba-Tunduma.',
  },
  {
    title: 'Hospitality and service capability',
    body:
      'Lodging, restaurant, and bar services through UZUNGUNI INN at Mpemba-Tunduma under Westsides Company Ltd, alongside group logistics and emerging business capacity.',
  },
];

// Sector icon per asset-capacity card (index-aligned with assetCapacity above).
const assetIcons = ['realestate', 'energy', 'trade', 'construction', 'logistics', 'hospitality'] as const;

const complianceItems = [
  'Tanzanian legal entity structure with operating companies managed as separate businesses.',
  'Business, tax, licensing, insurance, and statutory records maintained at company level.',
  'Sensitive documents such as bank records, contracts, fixed asset schedules, licenses, and legal records controlled through group-level governance.',
  'Supporting compliance documents can be provided directly to banks, partners, and authorized counterparties when appropriate.',
];

const strengths = [
  'Fuel stations are ideally located along major routes, including the TANZAM Highway and the Tunduma-Ileje Highway, with strong visibility near major transport movement and a major bus stand.',
  'Beverage distribution is supported by exclusive contracts with major national manufacturers, giving Westsides Company Ltd rights to operate within specified Songwe Region boundaries with little to no direct competition.',
  'Exclusive beverage suppliers include Tanzania Breweries Ltd, Tanzania Distilleries Ltd, Mega Beverage Ltd, SBC Tanzania Ltd (Pepsi), and Coca-Cola Kwanza Limited.',
  'A robust distribution network covers the entire Songwe Region through a dedicated delivery fleet, multiple branches, and fast delivery capability.',
  'Strong grassroots marketing knowledge gives the group practical understanding of market demand, retailer behavior, customer movement, and seasonal trade patterns.',
  'Clear separation of business divisions improves management focus, reporting, accountability, and customer routing across fuel, beverages, hardware, hospitality, parking, logistics, and emerging businesses.',
];

const futurePlans = [
  'Strengthen operating systems, reporting discipline, and internal controls across the group.',
  'Expand customer and supplier relationships in fuel, trade distribution, logistics, hospitality, and property-related services.',
  'Improve public-facing company information, enquiry routing, and partner readiness through the website.',
  'Continue developing the group as a resilient multi-sector Tanzanian business platform.',
];

const bankingPurposes = [
  'Support working capital for inventory, fuel, beverage distribution, hardware stock, logistics, hospitality, and operating expenses.',
  'Manage supplier payments, customer collections, and formal business transactions across the companies.',
  'Support asset financing, equipment, vehicles, property, and expansion requirements where appropriate.',
  'Provide banks with a clear profile of the group structure, operating activities, and contact route for due diligence.',
];

const attachments = [
  'Company registration and incorporation documents',
  'Tax identification and tax compliance documents',
  'Business licenses and sector-specific permits',
  'Audited or management financial statements, where required',
  'Bank statements, bank letters, or account confirmation documents',
  'Asset schedules, collateral documents, insurance records, and major contracts',
  'Management, ownership, and authorized signatory documents',
];

const legalCompanyProfiles = [
  {
    id: 'westsides',
    name: 'Westsides Company Ltd',
    profileTitle: 'Westsides Company Ltd Company Profile',
    sector: 'Wholesale Beverages, ITEMBA-HARDWARE, and UZUNGUNI INN',
    tin: '136-065-580',
    incorporationDate: '9 June 2017',
    incorporationNumber: '135764',
    status: 'Private company registered by BRELA',
    directors: [
      'Roman M Mwampuwa - Managing Director',
      'Isaac Roman Mwampuwa - Director',
      'Magreth Shale Mgalla - Director',
    ],
    summary:
      'Westsides Company Ltd manages the group trading and hospitality platform, including wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
    coverImage: {
      src: '/images/beverages/westsides-warehouse-stock-wide.webp',
      alt: 'Westsides Company Ltd wholesale beverage warehouse stock',
    },
    images: [
      {
        src: '/images/beverages/westsides-customer-order-truck.webp',
        alt: 'Customer beverage order loaded for Westsides wholesale distribution',
        caption: 'Wholesale beverage orders prepared for stockists and bulk customers.',
      },
      {
        src: '/images/hardware/itemba-hardware-storefront.webp',
        alt: 'ITEMBA-HARDWARE storefront and construction materials',
        caption: 'ITEMBA-HARDWARE supplies contractors, builders, and construction buyers.',
      },
      {
        src: '/images/hospitality/uzunguni-bar-restaurant.webp',
        alt: 'UZUNGUNI INN restaurant and bar seating',
        caption: 'UZUNGUNI INN provides lodging, restaurant, and bar services.',
      },
    ],
    sections: [
      {
        title: 'Business Activities',
        points: [
          'Wholesale beverage distribution for beer, spirits, soft drinks, and bottled water.',
          'Hardware and construction equipment sales under the ITEMBA-HARDWARE brand.',
          'Lodging, restaurant, and bar operations under the UZUNGUNI INN brand.',
        ],
      },
      {
        title: 'Products and Services',
        points: [
          'Safari Lager, Kilimanjaro Lager, Castle Lite, spirits, Coca-Cola, Pepsi, bottled water, and related beverage products.',
          'Nondo, roofing sheets, wire nails, paints, square pipes, round pipes, H-beams, I-beams, and U-channels.',
          'Accommodation, restaurant services, bar services, and business guest support through UZUNGUNI INN.',
        ],
      },
      {
        title: 'Target Market',
        points: [
          'More than 50 beverage stockists across Songwe Region with area-based distribution ability.',
          'Bars, night clubs, restaurants, hospitality outlets, and urban retail customers in Tunduma, Mlowo, Vwawa, and surrounding locations.',
          'International bulk buyers moving beverages and hardware through the Tunduma border to neighbouring countries.',
          'Construction companies, contractors, builders, real estate customers, and public infrastructure buyers.',
        ],
      },
      {
        title: 'Operations and Branches',
        points: [
          'Mpemba Main Branch for wholesale beverage distribution.',
          'Mlowo Branch serving Mlowo town and neighbouring villages and wards.',
          'Sogea Branch serving Sogea and Tunduma town beverage distribution demand.',
          'Tunduma Main Branch for hardware and construction equipment sales, supported by warehouses in Tunduma town and Sogea.',
        ],
      },
      {
        title: 'Competitive Strengths',
        points: [
          'Exclusive beverage supplier relationships with Tanzania Breweries Ltd, Tanzania Distilleries Ltd, Mega Beverage Ltd, SBC Tanzania Ltd (Pepsi), and Coca-Cola Kwanza Limited.',
          'Robust distribution network across Songwe Region with branches, delivery capability, and grassroots market knowledge.',
          'Clear division between beverage distribution, hardware, and hospitality operations.',
        ],
      },
    ],
  },
  {
    id: 'mwanjalisi',
    name: 'Mwanjalisi Oil Company Ltd',
    profileTitle: 'Mwanjalisi Oil Company Ltd Company Profile',
    sector: 'Fuel Retail, Lubricants, and Parking Facilities',
    tin: '134-036-206',
    incorporationDate: '2 May 2017',
    incorporationNumber: '134897',
    status: 'Private company registered by BRELA',
    directors: [
      'Roman M Mwampuwa - Managing Director',
      'Japhary Roman Mwampuwa - Director',
      'Lucy Lendison Mgalla - Director',
    ],
    summary:
      'Mwanjalisi Oil Company Ltd manages ITEMBA-branded fuel stations and UZUNGUNI PARKING YARD for motorists, transport operators, and logistics customers.',
    coverImage: {
      src: '/images/fuel-stations/itemba-filling-station-wide.webp',
      alt: 'ITEMBA filling station forecourt managed by Mwanjalisi Oil Company Ltd',
    },
    images: [
      {
        src: '/images/fuel-stations/itemba-mpemba-truck-canopy.webp',
        alt: 'Truck refuelling under an ITEMBA filling station canopy',
        caption: 'ITEMBA-MPEMBA supports motorists, buses, trucks, and business fuel customers.',
      },
      {
        src: '/images/fuel-stations/itemba-uzunguni-forecourt-wide.webp',
        alt: 'ITEMBA-UZUNGUNI filling station forecourt',
        caption: 'ITEMBA-UZUNGUNI is positioned for corridor traffic along the TANZAM Highway.',
      },
      {
        src: '/images/parking/uzunguni-parking-container-trucks.webp',
        alt: 'Container trucks at UZUNGUNI PARKING YARD',
        caption: 'UZUNGUNI PARKING YARD serves logistics and transit vehicle staging demand.',
      },
    ],
    sections: [
      {
        title: 'Business Activities',
        points: [
          'Retail fuel station operations supplying diesel, petrol, kerosene, and lubricants.',
          'Public station brands operate as ITEMBA-MPEMBA and ITEMBA-UZUNGUNI while remaining under Mwanjalisi Oil Company Ltd management.',
          'UZUNGUNI PARKING YARD is managed by Mwanjalisi Oil Company Ltd for corridor parking and vehicle staging.',
        ],
      },
      {
        title: 'Target Market',
        points: [
          'Motorists, buses, trucks, fleet operators, and local transport customers in Songwe Region.',
          'Logistics companies and transit operators moving through Tunduma toward Zambia, Zimbabwe, DRC, and Malawi.',
          'Commercial customers requiring reliable fuel, lubricants, parking, and staging facilities near major transport routes.',
        ],
      },
      {
        title: 'Operations and Branches',
        points: [
          'ITEMBA-UZUNGUNI along the TANZAM Highway in Uzunguni Area, Mpemba.',
          'ITEMBA-MPEMBA near Tunduma Bus Station along the Tunduma-Ileje Highway.',
          'UZUNGUNI PARKING YARD in Uzunguni Area, Mpemba-Tunduma.',
          'Three upcoming ITEMBA-branded fuel station locations under the same company management structure.',
        ],
      },
      {
        title: 'Competitive Strengths',
        points: [
          'Fuel stations are positioned along major routes and near important passenger and logistics movement.',
          'The station brand system keeps public visibility clear while preserving legal management under Mwanjalisi Oil Company Ltd.',
          'Parking, fuel, and corridor access create a connected service offer for transport operators.',
        ],
      },
    ],
  },
  {
    id: 'enterprises',
    name: 'Itemba Enterprises Co Ltd',
    profileTitle: 'Itemba Enterprises Co Ltd Company Profile',
    sector: 'Logistics, Cross-Border Transit, and Emerging Businesses',
    tin: '116-321-378',
    incorporationDate: '20 January 2012',
    incorporationNumber: '88774',
    status: 'Private company registered under the Companies Act, 2002',
    directors: [
      'Roman M Mwampuwa - Managing Director',
      'Magreth Shale Mgalla - Director',
      'Lucy Lendison Mgalla - Director',
    ],
    summary:
      'Itemba Enterprises Co Ltd is the original group company and now focuses on logistics services, cross-border transit, and emerging businesses.',
    coverImage: {
      src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
      alt: 'Itemba Logistics tanker supporting goods movement and transit operations',
    },
    images: [
      {
        src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
        alt: 'Itemba Logistics tanker under station canopy',
        caption: 'Itemba Logistics supports Dar es Salaam to Southern Highlands movement.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-front.webp',
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet presence for local and cross-border logistics customers.',
      },
      {
        src: '/images/logistics/itemba-logistics-truck-yard.webp',
        alt: 'Itemba Logistics truck in a yard',
        caption: 'Yard-based support for traders, transporters, and transit customers.',
      },
    ],
    sections: [
      {
        title: 'Business Activities',
        points: [
          'Local logistics and goods movement for businesses sourcing products from Dar es Salaam.',
          'Cross-border transit support through the Tunduma corridor.',
          'Emerging business opportunities retained under Itemba Enterprises Co Ltd.',
        ],
      },
      {
        title: 'Target Market',
        points: [
          'Local businesses sourcing goods from Dar es Salaam into Songwe, Mbeya, Rukwa, Ruvuma, and Iringa.',
          'Transit customers moving goods to and from Zambia, DRC, Zimbabwe, and Malawi.',
          'Importers, exporters, traders, and business customers requiring practical Southern Highlands corridor support.',
        ],
      },
      {
        title: 'Company History',
        points: [
          'Incorporated on 20 January 2012 as the original group company, initially running the hardware business.',
          'Expanded into parking facilities in 2013, beverages in 2014, fuel and hospitality in 2015, and logistics in 2021.',
          'After later group reorganization, trading and hospitality moved under Westsides Company Ltd while fuel and parking came under Mwanjalisi Oil Company Ltd.',
        ],
      },
      {
        title: 'Competitive Strengths',
        points: [
          'Practical location advantage through the Tunduma corridor and Southern Highlands trade routes.',
          'Group operating history across trade, fuel, parking, hospitality, and logistics.',
          'Focused current role in logistics and emerging businesses with clear separation from other operating companies.',
        ],
      },
    ],
  },
] as const;

const printProfileOptions = [
  {
    id: 'group',
    label: 'Itemba Group Profile',
    description: 'Full group profile for banks, suppliers, customers, partners, and broad institutional review.',
  },
  {
    id: 'westsides',
    label: 'Westsides Company Ltd',
    description: 'Legal company profile for beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
  },
  {
    id: 'mwanjalisi',
    label: 'Mwanjalisi Oil Company Ltd',
    description: 'Legal company profile for ITEMBA fuel stations, lubricants, and UZUNGUNI PARKING YARD.',
  },
  {
    id: 'enterprises',
    label: 'Itemba Enterprises Co Ltd',
    description: 'Legal company profile for logistics, cross-border transit, and emerging businesses.',
  },
] as const;

type PrintSectionColumn = {
  title: string;
  body?: string;
  points?: readonly string[];
};

type PrintSection = {
  title: string;
  body?: string;
  points?: readonly string[];
  columns?: readonly PrintSectionColumn[];
  pageBreakBefore?: boolean;
};

const groupPrintTargetMarkets = [
  {
    title: 'Fuel, Parking, and Corridor Customers',
    points: [
      'Long-haul motorists, truck drivers, fleet operators, and logistics companies moving through the Tunduma corridor toward Zambia, Zimbabwe, DRC, and Malawi.',
      'Transit logistics companies that need reliable fuel supply, vehicle staging, secure parking, and driver stopover points before or after border clearance.',
      'Private motorists, buses, taxis, regional transporters, and commercial fleets requiring diesel, petrol, lubricants, and corridor fuel support.',
    ],
  },
  {
    title: 'Westsides Wholesale, Hospitality, and Construction Markets',
    points: [
      'More than 50 beverage stockists across Songwe Region, serving populated towns, villages, urban centres, and rural trading locations through wholesale supply at distributor pricing.',
      'Bars, night clubs, restaurants, and hospitality outlets concentrated in urban centres such as Tunduma, Mlowo, and Vwawa.',
      'International bulk buyers purchasing beverages and ITEMBA-HARDWARE materials in wholesale quantities before moving goods through the Tunduma border to neighbouring countries.',
      'Construction companies, contractors, builders, hardware retailers, and property developers serving filling station construction, residential homes, commercial properties, and public infrastructure.',
    ],
  },
  {
    title: 'Logistics and Cross-Border Transit Customers',
    points: [
      'Local businesses sourcing goods from Dar es Salaam into the Southern Highlands, including Songwe, Mbeya, Rukwa, Ruvuma, and Iringa.',
      'Importers, exporters, traders, and cross-border customers requiring local logistics, transit support, and routes to or from Zambia, DRC, Zimbabwe, and Malawi.',
    ],
  },
  {
    title: 'Institutional, Property, and Stakeholder Audiences',
    points: [
      'Travellers, business guests, lodging customers, restaurant customers, bar customers, property stakeholders, and local service customers.',
      'Suppliers, distributors, financial institutions, and strategic partners seeking a regional operating group with clear company-level responsibilities.',
    ],
  },
] as const;

const groupPrintProfile = {
  id: 'group',
  title: 'Itemba Group Company Profile',
  subject: 'Itemba Group',
  subtitle:
    'A Tanzanian multi-sector group headquartered in Mpemba-Tunduma, Songwe Region, operating through legally independent companies.',
  coverImage: {
    src: '/images/company-profile/itemba-group-profile-cover.webp',
    alt: 'Itemba Group operating profile cover image',
  },
  facts: [
    { label: 'Profile Type', value: 'Group profile and capability statement' },
    { label: 'Head Office', value: contact.headOffice },
    { label: 'Operating Companies', value: 'Mwanjalisi Oil Company Ltd, Westsides Company Ltd, Itemba Enterprises Co Ltd' },
    { label: 'Website', value: site.domain },
    { label: 'Public Contact', value: `${contact.primaryPhoneDisplay} / ${contact.email}` },
  ],
  images: [
    {
      src: '/images/fuel-stations/itemba-filling-station-wide.webp',
      alt: 'ITEMBA fuel station forecourt',
      caption: 'Fuel retail operations under Mwanjalisi Oil Company Ltd.',
    },
    {
      src: '/images/beverages/westsides-warehouse-stock-wide.webp',
      alt: 'Westsides beverage warehouse stock',
      caption: 'Wholesale beverage distribution under Westsides Company Ltd.',
    },
    {
      src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
      alt: 'Itemba Logistics tanker',
      caption: 'Logistics and cross-border transit under Itemba Enterprises Co Ltd.',
    },
    {
      src: '/images/parking/uzunguni-parking-container-trucks.webp',
      alt: 'Container trucks at UZUNGUNI PARKING YARD',
      caption: 'Parking and staging facilities under Mwanjalisi Oil Company Ltd.',
    },
  ],
  sections: [
    {
      title: 'Company Overview',
      body:
        'Itemba Group operates as a shared business identity and governance platform for legally independent Tanzanian companies active in fuel, parking, trade, logistics, construction supply, hospitality, real estate-related services, and emerging businesses.',
    },
    {
      title: 'Vision and Mission',
      columns: visionMission.map((item) => ({ title: item.title, body: item.body })),
    },
    {
      title: 'Business Activities',
      columns: businessActivities.map((activity) => ({
        title: `${activity.company}: ${activity.title}`,
        body: activity.summary,
      })),
    },
    {
      title: 'Target Market',
      pageBreakBefore: true,
      columns: groupPrintTargetMarkets,
    },
    {
      title: 'Operations and Branches',
      pageBreakBefore: true,
      columns: branchOperations.map((operation) => ({
        title: operation.company,
        points: operation.branches.map((branch) => `${branch.name}: ${branch.focus} ${branch.coverage}`),
      })),
    },
    {
      title: 'Company History',
      pageBreakBefore: true,
      points: history.map((item) => `${item.date} - ${item.title}: ${item.body}`),
    },
    {
      title: 'Assets and Capacity',
      points: assetCapacity.map((item) => `${item.title}: ${item.body}`),
    },
    {
      title: 'Financial Overview',
      body:
        'The group operates revenue-generating companies across fuel retail, trade distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant, bar, property-related services, and emerging businesses. Detailed financial statements, bank records, tax filings, and asset schedules are controlled documents and can be provided directly to authorized reviewers.',
    },
    {
      title: 'Compliance Information',
      points: complianceItems,
    },
    {
      title: 'Competitive Strengths',
      pageBreakBefore: true,
      points: strengths,
    },
    {
      title: 'Future Plans',
      points: futurePlans,
    },
    {
      title: 'Purpose of Banking Relationship',
      points: bankingPurposes,
    },
    {
      title: 'Attachments Available on Request',
      points: attachments,
    },
  ],
} as const;

const companyPrintProfiles = legalCompanyProfiles.map((company) => ({
  id: company.id,
  title: company.profileTitle,
  subject: company.name,
  subtitle: `${company.sector}. ${company.summary}`,
  coverImage: company.coverImage,
  facts: [
    { label: 'Legal Name', value: company.name },
    { label: 'TIN', value: company.tin },
    { label: 'Incorporated', value: company.incorporationDate },
    { label: 'Incorporation No.', value: company.incorporationNumber },
    { label: 'Legal Status', value: company.status },
    { label: 'Website', value: site.domain },
    { label: 'Head Office Contact', value: contact.headOffice },
  ],
  directors: company.directors,
  images: company.images,
  sections: [
    {
      title: 'Company Overview',
      body: company.summary,
    },
    ...company.sections,
    {
      title: 'Financial Overview',
      body:
        'The company operates as a revenue-generating legal entity within Itemba Group. Detailed financial statements, tax filings, management accounts, bank records, and supporting schedules are treated as controlled documents and can be shared directly with authorized banks, suppliers, partners, and reviewers.',
    },
    {
      title: 'Compliance Information',
      points: [
        `${company.name} maintains company-level statutory, tax, licensing, and business records.`,
        `TIN: ${company.tin}. Incorporation number: ${company.incorporationNumber}.`,
        'Supporting compliance documents can be provided directly to authorized counterparties when required.',
      ],
    },
    {
      title: 'Purpose of Banking Relationship',
      points: bankingPurposes,
    },
    {
      title: 'Attachments Available on Request',
      points: attachments,
    },
  ],
}));

const printableProfiles = [groupPrintProfile, ...companyPrintProfiles] as const;

function ProfileSection({
  id,
  index,
  title,
  lead,
  children,
}: {
  id: string;
  index: number;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <AnimatedSection>
      <section id={id} className="scroll-mt-28 border-t border-white/10 py-12 print:break-inside-avoid">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gold-500/30 bg-gold-500/10 text-sm font-black text-gold-300">
            {index}
          </span>
          <div>
            <h2 className="font-tight text-3xl font-black leading-tight tracking-tight text-white">{title}</h2>
            {lead ? <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">{lead}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </AnimatedSection>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item} className="flex gap-3 text-sm leading-relaxed text-slate-300">
          <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-gold-400" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function PrintProfileDocuments() {
  return (
    <div className="print-document-root" aria-hidden="true">
      {printableProfiles.map((profile) => (
        <article key={profile.id} className="print-profile-document" data-profile={profile.id}>
          <header className="print-letterhead">
            <div className="print-letterhead-brand">
              <div className="print-logo-mark">
                <img src="/logo-print.png" alt="Itemba Group logo" />
                <span>EST. 2012</span>
              </div>
              <div>
                <p className="print-letterhead-title">ITEMBA GROUP</p>
                <p className="print-letterhead-subtitle">Company Profile and Capability Statement</p>
              </div>
            </div>
            <div className="print-letterhead-contact">
              <p>{contact.headOffice}</p>
              <p>{contact.postal}</p>
              <p>{contact.primaryPhoneDisplay} / {contact.secondaryPhoneDisplay}</p>
              <p>{contact.email} | {site.domain}</p>
            </div>
          </header>

          <section className="print-cover-panel">
            <div>
              <div className="print-cover-identity">
                <div className="print-cover-logo">
                  <img src="/logo-print.png" alt="Itemba Group logo" />
                  <span>EST. 2012</span>
                </div>
                <span>{site.domain}</span>
              </div>
              <p className="print-kicker">Prepared for institutional review</p>
              <h1>{profile.title}</h1>
              <p className="print-subtitle">{profile.subtitle}</p>
            </div>
            <img src={profile.coverImage.src} alt={profile.coverImage.alt} />
          </section>

          <section className="print-section print-section-tight">
            <h2>Key Profile Facts</h2>
            <dl className="print-fact-grid">
              {profile.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {profile.id === 'group' ? (
            <section className="print-section">
              <h2>Independent Legal Companies</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>TIN</th>
                    <th>Incorporation</th>
                    <th>Directors</th>
                  </tr>
                </thead>
                <tbody>
                  {legalCompanyProfiles.map((company) => (
                    <tr key={company.id}>
                      <td>{company.name}</td>
                      <td>{company.tin}</td>
                      <td>{company.incorporationDate}; No. {company.incorporationNumber}</td>
                      <td>{company.directors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {'directors' in profile ? (
            <section className="print-section print-section-tight">
              <h2>Directors</h2>
              <ul className="print-list print-list-columns">
                {profile.directors.map((director) => (
                  <li key={director}>{director}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="print-section print-section-tight">
            <h2>Related Operating Images</h2>
            <div className="print-image-grid">
              {profile.images.map((image) => (
                <figure key={image.src}>
                  <img src={image.src} alt={image.alt} />
                  <figcaption>{image.caption}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          {(profile.sections as readonly PrintSection[]).map((section) => (
            <PrintSectionBlock key={section.title} section={section} />
          ))}

          <footer className="print-document-footer">
            <span>{profile.subject}</span>
            <span>{site.domain}</span>
          </footer>
        </article>
      ))}
    </div>
  );
}

function PrintSectionBlock({ section }: { section: PrintSection }) {
  return (
    <section className={`print-section${section.pageBreakBefore ? ' print-section-page' : ''}`}>
      <h2>{section.title}</h2>
      {section.body ? <p>{section.body}</p> : null}
      {section.points ? (
        <ul className="print-list">
          {section.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {section.columns ? (
        <div className="print-column-grid">
          {section.columns.map((column) => (
            <div key={column.title} className="print-mini-card">
              <h3>{column.title}</h3>
              {column.body ? <p>{column.body}</p> : null}
              {column.points ? (
                <ul className="print-list">
                  {column.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function CompanyProfilePage() {
  return (
    <>
      <JsonLd
        data={[
          profileJsonLd,
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Company Profile', path: '/company-profile' },
          ]),
          faqJsonLd(groupFaqs),
        ]}
      />

      <CompanyProfilePrintScope />

      <section
        id="cover-page"
        className="relative overflow-hidden bg-ink-950 px-5 pb-20 pt-40 sm:px-8 print:bg-white print:pb-8 print:pt-8"
      >
        <div className="hero-ambient print:hidden">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.4 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.28 }} />
          <div className="grid-overlay" />
        </div>
        <div className="grain-overlay print:hidden" />
        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <AnimatedSection>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400 print:hidden" />
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300 print:text-ink-900">
                Company Profile and Capability Statement
              </p>
            </div>
            <h1
              className="mb-6 font-tight font-black leading-none text-white print:text-ink-900"
              style={{ fontSize: 'clamp(2.7rem, 6vw, 5.4rem)' }}
            >
              Itemba Group
              <span className="block text-gold-300 print:text-ink-900">Company Profile</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-300 print:text-slate-700">
              A Tanzanian holding group headquartered in Mpemba-Tunduma, Songwe Region,
              operating through three independent companies across energy, trade, logistics,
              construction supply, hospitality, real estate, and related services.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrintProfileButton profiles={printProfileOptions} />
              <Link
                href="/contact"
                className="print-hidden btn-primary inline-flex rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-300 hover:text-white"
              >
                Send enquiry
              </Link>
            </div>

            <div className="print-hidden mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-400">Download PDF</p>
              <div className="flex flex-wrap gap-2">
                {printProfileOptions.map((option) => (
                  <a
                    key={option.id}
                    href={`/downloads/itemba-${option.id}-profile.pdf`}
                    download
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-gold-400/60 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {option.label}
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Ready-made snapshots — use Print above for the live, current page.
              </p>
            </div>
          </AnimatedSection>

          <AnimatedSection direction="fade" className="print:hidden">
            <div className="relative h-80 overflow-hidden rounded-2xl ring-1 ring-white/10 cine-shadow">
              <CinematicImage
                src="/images/fuel-stations/itemba-filling-station-wide.webp"
                alt="ITEMBA-MPEMBA filling station forecourt representing Itemba Group operations"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="text-sm font-semibold text-white">Prepared for customers, suppliers, partners, and banking review.</p>
                <p className="mt-1 text-xs text-slate-400">{site.domain}</p>
              </div>
            </div>
          </AnimatedSection>
        </div>

        <div className="relative z-10 mx-auto mt-14 grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coverFacts.map((fact) => (
            <div key={fact.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 print:border-slate-200 print:bg-white">
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-400 print:text-slate-500">{fact.label}</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-white print:text-ink-900">{fact.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink-950 px-5 py-16 sm:px-8 print:px-0 print:py-8">
        <div className="print-sheet mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[18rem_1fr]">
          <aside className="print-hidden lg:sticky lg:top-28 lg:self-start">
            <ProfileNav outline={outline} />
          </aside>

          <div>
            <ProfileSection
              id="company-overview"
              index={2}
              title="Company Overview"
              lead="Itemba Group is presented as a practical multi-industry business group with separate operating companies and a shared parent structure."
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_0.85fr]">
                <div className="space-y-4 text-sm leading-relaxed text-slate-300">
                  <p>
                    Itemba Group is a Tanzanian holding group headquartered at {contact.headOffice}.
                    The group operates through three independently positioned companies: Mwanjalisi
                    Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.
                  </p>
                  <p>
                    The group model separates company-level operations from parent-level oversight.
                    This allows each company to serve its market directly while maintaining a common
                    identity, governance approach, and business development direction under Itemba
                    Group.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="font-semibold text-white">Business type</dt>
                      <dd className="mt-1 text-slate-300">Multi-industry holding group</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-white">Primary location</dt>
                      <dd className="mt-1 text-slate-300">Mpemba-Tunduma, Songwe Region, Tanzania</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-white">Public contact</dt>
                      <dd className="mt-1 break-all text-slate-300">{contact.email}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </ProfileSection>

            <ProfileSection id="vision-mission" index={3} title="Vision and Mission">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visionMission.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-sm print:shadow-none">
                    <h3 className="font-tight text-xl font-black text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{item.body}</p>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection
              id="business-activities"
              index={4}
              title="Business Activities"
              lead="The group covers multiple operating areas through named subsidiaries and divisions, with Westsides Company Ltd structured around three major divisions."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {businessActivities.map((activity) => (
                  <div
                    key={activity.title}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                  >
                    <p className="text-xs font-semibold uppercase text-slate-400">{activity.company}</p>
                    <h3 className="mt-3 font-tight text-xl font-black text-white">{activity.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{activity.summary}</p>
                    {'divisions' in activity ? (
                      <div className="mt-5 space-y-4">
                        {activity.divisions.map((division, index) => (
                          <div key={division.name} className="rounded-md bg-white/[0.04] p-4">
                            <p className="text-xs font-black uppercase text-gold-400">
                              Division {index + 1}
                            </p>
                            <h4 className="mt-1 font-tight text-base font-black text-white">
                              {division.name}
                            </h4>
                            <p className="mt-2 text-sm leading-relaxed text-slate-300">
                              {division.detail}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 space-y-2">
                        {activity.points.map((point) => (
                          <div key={point} className="flex gap-2 text-sm text-slate-300">
                            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold-400" />
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection
              id="products-services"
              index={5}
              title="Products and Services"
              lead="Visitors can identify the right product or service category before contacting the group."
            >
              <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
                {profileProductsServices.map((service) => (
                  <div key={service.title} className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[0.8fr_1.2fr]">
                    <div>
                      <p className="text-xs font-semibold uppercase text-gold-400">{service.eyebrow}</p>
                      <h3 className="mt-2 font-tight text-xl font-black text-white">{service.title}</h3>
                      <p className="mt-2 text-sm text-slate-400">{service.eyebrow}</p>
                    </div>
                    <div>
                      <p className="text-sm leading-relaxed text-slate-300">{service.summary}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {service.offerings.map((offering) => (
                          <span key={offering} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-300">
                            {offering}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection id="target-market" index={6} title="Target Market">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {targetMarketGroups.map((market) => (
                  <div key={market.company} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <p className="text-xs font-semibold uppercase text-gold-400">{market.company}</p>
                    <h3 className="mt-2 font-tight text-xl font-black text-white">{market.title}</h3>
                    <div className="mt-4">
                      <BulletList items={market.points} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl border border-gold-500/30 bg-gold-500/[0.08] p-5">
                <p className="text-sm font-semibold uppercase text-gold-300">
                  Corridor Fuel and Parking Opportunity
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  A key commercial target is the transit market moving through Mpemba-Tunduma:
                  motorists, transporters, and logistics companies heading to or from Zambia,
                  Zimbabwe, DRC, and Malawi. This audience creates direct demand for fuel sales,
                  secure parking, vehicle staging, and practical stopover services.
                </p>
              </div>
              <div className="mt-6">
                <BulletList items={targetMarkets} />
              </div>
            </ProfileSection>

            <ProfileSection
              id="operations-branches"
              index={7}
              title="Operations and Branches"
              lead="The public profile identifies the group head office and the operating companies responsible for specific business lines."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {profileCompanyOperations.map((company) => (
                  <Link
                    key={company.slug}
                    href={`/companies/${company.slug}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-gold-400 hover:bg-white/[0.06]"
                  >
                    <div className={`mb-4 h-2 w-12 rounded-full ${company.accentBg}`} />
                    <h3 className="font-tight text-lg font-black text-white">{company.name}</h3>
                    <p className="mt-2 text-xs font-semibold uppercase text-slate-400">{company.sector}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{company.detail}</p>
                  </Link>
                ))}
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-300">
                Branch, site, and division-level details are managed by the relevant operating company.
                Formal branch schedules can be provided for authorized due diligence where required.
              </p>

              <div className="mt-8 space-y-6">
                {branchOperations.map((operation) => (
                  <div key={operation.company} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <h3 className="font-tight text-xl font-black text-white">{operation.company}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{operation.summary}</p>
                    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {operation.branches.map((branch) => (
                        <div key={branch.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                          {'image' in branch ? (
                            <div className="relative mb-4 overflow-hidden rounded-2xl bg-ink-950">
                              <img
                                src={branch.image}
                                alt=""
                                aria-hidden="true"
                                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                                loading="lazy"
                              />
                              <div className="relative flex min-h-48 items-center justify-center p-2">
                                <img
                                  src={branch.image}
                                  alt={branch.imageAlt}
                                  className="max-h-52 w-full rounded-md object-contain shadow-lg ring-1 ring-white/10"
                                  loading="lazy"
                                />
                              </div>
                            </div>
                          ) : null}
                          <h4 className="font-tight text-lg font-black text-white">{branch.name}</h4>
                          <p className="mt-2 text-sm font-semibold text-gold-300">{branch.focus}</p>
                          <p className="mt-2 text-sm leading-relaxed text-slate-300">{branch.coverage}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection id="management-ownership" index={8} title="Management and Ownership">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <BulletList items={ownershipSummary} />
              </div>
              <div className="mt-6">
                <OrgChart companies={legalCompanyProfiles} />
              </div>

              <div className="mt-8">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">Leadership team</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {leadershipTeam.map((leader) => (
                    <LeadershipCard key={leader.name} leader={leader} />
                  ))}
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-sm print:shadow-none">
                <p className="text-xs font-semibold uppercase text-gold-400">
                  Legal Company Directors and TINs
                </p>
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {legalCompanyProfiles.map((company) => (
                    <div key={company.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                      <h3 className="font-tight text-lg font-black text-white">{company.name}</h3>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">TIN</dt>
                          <dd className="mt-1 text-slate-300">{company.tin}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">Incorporation</dt>
                          <dd className="mt-1 text-slate-300">
                            {company.incorporationDate}; No. {company.incorporationNumber}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase text-slate-400">Directors</dt>
                          <dd className="mt-1 text-slate-300">{company.directors.join('; ')}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            </ProfileSection>

            <ProfileSection id="company-history" index={9} title="Company History">
              <Timeline items={history} />
            </ProfileSection>

            <ProfileSection id="assets-capacity" index={10} title="Assets and Capacity">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {assetCapacity.map((item, index) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/20 bg-gold-500/10 text-gold-300">
                      <SectorIcon name={assetIcons[index] ?? 'trade'} className="h-5 w-5" />
                    </span>
                    <h3 className="font-tight text-lg font-black text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{item.body}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm leading-relaxed text-slate-300">
                Exact capacities, asset values, fleet details, inventory levels, and property schedules
                are not published on the public website. They can be shared directly with authorized
                reviewers when needed.
              </p>
            </ProfileSection>

            <ProfileSection id="financial-overview" index={11} title="Financial Overview">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <p className="text-sm leading-relaxed text-slate-300">
                  Itemba Group operates revenue-generating companies across fuel retail, trade
                  distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant,
                  bar, property, and related services. Public-facing financial figures are not
                  displayed on the website because detailed financial statements, bank records, tax
                  filings, and asset schedules are sensitive business documents.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  For banking, supplier, investor, or partner due diligence, management accounts,
                  audited financial statements, bank statements, and supporting schedules can be
                  provided directly through the appropriate authorized channel.
                </p>
              </div>
            </ProfileSection>

            <ProfileSection id="compliance-information" index={12} title="Compliance Information">
              <BulletList items={complianceItems} />
            </ProfileSection>

            <ProfileSection
              id="competitive-strengths"
              index={13}
              title="Competitive Strengths"
              lead="These strengths show why the group is commercially well positioned across fuel, beverages, distribution, and operating governance."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {strengths.map((strength) => (
                  <div key={strength} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <span className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-gold-500/20 bg-gold-500/10 text-gold-300">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <p className="text-sm leading-relaxed text-slate-300">{strength}</p>
                  </div>
                ))}
              </div>
            </ProfileSection>

            <ProfileSection id="future-plans" index={14} title="Future Plans">
              <BulletList items={futurePlans} />
            </ProfileSection>

            <ProfileSection
              id="banking-purpose"
              index={15}
              title="Purpose of Banking Relationship"
              lead="The profile gives banks a concise view of why the group needs formal banking support and what business activities the relationship supports."
            >
              <BulletList items={bankingPurposes} />
            </ProfileSection>

            <ProfileSection id="contact-information" index={16} title="Contact Information">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="rounded-2xl bg-ink-900 p-6 text-white print:border print:border-slate-200 print:bg-white print:text-ink-900">
                  <p className="mb-5 text-xs font-semibold uppercase text-gold-400 print:text-slate-500">Group Contact</p>
                  <div className="space-y-4 text-sm leading-relaxed">
                    <div>
                      <div className="font-semibold">Head Office</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.headOffice}</p>
                    </div>
                    <div>
                      <div className="font-semibold">Postal</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.postal}</p>
                    </div>
                    <div>
                      <div className="font-semibold">Phone</div>
                      <p className="text-slate-300 print:text-slate-600">{contact.primaryPhoneDisplay}</p>
                      <p className="text-slate-300 print:text-slate-600">{contact.secondaryPhoneDisplay}</p>
                    </div>
                    <div>
                      <div className="font-semibold">Email</div>
                      <p className="break-all text-gold-400 print:text-slate-600">{contact.email}</p>
                    </div>
                  </div>
                </div>
                <EnquiryRouter
                  compact
                  title="Send a routed enquiry"
                  description="Select the relevant operating area and contact the group office with a prepared message."
                  className="print-hidden"
                />
              </div>
            </ProfileSection>

            <ProfileSection
              id="attachments"
              index={17}
              title="Attachments"
              lead="The website can list supporting documents without publishing sensitive files publicly."
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <BulletList items={attachments} />
                <p className="mt-6 text-sm leading-relaxed text-slate-300">
                  Attachments should be shared directly with the requesting bank, supplier, partner,
                  or authorized reviewer. They are not attached to the public web page unless the
                  company chooses to publish a non-sensitive PDF profile.
                </p>
              </div>
            </ProfileSection>

            <AnimatedSection className="pt-10">
              <div className="grid grid-cols-1 gap-8 border-t border-white/10 pt-12 lg:grid-cols-[0.8fr_1.2fr]">
                <div>
                  <div className="gold-line mb-6" />
                  <h2 className="mb-4 font-tight text-3xl font-black leading-tight text-white">
                    Common Questions
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-300">
                    Quick answers for customers, suppliers, and partners reviewing the group profile.
                  </p>
                </div>
                <FaqList faqs={groupFaqs} />
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      <PrintProfileDocuments />
    </>
  );
}
