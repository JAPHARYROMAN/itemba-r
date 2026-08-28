import { createHash } from 'node:crypto';

export const EGRESS_RECEIPT_CONTRACT_VERSION = 4 as const;

export const BOUNDARY_ATTESTATION_DOMAIN = 'MSAIDIZI-EGRESS-BOUNDARY-ATTESTATION-V4' as const;
export const EGRESS_AUTHORIZATION_LEASE_DOMAIN = 'MSAIDIZI-EGRESS-AUTHORIZATION-LEASE-V4' as const;
export const EGRESS_RECEIPT_DOMAIN = 'MSAIDIZI-EGRESS-RECEIPT-V4' as const;
export const EGRESS_EVIDENCE_BUNDLE_DOMAIN = 'MSAIDIZI-EGRESS-EVIDENCE-BUNDLE-V4' as const;
export const ZERO_SHA256 = '0'.repeat(64);

export const BOUNDARY_FEATURES = [
  'browser-completion-attested',
  'browser-origin-attested',
  'network-egress-enforced',
  'process-tree-attributed',
  'signed-egress-receipts',
] as const;

export const REQUIRED_BOUNDARY_FEATURES = [
  'network-egress-enforced',
  'process-tree-attributed',
  'signed-egress-receipts',
] as const;

export type BoundaryFeature = (typeof BOUNDARY_FEATURES)[number];
export type EgressReceiptOutcome = 'completed' | 'cancelled' | 'failed' | 'unknown';

export interface BoundaryAttestationClaims {
  contractVersion: 4;
  attestationId: string;
  deviceId: string;
  supervisorInstanceId: string;
  bootId: string;
  issuedAtUnixMilliseconds: number;
  expiresAtUnixMilliseconds: number;
  secureBootEnabled: boolean;
  hvciEnabled: boolean;
  driverActive: boolean;
  serviceActive: boolean;
  driverMeasurementSha256: string;
  serviceMeasurementSha256: string;
  browserBrokerBuildSha256: string | null;
  receiptKeyId: string;
  receiptPublicKeySpkiBase64: string;
  receiptPublicKeySha256: string;
  features: BoundaryFeature[];
}

export interface SignedBoundaryAttestation extends BoundaryAttestationClaims {
  /** Independently enrolled boundary-supervisor key authorizing the embedded receipt key. */
  keyId: string;
  /** Canonical standard Base64 containing a 64-byte IEEE-P1363 ES256 signature. */
  signatureBase64: string;
}

export interface EgressAuthorizationLeaseClaims {
  contractVersion: 4;
  leaseId: string;
  attestationSha256: string;
  actionTokenSha256: string;
  actionId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  deviceId: string;
  mandateId: string;
  capabilityId: string;
  capabilityVersion: string;
  dispatchCount: number;
  destinationPolicySha256: string;
  executionIdentitySha256: string;
  argumentsSha256: string;
  expectedPreStateSha256: string | null;
  idempotencyKeySha256: string;
  destinationScopeSha256: string;
  requestBodySha256: string;
  exactRequestPolicySha256: string;
  reservationDnsAnswerSetSha256: string;
  reservedCapabilityEgressBytes: number;
  issuedAtUnixMilliseconds: number;
  expiresAtUnixMilliseconds: number;
}

export interface SignedEgressAuthorizationLease extends EgressAuthorizationLeaseClaims {
  keyId: string;
  signatureBase64: string;
}

export interface EgressReceiptClaims {
  contractVersion: 4;
  receiptId: string;
  leaseSha256: string;
  attestationSha256: string;
  actionTokenSha256: string;
  actionId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  deviceId: string;
  mandateId: string;
  capabilityId: string;
  capabilityVersion: string;
  dispatchCount: number;
  destinationPolicySha256: string;
  executionIdentitySha256: string;
  argumentsSha256: string;
  expectedPreStateSha256: string | null;
  idempotencyKeySha256: string;
  destinationScopeSha256: string;
  requestBodySha256: string;
  exactRequestPolicySha256: string;
  reservationDnsAnswerSetSha256: string;
  connectionDnsAnswerSetSha256: string;
  selectedAddressSha256: string;
  registrationSha256: string;
  dispositionSha256: string;
  reservedCapabilityEgressBytes: number;
  measuredExternalEgressBytes: number;
  uncertainExternalEgressBytes: number;
  chargedExternalEgressBytes: number;
  startedAtUnixMilliseconds: number;
  endedAtUnixMilliseconds: number;
  sequence: number;
  flowLogSha256: string;
  outcome: EgressReceiptOutcome;
}

export interface SignedEgressReceipt extends EgressReceiptClaims {
  keyId: string;
  signatureBase64: string;
}

export interface EgressReceiptProof {
  actionTokenSha256: string;
  authorization: {
    attestation: SignedBoundaryAttestation;
    lease: SignedEgressAuthorizationLease;
  };
  receipt: SignedEgressReceipt;
}

/** Nested envelope emitted by the Windows companion on ActionResult. */
export interface WireEgressReceiptEvidence {
  authorization: {
    attestation: {
      attestation: BoundaryAttestationClaims;
      keyId: string;
      signatureBase64: string;
    };
    lease: {
      lease: EgressAuthorizationLeaseClaims;
      keyId: string;
      signatureBase64: string;
    };
  };
  receipt: {
    receipt: EgressReceiptClaims;
    keyId: string;
    signatureBase64: string;
  };
}

const BOUNDARY_CLAIM_KEYS = [
  'contractVersion',
  'attestationId',
  'deviceId',
  'supervisorInstanceId',
  'bootId',
  'issuedAtUnixMilliseconds',
  'expiresAtUnixMilliseconds',
  'secureBootEnabled',
  'hvciEnabled',
  'driverActive',
  'serviceActive',
  'driverMeasurementSha256',
  'serviceMeasurementSha256',
  'browserBrokerBuildSha256',
  'receiptKeyId',
  'receiptPublicKeySpkiBase64',
  'receiptPublicKeySha256',
  'features',
] as const;

const LEASE_CLAIM_KEYS = [
  'contractVersion',
  'leaseId',
  'attestationSha256',
  'actionTokenSha256',
  'actionId',
  'taskId',
  'planVersionId',
  'stepId',
  'deviceId',
  'mandateId',
  'capabilityId',
  'capabilityVersion',
  'dispatchCount',
  'destinationPolicySha256',
  'executionIdentitySha256',
  'argumentsSha256',
  'expectedPreStateSha256',
  'idempotencyKeySha256',
  'destinationScopeSha256',
  'requestBodySha256',
  'exactRequestPolicySha256',
  'reservationDnsAnswerSetSha256',
  'reservedCapabilityEgressBytes',
  'issuedAtUnixMilliseconds',
  'expiresAtUnixMilliseconds',
] as const;

const RECEIPT_CLAIM_KEYS = [
  'contractVersion',
  'receiptId',
  'leaseSha256',
  'attestationSha256',
  'actionTokenSha256',
  'actionId',
  'taskId',
  'planVersionId',
  'stepId',
  'deviceId',
  'mandateId',
  'capabilityId',
  'capabilityVersion',
  'dispatchCount',
  'destinationPolicySha256',
  'executionIdentitySha256',
  'argumentsSha256',
  'expectedPreStateSha256',
  'idempotencyKeySha256',
  'destinationScopeSha256',
  'requestBodySha256',
  'exactRequestPolicySha256',
  'reservationDnsAnswerSetSha256',
  'connectionDnsAnswerSetSha256',
  'selectedAddressSha256',
  'registrationSha256',
  'dispositionSha256',
  'reservedCapabilityEgressBytes',
  'measuredExternalEgressBytes',
  'uncertainExternalEgressBytes',
  'chargedExternalEgressBytes',
  'startedAtUnixMilliseconds',
  'endedAtUnixMilliseconds',
  'sequence',
  'flowLogSha256',
  'outcome',
] as const;

const SIGNED_ENVELOPE_KEYS = ['keyId', 'signatureBase64'] as const;
const UUID_D = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const CAPABILITY_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export class EgressReceiptProtocolError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'EgressReceiptProtocolError';
  }
}

export function parseSignedBoundaryAttestation(value: unknown): SignedBoundaryAttestation {
  const source = exactRecord(
    value,
    [...BOUNDARY_CLAIM_KEYS, ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_BOUNDARY_ATTESTATION_SCHEMA_INVALID',
  );
  const claims = validateBoundaryAttestationClaims(project(source, BOUNDARY_CLAIM_KEYS));
  return {
    ...claims,
    keyId: keyId(source.keyId, 'EGRESS_BOUNDARY_ATTESTATION_KEY_ID_INVALID'),
    signatureBase64: signatureBase64(source.signatureBase64),
  };
}

export function parseSignedEgressAuthorizationLease(
  value: unknown,
): SignedEgressAuthorizationLease {
  const source = exactRecord(
    value,
    [...LEASE_CLAIM_KEYS, ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_AUTHORIZATION_LEASE_SCHEMA_INVALID',
  );
  const claims = validateEgressAuthorizationLeaseClaims(project(source, LEASE_CLAIM_KEYS));
  return {
    ...claims,
    keyId: keyId(source.keyId, 'EGRESS_AUTHORIZATION_LEASE_KEY_ID_INVALID'),
    signatureBase64: signatureBase64(source.signatureBase64),
  };
}

export function parseSignedEgressReceipt(value: unknown): SignedEgressReceipt {
  const source = exactRecord(
    value,
    [...RECEIPT_CLAIM_KEYS, ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_RECEIPT_SCHEMA_INVALID',
  );
  const claims = validateEgressReceiptClaims(project(source, RECEIPT_CLAIM_KEYS));
  return {
    ...claims,
    keyId: keyId(source.keyId, 'EGRESS_RECEIPT_KEY_ID_INVALID'),
    signatureBase64: signatureBase64(source.signatureBase64),
  };
}

export function parseEgressReceiptProof(value: unknown): EgressReceiptProof {
  const source = exactRecord(
    value,
    ['actionTokenSha256', 'authorization', 'receipt'],
    'EGRESS_RECEIPT_PROOF_SCHEMA_INVALID',
  );
  const authorization = exactRecord(
    source.authorization,
    ['attestation', 'lease'],
    'EGRESS_AUTHORIZATION_SCHEMA_INVALID',
  );
  return {
    actionTokenSha256: sha256(source.actionTokenSha256, 'EGRESS_ACTION_TOKEN_DIGEST_INVALID'),
    authorization: {
      attestation: parseSignedBoundaryAttestation(authorization.attestation),
      lease: parseSignedEgressAuthorizationLease(authorization.lease),
    },
    receipt: parseSignedEgressReceipt(source.receipt),
  };
}

/**
 * Strictly adapts the nested C# ActionResult wire envelope to the flat proof
 * consumed by verification. `actionTokenSha256` is the sibling top-level
 * ActionResult field; every egress-evidence wrapper and claim object is exact.
 */
export function parseWireEgressReceiptProof(
  actionTokenSha256: unknown,
  value: unknown,
): EgressReceiptProof {
  const evidence = exactRecord(
    value,
    ['authorization', 'receipt'],
    'EGRESS_WIRE_EVIDENCE_SCHEMA_INVALID',
  );
  const authorization = exactRecord(
    evidence.authorization,
    ['attestation', 'lease'],
    'EGRESS_WIRE_AUTHORIZATION_SCHEMA_INVALID',
  );
  const attestationEnvelope = exactRecord(
    authorization.attestation,
    ['attestation', ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_WIRE_ATTESTATION_ENVELOPE_INVALID',
  );
  const leaseEnvelope = exactRecord(
    authorization.lease,
    ['lease', ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_WIRE_LEASE_ENVELOPE_INVALID',
  );
  const receiptEnvelope = exactRecord(
    evidence.receipt,
    ['receipt', ...SIGNED_ENVELOPE_KEYS],
    'EGRESS_WIRE_RECEIPT_ENVELOPE_INVALID',
  );

  return parseEgressReceiptProof({
    actionTokenSha256,
    authorization: {
      attestation: {
        ...exactRecord(
          attestationEnvelope.attestation,
          BOUNDARY_CLAIM_KEYS,
          'EGRESS_WIRE_ATTESTATION_CLAIMS_INVALID',
        ),
        keyId: attestationEnvelope.keyId,
        signatureBase64: attestationEnvelope.signatureBase64,
      },
      lease: {
        ...exactRecord(leaseEnvelope.lease, LEASE_CLAIM_KEYS, 'EGRESS_WIRE_LEASE_CLAIMS_INVALID'),
        keyId: leaseEnvelope.keyId,
        signatureBase64: leaseEnvelope.signatureBase64,
      },
    },
    receipt: {
      ...exactRecord(
        receiptEnvelope.receipt,
        RECEIPT_CLAIM_KEYS,
        'EGRESS_WIRE_RECEIPT_CLAIMS_INVALID',
      ),
      keyId: receiptEnvelope.keyId,
      signatureBase64: receiptEnvelope.signatureBase64,
    },
  });
}

export function boundaryAttestationClaims(
  value: SignedBoundaryAttestation,
): BoundaryAttestationClaims {
  return validateBoundaryAttestationClaims(
    project(value as unknown as Record<string, unknown>, BOUNDARY_CLAIM_KEYS),
  );
}

export function egressAuthorizationLeaseClaims(
  value: SignedEgressAuthorizationLease,
): EgressAuthorizationLeaseClaims {
  return validateEgressAuthorizationLeaseClaims(
    project(value as unknown as Record<string, unknown>, LEASE_CLAIM_KEYS),
  );
}

export function egressReceiptClaims(value: SignedEgressReceipt): EgressReceiptClaims {
  return validateEgressReceiptClaims(
    project(value as unknown as Record<string, unknown>, RECEIPT_CLAIM_KEYS),
  );
}

/**
 * Cross-language canonical bytes. The first line is a versioned domain; each
 * following line is the next field in the fixed v4 order above. Strings are
 * unpadded Base64Url(UTF-8), integers are invariant decimal, nullable strings
 * use an empty line, and sorted features occupy one line each. There is no
 * trailing newline.
 */
export function canonicalBoundaryAttestationBytes(value: BoundaryAttestationClaims): Buffer {
  const claims = validateBoundaryAttestationClaims(value);
  return canonicalFrame(BOUNDARY_ATTESTATION_DOMAIN, [
    integerLine(claims.contractVersion),
    stringLine(claims.attestationId),
    stringLine(claims.deviceId),
    stringLine(claims.supervisorInstanceId),
    stringLine(claims.bootId),
    integerLine(claims.issuedAtUnixMilliseconds),
    integerLine(claims.expiresAtUnixMilliseconds),
    booleanLine(claims.secureBootEnabled),
    booleanLine(claims.hvciEnabled),
    booleanLine(claims.driverActive),
    booleanLine(claims.serviceActive),
    stringLine(claims.driverMeasurementSha256),
    stringLine(claims.serviceMeasurementSha256),
    nullableStringLine(claims.browserBrokerBuildSha256),
    stringLine(claims.receiptKeyId),
    stringLine(claims.receiptPublicKeySpkiBase64),
    stringLine(claims.receiptPublicKeySha256),
    ...claims.features.map(stringLine),
  ]);
}

export function canonicalEgressAuthorizationLeaseBytes(
  value: EgressAuthorizationLeaseClaims,
): Buffer {
  const claims = validateEgressAuthorizationLeaseClaims(value);
  return canonicalFrame(EGRESS_AUTHORIZATION_LEASE_DOMAIN, [
    integerLine(claims.contractVersion),
    stringLine(claims.leaseId),
    stringLine(claims.attestationSha256),
    stringLine(claims.actionTokenSha256),
    stringLine(claims.actionId),
    stringLine(claims.taskId),
    stringLine(claims.planVersionId),
    stringLine(claims.stepId),
    stringLine(claims.deviceId),
    stringLine(claims.mandateId),
    stringLine(claims.capabilityId),
    stringLine(claims.capabilityVersion),
    integerLine(claims.dispatchCount),
    stringLine(claims.destinationPolicySha256),
    stringLine(claims.executionIdentitySha256),
    stringLine(claims.argumentsSha256),
    nullableStringLine(claims.expectedPreStateSha256),
    stringLine(claims.idempotencyKeySha256),
    stringLine(claims.destinationScopeSha256),
    stringLine(claims.requestBodySha256),
    stringLine(claims.exactRequestPolicySha256),
    stringLine(claims.reservationDnsAnswerSetSha256),
    integerLine(claims.reservedCapabilityEgressBytes),
    integerLine(claims.issuedAtUnixMilliseconds),
    integerLine(claims.expiresAtUnixMilliseconds),
  ]);
}

export function canonicalEgressReceiptBytes(value: EgressReceiptClaims): Buffer {
  const claims = validateEgressReceiptClaims(value);
  return canonicalFrame(EGRESS_RECEIPT_DOMAIN, [
    integerLine(claims.contractVersion),
    stringLine(claims.receiptId),
    stringLine(claims.leaseSha256),
    stringLine(claims.attestationSha256),
    stringLine(claims.actionTokenSha256),
    stringLine(claims.actionId),
    stringLine(claims.taskId),
    stringLine(claims.planVersionId),
    stringLine(claims.stepId),
    stringLine(claims.deviceId),
    stringLine(claims.mandateId),
    stringLine(claims.capabilityId),
    stringLine(claims.capabilityVersion),
    integerLine(claims.dispatchCount),
    stringLine(claims.destinationPolicySha256),
    stringLine(claims.executionIdentitySha256),
    stringLine(claims.argumentsSha256),
    nullableStringLine(claims.expectedPreStateSha256),
    stringLine(claims.idempotencyKeySha256),
    stringLine(claims.destinationScopeSha256),
    stringLine(claims.requestBodySha256),
    stringLine(claims.exactRequestPolicySha256),
    stringLine(claims.reservationDnsAnswerSetSha256),
    stringLine(claims.connectionDnsAnswerSetSha256),
    stringLine(claims.selectedAddressSha256),
    stringLine(claims.registrationSha256),
    stringLine(claims.dispositionSha256),
    integerLine(claims.reservedCapabilityEgressBytes),
    integerLine(claims.measuredExternalEgressBytes),
    integerLine(claims.uncertainExternalEgressBytes),
    integerLine(claims.chargedExternalEgressBytes),
    integerLine(claims.startedAtUnixMilliseconds),
    integerLine(claims.endedAtUnixMilliseconds),
    integerLine(claims.sequence),
    stringLine(claims.flowLogSha256),
    stringLine(claims.outcome),
  ]);
}

/**
 * Canonical whole-proof bytes for journals and result receipts. The fixed v4
 * order is: top-level action-token digest, then the claims digest, envelope
 * key id, and exact signature for attestation, lease, and receipt. As with the
 * claim frames, every string is unpadded Base64Url(UTF-8) and there is no
 * trailing newline.
 */
export function canonicalEgressEvidenceBytes(value: EgressReceiptProof): Buffer {
  const proof = parseEgressReceiptProof(value);
  const { attestation, lease } = proof.authorization;
  const receipt = proof.receipt;

  return canonicalFrame(EGRESS_EVIDENCE_BUNDLE_DOMAIN, [
    stringLine(proof.actionTokenSha256),
    stringLine(boundaryAttestationSha256(boundaryAttestationClaims(attestation))),
    stringLine(attestation.keyId),
    stringLine(attestation.signatureBase64),
    stringLine(egressAuthorizationLeaseSha256(egressAuthorizationLeaseClaims(lease))),
    stringLine(lease.keyId),
    stringLine(lease.signatureBase64),
    stringLine(egressReceiptSha256(egressReceiptClaims(receipt))),
    stringLine(receipt.keyId),
    stringLine(receipt.signatureBase64),
  ]);
}

export function egressCanonicalSha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function boundaryAttestationSha256(value: BoundaryAttestationClaims): string {
  return egressCanonicalSha256(canonicalBoundaryAttestationBytes(value));
}

export function egressAuthorizationLeaseSha256(value: EgressAuthorizationLeaseClaims): string {
  return egressCanonicalSha256(canonicalEgressAuthorizationLeaseBytes(value));
}

export function egressReceiptSha256(value: EgressReceiptClaims): string {
  return egressCanonicalSha256(canonicalEgressReceiptBytes(value));
}

export function egressEvidenceSha256(value: EgressReceiptProof): string {
  return egressCanonicalSha256(canonicalEgressEvidenceBytes(value));
}

function validateBoundaryAttestationClaims(value: unknown): BoundaryAttestationClaims {
  const source = exactRecord(
    value,
    BOUNDARY_CLAIM_KEYS,
    'EGRESS_BOUNDARY_ATTESTATION_CLAIMS_INVALID',
  );
  const features = boundaryFeatures(source.features);
  const browserEnabled =
    features.includes('browser-origin-attested') &&
    features.includes('browser-completion-attested');
  const browserBrokerBuildSha256 =
    source.browserBrokerBuildSha256 === null
      ? null
      : sha256(source.browserBrokerBuildSha256, 'EGRESS_BROWSER_BROKER_BUILD_DIGEST_INVALID');
  if (browserEnabled !== (browserBrokerBuildSha256 !== null)) {
    throw protocolError('EGRESS_BROWSER_ATTESTATION_INCONSISTENT');
  }
  const issuedAtUnixMilliseconds = integer(
    source.issuedAtUnixMilliseconds,
    0,
    'EGRESS_BOUNDARY_ATTESTATION_ISSUED_AT_INVALID',
  );
  const expiresAtUnixMilliseconds = integer(
    source.expiresAtUnixMilliseconds,
    0,
    'EGRESS_BOUNDARY_ATTESTATION_EXPIRES_AT_INVALID',
  );
  if (expiresAtUnixMilliseconds <= issuedAtUnixMilliseconds) {
    throw protocolError('EGRESS_BOUNDARY_ATTESTATION_WINDOW_INVALID');
  }
  return {
    contractVersion: version(source.contractVersion),
    attestationId: uuid(source.attestationId, 'EGRESS_ATTESTATION_ID_INVALID'),
    deviceId: uuid(source.deviceId, 'EGRESS_DEVICE_ID_INVALID'),
    supervisorInstanceId: uuid(
      source.supervisorInstanceId,
      'EGRESS_SUPERVISOR_INSTANCE_ID_INVALID',
    ),
    bootId: uuid(source.bootId, 'EGRESS_BOOT_ID_INVALID'),
    issuedAtUnixMilliseconds,
    expiresAtUnixMilliseconds,
    secureBootEnabled: booleanValue(source.secureBootEnabled, 'EGRESS_SECURE_BOOT_STATE_INVALID'),
    hvciEnabled: booleanValue(source.hvciEnabled, 'EGRESS_HVCI_STATE_INVALID'),
    driverActive: booleanValue(source.driverActive, 'EGRESS_DRIVER_STATE_INVALID'),
    serviceActive: booleanValue(source.serviceActive, 'EGRESS_SERVICE_STATE_INVALID'),
    driverMeasurementSha256: sha256(
      source.driverMeasurementSha256,
      'EGRESS_DRIVER_MEASUREMENT_DIGEST_INVALID',
    ),
    serviceMeasurementSha256: sha256(
      source.serviceMeasurementSha256,
      'EGRESS_SERVICE_MEASUREMENT_DIGEST_INVALID',
    ),
    browserBrokerBuildSha256,
    receiptKeyId: keyId(source.receiptKeyId, 'EGRESS_RECEIPT_KEY_ID_INVALID'),
    receiptPublicKeySpkiBase64: canonicalBase64(
      source.receiptPublicKeySpkiBase64,
      1,
      4_096,
      'EGRESS_RECEIPT_PUBLIC_KEY_INVALID',
    ),
    receiptPublicKeySha256: sha256(
      source.receiptPublicKeySha256,
      'EGRESS_RECEIPT_PUBLIC_KEY_DIGEST_INVALID',
    ),
    features,
  };
}

function validateEgressAuthorizationLeaseClaims(value: unknown): EgressAuthorizationLeaseClaims {
  const source = exactRecord(value, LEASE_CLAIM_KEYS, 'EGRESS_AUTHORIZATION_LEASE_CLAIMS_INVALID');
  const issuedAtUnixMilliseconds = integer(
    source.issuedAtUnixMilliseconds,
    0,
    'EGRESS_AUTHORIZATION_LEASE_ISSUED_AT_INVALID',
  );
  const expiresAtUnixMilliseconds = integer(
    source.expiresAtUnixMilliseconds,
    0,
    'EGRESS_AUTHORIZATION_LEASE_EXPIRES_AT_INVALID',
  );
  if (expiresAtUnixMilliseconds <= issuedAtUnixMilliseconds) {
    throw protocolError('EGRESS_AUTHORIZATION_LEASE_WINDOW_INVALID');
  }
  return {
    contractVersion: version(source.contractVersion),
    leaseId: uuid(source.leaseId, 'EGRESS_LEASE_ID_INVALID'),
    attestationSha256: sha256(source.attestationSha256, 'EGRESS_ATTESTATION_DIGEST_INVALID'),
    actionTokenSha256: sha256(source.actionTokenSha256, 'EGRESS_ACTION_TOKEN_DIGEST_INVALID'),
    actionId: uuid(source.actionId, 'EGRESS_ACTION_ID_INVALID'),
    taskId: uuid(source.taskId, 'EGRESS_TASK_ID_INVALID'),
    planVersionId: uuid(source.planVersionId, 'EGRESS_PLAN_VERSION_ID_INVALID'),
    stepId: uuid(source.stepId, 'EGRESS_STEP_ID_INVALID'),
    deviceId: uuid(source.deviceId, 'EGRESS_DEVICE_ID_INVALID'),
    mandateId: uuid(source.mandateId, 'EGRESS_MANDATE_ID_INVALID'),
    capabilityId: patternText(source.capabilityId, CAPABILITY_ID, 'EGRESS_CAPABILITY_ID_INVALID'),
    capabilityVersion: patternText(
      source.capabilityVersion,
      CAPABILITY_VERSION,
      'EGRESS_CAPABILITY_VERSION_INVALID',
    ),
    dispatchCount: integer(source.dispatchCount, 1, 'EGRESS_DISPATCH_COUNT_INVALID'),
    destinationPolicySha256: sha256(
      source.destinationPolicySha256,
      'EGRESS_DESTINATION_POLICY_DIGEST_INVALID',
    ),
    executionIdentitySha256: sha256(
      source.executionIdentitySha256,
      'EGRESS_EXECUTION_IDENTITY_DIGEST_INVALID',
    ),
    argumentsSha256: sha256(source.argumentsSha256, 'EGRESS_ARGUMENTS_DIGEST_INVALID'),
    expectedPreStateSha256: nullableSha256(
      source.expectedPreStateSha256,
      'EGRESS_EXPECTED_PRE_STATE_DIGEST_INVALID',
    ),
    idempotencyKeySha256: sha256(
      source.idempotencyKeySha256,
      'EGRESS_IDEMPOTENCY_KEY_DIGEST_INVALID',
    ),
    destinationScopeSha256: sha256(
      source.destinationScopeSha256,
      'EGRESS_DESTINATION_SCOPE_DIGEST_INVALID',
    ),
    requestBodySha256: sha256(source.requestBodySha256, 'EGRESS_REQUEST_BODY_DIGEST_INVALID'),
    exactRequestPolicySha256: sha256(
      source.exactRequestPolicySha256,
      'EGRESS_EXACT_REQUEST_POLICY_DIGEST_INVALID',
    ),
    reservationDnsAnswerSetSha256: nonZeroSha256(
      source.reservationDnsAnswerSetSha256,
      'EGRESS_RESERVATION_DNS_ANSWER_SET_DIGEST_INVALID',
    ),
    reservedCapabilityEgressBytes: integer(
      source.reservedCapabilityEgressBytes,
      0,
      'EGRESS_RESERVED_BYTES_INVALID',
    ),
    issuedAtUnixMilliseconds,
    expiresAtUnixMilliseconds,
  };
}

function validateEgressReceiptClaims(value: unknown): EgressReceiptClaims {
  const source = exactRecord(value, RECEIPT_CLAIM_KEYS, 'EGRESS_RECEIPT_CLAIMS_INVALID');
  const reservedCapabilityEgressBytes = integer(
    source.reservedCapabilityEgressBytes,
    0,
    'EGRESS_RESERVED_BYTES_INVALID',
  );
  const measuredExternalEgressBytes = integer(
    source.measuredExternalEgressBytes,
    0,
    'EGRESS_MEASURED_BYTES_INVALID',
  );
  const uncertainExternalEgressBytes = integer(
    source.uncertainExternalEgressBytes,
    0,
    'EGRESS_UNCERTAIN_BYTES_INVALID',
  );
  const chargedExternalEgressBytes = integer(
    source.chargedExternalEgressBytes,
    0,
    'EGRESS_CHARGED_BYTES_INVALID',
  );
  const expectedCharge = measuredExternalEgressBytes + uncertainExternalEgressBytes;
  if (
    !Number.isSafeInteger(expectedCharge) ||
    chargedExternalEgressBytes !== expectedCharge ||
    chargedExternalEgressBytes > reservedCapabilityEgressBytes
  ) {
    throw protocolError('EGRESS_CHARGE_INVARIANT_INVALID');
  }
  const startedAtUnixMilliseconds = integer(
    source.startedAtUnixMilliseconds,
    0,
    'EGRESS_RECEIPT_STARTED_AT_INVALID',
  );
  const endedAtUnixMilliseconds = integer(
    source.endedAtUnixMilliseconds,
    0,
    'EGRESS_RECEIPT_ENDED_AT_INVALID',
  );
  if (endedAtUnixMilliseconds < startedAtUnixMilliseconds) {
    throw protocolError('EGRESS_RECEIPT_WINDOW_INVALID');
  }
  const outcome = source.outcome;
  if (
    typeof outcome !== 'string' ||
    !(['completed', 'cancelled', 'failed', 'unknown'] as const).includes(
      outcome as EgressReceiptOutcome,
    )
  ) {
    throw protocolError('EGRESS_RECEIPT_OUTCOME_INVALID');
  }
  if (outcome === 'unknown' && chargedExternalEgressBytes !== reservedCapabilityEgressBytes) {
    throw protocolError('EGRESS_UNKNOWN_CHARGE_INVARIANT_INVALID');
  }
  const reservationDnsAnswerSetSha256 = nonZeroSha256(
    source.reservationDnsAnswerSetSha256,
    'EGRESS_RESERVATION_DNS_ANSWER_SET_DIGEST_INVALID',
  );
  const connectionDnsAnswerSetSha256 = sha256(
    source.connectionDnsAnswerSetSha256,
    'EGRESS_CONNECTION_DNS_ANSWER_SET_DIGEST_INVALID',
  );
  const selectedAddressSha256 = sha256(
    source.selectedAddressSha256,
    'EGRESS_SELECTED_ADDRESS_DIGEST_INVALID',
  );
  const connectionMissing = connectionDnsAnswerSetSha256 === ZERO_SHA256;
  const selectedMissing = selectedAddressSha256 === ZERO_SHA256;
  if (
    (connectionMissing || selectedMissing) &&
    !(connectionMissing && selectedMissing && outcome === 'unknown')
  ) {
    throw protocolError('EGRESS_ROUTE_ATTESTATION_MISSING');
  }
  if (!connectionMissing && connectionDnsAnswerSetSha256 !== reservationDnsAnswerSetSha256) {
    throw protocolError('EGRESS_DNS_ANSWER_SET_CONTAINMENT_INVALID');
  }
  return {
    contractVersion: version(source.contractVersion),
    receiptId: uuid(source.receiptId, 'EGRESS_RECEIPT_ID_INVALID'),
    leaseSha256: sha256(source.leaseSha256, 'EGRESS_LEASE_DIGEST_INVALID'),
    attestationSha256: sha256(source.attestationSha256, 'EGRESS_ATTESTATION_DIGEST_INVALID'),
    actionTokenSha256: sha256(source.actionTokenSha256, 'EGRESS_ACTION_TOKEN_DIGEST_INVALID'),
    actionId: uuid(source.actionId, 'EGRESS_ACTION_ID_INVALID'),
    taskId: uuid(source.taskId, 'EGRESS_TASK_ID_INVALID'),
    planVersionId: uuid(source.planVersionId, 'EGRESS_PLAN_VERSION_ID_INVALID'),
    stepId: uuid(source.stepId, 'EGRESS_STEP_ID_INVALID'),
    deviceId: uuid(source.deviceId, 'EGRESS_DEVICE_ID_INVALID'),
    mandateId: uuid(source.mandateId, 'EGRESS_MANDATE_ID_INVALID'),
    capabilityId: patternText(source.capabilityId, CAPABILITY_ID, 'EGRESS_CAPABILITY_ID_INVALID'),
    capabilityVersion: patternText(
      source.capabilityVersion,
      CAPABILITY_VERSION,
      'EGRESS_CAPABILITY_VERSION_INVALID',
    ),
    dispatchCount: integer(source.dispatchCount, 1, 'EGRESS_DISPATCH_COUNT_INVALID'),
    destinationPolicySha256: sha256(
      source.destinationPolicySha256,
      'EGRESS_DESTINATION_POLICY_DIGEST_INVALID',
    ),
    executionIdentitySha256: sha256(
      source.executionIdentitySha256,
      'EGRESS_EXECUTION_IDENTITY_DIGEST_INVALID',
    ),
    argumentsSha256: sha256(source.argumentsSha256, 'EGRESS_ARGUMENTS_DIGEST_INVALID'),
    expectedPreStateSha256: nullableSha256(
      source.expectedPreStateSha256,
      'EGRESS_EXPECTED_PRE_STATE_DIGEST_INVALID',
    ),
    idempotencyKeySha256: sha256(
      source.idempotencyKeySha256,
      'EGRESS_IDEMPOTENCY_KEY_DIGEST_INVALID',
    ),
    destinationScopeSha256: sha256(
      source.destinationScopeSha256,
      'EGRESS_DESTINATION_SCOPE_DIGEST_INVALID',
    ),
    requestBodySha256: sha256(source.requestBodySha256, 'EGRESS_REQUEST_BODY_DIGEST_INVALID'),
    exactRequestPolicySha256: sha256(
      source.exactRequestPolicySha256,
      'EGRESS_EXACT_REQUEST_POLICY_DIGEST_INVALID',
    ),
    reservationDnsAnswerSetSha256,
    connectionDnsAnswerSetSha256,
    selectedAddressSha256,
    registrationSha256: sha256(source.registrationSha256, 'EGRESS_REGISTRATION_DIGEST_INVALID'),
    dispositionSha256: sha256(source.dispositionSha256, 'EGRESS_DISPOSITION_DIGEST_INVALID'),
    reservedCapabilityEgressBytes,
    measuredExternalEgressBytes,
    uncertainExternalEgressBytes,
    chargedExternalEgressBytes,
    startedAtUnixMilliseconds,
    endedAtUnixMilliseconds,
    sequence: integer(source.sequence, 1, 'EGRESS_RECEIPT_SEQUENCE_INVALID'),
    flowLogSha256: sha256(source.flowLogSha256, 'EGRESS_FLOW_LOG_DIGEST_INVALID'),
    outcome: outcome as EgressReceiptOutcome,
  };
}

function boundaryFeatures(value: unknown): BoundaryFeature[] {
  if (!Array.isArray(value) || value.length > BOUNDARY_FEATURES.length) {
    throw protocolError('EGRESS_BOUNDARY_FEATURES_INVALID');
  }
  const features = value.map((feature) => {
    if (
      typeof feature !== 'string' ||
      !(BOUNDARY_FEATURES as readonly string[]).includes(feature)
    ) {
      throw protocolError('EGRESS_BOUNDARY_FEATURES_INVALID');
    }
    return feature as BoundaryFeature;
  });
  if (
    new Set(features).size !== features.length ||
    features.some((feature, index) => [...features].sort()[index] !== feature) ||
    REQUIRED_BOUNDARY_FEATURES.some((feature) => !features.includes(feature))
  ) {
    throw protocolError('EGRESS_BOUNDARY_FEATURES_INVALID');
  }
  const hasOrigin = features.includes('browser-origin-attested');
  const hasCompletion = features.includes('browser-completion-attested');
  if (hasOrigin !== hasCompletion) throw protocolError('EGRESS_BROWSER_ATTESTATION_INCOMPLETE');
  return features;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError(code);
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw protocolError(code);
  }
  return source;
}

function project(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function version(value: unknown): typeof EGRESS_RECEIPT_CONTRACT_VERSION {
  if (value !== EGRESS_RECEIPT_CONTRACT_VERSION) {
    throw protocolError('EGRESS_CONTRACT_VERSION_UNSUPPORTED');
  }
  return EGRESS_RECEIPT_CONTRACT_VERSION;
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID_D.test(value)) throw protocolError(code);
  return value;
}

function sha256(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw protocolError(code);
  return value;
}

function nonZeroSha256(value: unknown, code: string): string {
  const digest = sha256(value, code);
  if (digest === ZERO_SHA256) throw protocolError(code);
  return digest;
}

function nullableSha256(value: unknown, code: string): string | null {
  return value === null ? null : sha256(value, code);
}

function keyId(value: unknown, code: string): string {
  return patternText(value, KEY_ID, code);
}

function patternText(value: unknown, pattern: RegExp, code: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.normalize('NFC') ||
    CONTROL_CHARACTER.test(value) ||
    !pattern.test(value)
  ) {
    throw protocolError(code);
  }
  return value;
}

function integer(value: unknown, minimum: number, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw protocolError(code);
  return Number(value);
}

function signatureBase64(value: unknown): string {
  return canonicalBase64(value, 64, 64, 'EGRESS_SIGNATURE_INVALID');
}

function canonicalBase64(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
  code: string,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) {
    throw protocolError(code);
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length < minimumBytes ||
    decoded.length > maximumBytes ||
    decoded.toString('base64') !== value
  ) {
    throw protocolError(code);
  }
  return value;
}

function canonicalFrame(domain: string, fields: readonly string[]): Buffer {
  return Buffer.from([domain, ...fields].join('\n'), 'utf8');
}

function integerLine(value: number): string {
  return String(value);
}

function booleanLine(value: boolean): string {
  return value ? '1' : '0';
}

function stringLine(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function nullableStringLine(value: string | null): string {
  return value === null ? '' : stringLine(value);
}

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw protocolError(code);
  return value;
}

function protocolError(code: string): EgressReceiptProtocolError {
  return new EgressReceiptProtocolError(code);
}
