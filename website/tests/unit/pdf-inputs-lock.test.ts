/**
 * PDF drift guard (architecture §5.6): the committed profile PDFs must have
 * been generated from the current print inputs. scripts/pdf-inputs.lock
 * records a SHA-256 of every file under src/content/profile/**, src/print/**
 * and src/styles/print.css, plus the SHA-256 of each PDF. Changing an input
 * without regenerating (npm run pdf) and re-locking (npm run pdf:lock) fails
 * here; so does replacing a PDF without re-locking.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PDF_INPUT_ROOTS,
  PDF_OUTPUTS,
  combinedDigest,
  computePdfInputs,
  computePdfOutputs,
  diffInputs,
  diffOutputs,
  hashTextInput,
  readPdfLock,
} from '../../scripts/lib/pdf-inputs.mjs';

const REGENERATE = 'Run `npm run pdf`, review the PDFs, then `npm run pdf:lock` and commit both.';

describe('pdf-inputs.lock', () => {
  const lock = readPdfLock();

  it('exists and covers the print inputs the architecture names', () => {
    expect(lock, 'scripts/pdf-inputs.lock is missing').not.toBeNull();
    expect(lock!.algorithm).toBe('sha256');
    expect(PDF_INPUT_ROOTS).toEqual(['src/content/profile', 'src/print', 'src/styles/print.css']);
    expect(lock!.inputs.roots).toEqual(PDF_INPUT_ROOTS);
    const files = Object.keys(lock!.inputs.files);
    expect(files).toContain('src/styles/print.css');
    expect(files).toContain('src/print/ProfileDocuments.tsx');
    expect(files.some((f) => f.startsWith('src/content/profile/'))).toBe(true);
    expect(lock!.inputs.sha256).toBe(combinedDigest(lock!.inputs.files));
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
