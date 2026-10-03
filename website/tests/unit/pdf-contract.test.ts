/**
 * The four downloadable company profiles under public/downloads/ must stay
 * present and recognisably the same documents: 200 KB to 8 MB each, page
 * counts within ±30% of the origin/main baseline, and every key string from
 * tests/baseline/pdfs.json still extractable. Regenerating the PDFs (npm run
 * pdf) is expected to keep this green.
 *
 * They must also say what the site says: each company's registered name and,
 * while flags.publishLegalIdentifiers is on, its TIN, incorporation date and
 * number and its directors (src/content/companies.ts) are in the group
 * profile and in the company's own. A stale PDF fails here even if the input
 * lock (scripts/pdf-inputs.lock) is bypassed.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { companies } from '@/content/companies';
import { flags } from '@/content/flags';
import { profilePdfHref } from '@/content/profile/cover';
import { extractPdf, textIncludes } from '../../scripts/lib/pdf-text.mjs';

const ROOT = path.resolve(__dirname, '../..');
const baseline = JSON.parse(readFileSync(path.join(ROOT, 'tests/baseline/pdfs.json'), 'utf8')) as {
  files: Record<string, { pageCount: number; keyStrings: Record<string, boolean> }>;
};

describe('profile PDF downloads', () => {
  it.each(Object.entries(baseline.files))('%s', async (file, facts) => {
    const full = path.join(ROOT, 'public/downloads', file);
    const { size } = statSync(full);
    expect(size).toBeGreaterThanOrEqual(200 * 1024);
    expect(size).toBeLessThanOrEqual(8 * 1024 * 1024);

    const pdf = await extractPdf(readFileSync(full));
    expect(pdf.pageCount).toBeGreaterThanOrEqual(Math.floor(facts.pageCount * 0.7));
    expect(pdf.pageCount).toBeLessThanOrEqual(Math.ceil(facts.pageCount * 1.3));

    const text = pdf.pages.map((p) => p.text).join('\n');
    const missing = Object.keys(facts.keyStrings).filter((key) => !textIncludes(text, key));
    expect(missing).toEqual([]);
    const lastPageBody = pdf.pages.at(-1)!.text
      .replace(/Page\s+\d+\s+of\s+\d+/gi, '')
      .replace(/www\.itembagrouptz\.com|Itemba Group/gi, '')
      .trim();
    expect(lastPageBody.split(/\s+/).length, `${file} ends with a footer-only sheet`).toBeGreaterThanOrEqual(20);
  });
});

async function pdfText(file: string) {
  const pdf = await extractPdf(readFileSync(path.join(ROOT, 'public/downloads', file)));
  return pdf.pages.map((p) => p.text).join('\n');
}

describe('profile PDFs match the company records', () => {
  const groupFile = 'itemba-group-profile.pdf';

  it.each(companies.map((c) => [c.slug, c] as const))('%s', async (_slug, company) => {
    const ownFile = path.basename(profilePdfHref(company.id));
    expect(ownFile).not.toBe(groupFile);
    const needles = [company.legalName];
    if (flags.publishLegalIdentifiers) {
      needles.push(company.legal.tin, company.legal.incorporationNumber, company.legal.incorporationDate);
      // Directors by name (the role after " - " is not needed to identify them).
      needles.push(...company.legal.directors.map((director) => director.split(' - ')[0]!));
    }
    for (const file of [groupFile, ownFile]) {
      const text = await pdfText(file);
      const missing = needles.filter((needle) => !textIncludes(text, needle));
      expect(missing, `${file} is stale: run npm run pdf`).toEqual([]);
      if (!flags.publishLegalIdentifiers) expect(textIncludes(text, company.legal.tin), file).toBe(false);
    }
  });
});
