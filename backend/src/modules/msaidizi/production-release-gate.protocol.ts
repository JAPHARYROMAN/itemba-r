import { createHash, timingSafeEqual } from 'node:crypto';

export const MSAIDIZI_PRODUCTION_PROMOTION_CONTRACT =
  'msaidizi-production-ring-promotion-inventory/v1' as const;

const CRUD_RELEASE_CONTRACT = 'msaidizi-crud-evidence-release/v1';
const CRUD_RELEASE_WORKFLOW = 'Msaidizi CRUD Evidence Release';
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REFERENCE = /^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RINGS = new Set(['0', '5', '25', '100']);

export interface ProductionReleaseBindingInput {
  inventoryBytes: Buffer;
  evidenceArtifactBytes: Buffer;
  expectedInventorySha256: string;
  expectedEvidenceSha256: string;
  expectedImageDigest: string;
  expectedBackendImageReference: string;
  expectedSourceCommit: string;
  expectedRepository: string;
  expectedEvidenceKeyId: string;
  expectedApplicationBuildDigest: string;
  expectedPrismaSchemaMigrationDigest: string;
}

export interface VerifiedProductionReleaseBinding {
  contract: typeof MSAIDIZI_PRODUCTION_PROMOTION_CONTRACT;
  targetId: string;
  ring: string;
  inventorySha256: string;
  evidenceSha256: string;
  backendImageReference: string;
  backendImageDigest: string;
  sourceCommit: string;
  sourceTree: string;
  repository: string;
  releaseRunId: string;
  releaseRunAttempt: string;
}

/**
 * Verifies the exact promotion inventory already accepted by the independent
 * deployment authority. This function does not create acceptance: every
 * expected digest is operator-owned input, and absence or inconsistency fails
 * closed. CRUD signature/age/coverage verification remains a separate runtime
 * gate so neither check can substitute for the other.
 */
export function verifyProductionReleaseBinding(
  input: ProductionReleaseBindingInput,
): VerifiedProductionReleaseBinding {
  requireBoundedBytes(input.inventoryBytes, 1024 * 1024, 'promotion inventory');
  requireBoundedBytes(input.evidenceArtifactBytes, 5 * 1024 * 1024, 'CRUD evidence artifact');
  requireSha256(input.expectedInventorySha256, 'accepted inventory');
  requireSha256(input.expectedEvidenceSha256, 'accepted evidence');
  requireImageDigest(input.expectedImageDigest, 'accepted image');
  requireImageReference(input.expectedBackendImageReference, 'deployed backend image');
  requireGitObject(input.expectedSourceCommit, 'deployed source commit');
  requireRepository(input.expectedRepository, 'deployed source repository');
  requireIdentifier(input.expectedEvidenceKeyId, 'CRUD evidence key ID');
  requireSha256(input.expectedApplicationBuildDigest, 'application build');
  requireSha256(input.expectedPrismaSchemaMigrationDigest, 'Prisma schema/migration');

  const inventorySha256 = sha256(input.inventoryBytes);
  const evidenceSha256 = sha256(input.evidenceArtifactBytes);
  requireSameDigest(inventorySha256, input.expectedInventorySha256, 'promotion inventory');
  requireSameDigest(evidenceSha256, input.expectedEvidenceSha256, 'CRUD evidence artifact');

  const inventory = parseObject(input.inventoryBytes, 'promotion inventory');
  requireExactKeys(
    inventory,
    [
      'backendImage',
      'contract',
      'environment',
      'evidence',
      'release',
      'ring',
      'source',
      'targetId',
    ],
    'promotion inventory',
  );
  if (
    inventory.contract !== MSAIDIZI_PRODUCTION_PROMOTION_CONTRACT ||
    inventory.environment !== 'production'
  ) {
    throw new Error('PRODUCTION_RELEASE_INVENTORY_CONTRACT_MISMATCH');
  }
  const targetId = requireIdentifier(inventory.targetId, 'production target ID');
  const ring = requireString(inventory.ring, 'promotion ring');
  if (!RINGS.has(ring)) throw new Error('PRODUCTION_RELEASE_RING_INVALID');

  const source = requireObject(inventory.source, 'promotion source');
  requireExactKeys(
    source,
    ['commitSha', 'gitTreeDigest', 'trackedFileCount', 'trackedSourceSha256'],
    'promotion source',
  );
  const sourceCommit = requireGitObject(source.commitSha, 'source commit');
  const sourceTree = requireGitObject(source.gitTreeDigest, 'source tree');
  requireSha256(source.trackedSourceSha256, 'tracked source');
  if (!Number.isInteger(source.trackedFileCount) || Number(source.trackedFileCount) < 1) {
    throw new Error('PRODUCTION_RELEASE_TRACKED_FILE_COUNT_INVALID');
  }
  if (sourceCommit !== input.expectedSourceCommit) {
    throw new Error('PRODUCTION_RELEASE_SOURCE_COMMIT_MISMATCH');
  }

  const backendImage = requireObject(inventory.backendImage, 'promotion backend image');
  requireExactKeys(backendImage, ['digest', 'reference', 'repository'], 'promotion backend image');
  const backendImageReference = requireImageReference(
    backendImage.reference,
    'promotion backend image reference',
  );
  const backendImageDigest = requireImageDigest(
    backendImage.digest,
    'promotion backend image digest',
  );
  const imageRepository = backendImageReference.slice(0, backendImageReference.indexOf('@'));
  if (
    backendImage.repository !== imageRepository ||
    !backendImageReference.endsWith(`@${backendImageDigest}`) ||
    backendImageReference !== input.expectedBackendImageReference ||
    backendImageDigest !== input.expectedImageDigest
  ) {
    throw new Error('PRODUCTION_RELEASE_BACKEND_IMAGE_MISMATCH');
  }

  const evidence = requireObject(inventory.evidence, 'promotion evidence');
  requireExactKeys(
    evidence,
    [
      'applicationBuildDigest',
      'artifactSha256',
      'executedCaseCount',
      'expiresAt',
      'generatedAt',
      'manifestDigest',
      'payloadDigest',
      'prismaSchemaMigrationDigest',
      'runId',
      'signatureKeyId',
    ],
    'promotion evidence',
  );
  const evidenceArtifactSha256 = requireSha256(evidence.artifactSha256, 'inventory evidence');
  requireSha256(evidence.manifestDigest, 'inventory manifest');
  requireSha256(evidence.payloadDigest, 'inventory evidence payload');
  const applicationBuildDigest = requireSha256(
    evidence.applicationBuildDigest,
    'inventory application build',
  );
  const prismaDigest = requireSha256(
    evidence.prismaSchemaMigrationDigest,
    'inventory Prisma schema/migration',
  );
  const evidenceKeyId = requireIdentifier(evidence.signatureKeyId, 'inventory evidence key ID');
  requireIdentifier(evidence.runId, 'inventory evidence run ID');
  requireTimestamp(evidence.generatedAt, 'inventory evidence generatedAt');
  requireTimestamp(evidence.expiresAt, 'inventory evidence expiresAt');
  if (!Number.isInteger(evidence.executedCaseCount) || Number(evidence.executedCaseCount) < 1) {
    throw new Error('PRODUCTION_RELEASE_EVIDENCE_CASE_COUNT_INVALID');
  }
  if (
    evidenceArtifactSha256 !== evidenceSha256 ||
    evidenceKeyId !== input.expectedEvidenceKeyId ||
    applicationBuildDigest !== input.expectedApplicationBuildDigest ||
    prismaDigest !== input.expectedPrismaSchemaMigrationDigest
  ) {
    throw new Error('PRODUCTION_RELEASE_EVIDENCE_BINDING_MISMATCH');
  }

  const release = requireObject(inventory.release, 'promotion release');
  requireExactKeys(
    release,
    ['contract', 'issuedAt', 'payloadDigest', 'pipeline', 'signatureKeyId'],
    'promotion release',
  );
  if (release.contract !== CRUD_RELEASE_CONTRACT) {
    throw new Error('PRODUCTION_RELEASE_BUNDLE_CONTRACT_MISMATCH');
  }
  requireTimestamp(release.issuedAt, 'release issuedAt');
  requireSha256(release.payloadDigest, 'release payload');
  requireIdentifier(release.signatureKeyId, 'release key ID');
  const pipeline = requireObject(release.pipeline, 'promotion release pipeline');
  requireExactKeys(pipeline, ['repository', 'runAttempt', 'runId', 'workflow'], 'release pipeline');
  const repository = requireRepository(pipeline.repository, 'release repository');
  if (repository !== input.expectedRepository || pipeline.workflow !== CRUD_RELEASE_WORKFLOW) {
    throw new Error('PRODUCTION_RELEASE_PIPELINE_MISMATCH');
  }
  const releaseRunId = requirePositiveInteger(pipeline.runId, 'release run ID');
  const releaseRunAttempt = requirePositiveInteger(pipeline.runAttempt, 'release run attempt');

  return Object.freeze({
    contract: MSAIDIZI_PRODUCTION_PROMOTION_CONTRACT,
    targetId,
    ring,
    inventorySha256,
    evidenceSha256,
    backendImageReference,
    backendImageDigest,
    sourceCommit,
    sourceTree,
    repository,
    releaseRunId,
    releaseRunAttempt,
  });
}

function parseObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return requireObject(JSON.parse(bytes.toString('utf8')) as unknown, label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PRODUCTION_RELEASE_')) throw error;
    throw new Error('PRODUCTION_RELEASE_INVENTORY_JSON_INVALID');
  }
}

function requireBoundedBytes(bytes: Buffer, maximum: number, label: string): void {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximum) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_SIZE_INVALID`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_FIELDS_INVALID`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  return value;
}

function requireIdentifier(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!IDENTIFIER.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  return text;
}

function requireSha256(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!SHA256.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_DIGEST_INVALID`);
  return text;
}

function requireImageDigest(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!IMAGE_DIGEST.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_DIGEST_INVALID`);
  return text;
}

function requireImageReference(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!IMAGE_REFERENCE.test(text)) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_REFERENCE_INVALID`);
  }
  return text;
}

function requireGitObject(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!GIT_OBJECT.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  return text;
}

function requireRepository(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!REPOSITORY.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  return text;
}

function requirePositiveInteger(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!POSITIVE_INTEGER.test(text)) throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  return text;
}

function requireTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);
  const milliseconds = Date.parse(text);
  if (
    !UTC_TIMESTAMP.test(text) ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== text
  ) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_INVALID`);
  }
  return text;
}

function requireSameDigest(actual: string, expected: string, label: string): void {
  if (!timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error(`PRODUCTION_RELEASE_${code(label)}_DIGEST_MISMATCH`);
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function code(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
