#!/usr/bin/env node
/**
 * Records facts about the four downloadable company-profile PDFs so a later
 * regeneration (npm run pdf) can be diffed against them: byte size, SHA-256,
 * page count, page size, document info, per-page character counts, the
 * presence of key strings, and the full extracted text (one .txt per PDF).
 *
 * Usage:
 *   node scripts/pdf-facts.mjs [--dir public/downloads] [--out tests/baseline]
 *
 * Writes <out>/pdfs.json and <out>/pdf-text/<name>.txt. Exits 1 if a PDF is
 * missing or a key string cannot be found.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdf, textIncludes } from './lib/pdf-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, '..');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : fallback;
}

const PDF_DIR = path.resolve(WEBSITE_ROOT, argValue('--dir', 'public/downloads'));
const OUT_DIR = path.resolve(WEBSITE_ROOT, argValue('--out', 'tests/baseline'));

/** Strings every profile carries (letterhead, cover, contact block). */
export const COMMON_KEY_STRINGS = [
  'Itemba Group',
  'Company Profile and Capability Statement',
  'PREPARED FOR INSTITUTIONAL REVIEW',
  'KEY PROFILE FACTS',
  'Itemba Filling Station, Along Tunduma-Ileje Highway',
  'P.O. Box 132, Tunduma-Songwe, Tanzania',
  '+255 758 793 511',
  '+255 745 215 047',
  'info@itembagrouptz.com',
  'www.itembagrouptz.com',
  'EST. 2012',
];

/** Profile-specific strings (legal identity and brands). */
export const PROFILE_KEY_STRINGS = {
  group: [
    'INDEPENDENT LEGAL COMPANIES',
    'Westsides Company Ltd',
    'Mwanjalisi Oil Company Ltd',
    'Itemba Enterprises Co Ltd',
    'TARGET MARKET',
  ],
  westsides: ['Westsides Company Ltd', 'ITEMBA-HARDWARE', 'UZUNGUNI INN', '136-065-580', '9 June 2017', '135764'],
  mwanjalisi: ['Mwanjalisi Oil Company Ltd', 'UZUNGUNI PARKING YARD', '134-036-206', '2 May 2017', '134897'],
  enterprises: ['Itemba Enterprises Co Ltd', 'Cross-Border Transit', '116-321-378', '20 January 2012', '88774'],
};

export const PROFILE_FILES = {
  group: 'itemba-group-profile.pdf',
  westsides: 'itemba-westsides-profile.pdf',
  mwanjalisi: 'itemba-mwanjalisi-profile.pdf',
  enterprises: 'itemba-enterprises-profile.pdf',
};

function headingsOf(text) {
  // Upper-case lines are the section labels in the print layout.
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l.length < 6 || !/[A-Z]{3}/.test(l) || /[a-z]/.test(l) || /^\+?\d/.test(l)) continue;
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

async function main() {
  const problems = [];
  const facts = {};
  await mkdir(path.join(OUT_DIR, 'pdf-text'), { recursive: true });

  for (const [profile, file] of Object.entries(PROFILE_FILES)) {
    const full = path.join(PDF_DIR, file);
    let bytes;
    try {
      bytes = await readFile(full);
    } catch {
      problems.push(`${file} is missing`);
      continue;
    }
    const { pageCount, info, pages } = await extractPdf(bytes);
    const allText = pages.map((p) => p.text).join('\n');
    const keys = [...COMMON_KEY_STRINGS, ...PROFILE_KEY_STRINGS[profile]];
    const keyStrings = Object.fromEntries(keys.map((k) => [k, textIncludes(allText, k)]));
    for (const [k, ok] of Object.entries(keyStrings)) if (!ok) problems.push(`${file}: key string not found: ${k}`);

    const footerCounts = [...allText.matchAll(/Page (\d+) of (\d+)/g)].map((m) => Number(m[2]));
    const pageSizes = [...new Set(pages.map((p) => `${p.width}x${p.height}`))];

    facts[file] = {
      profile,
      path: `/downloads/${file}`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount,
      pageSizes,
      info,
      footerPageTotals: [...new Set(footerCounts)],
      charsPerPage: pages.map((p) => p.text.length),
      totalChars: allText.length,
      keyStrings,
      headings: headingsOf(allText),
    };

    const txt = pages.map((p, i) => `--- page ${i + 1} of ${pageCount} ---\n${p.text}\n`).join('\n');
    await writeFile(path.join(OUT_DIR, 'pdf-text', file.replace(/\.pdf$/, '.txt')), txt, 'utf8');
    console.log(`  ${file}: ${pageCount} pages, ${(bytes.length / 1048576).toFixed(2)} MB, ${allText.length} chars`);
  }

  await writeFile(
    path.join(OUT_DIR, 'pdfs.json'),
    `${JSON.stringify({ source: path.relative(WEBSITE_ROOT, PDF_DIR).split(path.sep).join('/'), files: facts }, null, 2)}\n`,
    'utf8',
  );
  if (problems.length) {
    for (const p of problems) console.error(`  ! ${p}`);
    process.exit(1);
  }
  console.log(`Wrote ${path.relative(WEBSITE_ROOT, path.join(OUT_DIR, 'pdfs.json'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
