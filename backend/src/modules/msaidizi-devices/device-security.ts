import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CapabilityDescriptorDto, CapabilityManifestSnapshotDto } from './dto/msaidizi-device.dto';
import {
  isUnavailableHostFileContentCapability,
  REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
} from './host-file-ephemerality.policy';

const RESERVED_CAPABILITY_PREFIXES = [
  'supervisor.',
  'trusted-root.',
  'bootstrap.',
  'audit-signer.',
  'recovery-vault.',
  'device-identity.',
];

const RAW_EXECUTION_CAPABILITY_PREFIXES = ['shell.', 'powershell.', 'cmd.', 'raw-command.'];
const FORBIDDEN_RAW_SENSOR_CAPABILITIES = new Set(['audio.microphone.capture']);

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

export function pairingCodeDigest(pepper: string, deviceId: string, code: string): string {
  return createHmac('sha256', pepper)
    .update(`msaidizi-device-pairing/v1\0${deviceId}\0${normalisePairingCode(code)}`, 'utf8')
    .digest('hex');
}

export function supervisorEnrollmentCodeDigest(
  pepper: string,
  enrollmentId: string,
  deviceId: string,
  role: 'UPDATE' | 'RECOVERY',
  code: string,
): string {
  return createHmac('sha256', pepper)
    .update(
      `msaidizi-supervisor-enrollment/v1\0${enrollmentId}\0${deviceId}\0${role}\0${normalisePairingCode(code)}`,
      'utf8',
    )
    .digest('hex');
}

export function leaseTokenDigest(pepper: string, leaseId: string): string {
  return createHmac('sha256', pepper)
    .update(`msaidizi-device-lease/v1\0${leaseId}`, 'utf8')
    .digest('hex');
}

export function normalisePairingCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function fixedTimeHexEquals(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value, 0));
}

export function jsonSha256(value: unknown): string {
  return sha256Hex(stableJson(value));
}

export function validateCapabilityManifest(snapshot: CapabilityManifestSnapshotDto): void {
  if (
    new Set(snapshot.capabilities.map((item) => `${item.id}\0${item.version}`)).size !==
    snapshot.capabilities.length
  ) {
    throw new BadRequestException('Capability manifest contains duplicate id/version pairs');
  }
  for (const capability of snapshot.capabilities) validateCapability(capability);
}

export function capabilityEffect(
  effect: string | number,
): 'READ' | 'WRITE' | 'EXTERNAL' | 'IRREVERSIBLE' {
  effect = wireEnumName(effect, [
    'Observe',
    'LocalRead',
    'LocalWrite',
    'ExternalWrite',
    'Financial',
    'Administrative',
    'Irreversible',
  ]);
  if (effect === 'Observe' || effect === 'LocalRead') return 'READ';
  if (effect === 'LocalWrite' || effect === 'Administrative') return 'WRITE';
  if (effect === 'ExternalWrite' || effect === 'Financial') return 'EXTERNAL';
  if (effect === 'Irreversible') return 'IRREVERSIBLE';
  throw new BadRequestException('Capability manifest contains an unsupported effect');
}

export function capabilityDataClass(value: string | number): string {
  return wireEnumName(value, [
    'Public',
    'Internal',
    'Confidential',
    'Restricted',
    'Credential',
    'Biometric',
  ]);
}

export function capabilityConsent(value: string | number): string {
  return wireEnumName(value, [
    'None',
    'ActiveUser',
    'SignedMandate',
    'OneShotApproval',
    'EmergencyOperator',
  ]);
}

export function capabilityRecovery(value: string | number): string {
  return wireEnumName(value, [
    'NotApplicable',
    'IdempotentReplay',
    'Snapshot',
    'Quarantine',
    'CompensatingAction',
    'Irreversible',
  ]);
}

export function progressState(value: string | number): string {
  return wireEnumName(value, [
    'Accepted',
    'Started',
    'Cancelling',
    'Completed',
    'Failed',
    'Cancelled',
    'NeedsAttention',
    'Rejected',
  ]);
}

export function actionOutcome(value: string | number): string {
  return wireEnumName(value, [
    'Completed',
    'Rejected',
    'Cancelled',
    'Failed',
    'NeedsAttention',
    'AlreadyRunning',
  ]);
}

export function findCapability(
  manifest: unknown,
  id: string,
  version: string,
): CapabilityDescriptorDto | null {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const capabilities = (manifest as Record<string, unknown>).capabilities;
  if (!Array.isArray(capabilities)) return null;
  const found = capabilities.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).id === id &&
      (candidate as Record<string, unknown>).version === version,
  );
  return (found as CapabilityDescriptorDto | undefined) ?? null;
}

export function pairingMarker(digest: string): string {
  return `PAIRING_DIGEST_V1:${digest}`;
}

export function parsePairingExpiry(manifest: unknown): Date | null {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const pairing = (manifest as Record<string, unknown>).pairing;
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)) return null;
  const expiresAt = (pairing as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== 'string') return null;
  const parsed = new Date(expiresAt);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validateCapability(capability: CapabilityDescriptorDto): void {
  if (isUnavailableHostFileContentCapability(capability.id)) {
    throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  }
  if (
    capability.touchesTrustedRoot ||
    RESERVED_CAPABILITY_PREFIXES.some((prefix) => capability.id.startsWith(prefix))
  ) {
    throw new BadRequestException('Trusted-root capabilities cannot be enrolled');
  }
  if (RAW_EXECUTION_CAPABILITY_PREFIXES.some((prefix) => capability.id.startsWith(prefix))) {
    throw new BadRequestException('Raw command execution capabilities are not supported');
  }
  if (FORBIDDEN_RAW_SENSOR_CAPABILITIES.has(capability.id)) {
    throw new BadRequestException(
      'Raw sensor capture capabilities cannot cross the governed device boundary',
    );
  }
  strictObjectSchema(capability.argumentsSchema, 'arguments');
  strictObjectSchema(capability.resultSchema, 'result');
}

function strictObjectSchema(schema: Record<string, unknown>, label: string): void {
  if (schema.type !== 'object' || schema.additionalProperties !== false) {
    throw new BadRequestException(
      `Capability ${label} schema must be an object with additionalProperties=false`,
    );
  }
}

function wireEnumName(value: string | number, names: readonly string[]): string {
  if (typeof value === 'string' && names.includes(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && names[value]) return names[value];
  throw new BadRequestException('Device payload contains an unsupported enum value');
}

function sortJson(value: unknown, depth: number): unknown {
  if (depth > 64) throw new BadRequestException('JSON value exceeds the maximum nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new BadRequestException('JSON value contains a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => sortJson(item, depth + 1));
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw new BadRequestException('JSON value contains undefined');
      sorted[key] = sortJson(source[key], depth + 1);
    }
    return sorted;
  }
  throw new BadRequestException(`Unsupported JSON value type: ${typeof value}`);
}
