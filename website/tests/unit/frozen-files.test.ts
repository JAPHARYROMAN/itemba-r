/**
 * The rebuild replaces the presentation layer only. These files carry the
 * enquiry and health APIs, analytics, JSON-LD output, print scoping, the PDF
 * generator and the container build, and must stay byte-for-byte identical
 * to origin/main. The hashes in tests/frozen-files.json are SHA-256 of the
 * raw bytes: no line-ending or whitespace normalisation, so even an LF to
 * CRLF conversion counts as a change.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

type FrozenManifest = { algorithm: string; source: string; files: Record<string, string> };
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tests/frozen-files.json'), 'utf8')) as FrozenManifest;

// The frozen set is part of the rebuild contract, so it is listed here as
// well: dropping an entry from the JSON must not quietly unfreeze a file.
const FROZEN = [
  'src/app/api/enquiries/route.ts',
  'src/app/api/health/route.ts',
  'src/lib/analytics.ts',
  'src/components/Analytics.tsx',
  'src/components/ConversionTracker.tsx',
  'src/components/JsonLd.tsx',
  'src/components/CompanyProfilePrintScope.tsx',
  'scripts/generate-profile-pdfs.mjs',
  'Dockerfile',
];

const sha256 = (file: string) => createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');

describe('frozen files', () => {
  it('manifest lists exactly the frozen set with well-formed SHA-256 digests', () => {
    expect(manifest.algorithm).toBe('sha256');
    expect(Object.keys(manifest.files)).toEqual(FROZEN);
    for (const digest of Object.values(manifest.files)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(FROZEN)('%s is byte-identical to origin/main', (file) => {
    expect(sha256(file), `${file} changed; it is frozen for the rebuild`).toBe(manifest.files[file]);
  });
});
