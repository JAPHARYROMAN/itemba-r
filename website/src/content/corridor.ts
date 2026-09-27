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
 * Zambia"). Wording is drawn from the existing site copy: `note` is the
 * stop's short line, `detail` its one-sentence story, and `mapLabel` the
 * label beside its node on the drawn route.
 */
export const corridorStops = [
  {
    id: 'dar-es-salaam',
    name: 'Dar es Salaam',
    note: 'Origin of supply',
    mapLabel: 'Dar es Salaam',
    detail: 'Businesses source their goods in Dar es Salaam, and the corridor carries them south-west to the Southern Highlands.',
  },
  {
    id: 'southern-highlands',
    name: 'Southern Highlands',
    note: 'Songwe, Mbeya, Rukwa, Ruvuma and Iringa',
    mapLabel: 'Southern Highlands',
    detail: 'Itemba Enterprises moves goods for businesses across Songwe, Mbeya, Rukwa, Ruvuma and Iringa.',
  },
  {
    id: 'songwe',
    name: 'Mpemba-Tunduma, Songwe Region',
    note: 'Group headquarters and the Itemba sites',
    mapLabel: 'Mpemba-Tunduma',
    detail: 'Stations, parking, hardware, hospitality and the group office all sit here, where the supply line meets the border.',
  },
  {
    id: 'tunduma-border',
    name: 'Tunduma border',
    note: 'Tanzania – Zambia, the Tunduma corridor',
    mapLabel: 'Tunduma border',
    detail: "One of Southern Africa's busiest trade corridors, with direct access to cross-border flows and regional supply chains.",
  },
  {
    id: 'onward',
    name: 'Zambia, DRC, Zimbabwe and Malawi',
    note: 'Cross-border transit',
    mapLabel: 'Zambia · DRC · Zimbabwe · Malawi',
    detail: 'Transit customers move goods to and from four neighbouring countries through the Tunduma corridor.',
  },
] as const;

export type CorridorStop = (typeof corridorStops)[number];
export type CorridorStopId = CorridorStop['id'];

/** The stop where the six Itemba sites sit (the story lists them there). */
export const corridorHubStopId: CorridorStopId = 'songwe';

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
  /** The hub's label on the site map, one line each. */
  hubLines: ['Mpemba', 'Tunduma'],
  /** The route's two ends on the site map. */
  termini: { north: 'Dar es Salaam', south: 'Zambia border' },
  /** The two sides of the border line on the drawn route. */
  borderSides: { north: 'Tanzania', south: 'Zambia' },
  /** Under the site map: the drawing places the sites, it does not survey them. */
  schematicNote: 'Schematic, not to scale.',
  /** Accessible name of the site list when no heading names it. */
  sitesLabel: 'Itemba sites at the Mpemba-Tunduma hub',
  /** Accessible name of the story's list of stops when no heading names it. */
  stopsLabel: 'The corridor, from Dar es Salaam to the border and beyond',
} as const;
