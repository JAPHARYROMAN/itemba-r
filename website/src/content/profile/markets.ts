/**
 * Company profile §6: target markets: the corridor opportunity and the four
 * audience groups (the screen cards and the group print columns).
 */
import 'server-only';
import type { AccentKey, ContentIcon } from '../types';

export type TargetMarketGroup = {
  /** The business that serves the group (its accent on screen), or the group itself. */
  accent: AccentKey;
  icon: ContentIcon;
  title: string;
  points: readonly string[];
};

/** The screen view's highlighted opportunity, set before the market groups. */
export const corridorOpportunity = {
  title: 'Corridor Fuel and Parking Opportunity',
  body:
    'A key commercial target is the transit market moving through Mpemba-Tunduma: motorists, transporters, and logistics companies heading to or from Zambia, Zimbabwe, DRC, and Malawi. This audience creates direct demand for fuel sales, secure parking, vehicle staging, and practical stopover services.',
} as const;

/**
 * The markets the group serves, in four audience groups: the screen view's
 * cards (with the accent and line icon of the business that serves each) and
 * the group print document's four columns.
 */
export const targetMarketGroups: readonly TargetMarketGroup[] = [
  {
    accent: 'mwanjalisi',
    icon: 'energy',
    title: 'Fuel, Parking, and Corridor Customers',
    points: [
      'Long-haul motorists, truck drivers, fleet operators, and logistics companies moving through the Tunduma corridor toward Zambia, Zimbabwe, DRC, and Malawi.',
      'Transit logistics companies that need reliable fuel supply, vehicle staging, secure parking, and driver stopover points before or after border clearance.',
      'Private motorists, buses, taxis, regional transporters, and commercial fleets requiring diesel, petrol, lubricants, and corridor fuel support.',
    ],
  },
  {
    accent: 'westsides',
    icon: 'trade',
    title: 'Westsides Wholesale, Hospitality, and Construction Markets',
    points: [
      'More than 50 beverage stockists across Songwe Region, serving populated towns, villages, urban centres, and rural trading locations through wholesale supply at distributor pricing.',
      'Bars, night clubs, restaurants, and hospitality outlets concentrated in urban centres such as Tunduma, Mlowo, and Vwawa.',
      'International bulk buyers purchasing beverages and ITEMBA-HARDWARE materials in wholesale quantities before moving goods through the Tunduma border to neighbouring countries.',
      'Construction companies, contractors, builders, hardware retailers, and property developers serving filling station construction, residential homes, commercial properties, and public infrastructure.',
    ],
  },
  {
    accent: 'enterprises',
    icon: 'logistics',
    title: 'Logistics and Cross-Border Transit Customers',
    points: [
      'Local businesses sourcing goods from Dar es Salaam into the Southern Highlands, including Songwe, Mbeya, Rukwa, Ruvuma, and Iringa.',
      'Importers, exporters, traders, and cross-border customers requiring local logistics, transit support, and routes to or from Zambia, DRC, Zimbabwe, and Malawi.',
    ],
  },
  {
    accent: 'group',
    icon: 'globe',
    title: 'Institutional, Property, and Stakeholder Audiences',
    points: [
      'Travellers, business guests, lodging customers, restaurant customers, bar customers, property stakeholders, and local service customers.',
      'Suppliers, distributors, financial institutions, and strategic partners seeking a regional operating group with clear company-level responsibilities.',
    ],
  },
];
