/**
 * Company profile §4: business activities by company (Westsides by division).
 * `companyId` gives the screen view each company's accent.
 */
import 'server-only';
import type { CompanyId } from '../types';

export const businessActivities = [
  {
    companyId: 'mwanjalisi' as CompanyId,
    company: 'Mwanjalisi Oil Co Ltd',
    title: 'Petroleum Retail, Fuel Supply, and Parking',
    summary:
      'Fuel retail operations and parking facilities serving motorists, transport operators, commercial customers, and corridor traffic in Songwe Region.',
    points: ['Diesel and petrol supply', 'Kerosene and lubricants', 'UZUNGUNI PARKING YARD', 'Retail, business fuel, and parking enquiries'],
  },
  {
    companyId: 'westsides' as CompanyId,
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
    companyId: 'enterprises' as CompanyId,
    company: 'Itemba Enterprises Co Ltd',
    title: 'Logistics and Emerging Businesses',
    summary:
      'Local distribution, cross-border transit, logistics services, and emerging businesses after trading and hospitality activities moved under Westsides Company Ltd.',
    points: ['Local logistics', 'Cross-border transit', 'Emerging business opportunities'],
  },
] as const;
