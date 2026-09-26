/**
 * The corridor story: the Itemba sites clustered at the Mpemba-Tunduma hub
 * and the route they serve (Dar es Salaam → Southern Highlands → Songwe →
 * Tunduma border → Zambia, DRC, Zimbabwe, Malawi).
 *
 * Semantic data only: diagram coordinates and colours belong to the map
 * component. Small and client-safe (no server-only import).
 */
import type { Gated } from './types';

/** Who manages a site. `group` is the group office itself. */
export type SiteManager = 'mwanjalisi' | 'westsides' | 'group';

export type CorridorSite = Gated & {
  id: 'mpemba' | 'yard' | 'hardware' | 'uzunguni' | 'inn' | 'hq';
  name: string;
  manager: SiteManager;
  managerName: string;
  kind: string;
  detail: string;
};

export const corridorSites: CorridorSite[] = [
  {
    id: 'mpemba',
    name: 'ITEMBA-MPEMBA',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Filling station',
    detail: 'Diesel, petrol, kerosene and lubricants near the Tunduma Bus Station.',
  },
  {
    id: 'yard',
    name: 'UZUNGUNI PARKING YARD',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Parking & staging',
    detail: 'Corridor vehicle staging and overnight parking in Uzunguni Area.',
  },
  {
    id: 'hardware',
    name: 'ITEMBA-HARDWARE',
    manager: 'westsides',
    managerName: 'Westsides',
    kind: 'Trade & supply',
    detail: 'Building materials, tools and construction equipment for contractors.',
  },
  {
    id: 'uzunguni',
    name: 'ITEMBA-UZUNGUNI',
    manager: 'mwanjalisi',
    managerName: 'Mwanjalisi Oil',
    kind: 'Filling station',
    detail: 'Fuel and lubricants along the TANZAM Highway in Uzunguni Area.',
  },
  {
    id: 'inn',
    name: 'UZUNGUNI INN',
    manager: 'westsides',
    managerName: 'Westsides',
    kind: 'Hospitality',
    detail: 'Lodging, restaurant and bar for travellers and corridor traders.',
  },
  {
    id: 'hq',
    name: 'Group head office',
    manager: 'group',
    managerName: 'Itemba Group',
    kind: 'Headquarters',
    detail: 'Itemba Filling Station, along the Tunduma-Ileje Highway, Mpemba.',
  },
];

/** The route through the hub, north to south, as the legacy schematic labels it. */
export const corridorWaypoints = [
  { id: 'dar', label: 'Dar es Salaam', sub: 'Origin of supply' },
  { id: 'highlands', label: 'Southern Highlands', sub: 'Mbeya · Iringa' },
  { id: 'border', label: 'Zambia border', sub: 'DRC · Zimbabwe · Malawi' },
] as const;

/**
 * The corridor story's stops, in travel order (plan: "Where Tanzania meets
 * Zambia"). Wording is drawn from the existing site copy.
 */
export const corridorStops = [
  {
    id: 'dar-es-salaam',
    name: 'Dar es Salaam',
    note: 'Origin of supply',
  },
  {
    id: 'southern-highlands',
    name: 'Southern Highlands',
    note: 'Songwe, Mbeya, Rukwa, Ruvuma and Iringa',
  },
  {
    id: 'songwe',
    name: 'Mpemba-Tunduma, Songwe Region',
    note: 'Group headquarters and the Itemba sites',
  },
  {
    id: 'tunduma-border',
    name: 'Tunduma border',
    note: 'Tanzania – Zambia, the Tunduma corridor',
  },
  {
    id: 'onward',
    name: 'Zambia, DRC, Zimbabwe and Malawi',
    note: 'Cross-border transit',
  },
] as const;

export const corridorCopy = {
  hubLabel: 'TUNDUMA · MPEMBA',
  mapLabel: 'Schematic map of the Tunduma trade corridor showing Itemba Group sites at the Mpemba-Tunduma hub',
  intro: {
    eyebrow: 'One hub, six sites',
    title: 'Every Itemba site sits on the same corridor.',
    body:
      'Fuel, parking, hardware, hospitality and logistics — all anchored where the Dar es Salaam supply line meets the Tanzania-Zambia border at Tunduma. Hover or tap a pin to explore.',
  },
  /** Legend chips, in order. */
  legend: [
    { manager: 'mwanjalisi', label: 'Mwanjalisi Oil' },
    { manager: 'westsides', label: 'Westsides' },
    { manager: 'group', label: 'Itemba Group' },
  ],
  /** Accessible name of a pin: "<name> — <kind>, managed by <manager>". */
  managedBy: 'managed by',
} as const;
