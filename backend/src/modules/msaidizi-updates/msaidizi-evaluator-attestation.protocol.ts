import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';

export const EVALUATOR_ATTESTATION_SCHEMA_VERSION = 1 as const;
export const GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION = 2 as const;
export const EVALUATOR_SIGNATURE_ALGORITHM = 'ES256' as const;

export type EvaluatorKeyRole = 'ARTIFACT_VERIFIER' | 'EVALUATION_RUNNER' | 'MODEL_REVIEWER';
export type TrustedArtifactPurpose = 'SOURCE' | 'ROLLBACK' | 'REPORT';

export interface SignedAttestationEnvelope {
  claimsJson: string;
  signature: string;
}

interface ArtifactAttestationClaimsV1 {
  schemaVersion: 1;
  type: 'TRUSTED_UPDATE_ARTIFACT';
  signerKeyId: string;
  artifactId: string;
  artifactPurpose: TrustedArtifactPurpose;
  taskId: string;
  planVersionId: string;
  stepId: string;
  candidateId: string | null;
  name: string;
  mimeType: string;
  byteSize: string;
  sha256: string;
  dataClass: string;
  evaluationRunId: string;
  cleanSnapshotId: string;
  toolchainVersions: Record<string, string>;
  provenance: {
    producer: 'ISOLATED_WINDOWS_VERIFIER';
    source: 'CLEAN_SNAPSHOT_BUILD';
  };
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface EvaluationBindingClaimsV1 {
  candidateId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  rollbackArtifactId: string;
  rollbackArtifactSha256: string;
  rollbackVersion: string;
  reportArtifactId: string;
  reportArtifactSha256: string;
  evaluationRunId: string;
  cleanSnapshotId: string;
  toolchainVersions: Record<string, string>;
}

export interface GeneratedEvaluationBindingExtension {
  requestDigest: string;
  generationArtifactId: string;
  generationArtifactSha256: string;
  generationManifestSha256: string;
  protectedPolicyVersion: string;
  protectedPolicySha256: string;
  baseRevisionSha256: string;
}

export interface GeneratedEvaluationFinalUsage {
  cpuTimeSeconds: number;
  bytesRead: string;
  bytesWritten: string;
  externalEgressBytes: string;
  modelTurns: number;
  modelInputTokens: string;
  modelOutputTokens: string;
  modelCostMicrousd: string;
}

export interface GeneratedEvaluationTerminalAccounting {
  evaluationLeaseGeneration: number;
  finalUsage: GeneratedEvaluationFinalUsage;
}

export type GeneratedEvaluationBindingClaims = EvaluationBindingClaimsV1 &
  GeneratedEvaluationBindingExtension;
export type EvaluationBindingClaims = EvaluationBindingClaimsV1 | GeneratedEvaluationBindingClaims;

interface ArtifactAttestationClaimsV2
  extends Omit<ArtifactAttestationClaimsV1, 'schemaVersion'>, GeneratedEvaluationBindingExtension {
  schemaVersion: 2;
}

export type ArtifactAttestationClaims = ArtifactAttestationClaimsV1 | ArtifactAttestationClaimsV2;

interface EvaluationRunnerAttestationClaimsV1 extends EvaluationBindingClaimsV1 {
  schemaVersion: 1;
  type: 'UPDATE_EVALUATION_RUNNER';
  signerKeyId: string;
  checks: {
    isolatedWindowsVm: boolean;
    tests: boolean;
    staticAnalysis: boolean;
    adversarialEvaluation: boolean;
    supervisorIntegrity: boolean;
    protectedBoundaryDiff: boolean;
  };
  verdict: 'PASS' | 'FAIL';
  failureCodes: string[];
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

interface EvaluationRunnerAttestationClaimsV2
  extends GeneratedEvaluationBindingClaims, GeneratedEvaluationTerminalAccounting {
  schemaVersion: 2;
  type: 'UPDATE_EVALUATION_RUNNER';
  signerKeyId: string;
  checks: EvaluationRunnerAttestationClaimsV1['checks'] & {
    baseRevisionMatch: boolean;
    ntfsReparseHardLinkAndToctouIsolation: boolean;
  };
  verdict: 'PASS' | 'FAIL';
  failureCodes: string[];
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export type EvaluationRunnerAttestationClaims =
  | EvaluationRunnerAttestationClaimsV1
  | EvaluationRunnerAttestationClaimsV2;

interface ModelReviewAttestationClaimsV1 extends EvaluationBindingClaimsV1 {
  schemaVersion: 1;
  type: 'UPDATE_MODEL_REVIEW';
  signerKeyId: string;
  runnerClaimsDigest: string;
  reviewerId: string;
  modelId: string;
  verdict: 'APPROVE' | 'REJECT';
  rationale: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

interface ModelReviewAttestationClaimsV2
  extends GeneratedEvaluationBindingClaims, GeneratedEvaluationTerminalAccounting {
  schemaVersion: 2;
  type: 'UPDATE_MODEL_REVIEW';
  signerKeyId: string;
  runnerClaimsDigest: string;
  reviewerId: string;
  modelId: string;
  verdict: 'APPROVE' | 'REJECT';
  rationale: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export type ModelReviewAttestationClaims =
  | ModelReviewAttestationClaimsV1
  | ModelReviewAttestationClaimsV2;

export interface CanonicalAttestation<T> {
  claims: T;
  claimsJson: string;
  claimsDigest: string;
  signature: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATA_CLASS = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,199}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;

const ARTIFACT_KEYS = [
  'artifactId',
  'artifactPurpose',
  'byteSize',
  'candidateId',
  'cleanSnapshotId',
  'dataClass',
  'evaluationRunId',
  'expiresAt',
  'issuedAt',
  'mimeType',
  'name',
  'nonce',
  'planVersionId',
  'provenance',
  'schemaVersion',
  'sha256',
  'signerKeyId',
  'stepId',
  'taskId',
  'toolchainVersions',
  'type',
] as const;
const GENERATED_BINDING_KEYS = [
  'baseRevisionSha256',
  'generationArtifactId',
  'generationArtifactSha256',
  'generationManifestSha256',
  'protectedPolicySha256',
  'protectedPolicyVersion',
  'requestDigest',
] as const;
const GENERATED_TERMINAL_ACCOUNTING_KEYS = ['evaluationLeaseGeneration', 'finalUsage'] as const;
const GENERATED_FINAL_USAGE_KEYS = [
  'bytesRead',
  'bytesWritten',
  'cpuTimeSeconds',
  'externalEgressBytes',
  'modelCostMicrousd',
  'modelInputTokens',
  'modelOutputTokens',
  'modelTurns',
] as const;
const BINDING_KEYS = [
  'candidateId',
  'cleanSnapshotId',
  'evaluationRunId',
  'planVersionId',
  'reportArtifactId',
  'reportArtifactSha256',
  'rollbackArtifactId',
  'rollbackArtifactSha256',
  'rollbackVersion',
  'sourceArtifactId',
  'sourceArtifactSha256',
  'stepId',
  'taskId',
  'toolchainVersions',
] as const;
const RUNNER_KEYS = [
  ...BINDING_KEYS,
  'checks',
  'expiresAt',
  'failureCodes',
  'issuedAt',
  'nonce',
  'schemaVersion',
  'signerKeyId',
  'type',
  'verdict',
].sort();
const GENERATED_ARTIFACT_KEYS = [...ARTIFACT_KEYS, ...GENERATED_BINDING_KEYS].sort();
const GENERATED_RUNNER_KEYS = [
  ...BINDING_KEYS,
  ...GENERATED_BINDING_KEYS,
  ...GENERATED_TERMINAL_ACCOUNTING_KEYS,
  'checks',
  'expiresAt',
  'failureCodes',
  'issuedAt',
  'nonce',
  'schemaVersion',
  'signerKeyId',
  'type',
  'verdict',
].sort();
const REVIEW_KEYS = [
  ...BINDING_KEYS,
  'expiresAt',
  'issuedAt',
  'modelId',
  'nonce',
  'rationale',
  'reviewerId',
  'runnerClaimsDigest',
  'schemaVersion',
  'signerKeyId',
  'type',
  'verdict',
].sort();
const GENERATED_REVIEW_KEYS = [
  ...BINDING_KEYS,
  ...GENERATED_BINDING_KEYS,
  ...GENERATED_TERMINAL_ACCOUNTING_KEYS,
  'expiresAt',
  'issuedAt',
  'modelId',
  'nonce',
  'rationale',
  'reviewerId',
  'runnerClaimsDigest',
  'schemaVersion',
  'signerKeyId',
  'type',
  'verdict',
].sort();
const CHECK_KEYS = [
  'adversarialEvaluation',
  'isolatedWindowsVm',
  'protectedBoundaryDiff',
  'staticAnalysis',
  'supervisorIntegrity',
  'tests',
] as const;
const GENERATED_CHECK_KEYS = [
  ...CHECK_KEYS,
  'baseRevisionMatch',
  'ntfsReparseHardLinkAndToctouIsolation',
].sort();

export class EvaluatorAttestationError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'EvaluatorAttestationError';
  }
}

export function parseArtifactAttestation(
  envelope: SignedAttestationEnvelope,
): CanonicalAttestation<ArtifactAttestationClaims> {
  const value = parseCanonicalEnvelope(envelope);
  const schemaVersion = supportedSchema(value);
  exactKeys(
    value,
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? GENERATED_ARTIFACT_KEYS
      : ARTIFACT_KEYS,
    'ARTIFACT_CLAIMS_SCHEMA_INVALID',
  );
  const provenance = record(value.provenance, 'ARTIFACT_PROVENANCE_INVALID');
  exactKeys(provenance, ['producer', 'source'], 'ARTIFACT_PROVENANCE_INVALID');
  if (
    provenance.producer !== 'ISOLATED_WINDOWS_VERIFIER' ||
    provenance.source !== 'CLEAN_SNAPSHOT_BUILD'
  ) {
    throw error('ARTIFACT_PROVENANCE_INVALID');
  }
  if (!['SOURCE', 'ROLLBACK', 'REPORT'].includes(String(value.artifactPurpose))) {
    throw error('ARTIFACT_PURPOSE_INVALID');
  }
  const candidateId = value.candidateId === null ? null : uuid(value.candidateId, 'candidateId');
  const common = {
    type: literal(value.type, 'TRUSTED_UPDATE_ARTIFACT', 'ARTIFACT_TYPE_INVALID'),
    signerKeyId: identifier(value.signerKeyId, 'signerKeyId'),
    artifactId: uuid(value.artifactId, 'artifactId'),
    artifactPurpose: value.artifactPurpose as TrustedArtifactPurpose,
    taskId: uuid(value.taskId, 'taskId'),
    planVersionId: uuid(value.planVersionId, 'planVersionId'),
    stepId: uuid(value.stepId, 'stepId'),
    candidateId,
    name: patternText(value.name, FILE_NAME, 'name'),
    mimeType: patternText(value.mimeType, MIME_TYPE, 'mimeType').toLowerCase(),
    byteSize: canonicalPositiveInteger(value.byteSize, 'byteSize'),
    sha256: sha256(value.sha256, 'sha256'),
    dataClass: patternText(value.dataClass, DATA_CLASS, 'dataClass'),
    evaluationRunId: identifier(value.evaluationRunId, 'evaluationRunId'),
    cleanSnapshotId: identifier(value.cleanSnapshotId, 'cleanSnapshotId'),
    toolchainVersions: toolchains(value.toolchainVersions),
    provenance: {
      producer: 'ISOLATED_WINDOWS_VERIFIER',
      source: 'CLEAN_SNAPSHOT_BUILD',
    } as const,
    issuedAt: timestamp(value.issuedAt, 'issuedAt'),
    expiresAt: timestamp(value.expiresAt, 'expiresAt'),
    nonce: uuid(value.nonce, 'nonce'),
  };
  const claims: ArtifactAttestationClaims =
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? { schemaVersion, ...common, ...generatedBinding(value) }
      : { schemaVersion, ...common };
  return finish(envelope, claims);
}

export function parseEvaluationRunnerAttestation(
  envelope: SignedAttestationEnvelope,
): CanonicalAttestation<EvaluationRunnerAttestationClaims> {
  const value = parseCanonicalEnvelope(envelope);
  const schemaVersion = supportedSchema(value);
  exactKeys(
    value,
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? GENERATED_RUNNER_KEYS
      : RUNNER_KEYS,
    'RUNNER_CLAIMS_SCHEMA_INVALID',
  );
  const rawChecks = record(value.checks, 'RUNNER_CHECKS_INVALID');
  exactKeys(
    rawChecks,
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? GENERATED_CHECK_KEYS
      : CHECK_KEYS,
    'RUNNER_CHECKS_INVALID',
  );
  const commonChecks = {
    isolatedWindowsVm: bool(rawChecks.isolatedWindowsVm, 'isolatedWindowsVm'),
    tests: bool(rawChecks.tests, 'tests'),
    staticAnalysis: bool(rawChecks.staticAnalysis, 'staticAnalysis'),
    adversarialEvaluation: bool(rawChecks.adversarialEvaluation, 'adversarialEvaluation'),
    supervisorIntegrity: bool(rawChecks.supervisorIntegrity, 'supervisorIntegrity'),
    protectedBoundaryDiff: bool(rawChecks.protectedBoundaryDiff, 'protectedBoundaryDiff'),
  };
  const checks =
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? {
          ...commonChecks,
          baseRevisionMatch: bool(rawChecks.baseRevisionMatch, 'baseRevisionMatch'),
          ntfsReparseHardLinkAndToctouIsolation: bool(
            rawChecks.ntfsReparseHardLinkAndToctouIsolation,
            'ntfsReparseHardLinkAndToctouIsolation',
          ),
        }
      : commonChecks;
  const verdict = oneOf(value.verdict, ['PASS', 'FAIL'] as const, 'RUNNER_VERDICT_INVALID');
  const failureCodes = stringArray(
    value.failureCodes,
    FAILURE_CODE,
    32,
    'RUNNER_FAILURE_CODES_INVALID',
  );
  const allPassed = Object.values(checks).every(Boolean);
  if (
    (verdict === 'PASS' && (!allPassed || failureCodes.length !== 0)) ||
    (verdict === 'FAIL' && (allPassed || failureCodes.length === 0))
  ) {
    throw error('RUNNER_VERDICT_INCONSISTENT');
  }
  const common = {
    type: literal(value.type, 'UPDATE_EVALUATION_RUNNER', 'RUNNER_TYPE_INVALID'),
    signerKeyId: identifier(value.signerKeyId, 'signerKeyId'),
    checks,
    verdict,
    failureCodes,
    issuedAt: timestamp(value.issuedAt, 'issuedAt'),
    expiresAt: timestamp(value.expiresAt, 'expiresAt'),
    nonce: uuid(value.nonce, 'nonce'),
  };
  const claims: EvaluationRunnerAttestationClaims =
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? {
          schemaVersion,
          ...common,
          checks: checks as EvaluationRunnerAttestationClaimsV2['checks'],
          ...(binding(value) as EvaluationBindingClaimsV1),
          ...generatedBinding(value),
          ...generatedTerminalAccounting(value),
        }
      : {
          schemaVersion,
          ...common,
          checks: checks as EvaluationRunnerAttestationClaimsV1['checks'],
          ...(binding(value) as EvaluationBindingClaimsV1),
        };
  return finish(envelope, claims);
}

export function parseModelReviewAttestation(
  envelope: SignedAttestationEnvelope,
): CanonicalAttestation<ModelReviewAttestationClaims> {
  const value = parseCanonicalEnvelope(envelope);
  const schemaVersion = supportedSchema(value);
  exactKeys(
    value,
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? GENERATED_REVIEW_KEYS
      : REVIEW_KEYS,
    'MODEL_REVIEW_CLAIMS_SCHEMA_INVALID',
  );
  const rationale = boundedText(value.rationale, 1, 2_000, 'rationale', true);
  const common = {
    type: literal(value.type, 'UPDATE_MODEL_REVIEW', 'MODEL_REVIEW_TYPE_INVALID'),
    signerKeyId: identifier(value.signerKeyId, 'signerKeyId'),
    runnerClaimsDigest: sha256(value.runnerClaimsDigest, 'runnerClaimsDigest'),
    reviewerId: identifier(value.reviewerId, 'reviewerId'),
    modelId: identifier(value.modelId, 'modelId'),
    verdict: oneOf(value.verdict, ['APPROVE', 'REJECT'] as const, 'MODEL_REVIEW_VERDICT_INVALID'),
    rationale,
    issuedAt: timestamp(value.issuedAt, 'issuedAt'),
    expiresAt: timestamp(value.expiresAt, 'expiresAt'),
    nonce: uuid(value.nonce, 'nonce'),
  };
  const claims: ModelReviewAttestationClaims =
    schemaVersion === GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
      ? {
          schemaVersion,
          ...common,
          ...binding(value),
          ...generatedBinding(value),
          ...generatedTerminalAccounting(value),
        }
      : { schemaVersion, ...common, ...binding(value) };
  return finish(envelope, claims);
}

export function canonicalAttestationJson(value: unknown): string {
  return canonicalJson(value);
}

export function attestationSigningPayload(claimsJson: string): Buffer {
  return Buffer.from(`MSAIDIZI-EVALUATOR-ATTESTATION-V1\0${claimsJson}`, 'utf8');
}

export function decodeCanonicalEvaluatorSignature(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !SIGNATURE.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  // Node ignores unused trailing bits, so require the unique round-trip representation.
  return decoded.length === 64 && decoded.toString('base64url') === value ? decoded : null;
}

export function attestationBundleDigest(
  runnerClaimsDigest: string,
  reviewerClaimsDigests: readonly string[],
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        protocol: 'MSAIDIZI-EVALUATION-BUNDLE-V1',
        runnerClaimsDigest,
        reviewerClaimsDigests: [...reviewerClaimsDigests].sort(),
      }),
      'utf8',
    )
    .digest('hex');
}

export function sameEvaluationBinding(
  left: EvaluationBindingClaims & Partial<GeneratedEvaluationTerminalAccounting>,
  right: EvaluationBindingClaims & Partial<GeneratedEvaluationTerminalAccounting>,
): boolean {
  return (
    canonicalJson(extractEvaluationBinding(left)) === canonicalJson(extractEvaluationBinding(right))
  );
}

/**
 * Deliberately projects only immutable binding fields. Passing a full runner
 * or reviewer claim object can therefore never make check/verdict metadata
 * participate in, or bypass, the cross-attestation binding comparison.
 */
export function extractEvaluationBinding(claims: EvaluationBindingClaims): EvaluationBindingClaims {
  const common: EvaluationBindingClaimsV1 = {
    candidateId: claims.candidateId,
    taskId: claims.taskId,
    planVersionId: claims.planVersionId,
    stepId: claims.stepId,
    sourceArtifactId: claims.sourceArtifactId,
    sourceArtifactSha256: claims.sourceArtifactSha256,
    rollbackArtifactId: claims.rollbackArtifactId,
    rollbackArtifactSha256: claims.rollbackArtifactSha256,
    rollbackVersion: claims.rollbackVersion,
    reportArtifactId: claims.reportArtifactId,
    reportArtifactSha256: claims.reportArtifactSha256,
    evaluationRunId: claims.evaluationRunId,
    cleanSnapshotId: claims.cleanSnapshotId,
    toolchainVersions: claims.toolchainVersions,
  };
  if (!isGeneratedEvaluationBinding(claims)) return common;
  return {
    ...common,
    ...extractGeneratedEvaluationBinding(claims),
    ...(isGeneratedEvaluationTerminalAccounting(claims)
      ? extractGeneratedEvaluationTerminalAccounting(claims)
      : {}),
  } as GeneratedEvaluationBindingClaims;
}

export function isGeneratedEvaluationBinding(
  claims: EvaluationBindingClaims | ArtifactAttestationClaims,
): claims is (EvaluationBindingClaims | ArtifactAttestationClaims) &
  GeneratedEvaluationBindingExtension {
  return (
    'requestDigest' in claims &&
    'generationArtifactId' in claims &&
    'generationArtifactSha256' in claims &&
    'generationManifestSha256' in claims &&
    'protectedPolicyVersion' in claims &&
    'protectedPolicySha256' in claims &&
    'baseRevisionSha256' in claims
  );
}

export function extractGeneratedEvaluationBinding(
  claims: GeneratedEvaluationBindingExtension,
): GeneratedEvaluationBindingExtension {
  return {
    requestDigest: claims.requestDigest,
    generationArtifactId: claims.generationArtifactId,
    generationArtifactSha256: claims.generationArtifactSha256,
    generationManifestSha256: claims.generationManifestSha256,
    protectedPolicyVersion: claims.protectedPolicyVersion,
    protectedPolicySha256: claims.protectedPolicySha256,
    baseRevisionSha256: claims.baseRevisionSha256,
  };
}

export function isGeneratedEvaluationTerminalAccounting(
  claims: unknown,
): claims is GeneratedEvaluationTerminalAccounting {
  return Boolean(
    claims &&
    typeof claims === 'object' &&
    'evaluationLeaseGeneration' in claims &&
    'finalUsage' in claims,
  );
}

export function extractGeneratedEvaluationTerminalAccounting(
  claims: GeneratedEvaluationTerminalAccounting,
): GeneratedEvaluationTerminalAccounting {
  return {
    evaluationLeaseGeneration: claims.evaluationLeaseGeneration,
    finalUsage: { ...claims.finalUsage },
  };
}

function parseCanonicalEnvelope(envelope: SignedAttestationEnvelope): Record<string, unknown> {
  if (
    !envelope ||
    typeof envelope.claimsJson !== 'string' ||
    envelope.claimsJson.length < 2 ||
    envelope.claimsJson.length > 64 * 1024 ||
    !decodeCanonicalEvaluatorSignature(envelope.signature)
  ) {
    throw error('ATTESTATION_ENVELOPE_INVALID');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.claimsJson) as unknown;
  } catch {
    throw error('ATTESTATION_JSON_INVALID');
  }
  const value = record(parsed, 'ATTESTATION_JSON_INVALID');
  if (canonicalJson(value) !== envelope.claimsJson) {
    throw error('ATTESTATION_NOT_CANONICAL');
  }
  return value;
}

function finish<T extends Record<string, unknown> | object>(
  envelope: SignedAttestationEnvelope,
  claims: T,
): CanonicalAttestation<T> {
  const canonical = canonicalJson(claims);
  if (canonical !== envelope.claimsJson) throw error('ATTESTATION_NORMALIZATION_MISMATCH');
  const dlpInput = isGeneratedEvaluationTerminalAccounting(claims)
    ? { ...claims, finalUsage: '[VALIDATED EVALUATION TERMINAL USAGE]' }
    : claims;
  if (sanitizePersistedValue(dlpInput).redactionsApplied) {
    throw error('ATTESTATION_DLP_REJECTED');
  }
  return {
    claims,
    claimsJson: canonical,
    claimsDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    signature: envelope.signature,
  };
}

function binding(value: Record<string, unknown>): EvaluationBindingClaims {
  return {
    candidateId: uuid(value.candidateId, 'candidateId'),
    taskId: uuid(value.taskId, 'taskId'),
    planVersionId: uuid(value.planVersionId, 'planVersionId'),
    stepId: uuid(value.stepId, 'stepId'),
    sourceArtifactId: uuid(value.sourceArtifactId, 'sourceArtifactId'),
    sourceArtifactSha256: sha256(value.sourceArtifactSha256, 'sourceArtifactSha256'),
    rollbackArtifactId: uuid(value.rollbackArtifactId, 'rollbackArtifactId'),
    rollbackArtifactSha256: sha256(value.rollbackArtifactSha256, 'rollbackArtifactSha256'),
    rollbackVersion: patternText(value.rollbackVersion, VERSION, 'rollbackVersion'),
    reportArtifactId: uuid(value.reportArtifactId, 'reportArtifactId'),
    reportArtifactSha256: sha256(value.reportArtifactSha256, 'reportArtifactSha256'),
    evaluationRunId: identifier(value.evaluationRunId, 'evaluationRunId'),
    cleanSnapshotId: identifier(value.cleanSnapshotId, 'cleanSnapshotId'),
    toolchainVersions: toolchains(value.toolchainVersions),
  };
}

function generatedBinding(value: Record<string, unknown>): GeneratedEvaluationBindingExtension {
  return {
    requestDigest: sha256(value.requestDigest, 'requestDigest'),
    generationArtifactId: uuid(value.generationArtifactId, 'generationArtifactId'),
    generationArtifactSha256: sha256(value.generationArtifactSha256, 'generationArtifactSha256'),
    generationManifestSha256: sha256(value.generationManifestSha256, 'generationManifestSha256'),
    protectedPolicyVersion: patternText(
      value.protectedPolicyVersion,
      /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}$/,
      'protectedPolicyVersion',
    ),
    protectedPolicySha256: sha256(value.protectedPolicySha256, 'protectedPolicySha256'),
    baseRevisionSha256: sha256(value.baseRevisionSha256, 'baseRevisionSha256'),
  };
}

function generatedTerminalAccounting(
  value: Record<string, unknown>,
): GeneratedEvaluationTerminalAccounting {
  if (
    !Number.isSafeInteger(value.evaluationLeaseGeneration) ||
    (value.evaluationLeaseGeneration as number) < 1 ||
    (value.evaluationLeaseGeneration as number) > 1_000_000
  ) {
    throw error('ATTESTATION_EVALUATIONLEASEGENERATION_INVALID');
  }
  const usage = record(value.finalUsage, 'ATTESTATION_FINALUSAGE_INVALID');
  exactKeys(usage, GENERATED_FINAL_USAGE_KEYS, 'ATTESTATION_FINALUSAGE_INVALID');
  if (
    !Number.isSafeInteger(usage.cpuTimeSeconds) ||
    (usage.cpuTimeSeconds as number) < 0 ||
    !Number.isSafeInteger(usage.modelTurns) ||
    (usage.modelTurns as number) < 0
  ) {
    throw error('ATTESTATION_FINALUSAGE_INVALID');
  }
  return {
    evaluationLeaseGeneration: value.evaluationLeaseGeneration as number,
    finalUsage: {
      cpuTimeSeconds: usage.cpuTimeSeconds as number,
      bytesRead: canonicalNonnegativeInteger(usage.bytesRead, 'finalUsage.bytesRead'),
      bytesWritten: canonicalNonnegativeInteger(usage.bytesWritten, 'finalUsage.bytesWritten'),
      externalEgressBytes: canonicalNonnegativeInteger(
        usage.externalEgressBytes,
        'finalUsage.externalEgressBytes',
      ),
      modelTurns: usage.modelTurns as number,
      modelInputTokens: canonicalNonnegativeInteger(
        usage.modelInputTokens,
        'finalUsage.modelInputTokens',
      ),
      modelOutputTokens: canonicalNonnegativeInteger(
        usage.modelOutputTokens,
        'finalUsage.modelOutputTokens',
      ),
      modelCostMicrousd: canonicalNonnegativeInteger(
        usage.modelCostMicrousd,
        'finalUsage.modelCostMicrousd',
      ),
    },
  };
}

function supportedSchema(value: Record<string, unknown>): 1 | 2 {
  if (
    value.schemaVersion !== EVALUATOR_ATTESTATION_SCHEMA_VERSION &&
    value.schemaVersion !== GENERATED_EVALUATOR_ATTESTATION_SCHEMA_VERSION
  ) {
    throw error('ATTESTATION_SCHEMA_VERSION_UNSUPPORTED');
  }
  return value.schemaVersion;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw error(code);
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(code);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  return value.toLowerCase();
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  return value;
}

function identifier(value: unknown, field: string): string {
  return patternText(value, IDENTIFIER, field);
}

function patternText(value: unknown, pattern: RegExp, field: string): string {
  const text = boundedText(value, 1, 200, field);
  if (!pattern.test(text)) throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  return text;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
  multiline = false,
): string {
  if (typeof value !== 'string' || value !== value.normalize('NFC')) {
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  const controls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (value.length < minimum || value.length > maximum || controls.test(value)) {
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function canonicalPositiveInteger(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) {
    throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function canonicalNonnegativeInteger(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    throw error(`ATTESTATION_${field.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_INVALID`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw error(`ATTESTATION_${field.toUpperCase()}_INVALID`);
  return value;
}

function literal<T extends string>(value: unknown, expected: T, code: string): T {
  if (value !== expected) throw error(code);
  return expected;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  code: string,
): T[number] {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    throw error(code);
  return value as T[number];
}

function stringArray(value: unknown, pattern: RegExp, maximum: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw error(code);
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || !pattern.test(entry)) throw error(code);
    return entry;
  });
  if (new Set(result).size !== result.length) throw error(code);
  return result;
}

function toolchains(value: unknown): Record<string, string> {
  const raw = record(value, 'ATTESTATION_TOOLCHAINS_INVALID');
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.length > 32) throw error('ATTESTATION_TOOLCHAINS_INVALID');
  const result: Record<string, string> = {};
  for (const [key, version] of entries) {
    if (!IDENTIFIER.test(key) || typeof version !== 'string' || !IDENTIFIER.test(version)) {
      throw error('ATTESTATION_TOOLCHAINS_INVALID');
    }
    result[key] = version;
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw error('ATTESTATION_NON_CANONICAL_NUMBER');
    return String(value);
  }
  if (typeof value === 'string') {
    if (value !== value.normalize('NFC')) throw error('ATTESTATION_NON_CANONICAL_STRING');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const recordValue = value as Record<string, unknown>;
    return `{${Object.keys(recordValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(recordValue[key])}`)
      .join(',')}}`;
  }
  throw error('ATTESTATION_NON_JSON_VALUE');
}

function error(code: string): EvaluatorAttestationError {
  return new EvaluatorAttestationError(code);
}
