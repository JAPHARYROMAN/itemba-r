#!/usr/bin/env node
/**
 * Builds public/logo-nav.png, the crest for the 48px global nav, from the
 * full lockup public/logo.png (930×360: the shield, ITEMBA, and GROUP
 * between two rules, white on a transparent field).
 *
 * At nav height the full lockup sets GROUP about 5px tall, which no one can
 * read. The nav mark keeps the shield and the ITEMBA wordmark at their
 * original size and spacing, drops the GROUP line, and centres the wordmark
 * on the shield. It serves the global nav and its phone menu sheet; the
 * footer, the OG cards and the print letterhead keep the full lockup.
 *
 * Usage (from website/): node scripts/images/build-nav-crest.mjs
 * Output is deterministic: the same logo.png gives the same bytes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'public', 'logo.png');
const OUT = path.join(ROOT, 'public', 'logo-nav.png');

/** Alpha above this counts as ink (the mark is anti-aliased). */
const INK = 24;
/** Transparent margin kept around the mark, in source pixels. */
const MARGIN = 4;

const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const alpha = (x, y) => data[(y * width + x) * channels + 3];

/** Bounding box of the ink inside a region. */
function inkBox(x0, y0, x1, y1) {
  let left = x1;
  let right = x0;
  let top = y1;
  let bottom = y0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alpha(x, y) > INK) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) throw new Error(`No ink in ${x0},${y0}–${x1},${y1}`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const columnHasInk = (x) => {
  for (let y = 0; y < height; y++) if (alpha(x, y) > INK) return true;
  return false;
};

/** The first empty column after the first inked one: the gap between the shield and the words. */
function gapAfterShield() {
  let x = 0;
  while (x < width && !columnHasInk(x)) x++;
  while (x < width && columnHasInk(x)) x++;
  if (x >= width) throw new Error('No gap after the shield');
  return x;
}

/** The first row with no ink between `y0` and the bottom, across columns x0–x1: the gap under ITEMBA. */
function firstEmptyRow(y0, x0, x1) {
  for (let y = y0; y < height; y++) {
    let ink = false;
    for (let x = x0; x <= x1 && !ink; x++) ink = alpha(x, y) > INK;
    if (!ink) return y;
  }
  throw new Error('No gap under the wordmark');
}

const shield = inkBox(0, 0, gapAfterShield() - 1, height - 1);
const wordsLeft = shield.left + shield.width + 1;
// ITEMBA is the first band of ink to the right of the shield; GROUP and its rules sit below a clear gap.
const firstWords = inkBox(wordsLeft, 0, width - 1, height - 1);
const itemba = inkBox(wordsLeft, firstWords.top, width - 1, firstEmptyRow(firstWords.top, wordsLeft, width - 1) - 1);
const gap = itemba.left - (shield.left + shield.width);

const canvas = { width: MARGIN * 2 + shield.width + gap + itemba.width, height: MARGIN * 2 + shield.height };
const extract = (box) => sharp(SOURCE).extract(box).png().toBuffer();

const png = await sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: await extract(shield), left: MARGIN, top: MARGIN },
    {
      input: await extract(itemba),
      left: MARGIN + shield.width + gap,
      top: MARGIN + Math.round((shield.height - itemba.height) / 2),
    },
  ])
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

await sharp(png).toFile(OUT);
console.log(`[nav-crest] ${path.relative(ROOT, OUT)} ${canvas.width}x${canvas.height} (shield ${shield.width}x${shield.height}, ITEMBA ${itemba.width}x${itemba.height})`);
