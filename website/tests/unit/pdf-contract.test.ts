/**
 * The four downloadable company profiles under public/downloads/ must stay
 * present and recognisably the same documents: 200 KB to 8 MB each, page
 * counts within ±30% of the origin/main baseline, and every key string from
 * tests/baseline/pdfs.json still extractable. Regenerating the PDFs (npm run
 * pdf) is expected to keep this green.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
  });
});
