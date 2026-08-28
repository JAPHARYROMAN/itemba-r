import { createHash, createPublicKey, KeyObject, verify } from 'node:crypto';
import {
  boundaryAttestationClaims,
  boundaryAttestationSha256,
  canonicalBoundaryAttestationBytes,
  canonicalEgressAuthorizationLeaseBytes,
  canonicalEgressReceiptBytes,
  EgressReceiptProof,
  EgressReceiptProtocolError,
  egressAuthorizationLeaseClaims,
  egressAuthorizationLeaseSha256,
  egressEvidenceSha256,
  egressReceiptClaims,
  egressReceiptSha256,
  parseEgressReceiptProof,
  SignedBoundaryAttestation,
  SignedEgressAuthorizationLease,
  SignedEgressReceipt,
} from './egress-receipt.protocol';

export type EgressPublicKeyMaterial = string | Buffer | KeyObject;

/**
 * Independently enrolled hardware-backed supervisor authority. This is not
 * the ordinary paired-device identity key. Its signature authorizes the
 * short-lived receipt key embedded in a boundary attestation.
 */
export interface EnrolledBoundarySupervisorTrust {
  deviceId: string;
  keyId: string;
  publicKey: EgressPublicKeyMaterial;
  publicKeySpkiSha256: string;
}

export interface ExpectedEgressReceiptBinding {
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
  /** Centrally enrolled before dispatch; never derive this expectation from the proof. */
  destinationPolicySha256: string;
  /** Centrally enrolled before dispatch; never derive this expectation from the proof. */
  executionIdentitySha256: string;
  /** Canonical request arguments digest captured before dispatch. */
  argumentsSha256: string;
  /** Trusted pre-state digest for mutations, or null for actions without one. */
  expectedPreStateSha256: string | null;
  /** Digest of the persisted action idempotency key. */
  idempotencyKeySha256: string;
  reservedCapabilityEgressBytes: number;
}

export interface EgressReceiptReplayState {
  acceptedReceiptIds?: ReadonlySet<string>;
  acceptedLeaseIds?: ReadonlySet<string>;
  lastAcceptedBootId?: string;
  lastAcceptedReceiptSequence?: number;
}

export type EgressReceiptTimeValidationMode = 'CURRENT' | 'HISTORICAL_TERMINAL_RECEIPT';

export interface EgressReceiptVerificationOptions {
  /** Required at runtime even if an untyped caller attempts to omit it. */
  enrolledBoundarySupervisor: EnrolledBoundarySupervisorTrust;
  /**
   * All values must come from central pre-dispatch state. If either deployment
   * digest is not independently enrolled, metered activation must remain off.
   */
  expected: ExpectedEgressReceiptBinding;
  nowUnixMilliseconds: number;
  maxClockSkewMilliseconds: number;
  maxAttestationLifetimeMilliseconds: number;
  maxLeaseLifetimeMilliseconds: number;
  /**
   * CURRENT (the default) requires live attestation and lease authority.
   * HISTORICAL_TERMINAL_RECEIPT is only for delayed terminal evidence: it
   * permits expired authority while retaining signed-window and lifetime
   * validation and rejecting any time later than the broker's actual now.
   */
  timeValidationMode?: EgressReceiptTimeValidationMode;
  replay?: EgressReceiptReplayState;
  /** True only for capabilities that require browser-origin and completion evidence. */
  requireBrowserAttestation: boolean;
}

export interface VerifiedEgressReceiptProof {
  proof: EgressReceiptProof;
  attestationSha256: string;
  leaseSha256: string;
  receiptSha256: string;
  egressEvidenceSha256: string;
  receiptPublicKeySha256: string;
  reservationDnsAnswerSetSha256: string;
  connectionDnsAnswerSetSha256: string;
  selectedAddressSha256: string;
  chargedExternalEgressBytes: number;
}

export class EgressReceiptVerificationError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'EgressReceiptVerificationError';
  }
}

/** Loads only a public P-256 key; other curves and private-key inputs fail closed. */
export function loadEgressP256PublicKey(value: EgressPublicKeyMaterial): KeyObject {
  try {
    const key = value instanceof KeyObject ? value : createPublicKey(value);
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new Error('not a P-256 public key');
    }
    return key;
  } catch {
    throw verificationError('EGRESS_PUBLIC_KEY_INVALID');
  }
}

/** Decodes a canonical standard-Base64 DER SPKI and rejects non-canonical keys. */
export function loadEgressP256PublicKeyFromSpkiBase64(value: string): KeyObject {
  try {
    const der = decodeCanonicalBase64(value, undefined, 'EGRESS_RECEIPT_PUBLIC_KEY_INVALID');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (
      key.type !== 'public' ||
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new Error('not a P-256 public key');
    }
    const canonicalDer = key.export({ type: 'spki', format: 'der' });
    if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) {
      throw new Error('non-canonical DER SPKI');
    }
    return key;
  } catch (error) {
    if (error instanceof EgressReceiptVerificationError) throw error;
    throw verificationError('EGRESS_RECEIPT_PUBLIC_KEY_INVALID');
  }
}

export function egressPublicKeySpkiSha256(value: EgressPublicKeyMaterial): string {
  const key = loadEgressP256PublicKey(value);
  const der = key.export({ type: 'spki', format: 'der' });
  if (!Buffer.isBuffer(der)) throw verificationError('EGRESS_PUBLIC_KEY_INVALID');
  return createHash('sha256').update(der).digest('hex');
}

/** Strict ES256 verification: standard Base64, exactly 64 P1363 bytes, P-256 key. */
export function verifyEgressEs256P1363(
  payload: Buffer,
  signatureBase64: string,
  publicKey: EgressPublicKeyMaterial,
): boolean {
  try {
    const signature = decodeCanonicalBase64(
      signatureBase64,
      64,
      'EGRESS_SIGNATURE_ENCODING_INVALID',
    );
    return verify(
      'sha256',
      payload,
      { key: loadEgressP256PublicKey(publicKey), dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * Validates the complete trust chain and all redundant action bindings without
 * mutating replay state or performing settlement. Callers must map every error
 * to their conservative full-reservation/needs-attention policy.
 */
export function verifyEgressReceiptProof(
  input: unknown,
  options: EgressReceiptVerificationOptions,
): VerifiedEgressReceiptProof {
  const proof = parseProof(input);
  const policy = verificationPolicy(options);
  const { attestation, lease } = proof.authorization;
  const { receipt } = proof;
  const attestationClaims = boundaryAttestationClaims(attestation);
  const leaseClaims = egressAuthorizationLeaseClaims(lease);
  const receiptClaims = egressReceiptClaims(receipt);

  assertBoundarySupervisorTrust(attestation, policy.enrolledBoundarySupervisor);
  assertBrowserPolicy(attestation, policy.requireBrowserAttestation);
  assertTimeWindows(attestation, lease, receipt, policy);

  if (
    !verifyEgressEs256P1363(
      canonicalBoundaryAttestationBytes(attestationClaims),
      attestation.signatureBase64,
      policy.enrolledBoundarySupervisor.publicKey,
    )
  ) {
    throw verificationError('EGRESS_BOUNDARY_ATTESTATION_SIGNATURE_INVALID');
  }
  assertHostIntegrity(attestation);

  const receiptKey = loadEgressP256PublicKeyFromSpkiBase64(attestation.receiptPublicKeySpkiBase64);
  const receiptPublicKeySha256 = egressPublicKeySpkiSha256(receiptKey);
  if (receiptPublicKeySha256 !== attestation.receiptPublicKeySha256) {
    throw verificationError('EGRESS_RECEIPT_PUBLIC_KEY_DIGEST_INVALID');
  }

  if (lease.keyId !== attestation.receiptKeyId || receipt.keyId !== attestation.receiptKeyId) {
    throw verificationError('EGRESS_RECEIPT_KEY_ID_MISMATCH');
  }
  if (
    !verifyEgressEs256P1363(
      canonicalEgressAuthorizationLeaseBytes(leaseClaims),
      lease.signatureBase64,
      receiptKey,
    )
  ) {
    throw verificationError('EGRESS_AUTHORIZATION_LEASE_SIGNATURE_INVALID');
  }
  if (
    !verifyEgressEs256P1363(
      canonicalEgressReceiptBytes(receiptClaims),
      receipt.signatureBase64,
      receiptKey,
    )
  ) {
    throw verificationError('EGRESS_RECEIPT_SIGNATURE_INVALID');
  }

  const attestationDigest = boundaryAttestationSha256(attestationClaims);
  const leaseDigest = egressAuthorizationLeaseSha256(leaseClaims);
  if (
    lease.attestationSha256 !== attestationDigest ||
    receipt.attestationSha256 !== attestationDigest
  ) {
    throw verificationError('EGRESS_ATTESTATION_DIGEST_BINDING_MISMATCH');
  }
  if (receipt.leaseSha256 !== leaseDigest) {
    throw verificationError('EGRESS_LEASE_DIGEST_BINDING_MISMATCH');
  }

  assertExpectedBinding(proof, policy.expected);
  assertLeaseReceiptBinding(lease, receipt);
  assertNotReplayed(attestation, lease, receipt, policy.replay);

  return {
    proof,
    attestationSha256: attestationDigest,
    leaseSha256: leaseDigest,
    receiptSha256: egressReceiptSha256(receiptClaims),
    egressEvidenceSha256: egressEvidenceSha256(proof),
    receiptPublicKeySha256,
    reservationDnsAnswerSetSha256: receipt.reservationDnsAnswerSetSha256,
    connectionDnsAnswerSetSha256: receipt.connectionDnsAnswerSetSha256,
    selectedAddressSha256: receipt.selectedAddressSha256,
    chargedExternalEgressBytes: receipt.chargedExternalEgressBytes,
  };
}

function assertBoundarySupervisorTrust(
  attestation: SignedBoundaryAttestation,
  supervisor: EnrolledBoundarySupervisorTrust,
): void {
  if (attestation.deviceId !== supervisor.deviceId || attestation.keyId !== supervisor.keyId) {
    throw verificationError('EGRESS_BOUNDARY_SUPERVISOR_BINDING_MISMATCH');
  }
  if (egressPublicKeySpkiSha256(supervisor.publicKey) !== supervisor.publicKeySpkiSha256) {
    throw verificationError('EGRESS_BOUNDARY_SUPERVISOR_KEY_NOT_ENROLLED');
  }
}

function assertHostIntegrity(attestation: SignedBoundaryAttestation): void {
  if (
    !attestation.secureBootEnabled ||
    !attestation.hvciEnabled ||
    !attestation.driverActive ||
    !attestation.serviceActive
  ) {
    throw verificationError('EGRESS_BOUNDARY_HOST_INTEGRITY_INVALID');
  }
}

function assertBrowserPolicy(
  attestation: SignedBoundaryAttestation,
  requireBrowserAttestation: boolean,
): void {
  const browserOrigin = attestation.features.includes('browser-origin-attested');
  const browserCompletion = attestation.features.includes('browser-completion-attested');
  if (requireBrowserAttestation && (!browserOrigin || !browserCompletion)) {
    throw verificationError('EGRESS_BROWSER_ATTESTATION_REQUIRED');
  }
  if (!requireBrowserAttestation && (browserOrigin || browserCompletion)) {
    throw verificationError('EGRESS_BROWSER_BOUNDARY_DISABLED');
  }
}

function assertTimeWindows(
  attestation: SignedBoundaryAttestation,
  lease: SignedEgressAuthorizationLease,
  receipt: SignedEgressReceipt,
  options: ReturnType<typeof verificationPolicy>,
): void {
  const now = options.nowUnixMilliseconds;
  const skew = options.maxClockSkewMilliseconds;
  const historicalTerminalReceipt = options.timeValidationMode === 'HISTORICAL_TERMINAL_RECEIPT';
  const futureTimeLimit = historicalTerminalReceipt ? now : now + skew;
  if (
    attestation.issuedAtUnixMilliseconds > futureTimeLimit ||
    (!historicalTerminalReceipt && attestation.expiresAtUnixMilliseconds <= now - skew) ||
    attestation.expiresAtUnixMilliseconds - attestation.issuedAtUnixMilliseconds >
      options.maxAttestationLifetimeMilliseconds
  ) {
    throw verificationError('EGRESS_BOUNDARY_ATTESTATION_TIME_INVALID');
  }
  if (
    lease.issuedAtUnixMilliseconds > futureTimeLimit ||
    (!historicalTerminalReceipt && lease.expiresAtUnixMilliseconds <= now - skew) ||
    lease.expiresAtUnixMilliseconds - lease.issuedAtUnixMilliseconds >
      options.maxLeaseLifetimeMilliseconds ||
    lease.issuedAtUnixMilliseconds < attestation.issuedAtUnixMilliseconds ||
    lease.expiresAtUnixMilliseconds > attestation.expiresAtUnixMilliseconds
  ) {
    throw verificationError('EGRESS_AUTHORIZATION_LEASE_TIME_INVALID');
  }
  if (
    receipt.startedAtUnixMilliseconds <
      lease.issuedAtUnixMilliseconds - (historicalTerminalReceipt ? 0 : skew) ||
    receipt.endedAtUnixMilliseconds >
      lease.expiresAtUnixMilliseconds + (historicalTerminalReceipt ? 0 : skew) ||
    receipt.endedAtUnixMilliseconds > futureTimeLimit
  ) {
    throw verificationError('EGRESS_RECEIPT_TIME_INVALID');
  }
}

function assertExpectedBinding(
  proof: EgressReceiptProof,
  expected: ExpectedEgressReceiptBinding,
): void {
  const lease = proof.authorization.lease;
  const receipt = proof.receipt;
  if (
    proof.actionTokenSha256 !== expected.actionTokenSha256 ||
    lease.actionTokenSha256 !== expected.actionTokenSha256 ||
    receipt.actionTokenSha256 !== expected.actionTokenSha256
  ) {
    throw verificationError('EGRESS_ACTION_TOKEN_BINDING_MISMATCH');
  }
  for (const field of [
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
    'reservedCapabilityEgressBytes',
  ] as const) {
    if (lease[field] !== expected[field] || receipt[field] !== expected[field]) {
      throw verificationError('EGRESS_ACTION_BINDING_MISMATCH');
    }
  }
}

function assertLeaseReceiptBinding(
  lease: SignedEgressAuthorizationLease,
  receipt: SignedEgressReceipt,
): void {
  for (const field of [
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
  ] as const) {
    if (lease[field] !== receipt[field]) {
      throw verificationError('EGRESS_LEASE_RECEIPT_BINDING_MISMATCH');
    }
  }
}

function assertNotReplayed(
  attestation: SignedBoundaryAttestation,
  lease: SignedEgressAuthorizationLease,
  receipt: SignedEgressReceipt,
  replay: EgressReceiptReplayState | undefined,
): void {
  if (!replay) return;
  if (
    replay.acceptedReceiptIds?.has(receipt.receiptId) ||
    replay.acceptedLeaseIds?.has(lease.leaseId)
  ) {
    throw verificationError('EGRESS_RECEIPT_REPLAYED');
  }
  const hasBoot = replay.lastAcceptedBootId !== undefined;
  const hasSequence = replay.lastAcceptedReceiptSequence !== undefined;
  if (hasBoot !== hasSequence) throw verificationError('EGRESS_REPLAY_STATE_INVALID');
  if (
    hasBoot &&
    replay.lastAcceptedBootId === attestation.bootId &&
    receipt.sequence <= Number(replay.lastAcceptedReceiptSequence)
  ) {
    throw verificationError('EGRESS_RECEIPT_SEQUENCE_REPLAYED');
  }
}

function verificationPolicy(
  options: EgressReceiptVerificationOptions,
): EgressReceiptVerificationOptions {
  if (!options || !options.enrolledBoundarySupervisor || !options.expected) {
    throw verificationError('EGRESS_TRUST_POLICY_INCOMPLETE');
  }
  if (typeof options.requireBrowserAttestation !== 'boolean') {
    throw verificationError('EGRESS_TRUST_POLICY_INVALID');
  }
  if (
    options.timeValidationMode !== undefined &&
    options.timeValidationMode !== 'CURRENT' &&
    options.timeValidationMode !== 'HISTORICAL_TERMINAL_RECEIPT'
  ) {
    throw verificationError('EGRESS_TRUST_POLICY_INVALID');
  }
  for (const [value, allowZero] of [
    [options.nowUnixMilliseconds, true],
    [options.maxClockSkewMilliseconds, true],
    [options.maxAttestationLifetimeMilliseconds, false],
    [options.maxLeaseLifetimeMilliseconds, false],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
      throw verificationError('EGRESS_TRUST_POLICY_INVALID');
    }
  }
  return options;
}

function parseProof(value: unknown): EgressReceiptProof {
  try {
    return parseEgressReceiptProof(value);
  } catch (error) {
    if (error instanceof EgressReceiptProtocolError) {
      throw new EgressReceiptVerificationError(error.code);
    }
    throw verificationError('EGRESS_RECEIPT_PROOF_INVALID');
  }
}

function decodeCanonicalBase64(value: string, length: number | undefined, code: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) {
    throw verificationError(code);
  }
  const decoded = Buffer.from(value, 'base64');
  if ((length !== undefined && decoded.length !== length) || decoded.toString('base64') !== value) {
    throw verificationError(code);
  }
  return decoded;
}

function verificationError(code: string): EgressReceiptVerificationError {
  return new EgressReceiptVerificationError(code);
}
