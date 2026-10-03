#!/usr/bin/env node
/**
 * Image pipeline (WP1.4): re-exports every photograph under public/images
 * from its best master with one restrained, natural grade, then regenerates
 * src/content/media.generated.ts (width, height, 16px blurDataURL).
 *
 * Masters
 * - Raw originals in website/images/ (phone JPEGs, including five 4000x3000
 *   Samsung originals). Each public file was matched to its raw by thumbnail
 *   correlation (every match ≥ 0.98).
 * - Where no raw exists (the Songwe landscape and the real-estate set) the
 *   pristine legacy webp is kept under scripts/images/sources/ so re-running
 *   never grades an already-graded file. Those copies are the exact blobs
 *   already in git history, so they add no repository weight.
 *
 * Every output keeps its existing public/images path: the URLs are published
 * in JSON-LD, and the PDF script rewrites the /images/ prefix.
 *
 * Processing per image: auto-orient → optional straighten/crop/trim →
 * resize (2400px long edge for hero-class images, 1600px for the rest,
 * never enlarged) → grade → webp q82. All metadata (EXIF, GPS, device data,
 * ICC) is dropped; pixels are converted to sRGB first.
 *
 * The grade (the same for every image; no HDR, no clarity, no sharpening),
 * computed per pixel in OKLab so hue never moves:
 * - shadows lifted slightly by a curve on lightness that pins black and
 *   white: L' = L + SHADOW_LIFT·L·(1−L)² (on 8-bit greys: 15→20, 30→37,
 *   60→68, 128→134, 200→201; pure black and white are unchanged);
 * - chroma scaled by 0.85, i.e. saturation reduced by 15%. A recipe may set
 *   its own `saturation` where the phone already applied a heavy "vivid"
 *   filter (the exception is noted beside its recipe).
 *
 * Usage (from website/):
 *   npm run images                     rebuild every output, then media.generated.ts
 *   npm run images -- --only mpemba    rebuild outputs whose path contains "mpemba"
 *   npm run images -- --check          exit 1 if any output or media.generated.ts is stale
 *   npm run images -- --out <dir>      write outputs to <dir> instead (previews; no manifest)
 *
 * Output is deterministic: the same master and settings give the same bytes.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildMediaManifest, writeMediaManifest } from './media-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_DIR = path.join(ROOT, 'images');
const SOURCES_DIR = path.join(ROOT, 'scripts', 'images', 'sources');
const PUBLIC_DIR = path.join(ROOT, 'public', 'images');
const MANIFEST_FILE = path.join(ROOT, 'src', 'content', 'media.generated.ts');

/** Long-edge caps, in pixels. */
const HERO_MAX = 2400;
const DEFAULT_MAX = 1600;
const WEBP = { quality: 82, effort: 6, smartSubsample: true };
/** Strength of the shadow-lift curve on OKLab lightness (see header). */
const SHADOW_LIFT = 0.2;
/** OKLab chroma multiplier: 0.85 = 15% less saturation. */
const SATURATION = 0.85;

/** A raw original in website/images/. */
const raw = (file) => ({ kind: 'raw', file });
/** A pristine legacy webp kept in scripts/images/sources/ (no raw exists). */
const legacy = (file) => ({ kind: 'legacy', file });

/**
 * One entry per file under public/images. `hero` marks the plan's lead
 * images (2400px masters); `rotate` levels a tilted shot (degrees, clockwise
 * positive) and keeps the largest centred frame of the original shape;
 * `crop` is in auto-oriented (and levelled) source pixels; `trim` removes
 * the black letterbox bars left on phone screenshots; `saturation`
 * overrides the chroma multiplier for that image; `linear` ([a, b], each
 * 8-bit channel becomes a·v + b after the grade) is a mild contrast step
 * for a shot veiled by haze or a smudged lens, for that recipe only.
 */
export const RECIPES = [
  // ── Mwanjalisi Oil: ITEMBA-MPEMBA ─────────────────────────────────────────
  // ITEMBA-MPEMBA under a big sky (Samsung 4000x3000 original), as the
  // company band, the profile covers and the JSON-LD have always used it.
  { out: 'fuel-stations/itemba-filling-station-wide.webp', src: raw('itemba filling station 002.jpg'), hero: true },
  // Home hero: the same frame without the fuel-price pylon on the left (its
  // live prices would date the page) and with less bare forecourt; the crop
  // also centres the canopy.
  {
    out: 'fuel-stations/itemba-mpemba-hero.webp',
    src: raw('itemba filling station 002.jpg'),
    hero: true,
    crop: { left: 600, top: 150, width: 3400, height: 2400 },
  },
  // A coach under the ITEMBA-MPEMBA canopy (3000x4000 original), for the
  // Mwanjalisi Oil hero: a 2:1 band from the canopy's underside to the
  // forecourt, so the pillar signs sit in its top third and the pumps,
  // the coach and people fill the middle (the sky and the bare canopy
  // soffit above them are cut). The shot is veiled by haze (a smudged lens
  // or glare), so it alone gets a mild contrast step.
  {
    out: 'fuel-stations/itemba-mpemba-coach-canopy.webp',
    src: raw('itemba-mpemba 016.jpg'),
    hero: true,
    crop: { left: 0, top: 1150, width: 3000, height: 1500 },
    linear: [1.14, -18],
  },
  // Roadside panorama with a tanker: a full-width corridor band (4000x3000 original).
  { out: 'fuel-stations/itemba-station-wide-yard.webp', src: raw('itemba.jpg'), hero: true },
  // Dusk "Itemba 24 Hours" pump island for the energy cinema tile. New file:
  // the 3000x4000 portrait is cropped to its top 4:3 (sky, lit canopy, pumps,
  // motorbikes, minibus) and loses the empty concrete foreground.
  {
    out: 'fuel-stations/itemba-mpemba-24-hours-dusk.webp',
    src: raw('itemba-mpemba 017.jpg'),
    hero: true,
    crop: { left: 0, top: 0, width: 3000, height: 2250 },
  },
  { out: 'fuel-stations/itemba-filling-station-night.webp', src: raw('itemba filling station.jpg') },
  // Shot about 4.7° off level (the canopy pillars lean): levelled.
  { out: 'fuel-stations/itemba-mpemba-truck-canopy.webp', src: raw('itemba-mpemba-015.jpg'), rotate: -4.7 },
  { out: 'fuel-stations/itemba-mpemba-forecourt.webp', src: raw('itemba-mpemba 003.jpg') },
  { out: 'fuel-stations/itemba-mpemba-service-yard.webp', src: raw('itemba-mpemba 012.jpg') },
  { out: 'fuel-stations/itemba-mpemba-canopy.webp', src: raw('itemba-mpemba 014.jpg') },
  { out: 'fuel-stations/itemba-mpemba-front.webp', src: raw('ITEMBA-MPEMBA 001.jpg') },
  { out: 'fuel-stations/itemba-mpemba-station.webp', src: raw('ITEMBA-MPEMBA 001.jpg') },
  { out: 'fuel-stations/itemba-mpemba-wide.webp', src: raw('ITEMBA-MPEMBA 002.jpg') },

  // ── Mwanjalisi Oil: ITEMBA-UZUNGUNI ───────────────────────────────────────
  { out: 'fuel-stations/itemba-uzunguni-pump-island.webp', src: raw('itemba-uzunguni 004.jpg') },
  { out: 'fuel-stations/itemba-uzunguni-close.webp', src: raw('itemba-uzunguni 003.jpg') },
  { out: 'fuel-stations/itemba-uzunguni-station.webp', src: raw('itemba-uzunguni 003.jpg') },
  // The canopy and the forecourt life, without the bare ground in front.
  {
    out: 'fuel-stations/itemba-uzunguni-forecourt-wide.webp',
    src: raw('itemba-uzunguni 005.jpg'),
    crop: { left: 0, top: 0, width: 1152, height: 580 },
  },
  { out: 'fuel-stations/itemba-uzunguni-forecourt.webp', src: raw('itemba-uzunguni 005.jpg') },
  { out: 'fuel-stations/itemba-uzunguni-front.webp', src: raw('itemba-uzunguni 007.jpg') },
  { out: 'fuel-stations/itemba-uzunguni-roadside.webp', src: raw('itemba-uzunguni 008.jpg') },
  { out: 'fuel-stations/itemba-uzunguni-yard-view.webp', src: raw('itemba-uzunguni 009.jpg') },
  // Group print cover: the top 1280x704 of the Uzunguni front scene, now at
  // native resolution (the legacy file was the same crop upscaled to 1600x880).
  {
    out: 'company-profile/itemba-group-profile-cover.webp',
    src: raw('itemba-uzunguni 007.jpg'),
    crop: { left: 0, top: 0, width: 1280, height: 704 },
  },

  // ── Mwanjalisi Oil: UZUNGUNI PARKING YARD ─────────────────────────────────
  // The strongest "corridor that moves the south" photograph (logistics lead).
  // Trimmed to the sky and the truck line, without most of the yard floor.
  {
    out: 'parking/uzunguni-parking-truck-line.webp',
    src: raw('uzunguni-parking 002.jpg'),
    hero: true,
    crop: { left: 0, top: 80, width: 1280, height: 620 },
  },
  { out: 'parking/uzunguni-parking-yard-trucks.webp', src: raw('uzunguni-parking 003.jpg') },
  { out: 'parking/uzunguni-parking-container-trucks.webp', src: raw('uzunguni-parking 006.jpg') },
  { out: 'parking/uzunguni-parking-yard-overview.webp', src: raw('uzunguni-parking 007.jpg') },

  // ── Itemba Enterprises: Itemba Logistics ──────────────────────────────────
  // Its sky came out of the phone a saturated electric blue, far more vivid
  // than any other photograph on the site: chroma 0.7 brings it to the set.
  { out: 'logistics/itemba-logistics-tanker-under-canopy.webp', src: raw('itemba logistics.jpg'), saturation: 0.7 },
  // Shot through a heavy "vivid" phone filter (neon trees, magenta
  // lettering): chroma 0.55 rather than 0.85 brings it back to the set.
  { out: 'logistics/itemba-logistics-truck-front.webp', src: raw('itemba logistics 002.jpg'), saturation: 0.55 },
  { out: 'logistics/itemba-logistics-truck-yard.webp', src: raw('itemba logistics 001.jpg') },

  // ── Westsides: wholesale beverages ────────────────────────────────────────
  { out: 'beverages/westsides-warehouse-stock-wide.webp', src: raw('westsides-007.jpg') },
  { out: 'beverages/westsides-stock-overview.webp', src: raw('westsides-stock.jpg') },
  { out: 'beverages/westsides-customer-order-truck.webp', src: raw('westsides-customer order.jpg') },
  { out: 'beverages/westsides-softdrinks-warehouse.webp', src: raw('softdrinks-westsides 002.jpg') },
  { out: 'beverages/westsides-softdrinks-stacks.webp', src: raw('softdrinks-westsides.jpg') },
  { out: 'beverages/westsides-cocacola-crates.webp', src: raw('cocacola-wetsides.jpg') },
  { out: 'beverages/westsides-beer-delivery-truck.webp', src: raw('beer-westsides.jpg') },
  { out: 'beverages/beverage-stock-crates.webp', src: raw('beverages 002.jpg') },
  { out: 'beverages/beverage-stock-pallets.webp', src: raw('beverages 001.jpg'), trim: true },
  { out: 'beverages/liquor-cases.webp', src: raw('liquor 001.jpg'), trim: true },
  { out: 'beverages/spirits-warehouse-cases.webp', src: raw('spirits 001.jpg'), trim: true },

  // ── Westsides: ITEMBA-HARDWARE ────────────────────────────────────────────
  // The WESTSIDES COMPANY LIMITED signboard: the trade lead.
  { out: 'hardware/itemba-hardware-storefront.webp', src: raw('itemba-hardware 001.jpg'), hero: true },
  { out: 'hardware/itemba-hardware-paint-stock.webp', src: raw('itemba-hardware 002.jpg') },

  // ── Westsides: UZUNGUNI INN ───────────────────────────────────────────────
  { out: 'hospitality/uzunguni-bar-restaurant.webp', src: raw('uzunguni-bar 001.jpg') },
  { out: 'hospitality/uzunguni-bar-night.webp', src: raw('uzunguni bar.jpg') },
  { out: 'hospitality/uzunguni-inn-room.webp', src: raw('uzunguni inn-room.jpg') },
  { out: 'hospitality/uzunguni-lodge-room.webp', src: raw('uzunguni-lodge-room.jpg') },

  // ── Location (third party, CC BY-SA 4.0: the credit must be rendered) ─────
  { out: 'locations/songwe-region-landscape.webp', src: legacy('locations/songwe-region-landscape.webp'), hero: true },

  // ── Itemba Estate set (external, no raw, not Itemba projects) ─────────────
  ...[
    'modern-african-estate-construction-card.webp',
    'modern-african-estate-construction-wide.webp',
    'modern-african-estate-construction.webp',
    'modern-african-housing-development-wide.webp',
    'modern-african-housing-development.webp',
    'modern-tanzania-white-villa-wide.webp',
    'modern-tanzania-white-villa.webp',
    'zanzibar-residential-houses-aerial-wide.webp',
    'zanzibar-residential-houses-aerial.webp',
  ].map((file) => ({ out: `real-estate/${file}`, src: legacy(`real-estate/${file}`) })),
];

function sourcePath(src) {
  return src.kind === 'raw' ? path.join(RAW_DIR, src.file) : path.join(SOURCES_DIR, src.file);
}

// ── The grade, in OKLab ─────────────────────────────────────────────────────
// Working in OKLab keeps hue exact: chroma is scaled on a/b, lightness is
// curved on L alone. (Desaturating in CIELAB LCh or curving sRGB channels
// independently drifts saturated blues toward violet.)

/** sRGB 8-bit → linear light. */
const TO_LINEAR = new Float64Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
/** Linear light (quantised to 16 bits) → sRGB 8-bit. */
const LINEAR_STEPS = 65535;
const TO_SRGB = new Uint8Array(LINEAR_STEPS + 1).map((_, i) => {
  const l = i / LINEAR_STEPS;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
});
const encode = (l) => TO_SRGB[Math.round(Math.min(1, Math.max(0, l)) * LINEAR_STEPS)];

/** Shadow lift on OKLab lightness: L + s·L·(1−L)². Monotonic, pins 0 and 1. */
const lift = (L) => L + SHADOW_LIFT * L * (1 - L) * (1 - L);

/** Apply the grade in place to packed 8-bit sRGB (3 channels). */
function grade(data, saturation = SATURATION) {
  for (let i = 0; i < data.length; i += 3) {
    const r = TO_LINEAR[data[i]];
    const g = TO_LINEAR[data[i + 1]];
    const b = TO_LINEAR[data[i + 2]];
    // linear sRGB → OKLab (Björn Ottosson, 2020)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = lift(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
    const A = saturation * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s);
    const B = saturation * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
    // OKLab → linear sRGB
    const l2 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m2 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    data[i] = encode(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2);
    data[i + 1] = encode(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2);
    data[i + 2] = encode(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2);
  }
}

async function toRaw(pipeline) {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: info.channels } };
}

const fromRaw = (image) => sharp(image.data, { raw: image.info });

/**
 * Turn by `degrees` (clockwise positive), then keep the largest centred
 * rectangle of the original shape that holds only photograph: a W×H frame
 * turned by θ keeps (W, H) · 1 / (cos θ + (long side / short side) · sin θ).
 */
async function straighten(image, degrees) {
  const { width, height } = image.info;
  const theta = (Math.abs(degrees) * Math.PI) / 180;
  const ratio = Math.max(width, height) / Math.min(width, height);
  const scale = 1 / (Math.cos(theta) + ratio * Math.sin(theta));
  const w = Math.floor(width * scale);
  const h = Math.floor(height * scale);
  const turned = await toRaw(fromRaw(image).rotate(degrees, { background: '#000000' }));
  const left = Math.floor((turned.info.width - w) / 2);
  const top = Math.floor((turned.info.height - h) / 2);
  return toRaw(fromRaw(turned).extract({ left, top, width: w, height: h }));
}

/** Render one recipe to webp bytes. */
export async function render(recipe) {
  const input = await readFile(sourcePath(recipe.src));

  // 1. Auto-orient from EXIF, convert to sRGB, drop alpha. Raw pixels carry no metadata.
  let image = await toRaw(sharp(input, { failOn: 'error' }).rotate().toColourspace('srgb').removeAlpha());

  // 2. Composition: level a tilted shot, explicit crop, or trim black letterbox bars.
  if (recipe.rotate) image = await straighten(image, recipe.rotate);
  if (recipe.crop) image = await toRaw(fromRaw(image).extract(recipe.crop));
  if (recipe.trim) image = await toRaw(fromRaw(image).trim({ background: '#000000', threshold: 24 }));

  // 3. Resize to the long-edge cap, never enlarging.
  const max = recipe.hero ? HERO_MAX : DEFAULT_MAX;
  image = await toRaw(
    fromRaw(image).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' }),
  );

  // 4. Grade: shadow lift on lightness, chroma −15% (or the recipe's own), hue untouched.
  if (image.info.channels !== 3) throw new Error(`${recipe.out}: expected 3-channel sRGB, got ${image.info.channels}`);
  grade(image.data, recipe.saturation ?? SATURATION);

  // 4b. A recipe's own contrast step, for a shot veiled by haze.
  if (recipe.linear) image = await toRaw(fromRaw(image).linear(recipe.linear[0], recipe.linear[1]));

  // 5. Encode. No withMetadata(): EXIF, XMP and ICC are all omitted.
  return fromRaw(image).webp(WEBP).toBuffer();
}

async function listPublic(dir = PUBLIC_DIR, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listPublic(path.join(dir, entry.name), rel)));
    else if (/\.(webp|jpe?g|png|avif)$/i.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Every public image has exactly one recipe and every master exists. */
async function validate() {
  const problems = [];
  const outs = new Set();
  for (const r of RECIPES) {
    if (outs.has(r.out)) problems.push(`duplicate recipe for ${r.out}`);
    outs.add(r.out);
    if (!(await exists(sourcePath(r.src)))) problems.push(`missing master for ${r.out}: ${path.relative(ROOT, sourcePath(r.src))}`);
  }
  for (const file of await listPublic()) {
    if (!outs.has(file)) problems.push(`public/images/${file} has no recipe (add one to RECIPES)`);
  }
  if (problems.length) {
    console.error(`[images] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const args = { check: false, only: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--only') args.only = argv[(i += 1)];
    else if (a === '--out') args.out = path.resolve(argv[(i += 1)]);
    else {
      console.error(`[images] unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await validate();
  const recipes = args.only ? RECIPES.filter((r) => r.out.includes(args.only)) : RECIPES;
  if (!recipes.length) {
    console.error(`[images] no recipe matches --only ${args.only}`);
    process.exit(1);
  }

  const targetDir = args.out ?? PUBLIC_DIR;
  const stale = [];
  let before = 0;
  let after = 0;
  for (const recipe of recipes) {
    const target = path.join(targetDir, recipe.out);
    const bytes = await render(recipe);
    const previous = await readFile(target).catch(() => null);
    before += previous?.length ?? 0;
    after += bytes.length;
    const meta = await sharp(bytes).metadata();
    const same = previous !== null && sha(previous) === sha(bytes);
    if (args.check) {
      if (!same) stale.push(recipe.out);
      continue;
    }
    if (!same) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    console.log(
      `[images] ${same ? '=' : '✓'} ${recipe.out.padEnd(58)} ${`${meta.width}x${meta.height}`.padStart(9)} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB${recipe.hero ? '  hero' : ''}`,
    );
  }

  if (args.check) {
    const manifestFresh = (await buildMediaManifest()) === (await readFile(MANIFEST_FILE, 'utf8').catch(() => ''));
    if (stale.length || !manifestFresh) {
      if (stale.length) console.error(`[images] stale outputs (run npm run images):\n  ${stale.join('\n  ')}`);
      if (!manifestFresh) console.error('[images] src/content/media.generated.ts is stale (run npm run images).');
      process.exit(1);
    }
    console.log(`[images] ${recipes.length} outputs and media.generated.ts are up to date.`);
    return;
  }

  console.log(`[images] ${recipes.length} image(s): ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
  if (!args.out) {
    const out = await writeMediaManifest();
    console.log(`[images] wrote ${path.relative(ROOT, out)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
