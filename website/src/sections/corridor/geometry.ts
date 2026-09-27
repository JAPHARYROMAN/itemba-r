/**
 * Drawing coordinates for the corridor graphics. Layout only: the stops,
 * sites and labels are content (src/content/corridor.ts). Both drawings are
 * schematic; they place things in order, they do not survey them.
 */
import type { CorridorSite, CorridorStopId } from '@/content/corridor';

const round = (n: number) => Math.round(n * 10) / 10;

/* ── The site map: the Mpemba-Tunduma hub and its six sites ───────────── */

export const hubMap = {
  width: 400,
  height: 400,
  center: { x: 200, y: 200 },
  hubRadius: 46,
  pinRadius: 18,
  /** Distance from the hub's centre to each pin's centre. */
  ring: 132,
  /** The corridor spine through the hub, north (Dar es Salaam) to south (the border). */
  spine: { top: 44, bottom: 356 },
} as const;

/**
 * Where each site's pin sits around the hub, in degrees clockwise from east
 * (SVG y points down). The fuel and parking sites and ITEMBA-HARDWARE sit to
 * the west, the Uzunguni station, the inn and the head office to the east,
 * as on the legacy schematic.
 */
const PIN_ANGLES: Record<CorridorSite['id'], number> = {
  mpemba: 220,
  yard: 180,
  hardware: 140,
  uzunguni: 320,
  inn: 0,
  hq: 40,
};

export type PinGeometry = {
  x: number;
  y: number;
  /** The spoke from the hub's edge to the pin's edge. */
  spoke: { x1: number; y1: number; x2: number; y2: number };
};

export function pinGeometry(id: CorridorSite['id']): PinGeometry {
  const { center, ring, hubRadius, pinRadius } = hubMap;
  const angle = (PIN_ANGLES[id] * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const gap = 6;
  return {
    x: round(center.x + ring * ux),
    y: round(center.y + ring * uy),
    spoke: {
      x1: round(center.x + (hubRadius + gap) * ux),
      y1: round(center.y + (hubRadius + gap) * uy),
      x2: round(center.x + (ring - pinRadius - gap) * ux),
      y2: round(center.y + (ring - pinRadius - gap) * uy),
    },
  };
}

/* ── The route: Dar es Salaam to the border and beyond ────────────────── */

export const routeMap = {
  width: 360,
  height: 600,
  /** The Tanzania–Zambia border line crosses the route at the Tunduma node. */
  borderY: 446,
  nodeRadius: 6.5,
  /** The hub's node is a little larger; the site dots ring it. */
  hubRadius: 8.5,
  /** Radius of the ring of site dots around the hub node, and each dot's radius. */
  siteRing: 21,
  siteRadius: 4.25,
} as const;

type Anchor = 'start' | 'end';

/** Each stop's node and the side its label sits on. North-east to south-west, as the road runs. */
export const routeNodes: Record<CorridorStopId, { x: number; y: number; anchor: Anchor }> = {
  'dar-es-salaam': { x: 296, y: 60, anchor: 'end' },
  'southern-highlands': { x: 220, y: 196, anchor: 'end' },
  songwe: { x: 136, y: 340, anchor: 'start' },
  'tunduma-border': { x: 112, y: 446, anchor: 'start' },
  onward: { x: 92, y: 552, anchor: 'start' },
};

/**
 * The route between consecutive stops as cubic curves, in travel order:
 * segment i runs from stop i to stop i + 1. Hand-tuned for a gentle S.
 */
export const routeSegments: readonly string[] = [
  'M296 60 C280 110 244 150 220 196',
  'M220 196 C196 242 150 282 136 340',
  'M136 340 C128 376 116 410 112 446',
  'M112 446 C108 486 100 520 92 552',
];

/** The whole route as one path (the track under the drawn line). */
export const routeTrack = routeSegments
  .map((segment, index) => (index === 0 ? segment : segment.replace(/^M[\d.]+ [\d.]+ /, '')))
  .join(' ');

/** Label position for a node: beside it, on its anchor side. */
export function nodeLabel(id: CorridorStopId): { x: number; y: number; anchor: Anchor } {
  const node = routeNodes[id];
  const offset = id === 'songwe' ? routeMap.siteRing + 10 : 16;
  return { x: node.x + (node.anchor === 'end' ? -offset : offset), y: node.y + 5, anchor: node.anchor };
}

/** The six site dots on a ring around the hub node, first at the top, clockwise. */
export function siteDot(index: number, count: number, hub: { x: number; y: number }): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(count, 1);
  return { x: round(hub.x + routeMap.siteRing * Math.cos(angle)), y: round(hub.y + routeMap.siteRing * Math.sin(angle)) };
}
