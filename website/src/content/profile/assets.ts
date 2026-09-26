/**
 * Company profile §10: assets and capacity (with a line icon per card).
 */
import 'server-only';
import type { IconKey } from '../types';

export const assetCapacity = [
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

// Line icon per asset-capacity card (index-aligned with assetCapacity above).
export const assetIcons: readonly IconKey[] = ['realestate', 'energy', 'trade', 'construction', 'logistics', 'hospitality'];

export const assetsNote =
  'Exact capacities, asset values, fleet details, inventory levels, and property schedules are not published on the public website. They can be shared directly with authorized reviewers when needed.';
