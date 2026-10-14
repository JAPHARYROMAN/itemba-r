/**
 * The four downloadable company profiles under public/downloads/ must stay
 * present and recognisably the same documents: 200 KB to 8 MB each, page
 * counts within ±30% of the origin/main baseline, and retained key strings
 * from tests/baseline/pdfs.json still extractable. Unverified dates and legal
 * identifiers are intentionally removed and must be absent after regeneration.
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

/** Exact omissions authorised by the verify-or-omit policy, not a new baseline. */
const unpublishedIdentifiers = new Set(
  companies.flatMap((company) => [
    company.legal.tin,
    company.legal.incorporationNumber,
    company.legal.incorporationDate,
  ]),
);

function retainedKey(key: string): string | null {
  if (key === 'EST. 2012') return null;
  if (!flags.publishLegalIdentifiers && unpublishedIdentifiers.has(key)) return null;
  if (key === 'INDEPENDENT LEGAL COMPANIES') return 'Operating Companies';
  if (!flags.publishLegalIdentifiers && key === 'Mwanjalisi Oil Company Ltd') return 'Mwanjalisi Oil Co Ltd';
  const company = companies.find((entry) => entry.legalName === key);
  return company && !flags.publishLegalIdentifiers ? company.name : key;
}

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
    const required = Object.keys(facts.keyStrings).map(retainedKey).filter((key): key is string => key !== null);
    const missing = required.filter((key) => !textIncludes(text, key));
    expect(missing).toEqual([]);
    expect(textIncludes(text, 'EST. 2012'), `${file} retains an unverified founding year`).toBe(false);
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
    const needles = [flags.publishLegalIdentifiers ? company.legalName : company.name];
    if (flags.publishLegalIdentifiers) {
      needles.push(company.legal.tin, company.legal.incorporationNumber, company.legal.incorporationDate);
      // Directors by name (the role after " - " is not needed to identify them).
      needles.push(...company.legal.directors.map((director) => director.split(' - ')[0]!));
    }
    for (const file of [groupFile, ownFile]) {
      const text = await pdfText(file);
      const missing = needles.filter((needle) => !textIncludes(text, needle));
      expect(missing, `${file} is stale: run npm run pdf`).toEqual([]);
      if (!flags.publishLegalIdentifiers) {
        for (const omitted of [company.legal.tin, company.legal.incorporationNumber, company.legal.incorporationDate]) {
          expect(textIncludes(text, omitted), `${file} contains an unverified identifier`).toBe(false);
        }
        for (const director of company.legal.directors) {
          expect(textIncludes(text, director.split(' - ')[0]!), `${file} contains an unverified director`).toBe(false);
        }
      }
    }
  });
});
