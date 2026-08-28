import { timingSafeEqual } from 'node:crypto';
import type { VerifiedProviderContractAttestation } from '../msaidizi/provider-contract-attestation.protocol';
import { sha256Hex, stableJson } from './device-security';
import {
  EPHEMERAL_FILE_DISCLOSURE_CAPABILITY,
  EPHEMERAL_FILE_DISCLOSURE_VERSION,
  REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
} from './host-file-ephemerality.policy';

export const EPHEMERAL_FILE_DISCLOSURE_PROTOCOL = 'msaidizi-ephemeral-file-disclosure/v1' as const;
export const EPHEMERAL_FILE_DISCLOSURE_NONCE_BYTES = 32;
export const EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES = 512 * 1024;
export const EPHEMERAL_FILE_DISCLOSURE_MAX_LIFETIME_MS = 120_000;

export const EPHEMERAL_FILE_DISCLOSURE_MIME_TYPES = Object.freeze([
  'application/json',
  'application/pdf',
  'text/csv',
  'text/markdown',
  'text/plain',
] as const);

export type EphemeralFileDisclosureMimeType = (typeof EPHEMERAL_FILE_DISCLOSURE_MIME_TYPES)[number];

/**
 * Signed metadata only. Raw paths and file bytes are deliberately absent.
 * Every security-relevant field is compared with an independently verified
 * expected binding. Reviewed action arguments bind rootId + relativePath and
 * are independently reduced to relativePathSha256 here.
 */
export interface EphemeralFileDisclosureGrantV1 {
  actionId: string;
  allowedMimeTypes: readonly EphemeralFileDisclosureMimeType[];
  argumentsSha256: string;
  capability: typeof EPHEMERAL_FILE_DISCLOSURE_CAPABILITY;
  capabilityVersion: typeof EPHEMERAL_FILE_DISCLOSURE_VERSION;
  deviceId: string;
  expectedFileIdentitySha256: string;
  expectedPreStateSha256: string;
  expiresAt: string;
  idempotencyKey: string;
  issuanceGeneration: number;
  mandateId: string;
  maximumBytes: number;
  nonce: string;
  planVersionId: string;
  protocol: typeof EPHEMERAL_FILE_DISCLOSURE_PROTOCOL;
  providerContractArtifactSha256: string;
  providerModelId: string;
  relativePathSha256: string;
  rootId: string;
  stepId: string;
  taskId: string;
}

export interface EphemeralFileDisclosureExpectedBinding {
  actionId: string;
  allowedMimeTypes: readonly EphemeralFileDisclosureMimeType[];
  argumentsSha256: string;
  capability: typeof EPHEMERAL_FILE_DISCLOSURE_CAPABILITY;
  capabilityVersion: typeof EPHEMERAL_FILE_DISCLOSURE_VERSION;
  deviceId: string;
  expectedFileIdentitySha256: string;
  expectedPreStateSha256: string;
  expiresAt: string;
  idempotencyKey: string;
  issuanceGeneration: number;
  mandateId: string;
  maximumBytes: number;
  nonce: string;
  planVersionId: string;
  providerContractArtifactSha256: string;
  providerModelId: string;
  relativePathSha256: string;
  rootId: string;
  stepId: string;
  taskId: string;
}

export interface EphemeralFileDisclosureReceiptV1 {
  protocol: 'msaidizi-ephemeral-file-disclosure-receipt/v1';
  actionId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  deviceId: string;
  nonceSha256: string;
  contentSha256: string;
  contentBytes: number;
  mimeType: EphemeralFileDisclosureMimeType;
  providerContractArtifactSha256: string;
  providerRequestSha256: string;
  outcome: 'DISCLOSED' | 'REJECTED' | 'UNKNOWN';
}

export class EphemeralFileDisclosureProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'EphemeralFileDisclosureProtocolError';
  }
}

export function parseAndAuthorizeEphemeralFileDisclosureGrant(
  value: unknown,
  expected: EphemeralFileDisclosureExpectedBinding,
  now = new Date(),
): Readonly<EphemeralFileDisclosureGrantV1> {
  const grant = parseGrant(value);
  assertExpectedBinding(grant, expected);
  const expiry = Date.parse(grant.expiresAt);
  if (expiry <= now.getTime()) fail('EPHEMERAL_FILE_GRANT_EXPIRED', 'grant has expired');
  if (expiry - now.getTime() > EPHEMERAL_FILE_DISCLOSURE_MAX_LIFETIME_MS) {
    fail('EPHEMERAL_FILE_GRANT_LIFETIME_INVALID', 'grant lifetime exceeds 120 seconds');
  }
  return Object.freeze({ ...grant, allowedMimeTypes: Object.freeze([...grant.allowedMimeTypes]) });
}

export function canonicalEphemeralFileDisclosureGrantJson(
  value: EphemeralFileDisclosureGrantV1,
): string {
  return stableJson(value);
}

export function ephemeralFileDisclosureGrantSha256(value: EphemeralFileDisclosureGrantV1): string {
  return sha256Hex(canonicalEphemeralFileDisclosureGrantJson(value));
}

export function assertEphemeralFileProviderContract(
  grant: EphemeralFileDisclosureGrantV1,
  verified: VerifiedProviderContractAttestation,
): void {
  const claims = verified.artifact.claims;
  if (!fixedDigest(verified.artifactSha256, grant.providerContractArtifactSha256)) {
    fail(
      'EPHEMERAL_FILE_PROVIDER_ATTESTATION_MISMATCH',
      'provider attestation does not match the signed grant',
    );
  }
  if (
    claims.zeroTraining !== true ||
    claims.providerRetentionSeconds !== 0 ||
    !claims.coveredDataClasses.includes('credentials') ||
    !claims.coveredDataClasses.includes('documents') ||
    !claims.permittedModelIds.includes(grant.providerModelId)
  ) {
    fail(
      'EPHEMERAL_FILE_PROVIDER_POLICY_DENIED',
      'provider contract lacks exact zero-training, zero-retention, data-class or model coverage',
    );
  }
}

/** Production remains closed until an atomic streaming implementation exists. */
export class RejectingEphemeralFileDisclosurePort {
  readonly capability = EPHEMERAL_FILE_DISCLOSURE_CAPABILITY;
  readonly capabilityVersion = EPHEMERAL_FILE_DISCLOSURE_VERSION;
  readonly provisioned = false;

  disclose(): never {
    throw new EphemeralFileDisclosureProtocolError(
      REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
      'no single-session device-to-provider disclosure transport is provisioned',
    );
  }
}

function parseGrant(value: unknown): EphemeralFileDisclosureGrantV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('EPHEMERAL_FILE_GRANT_INVALID', 'grant must be an object');
  }
  const source = value as Record<string, unknown>;
  const keys = [
    'actionId',
    'allowedMimeTypes',
    'argumentsSha256',
    'capability',
    'capabilityVersion',
    'deviceId',
    'expectedFileIdentitySha256',
    'expectedPreStateSha256',
    'expiresAt',
    'idempotencyKey',
    'issuanceGeneration',
    'mandateId',
    'maximumBytes',
    'nonce',
    'planVersionId',
    'protocol',
    'providerContractArtifactSha256',
    'providerModelId',
    'relativePathSha256',
    'rootId',
    'stepId',
    'taskId',
  ] as const;
  if (
    Object.keys(source).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(source, key))
  ) {
    fail('EPHEMERAL_FILE_GRANT_SHAPE_INVALID', 'grant fields do not match the v1 contract');
  }
  const allowedMimeTypes = source.allowedMimeTypes;
  if (
    !Array.isArray(allowedMimeTypes) ||
    allowedMimeTypes.length === 0 ||
    allowedMimeTypes.length > EPHEMERAL_FILE_DISCLOSURE_MIME_TYPES.length ||
    allowedMimeTypes.some(
      (mimeType) =>
        typeof mimeType !== 'string' ||
        !EPHEMERAL_FILE_DISCLOSURE_MIME_TYPES.includes(mimeType as EphemeralFileDisclosureMimeType),
    ) ||
    new Set(allowedMimeTypes).size !== allowedMimeTypes.length ||
    [...allowedMimeTypes].sort().some((mimeType, index) => mimeType !== allowedMimeTypes[index])
  ) {
    fail('EPHEMERAL_FILE_GRANT_MIME_INVALID', 'allowed MIME types must be sorted and unique');
  }
  const grant = {
    actionId: requiredUuid(source.actionId, 'actionId'),
    allowedMimeTypes: [...allowedMimeTypes] as EphemeralFileDisclosureMimeType[],
    argumentsSha256: requiredDigest(source.argumentsSha256, 'argumentsSha256'),
    capability: source.capability,
    capabilityVersion: source.capabilityVersion,
    deviceId: requiredUuid(source.deviceId, 'deviceId'),
    expectedFileIdentitySha256: requiredDigest(
      source.expectedFileIdentitySha256,
      'expectedFileIdentitySha256',
    ),
    expectedPreStateSha256: requiredDigest(source.expectedPreStateSha256, 'expectedPreStateSha256'),
    expiresAt: requiredInstant(source.expiresAt),
    idempotencyKey: requiredSafeString(source.idempotencyKey, 'idempotencyKey', 200),
    issuanceGeneration: requiredPositiveInteger(source.issuanceGeneration, 'issuanceGeneration'),
    mandateId: requiredUuid(source.mandateId, 'mandateId'),
    maximumBytes: requiredPositiveInteger(source.maximumBytes, 'maximumBytes'),
    nonce: requiredNonce(source.nonce),
    planVersionId: requiredUuid(source.planVersionId, 'planVersionId'),
    protocol: source.protocol,
    providerContractArtifactSha256: requiredDigest(
      source.providerContractArtifactSha256,
      'providerContractArtifactSha256',
    ),
    providerModelId: requiredSafeString(source.providerModelId, 'providerModelId', 200),
    relativePathSha256: requiredDigest(source.relativePathSha256, 'relativePathSha256'),
    rootId: requiredSafeString(source.rootId, 'rootId', 64),
    stepId: requiredUuid(source.stepId, 'stepId'),
    taskId: requiredUuid(source.taskId, 'taskId'),
  };
  if (grant.protocol !== EPHEMERAL_FILE_DISCLOSURE_PROTOCOL) {
    fail('EPHEMERAL_FILE_GRANT_PROTOCOL_INVALID', 'unsupported protocol');
  }
  if (
    grant.capability !== EPHEMERAL_FILE_DISCLOSURE_CAPABILITY ||
    grant.capabilityVersion !== EPHEMERAL_FILE_DISCLOSURE_VERSION
  ) {
    fail('EPHEMERAL_FILE_GRANT_CAPABILITY_INVALID', 'unsupported capability identity');
  }
  if (grant.maximumBytes > EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES) {
    fail('EPHEMERAL_FILE_GRANT_SIZE_INVALID', 'maximumBytes exceeds 512 KiB');
  }
  return grant as EphemeralFileDisclosureGrantV1;
}

function assertExpectedBinding(
  grant: EphemeralFileDisclosureGrantV1,
  expected: EphemeralFileDisclosureExpectedBinding,
): void {
  if (
    grant.allowedMimeTypes.length !== expected.allowedMimeTypes.length ||
    grant.allowedMimeTypes.some((value, index) => value !== expected.allowedMimeTypes[index])
  ) {
    fail(
      'EPHEMERAL_FILE_GRANT_BINDING_MISMATCH',
      'allowedMimeTypes does not match signed authority',
    );
  }
  for (const key of [
    'actionId',
    'argumentsSha256',
    'capability',
    'capabilityVersion',
    'deviceId',
    'expectedFileIdentitySha256',
    'expectedPreStateSha256',
    'expiresAt',
    'idempotencyKey',
    'issuanceGeneration',
    'mandateId',
    'maximumBytes',
    'nonce',
    'planVersionId',
    'providerContractArtifactSha256',
    'providerModelId',
    'relativePathSha256',
    'rootId',
    'stepId',
    'taskId',
  ] as const) {
    if (grant[key] !== expected[key]) {
      fail('EPHEMERAL_FILE_GRANT_BINDING_MISMATCH', `${key} does not match signed authority`);
    }
  }
}

function requiredUuid(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    fail('EPHEMERAL_FILE_GRANT_ID_INVALID', `${name} must be a canonical UUID`);
  }
  return value;
}

function requiredDigest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('EPHEMERAL_FILE_GRANT_DIGEST_INVALID', `${name} must be lowercase SHA-256`);
  }
  return value;
}

function requiredInstant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail('EPHEMERAL_FILE_GRANT_EXPIRY_INVALID', 'expiresAt must be a canonical UTC instant');
  }
  return value;
}

function requiredSafeString(value: unknown, name: string, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    !/^[A-Za-z0-9._:@/-]+$/.test(value)
  ) {
    fail('EPHEMERAL_FILE_GRANT_STRING_INVALID', `${name} is not canonical`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail('EPHEMERAL_FILE_GRANT_INTEGER_INVALID', `${name} must be a positive safe integer`);
  }
  return value as number;
}

function requiredNonce(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    fail('EPHEMERAL_FILE_GRANT_NONCE_INVALID', 'nonce must be canonical Base64url');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== EPHEMERAL_FILE_DISCLOSURE_NONCE_BYTES ||
    decoded.toString('base64url') !== value
  ) {
    decoded.fill(0);
    fail('EPHEMERAL_FILE_GRANT_NONCE_INVALID', 'nonce must encode exactly 32 bytes');
  }
  decoded.fill(0);
  return value;
}

function fixedDigest(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function fail(code: string, message: string): never {
  throw new EphemeralFileDisclosureProtocolError(code, message);
}
