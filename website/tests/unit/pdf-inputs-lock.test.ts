/**
 * PDF drift guard (architecture §5.6): the committed profile PDFs must have
 * been generated from the current print inputs. scripts/pdf-inputs.lock
 * records a SHA-256 of every file under src/content/profile/**, src/print/**,
 * src/styles/print.css, the font, and every src/ module the print documents
 * import (src/content/companies.ts with the legal names, TINs and directors;
 * contact, site, media, flags, types), plus the SHA-256 of each PDF.
 * Changing an input without regenerating (npm run pdf) and re-locking
 * (npm run pdf:lock) fails here; so does replacing a PDF without re-locking.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PDF_ENTRY_POINTS,
  PDF_INPUT_ROOTS,
  PDF_OUTPUTS,
  combinedDigest,
  computePdfInputs,
  computePdfOutputs,
  diffInputs,
  diffOutputs,
  hashInput,
  hashTextInput,
  importClosure,
  readPdfLock,
} from '../../scripts/lib/pdf-inputs.mjs';

const REGENERATE = 'Run `npm run pdf`, review the PDFs, then `npm run pdf:lock` and commit both.';

describe('pdf-inputs.lock', () => {
  const lock = readPdfLock();

  it('exists and covers the print inputs the architecture names', () => {
    expect(lock, 'scripts/pdf-inputs.lock is missing').not.toBeNull();
    expect(lock!.algorithm).toBe('sha256');
    expect(PDF_INPUT_ROOTS).toEqual(expect.arrayContaining(['src/content/profile', 'src/print', 'src/styles/print.css']));
    expect(PDF_ENTRY_POINTS).toEqual(['src/print/ProfileDocuments.tsx', 'src/content/profile/index.ts']);
    expect(lock!.inputs.roots).toEqual(PDF_INPUT_ROOTS);
    expect(lock!.inputs.entryPoints).toEqual(PDF_ENTRY_POINTS);
    const files = Object.keys(lock!.inputs.files);
    expect(files).toContain('src/styles/print.css');
    expect(files).toContain('src/print/ProfileDocuments.tsx');
    expect(files.some((f) => f.startsWith('src/content/profile/'))).toBe(true);
    expect(lock!.inputs.sha256).toBe(combinedDigest(lock!.inputs.files));
  });

  it('covers every src/ module the print documents import, the legal records first', () => {
    const files = Object.keys(lock!.inputs.files);
    // The companies' legal names, TINs, incorporation and directors print in all four PDFs.
    for (const input of [
      'src/content/companies.ts',
      'src/content/contact.ts',
      'src/content/site.ts',
      'src/content/media.ts',
      'src/content/media.generated.ts',
      'src/content/flags.ts',
      'src/content/types.ts',
      'src/assets/fonts/InterVariable-latin.woff2',
    ]) {
      expect(files, input).toContain(input);
    }
    for (const imported of importClosure()) expect(files, imported).toContain(imported);
  });

  it('matches the current inputs (inputs changed without regenerating the PDFs?)', () => {
    const current = computePdfInputs();
    const drift = diffInputs(lock!.inputs.files, current.files);
    expect(drift, `PDF inputs drifted from scripts/pdf-inputs.lock. ${REGENERATE}`).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
    expect(current.sha256).toBe(lock!.inputs.sha256);
  });

  it('matches the committed PDFs (a PDF replaced without re-locking?)', () => {
    const current = computePdfOutputs();
    expect(Object.keys(lock!.outputs)).toEqual(PDF_OUTPUTS);
    expect(diffOutputs(lock!.outputs, current), `PDFs differ from scripts/pdf-inputs.lock. ${REGENERATE}`).toEqual([]);
  });
});

describe('pdf-inputs helpers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-inputs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('hashes text inputs independent of CRLF line endings', () => {
    expect(hashTextInput(Buffer.from('a\r\nb\r\n'))).toBe(hashTextInput(Buffer.from('a\nb\n')));
    expect(hashTextInput(Buffer.from('a\nb\n'))).not.toBe(hashTextInput(Buffer.from('a\nc\n')));
  });

  it('hashes a binary input raw, and a text input with CRLF folded', () => {
    const font = 'src/assets/fonts/x.woff2';
    expect(hashInput(font, Buffer.from([0x77, 0x4f, 0x0d, 0x0a]))).not.toBe(hashInput(font, Buffer.from([0x77, 0x4f, 0x0a])));
    expect(hashInput('src/content/x.ts', Buffer.from('a\r\n'))).toBe(hashInput('src/content/x.ts', Buffer.from('a\n')));
  });

  it('follows the print entry points through @/ and relative imports, and stops at packages', () => {
    const closure = mkdtempSync(path.join(tmpdir(), 'pdf-closure-'));
    try {
      for (const rel of ['src/print', 'src/content/profile', 'src/islands', 'src/lib']) {
        mkdirSync(path.join(closure, rel), { recursive: true });
      }
      const files: Record<string, string> = {
        'src/print/ProfileDocuments.tsx':
          "import { contact } from '@/content/contact';\nimport Loader from '@/islands/Loader';\nimport 'server-only';\n",
        'src/content/profile/index.ts': "export * from './legal';\n",
        'src/content/profile/legal.ts': "import { getCompanyById } from '../companies';\nimport type { CompanyId } from '../types';\n",
        'src/content/companies.ts': "import { mediaImage } from './media';\n",
        'src/content/media.ts': "import { mediaGenerated } from './media.generated';\n",
        'src/content/media.generated.ts': 'export {};\n',
        'src/content/types.ts': 'export {};\n',
        'src/content/contact.ts': 'export {};\n',
        'src/content/unrelated.ts': 'export {};\n',
        'src/islands/Loader.tsx': "'use client';\nimport { useEffect } from 'react';\nimport { x } from '@/lib/print-assets';\n",
        'src/lib/print-assets.ts': 'export const x = 1;\n',
      };
      for (const [rel, code] of Object.entries(files)) writeFileSync(path.join(closure, rel), code);
      expect(importClosure(closure)).toEqual([
        'src/content/companies.ts',
        'src/content/contact.ts',
        'src/content/media.generated.ts',
        'src/content/media.ts',
        'src/content/profile/index.ts',
        'src/content/profile/legal.ts',
        'src/content/types.ts',
        'src/islands/Loader.tsx',
        'src/lib/print-assets.ts',
        'src/print/ProfileDocuments.tsx',
      ]);
    } finally {
      rmSync(closure, { recursive: true, force: true });
    }
  });

  it('detects a changed, added or removed input', () => {
    for (const rel of ['src/content/profile', 'src/print', 'src/styles']) mkdirSync(path.join(dir, rel), { recursive: true });
    writeFileSync(path.join(dir, 'src/content/profile/cover.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(dir, 'src/print/ProfileDocuments.tsx'), 'export {};\n');
    writeFileSync(path.join(dir, 'src/styles/print.css'), '@media print {}\n');
    writeFileSync(path.join(dir, 'src/styles/base.css'), 'body {}\n');
    const before = computePdfInputs(dir);
    expect(Object.keys(before.files)).toEqual([
      'src/content/profile/cover.ts',
      'src/print/ProfileDocuments.tsx',
      'src/styles/print.css',
    ]);

    writeFileSync(path.join(dir, 'src/content/profile/cover.ts'), 'export const a = 2;\n');
    writeFileSync(path.join(dir, 'src/content/profile/new.ts'), 'export {};\n');
    rmSync(path.join(dir, 'src/print/ProfileDocuments.tsx'));
    writeFileSync(path.join(dir, 'src/styles/base.css'), 'body { color: red }\n');
    const after = computePdfInputs(dir);
    expect(diffInputs(before.files, after.files)).toEqual({
      added: ['src/content/profile/new.ts'],
      removed: ['src/print/ProfileDocuments.tsx'],
      changed: ['src/content/profile/cover.ts'],
    });
    expect(after.sha256).not.toBe(before.sha256);
  });
});
