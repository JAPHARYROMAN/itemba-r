/**
 * The three companies' legal profiles for the company-profile page and the
 * print documents, in print order (Westsides, Mwanjalisi Oil, Itemba
 * Enterprises). Registered name, TIN, incorporation and directors come from
 * ./companies (one source); gate public display with flags.publishLegalIdentifiers.
 */
import 'server-only';
import { getCompanyById, type CompanyLegal } from '../companies';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from '../media';
import type { CompanyId } from '../types';

export type LegalProfileSection = {
  title: string;
  points: readonly string[];
};

export type LegalCompanyProfile = CompanyLegal & {
  id: CompanyId;
  /** Registered name. */
  name: string;
  profileTitle: string;
  sector: string;
  summary: string;
  coverImage: MediaImage;
  images: readonly MediaFigure[];
  sections: readonly LegalProfileSection[];
};

/** Registered name, document title and statutory identifiers from the company record. */
function legalIdentity(id: CompanyId): CompanyLegal & { name: string; profileTitle: string } {
  const company = getCompanyById(id);
  if (!company) throw new Error(`Unknown company id: ${id}`);
  return {
    name: company.legalName,
    profileTitle: `${company.legalName} Company Profile`,
    ...company.legal,
  };
}

/** Column labels for the legal identifiers (screen grid and print table). */
export const legalLabels = {
  heading: 'Legal Company Directors and TINs',
  tin: 'TIN',
  incorporation: 'Incorporation',
  directors: 'Directors',
  /** "<date>; No. <number>" */
  numberPrefix: 'No.',
} as const;

export const legalCompanyProfiles: readonly LegalCompanyProfile[] = [
  {
    id: 'westsides',
    ...legalIdentity('westsides'),
    sector: 'Wholesale Beverages, ITEMBA-HARDWARE, and UZUNGUNI INN',
    summary:
      'Westsides Company Ltd manages the group trading and hospitality platform, including wholesale beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
    coverImage: mediaImage('westsides-warehouse-stock', {
      alt: 'Westsides Company Ltd wholesale beverage warehouse stock',
    }),
    images: [
      mediaFigure('westsides-order-truck', {
        alt: 'Customer beverage order loaded for Westsides wholesale distribution',
        caption: 'Wholesale beverage orders prepared for stockists and bulk customers.',
      }),
      mediaFigure('hardware-storefront', {
        alt: 'ITEMBA-HARDWARE storefront and construction materials',
        caption: 'ITEMBA-HARDWARE supplies contractors, builders, and construction buyers.',
      }),
      mediaFigure('inn-bar-restaurant', {
        alt: 'UZUNGUNI INN restaurant and bar seating',
        caption: 'UZUNGUNI INN provides lodging, restaurant, and bar services.',
      }),
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
    ...legalIdentity('mwanjalisi'),
    sector: 'Fuel Retail, Lubricants, and Parking Facilities',
    summary:
      'Mwanjalisi Oil Company Ltd manages ITEMBA-branded fuel stations and UZUNGUNI PARKING YARD for motorists, transport operators, and logistics customers.',
    coverImage: mediaImage('mpemba-station-wide', {
      alt: 'ITEMBA filling station forecourt managed by Mwanjalisi Oil Company Ltd',
    }),
    images: [
      mediaFigure('mpemba-truck-canopy', {
        alt: 'Truck refuelling under an ITEMBA filling station canopy',
        caption: 'ITEMBA-MPEMBA supports motorists, buses, trucks, and business fuel customers.',
      }),
      mediaFigure('uzunguni-forecourt-wide', {
        alt: 'ITEMBA-UZUNGUNI filling station forecourt',
        caption: 'ITEMBA-UZUNGUNI is positioned for corridor traffic along the TANZAM Highway.',
      }),
      mediaFigure('parking-container-trucks', {
        alt: 'Container trucks at UZUNGUNI PARKING YARD',
        caption: 'UZUNGUNI PARKING YARD serves logistics and transit vehicle staging demand.',
      }),
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
    ...legalIdentity('enterprises'),
    sector: 'Logistics, Cross-Border Transit, and Emerging Businesses',
    summary:
      'Itemba Enterprises Co Ltd is the original group company and now focuses on logistics services, cross-border transit, and emerging businesses.',
    coverImage: mediaImage('logistics-tanker', {
      alt: 'Itemba Logistics tanker supporting goods movement and transit operations',
    }),
    images: [
      mediaFigure('logistics-tanker', {
        alt: 'Itemba Logistics tanker under station canopy',
        caption: 'Itemba Logistics supports Dar es Salaam to Southern Highlands movement.',
      }),
      mediaFigure('logistics-truck-front', {
        alt: 'Itemba Logistics truck front view',
        caption: 'Fleet presence for local and cross-border logistics customers.',
      }),
      mediaFigure('logistics-truck-yard', {
        alt: 'Itemba Logistics truck in a yard',
        caption: 'Yard-based support for traders, transporters, and transit customers.',
      }),
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
];
