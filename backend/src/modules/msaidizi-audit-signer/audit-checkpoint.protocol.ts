import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const AUDIT_CHECKPOINT_VERSION = 1;
export const ZERO_SHA256 = '0'.repeat(64);

export interface AuditCheckpointManifest {
  schemaVersion: 1;
  checkpointId: string;
  signerKeyId: string;
  previousCheckpointSha256: string;
  fromCursor: string;
  toCursor: string;
  previousEventHash: string;
  eventHeadHash: string;
  eventCount: number;
  canonicalSegmentSha256: string;
  issuedAt: string;
  expiresAt: string;
}

const EXACT_KEYS = [
  'canonicalSegmentSha256',
  'checkpointId',
  'eventCount',
  'eventHeadHash',
  'expiresAt',
  'fromCursor',
  'issuedAt',
  'previousCheckpointSha256',
  'previousEventHash',
  'schemaVersion',
  'signerKeyId',
  'toCursor',
] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const CURSOR = /^(0|[1-9][0-9]{0,18})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseAuditCheckpointManifest(manifestJson: string): AuditCheckpointManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestJson);
  } catch {
    throw new BadRequestException('Audit checkpoint manifest is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('Audit checkpoint manifest must be an object');
  }
  const source = raw as Record<string, unknown>;
  if (Object.keys(source).sort().join('\0') !== [...EXACT_KEYS].sort().join('\0')) {
    throw new BadRequestException('Audit checkpoint manifest has unknown or missing fields');
  }
  if (canonicalJson(source) !== manifestJson) {
    throw new BadRequestException('Audit checkpoint manifest is not canonical JSON');
  }
  if (
    source.schemaVersion !== AUDIT_CHECKPOINT_VERSION ||
    typeof source.checkpointId !== 'string' ||
    !UUID.test(source.checkpointId) ||
    typeof source.signerKeyId !== 'string' ||
    !KEY_ID.test(source.signerKeyId) ||
    typeof source.previousCheckpointSha256 !== 'string' ||
    !SHA256.test(source.previousCheckpointSha256) ||
    typeof source.fromCursor !== 'string' ||
    !CURSOR.test(source.fromCursor) ||
    source.fromCursor === '0' ||
    typeof source.toCursor !== 'string' ||
    !CURSOR.test(source.toCursor) ||
    source.toCursor === '0' ||
    typeof source.previousEventHash !== 'string' ||
    !SHA256.test(source.previousEventHash) ||
    typeof source.eventHeadHash !== 'string' ||
    !SHA256.test(source.eventHeadHash) ||
    !Number.isSafeInteger(source.eventCount) ||
    Number(source.eventCount) < 1 ||
    typeof source.canonicalSegmentSha256 !== 'string' ||
    !SHA256.test(source.canonicalSegmentSha256) ||
    typeof source.issuedAt !== 'string' ||
    !canonicalIso(source.issuedAt) ||
    typeof source.expiresAt !== 'string' ||
    !canonicalIso(source.expiresAt)
  ) {
    throw new BadRequestException('Audit checkpoint manifest has invalid canonical claims');
  }
  if (BigInt(source.toCursor) < BigInt(source.fromCursor)) {
    throw new BadRequestException('Audit checkpoint cursor range is reversed');
  }
  return source as unknown as AuditCheckpointManifest;
}

export function canonicalSegmentSha256(materials: readonly string[]): string {
  return sha256Hex(materials.join('\n'));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BadRequestException('Non-finite canonical JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') {
    throw new BadRequestException('Unsupported canonical JSON value');
  }
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(',')}}`;
}

function canonicalIso(value: string): boolean {
  if (!ISO_UTC_MILLIS.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
