import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createQrMatrix } from './InstallQrCode';
const require = createRequire(resolve('../backend/package.json'));
const qr = require('qrcode') as {
  create: (
    segments: Array<{ data: string; mode: string }>,
    options: { version: number; errorCorrectionLevel: string; maskPattern: number },
  ) => { modules: { data: Uint8Array; size: number } };
};
describe('installation QR encoder', () => {
  it.each([
    'https://erp.itembagrouptz.com/mobile-pos/join/' + 'A'.repeat(32),
    'https://itemba-pos-draft-remake-preview-very-long-branch.example.com/mobile-pos/join/' +
      'Ab2_'.repeat(8),
    'https://example.com/' + 'a'.repeat(210),
  ])('matches the canonical QR encoder for %s', (url) => {
    const expected = qr.create([{ data: url, mode: 'byte' }], {
      version: 9,
      errorCorrectionLevel: 'L',
      maskPattern: 0,
    }).modules;
    const actual = createQrMatrix(url);
    expect(actual.length).toBe(expected.size);
    expect(actual.flat().map(Number)).toEqual([...expected.data]);
  });
  it('fails clearly above capacity so the component can display the installation link', () =>
    expect(() => createQrMatrix('a'.repeat(231))).toThrow('too long'));
});
