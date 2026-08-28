import { BadRequestException } from '@nestjs/common';
import {
  canonicalJson,
  canonicalSegmentSha256,
  parseAuditCheckpointManifest,
  sha256Hex,
  ZERO_SHA256,
} from './audit-checkpoint.protocol';

describe('audit checkpoint canonical protocol', () => {
  it('accepts only exact sorted canonical JSON and exact database material bytes', () => {
    const manifest = {
      schemaVersion: 1,
      checkpointId: '12345678-1234-4234-8234-123456789abc',
      signerKeyId: 'signer-1',
      previousCheckpointSha256: ZERO_SHA256,
      fromCursor: '1',
      toCursor: '2',
      previousEventHash: ZERO_SHA256,
      eventHeadHash: 'a'.repeat(64),
      eventCount: 2,
      canonicalSegmentSha256: canonicalSegmentSha256(['one', 'two']),
      issuedAt: '2026-08-26T10:00:00.000Z',
      expiresAt: '2026-08-26T10:05:00.000Z',
    };
    const canonical = canonicalJson(manifest);

    expect(parseAuditCheckpointManifest(canonical)).toEqual(manifest);
    expect(canonicalSegmentSha256(['one', 'two'])).toBe(sha256Hex('one\ntwo'));
    expect(() => parseAuditCheckpointManifest(JSON.stringify(manifest))).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseAuditCheckpointManifest(canonical.replace('"eventCount":2', '"eventCount":0')),
    ).toThrow(BadRequestException);
  });
});
