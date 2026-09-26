/**
 * Company profile §6: target markets (screen groups, the full list, and the print columns).
 */
import 'server-only';

export const targetMarkets = [
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

export const targetMarketGroups = [
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

/** The screen view's highlighted opportunity under the market groups. */
export const corridorOpportunity = {
  title: 'Corridor Fuel and Parking Opportunity',
  body:
    'A key commercial target is the transit market moving through Mpemba-Tunduma: motorists, transporters, and logistics companies heading to or from Zambia, Zimbabwe, DRC, and Malawi. This audience creates direct demand for fuel sales, secure parking, vehicle staging, and practical stopover services.',
} as const;

/** The group print document groups the same markets into four columns. */
export const groupPrintTargetMarkets = [
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
