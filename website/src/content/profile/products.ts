/**
 * Company profile §5: products and services by brand, each with the company
 * that runs it (`companyId`, for its accent on screen).
 */
import 'server-only';
import type { CompanyId } from '../types';

export const profileProductsServices = [
  {
    companyId: 'westsides' as CompanyId,
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
    companyId: 'westsides' as CompanyId,
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
    companyId: 'westsides' as CompanyId,
    eyebrow: 'Westsides Company Ltd',
    title: 'UZUNGUNI INN',
    summary:
      'Lodging, restaurant, and bar services through UZUNGUNI INN at Mpemba-Tunduma, managed by Westsides Company Ltd.',
    offerings: ['Lodging', 'Restaurant services', 'Bar services', 'Business guest support'],
  },
  {
    companyId: 'mwanjalisi' as CompanyId,
    eyebrow: 'Mwanjalisi Oil Co Ltd',
    title: 'UZUNGUNI PARKING YARD',
    summary:
      'Parking facilities under the UZUNGUNI PARKING YARD brand, managed by Mwanjalisi Oil Co Ltd for corridor motorists and logistics operators.',
    offerings: ['Vehicle parking', 'Truck and logistics parking', 'Corridor vehicle staging', 'Parking facility enquiries'],
  },
  {
    companyId: 'mwanjalisi' as CompanyId,
    eyebrow: 'Mwanjalisi Oil Co Ltd',
    title: 'Fuel and Lubricants',
    summary:
      'Petroleum retail services managed by Mwanjalisi Oil Company Ltd, with fuel stations carrying the public ITEMBA location brand.',
    offerings: ['ITEMBA-MPEMBA', 'ITEMBA-UZUNGUNI', 'Diesel', 'Petrol', 'Kerosene', 'Lubricants', 'Business fuel enquiries'],
  },
  {
    companyId: 'enterprises' as CompanyId,
    eyebrow: 'Itemba Enterprises Co Ltd',
    title: 'Logistics and Emerging Businesses',
    summary:
      'Local logistics, cross-border transit, and emerging business activities managed through Itemba Enterprises Co Ltd.',
    offerings: ['Local logistics', 'Cross-border transit', 'Emerging business opportunities'],
  },
] as const;
