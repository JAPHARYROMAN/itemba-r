/**
 * Media registry: every photograph the site uses, by stable id.
 *
 * Content refers to images by id (`mediaImage('mpemba-station-wide')`), never
 * by path, so the image pipeline can re-point an id without touching copy.
 * Each entry records who the image belongs to (`entity`), where it came from
 * (`provenance`) and, for third-party images, the credit and licence that
 * must be rendered next to it. Intrinsic size and the blur placeholder come
 * from ./media.generated.ts (npm run media:manifest).
 *
 * Paths stay under /images/ because the PDF script rewrites exactly that
 * prefix and JSON-LD publishes these URLs.
 */
import 'server-only';
import type { BooleanFlagName } from './flags';
import { mediaGenerated, type GeneratedMediaSrc } from './media.generated';

/** Who the photograph shows / belongs to. */
export type MediaEntity = 'group' | 'mwanjalisi' | 'westsides' | 'enterprises' | 'location';

/**
 * - own: Itemba's own photograph (phone originals in website/images/).
 * - stock: a third-party image used under the recorded licence (credit + licence required).
 * - unknown: provenance or licence not recorded; needs owner confirmation before prominent use.
 */
export type MediaProvenance = 'own' | 'stock' | 'unknown';

export type MediaEntry = {
  src: GeneratedMediaSrc;
  /** Canonical alt text (ownership-carrying). A usage may override it in context. */
  alt: string;
  entity: MediaEntity;
  provenance: MediaProvenance;
  /** Rendered credit line, e.g. "Richard grivas / Wikimedia Commons". */
  credit?: string;
  licence?: string;
  licenceUrl?: string;
  /** Only render when this flag is on. */
  requires?: BooleanFlagName;
  /**
   * Where the subject sits vertically. A crop to another aspect ratio keeps
   * this edge (the centre when omitted), so a big sky or a signboard at the
   * top of the frame survives a wide crop. A number is a percentage from the
   * top (CSS object-position), for a subject between the edge and the centre.
   */
  focus?: 'top' | 'bottom' | number;
  /**
   * Where the subject sits across, as a percentage from the left (the
   * centre when omitted). It matters where a frame is narrower than the
   * photograph (a square or 4:3 phone crop of a wide shot), so the crop
   * keeps the subject rather than the middle of the frame.
   */
  focusX?: number;
  note?: string;
};

export const media = {
  // ── Mwanjalisi Oil: ITEMBA stations ──────────────────────────────────────
  'mpemba-station-wide': {
    src: '/images/fuel-stations/itemba-filling-station-wide.webp',
    alt: 'ITEMBA-MPEMBA filling station forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
    focus: 'top',
    note: 'Raw: images/itemba filling station 002.jpg (4000x3000). Includes the fuel-price pylon; the home hero uses mpemba-hero.',
  },
  'mpemba-hero': {
    src: '/images/fuel-stations/itemba-mpemba-hero.webp',
    alt: 'ITEMBA-MPEMBA filling station under a wide Songwe sky, managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
    focus: 55,
    focusX: 45,
    note: 'The plan lead for the home hero: the 4000x3000 raw without the fuel-price pylon (its live prices would date the page). Focus 55: in the wide desktop frame the canopy clears the fold under a 96px headline, with the sky above it. FocusX 45: the centre of the canopy, where the 1.5x phone crop (HomeHero) is taken, so the whole canopy and its ITEMBA signs fill the phone frame.',
  },
  'mpemba-dusk': {
    src: '/images/fuel-stations/itemba-mpemba-24-hours-dusk.webp',
    alt: 'ITEMBA-MPEMBA at dusk: motorbikes and a minibus at the pump island under the lit 24-hour canopy',
    entity: 'mwanjalisi',
    provenance: 'own',
    focus: 40,
    note: 'Raw: images/itemba-mpemba 017.jpg (top 4:3 of the portrait). Plan lead for the energy cinema tile. Soft and noisy past about 1100px wide: keep it in the content width.',
  },
  'mpemba-coach-canopy': {
    src: '/images/fuel-stations/itemba-mpemba-coach-canopy.webp',
    alt: 'A coach at the pumps under the ITEMBA-MPEMBA canopy, managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
    focusX: 85,
    note: 'Raw: images/itemba-mpemba 016.jpg (3000x4000), cropped to a 2:1 band from the canopy underside to the forecourt, with a mild contrast step against its haze. The Mwanjalisi Oil page hero. FocusX 85: a 4:3 phone crop keeps the coach, the pumps and both pillar signs.',
  },
  'mpemba-station-roadside': {
    src: '/images/fuel-stations/itemba-station-wide-yard.webp',
    alt: 'ITEMBA filling station forecourt seen from the highway on the Songwe Region corridor',
    entity: 'mwanjalisi',
    provenance: 'own',
    note: 'Raw: images/itemba.jpg (4000x3000).',
  },
  'mpemba-truck-canopy': {
    src: '/images/fuel-stations/itemba-mpemba-truck-canopy.webp',
    alt: 'Trucks refuelling under the ITEMBA-MPEMBA canopy managed by Mwanjalisi Oil',
    entity: 'mwanjalisi',
    provenance: 'own',
    note: 'Levelled in the pipeline (the raw is about 4.7° off).',
  },
  'mpemba-forecourt': {
    src: '/images/fuel-stations/itemba-mpemba-forecourt.webp',
    alt: 'ITEMBA-MPEMBA forecourt and canopy managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
  },
  'mpemba-service-yard': {
    src: '/images/fuel-stations/itemba-mpemba-service-yard.webp',
    alt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
  },
  'uzunguni-pump-island': {
    src: '/images/fuel-stations/itemba-uzunguni-pump-island.webp',
    alt: 'ITEMBA-UZUNGUNI filling station managed by Mwanjalisi Oil Company Ltd',
    entity: 'mwanjalisi',
    provenance: 'own',
  },
  'uzunguni-forecourt-wide': {
    src: '/images/fuel-stations/itemba-uzunguni-forecourt-wide.webp',
    alt: 'ITEMBA-UZUNGUNI filling station forecourt on the TANZAM Highway',
    entity: 'mwanjalisi',
    provenance: 'own',
    note: 'Cropped in the pipeline to the canopy and the forecourt, without the bare ground in front.',
  },

  // ── Mwanjalisi Oil: UZUNGUNI PARKING YARD ────────────────────────────────
  'parking-container-trucks': {
    src: '/images/parking/uzunguni-parking-container-trucks.webp',
    alt: 'Container trucks parked at UZUNGUNI PARKING YARD',
    entity: 'mwanjalisi',
    provenance: 'own',
  },
  'parking-yard-trucks': {
    src: '/images/parking/uzunguni-parking-yard-trucks.webp',
    alt: 'Truck parking at UZUNGUNI PARKING YARD',
    entity: 'mwanjalisi',
    provenance: 'own',
  },
  'parking-truck-line': {
    src: '/images/parking/uzunguni-parking-truck-line.webp',
    alt: 'A line of trucks and containers at UZUNGUNI PARKING YARD, Mpemba-Tunduma',
    entity: 'mwanjalisi',
    provenance: 'own',
    note: 'Cropped in the pipeline to the sky and the truck line. A Mwanjalisi Oil site: never shown as an Itemba Enterprises photograph.',
  },

  // ── Itemba Enterprises: Itemba Logistics ─────────────────────────────────
  'logistics-tanker': {
    src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp',
    alt: 'Itemba Logistics tanker supporting goods movement and transit operations',
    entity: 'enterprises',
    provenance: 'own',
    focus: 20,
    note: 'Portrait 720x1280; the striped canopy is not ITEMBA signage. Small cells only. Focus 20 trims the bare yard below the tanker; its vivid sky is toned down in the pipeline (chroma 0.7).',
  },
  'logistics-truck-front': {
    src: '/images/logistics/itemba-logistics-truck-front.webp',
    alt: 'An Itemba Enterprises truck, seen from the front',
    entity: 'enterprises',
    provenance: 'own',
    note: 'Portrait 720x1280, shot with a heavy "vivid" filter: the pipeline tones its chroma down further than the rest.',
  },
  'logistics-truck-yard': {
    src: '/images/logistics/itemba-logistics-truck-yard.webp',
    alt: 'Itemba Logistics truck in a yard',
    entity: 'enterprises',
    provenance: 'own',
  },

  // ── Westsides: wholesale beverages ───────────────────────────────────────
  'westsides-warehouse-stock': {
    src: '/images/beverages/westsides-warehouse-stock-wide.webp',
    alt: 'Westsides Company Ltd wholesale beverage warehouse stock for distribution customers',
    entity: 'westsides',
    provenance: 'own',
  },
  'westsides-order-truck': {
    src: '/images/beverages/westsides-customer-order-truck.webp',
    alt: 'Customer beverage order loaded on a truck for Westsides distribution',
    entity: 'westsides',
    provenance: 'own',
  },
  'westsides-beer-delivery': {
    src: '/images/beverages/westsides-beer-delivery-truck.webp',
    alt: 'Beverage crates stacked on a Westsides delivery truck',
    entity: 'westsides',
    provenance: 'own',
    note: 'Portrait 780x1040: crates on a truck with no dominant third-party logo. The Westsides page hero (split, beside the text).',
  },
  'westsides-softdrinks': {
    src: '/images/beverages/westsides-softdrinks-warehouse.webp',
    alt: 'Soft drink stock inside a Westsides beverage warehouse',
    entity: 'westsides',
    provenance: 'own',
  },
  'westsides-crates': {
    src: '/images/beverages/westsides-cocacola-crates.webp',
    alt: 'Coca-Cola crates stored for Westsides distribution',
    entity: 'westsides',
    provenance: 'own',
  },

  // ── Westsides: ITEMBA-HARDWARE ───────────────────────────────────────────
  'hardware-storefront': {
    src: '/images/hardware/itemba-hardware-storefront.webp',
    alt: 'ITEMBA-HARDWARE storefront and construction supply stock managed by Westsides Company Ltd',
    entity: 'westsides',
    provenance: 'own',
    focus: 'top',
    note: 'Portrait 960x1280 under the WESTSIDES COMPANY LIMITED signboard: the plan lead for trade.',
  },
  'hardware-paint-stock': {
    src: '/images/hardware/itemba-hardware-paint-stock.webp',
    alt: 'ITEMBA-HARDWARE paint and construction supply stock',
    entity: 'westsides',
    provenance: 'own',
  },

  // ── Westsides: UZUNGUNI INN ──────────────────────────────────────────────
  'inn-lodge-room': {
    src: '/images/hospitality/uzunguni-lodge-room.webp',
    alt: 'UZUNGUNI INN lodging room managed by Westsides Company Ltd',
    entity: 'westsides',
    provenance: 'unknown',
    requires: 'useUnverifiedHospitalityPhotos',
    note: '600x449 and stock-looking; unconfirmed as an UZUNGUNI INN room. Never full-bleed.',
  },
  'inn-bar-restaurant': {
    src: '/images/hospitality/uzunguni-bar-restaurant.webp',
    alt: 'UZUNGUNI INN restaurant and bar seating',
    entity: 'westsides',
    provenance: 'own',
  },
  'inn-bar-night': {
    src: '/images/hospitality/uzunguni-bar-night.webp',
    alt: 'UZUNGUNI INN bar area at night',
    entity: 'westsides',
    provenance: 'own',
  },

  // ── Itemba Enterprises: Itemba Estate (not Itemba projects) ──────────────
  'estate-construction-wide': {
    src: '/images/real-estate/modern-african-estate-construction-wide.webp',
    alt: 'Modern low-rise residential estate construction site with multiple homes',
    entity: 'enterprises',
    provenance: 'unknown',
    note: 'External image, no licence recorded; does not show an Itemba project (flags.estateImagery).',
  },
  'estate-construction': {
    src: '/images/real-estate/modern-african-estate-construction.webp',
    alt: 'Aerial view of multiple low-rise homes under construction in a residential estate',
    entity: 'enterprises',
    provenance: 'unknown',
    note: 'External image, no licence recorded (flags.estateImagery).',
  },
  'estate-housing-development': {
    src: '/images/real-estate/modern-african-housing-development-wide.webp',
    alt: 'Modern low-rise housing development with repeated residential units',
    entity: 'enterprises',
    provenance: 'unknown',
    note: 'External image, no licence recorded (flags.estateImagery).',
  },
  'estate-white-villa': {
    src: '/images/real-estate/modern-tanzania-white-villa-wide.webp',
    alt: 'Finished modern residential home in Tanzania',
    entity: 'enterprises',
    provenance: 'unknown',
    note: 'External image, no licence recorded (flags.estateImagery).',
  },
  'estate-coastal-aerial': {
    src: '/images/real-estate/zanzibar-residential-houses-aerial-wide.webp',
    alt: 'Aerial view of residential houses and roads in a Tanzanian coastal town',
    entity: 'enterprises',
    provenance: 'unknown',
    note: 'External image, no licence recorded (flags.estateImagery).',
  },

  // ── Location and group ───────────────────────────────────────────────────
  'songwe-landscape': {
    src: '/images/locations/songwe-region-landscape.webp',
    alt: 'Fields and mountains in Songwe Region, Tanzania',
    entity: 'location',
    provenance: 'stock',
    credit: 'Richard grivas / Wikimedia Commons',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    note: 'The credit must be rendered wherever the image appears.',
  },
  'profile-cover': {
    src: '/images/company-profile/itemba-group-profile-cover.webp',
    alt: 'ITEMBA-UZUNGUNI filling station canopy, the Itemba Group company profile cover',
    entity: 'mwanjalisi',
    provenance: 'own',
    note: 'A crop of the ITEMBA-UZUNGUNI front scene; group print cover.',
  },
} as const satisfies Record<string, MediaEntry>;

export type MediaId = keyof typeof media;

/** An image as content carries it: registry id plus the (possibly contextual) alt and caption. */
export type MediaImage = {
  media: MediaId;
  src: string;
  alt: string;
  caption?: string;
};

/**
 * Content-side image reference. `alt` overrides the registry alt where the
 * context needs different words (kept verbatim from the legacy pages).
 */
export function mediaImage(id: MediaId, options: { alt?: string; caption?: string } = {}): MediaImage {
  const entry: MediaEntry = media[id];
  const image: MediaImage = { media: id, src: entry.src, alt: options.alt ?? entry.alt };
  if (options.caption !== undefined) image.caption = options.caption;
  return image;
}

/** An image shown with a visible caption (galleries, print grids). */
export type MediaFigure = MediaImage & { caption: string };

export function mediaFigure(id: MediaId, options: { alt?: string; caption: string }): MediaFigure {
  return { ...mediaImage(id, { alt: options.alt }), caption: options.caption };
}

export type ResolvedMedia = MediaEntry & {
  id: MediaId;
  width: number;
  height: number;
  blurDataURL: string;
};

/** Registry entry plus generated intrinsic size and blur placeholder. */
export function getMedia(id: MediaId): ResolvedMedia {
  const entry: MediaEntry = media[id];
  const generated = mediaGenerated[entry.src];
  return { ...entry, id, width: generated.width, height: generated.height, blurDataURL: generated.blurDataURL };
}

export const mediaIds = Object.keys(media) as MediaId[];
