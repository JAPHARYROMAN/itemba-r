import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createQrMatrix } from './InstallQrCode';
describe('installation QR encoder', () => {
  // Independent qrcode@1.5.4 vectors: byte mode, version 9, correction L, mask 0.
  // Hash all 53x53 module bytes so frontend-only CI needs no backend dependencies.
  it.each([
    [
      'https://erp.itembagrouptz.com/mobile-pos/join/' + 'A'.repeat(32),
      '5f0bef93afa182bdceb0f6738d4ee3d8ba01a397cc8714a30fcb754dbcea571e',
    ],
    [
      'https://itemba-pos-draft-remake-preview-very-long-branch.example.com/mobile-pos/join/' +
        'Ab2_'.repeat(8),
      'fcc11d60920706d171efffee4575c1f99f4efb3fb693e05ec5ba07d5c6d4e01f',
    ],
    [
      'https://example.com/' + 'a'.repeat(210),
      '0b9f77d3bd19c9a877f2682324fe50bd537967db0d0777d8569708e4d55bb9b4',
    ],
  ])('matches the canonical QR encoder reference for %s', (url, expectedHash) => {
    const actual = createQrMatrix(url);
    expect(actual.length).toBe(53);
    expect(actual.every((row) => row.length === 53)).toBe(true);
    expect(
      createHash('sha256')
        .update(Uint8Array.from(actual.flat().map(Number)))
        .digest('hex'),
    ).toBe(expectedHash);
  });
  it('fails clearly above capacity so the component can display the installation link', () =>
    expect(() => createQrMatrix('a'.repeat(231))).toThrow('too long'));
});
