import { createHash, createPublicKey, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './crud-evidence-runner-lib.mjs';
import {
  evidenceReleaseFacts,
  immutableImage,
  verifyReleaseBundle,
  verifySignedCrudEvidence,
} from './crud-evidence-release-lib.mjs';

export const MSAIDIZI_PROMOTION_INVENTORY_CONTRACT =
  'msaidizi-production-ring-promotion-inventory/v1';
export const CRUD_EVIDENCE_RELEASE_WORKFLOW = 'Msaidizi CRUD Evidence Release';

const RINGS = new Set(['0', '5', '25', '100']);

export function createPromotionInventory(bundle, input) {
  const targetId = boundedIdentifier(input.targetId, 'production target ID');
  const ring = String(input.ring ?? '');
  if (!RINGS.has(ring)) throw new Error('Promotion ring must be one of 0, 5, 25, or 100.');

  return {
    contract: MSAIDIZI_PROMOTION_INVENTORY_CONTRACT,
    environment: 'production',
    targetId,
    ring,
    source: { ...bundle.source },
    backendImage: { ...bundle.backendImage },
    evidence: { ...bundle.evidence },
    release: {
      contract: bundle.contract,
      issuedAt: bundle.issuedAt,
      payloadDigest: bundle.payloadDigest,
      signatureKeyId: bundle.signature.keyId,
      pipeline: { ...bundle.pipeline },
    },
  };
}

export function promotionInventoryDigest(inventory) {
  verifyPromotionInventoryShape(inventory);
  return sha256Hex(canonicalJson(inventory));
}

export function verifyPromotionArtifacts(input) {
  const verified = verifyPromotionCandidate(input);
  requireAcceptedDigest(
    verified.inventorySha256,
    input.acceptedInventorySha256,
    'production-accepted promotion inventory',
  );
  requireAcceptedDigest(
    verified.evidenceFacts.artifactSha256,
    input.acceptedEvidenceSha256,
    'production-accepted evidence artifact',
  );
  requireAcceptedImageDigest(verified.inventory.backendImage.digest, input.acceptedImageDigest);
  return verified;
}

export function verifyPromotionCandidate(input) {
  const image = immutableImage(input.backendImageReference);
  if (input.evidenceKeyId === input.releaseKeyId) {
    throw new Error('Evidence and release verification key IDs must remain purpose-separated.');
  }
  requireDistinctVerificationKeys(input.evidencePublicKeyPem, input.releasePublicKeyPem);

  const evidenceArtifact = verifySignedCrudEvidence(input.evidenceArtifact, {
    publicKeyPem: input.evidencePublicKeyPem,
    expectedKeyId: input.evidenceKeyId,
    requireAllPassed: true,
    maxAgeMs: input.maxEvidenceAgeMs,
    now: input.now,
  });
  const evidenceFacts = evidenceReleaseFacts(input.evidenceArtifactBytes, evidenceArtifact);

  const bundle = verifyReleaseBundle(input.releaseBundle, {
    publicKeyPem: input.releasePublicKeyPem,
    expectedKeyId: input.releaseKeyId,
    expectedBackendImageReference: image.reference,
    expectedArtifactSha256: evidenceFacts.artifactSha256,
    expectedPipeline: {
      repository: input.repository,
      workflow: CRUD_EVIDENCE_RELEASE_WORKFLOW,
      runId: input.releaseRunId,
      runAttempt: input.releaseRunAttempt,
    },
  });

  if (canonicalJson(bundle.evidence) !== canonicalJson(evidenceFacts)) {
    throw new Error(
      'Release bundle evidence facts do not exactly match the independently verified artifact.',
    );
  }
  const inventory = createPromotionInventory(bundle, {
    targetId: input.targetId,
    ring: input.ring,
  });
  const inventorySha256 = promotionInventoryDigest(inventory);

  return {
    inventory,
    inventorySha256,
    evidenceArtifact,
    evidenceFacts,
    releaseBundle: bundle,
  };
}

export function verifyTargetOciInspection(input) {
  const inventory = verifyPromotionInventoryShape(input.inventory);
  const inventorySha256 = promotionInventoryDigest(inventory);
  requireAcceptedDigest(
    inventorySha256,
    input.acceptedInventorySha256,
    'production-accepted promotion inventory',
  );
  requireAcceptedDigest(
    inventory.evidence.artifactSha256,
    input.acceptedEvidenceSha256,
    'production-accepted evidence artifact',
  );
  requireAcceptedImageDigest(inventory.backendImage.digest, input.acceptedImageDigest);

  const evidenceSha256 = sha256Hex(input.evidenceArtifactBytes);
  if (!safeHexEqual(evidenceSha256, inventory.evidence.artifactSha256)) {
    throw new Error('Target evidence bytes do not match the signed release inventory.');
  }

  const imageInspect = singleDockerInspection(input.imageInspection, 'image');
  if (!isImageDigest(imageInspect.Id)) {
    throw new Error('Target image inspection lacks a canonical image configuration digest.');
  }
  if (
    !Array.isArray(imageInspect.RepoDigests) ||
    !imageInspect.RepoDigests.includes(inventory.backendImage.reference)
  ) {
    throw new Error('Target image does not expose the exact signed repository digest.');
  }
  const sameRepositoryDigests = imageInspect.RepoDigests.filter((value) =>
    value.startsWith(`${inventory.backendImage.repository}@`),
  );
  if (
    sameRepositoryDigests.length !== 1 ||
    sameRepositoryDigests[0] !== inventory.backendImage.reference
  ) {
    throw new Error('Target image repository resolves ambiguously or to an unaccepted digest.');
  }

  const labels = imageInspect.Config?.Labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error('Target image has no OCI labels.');
  }
  const expectedLabels = {
    'org.opencontainers.image.revision': inventory.source.commitSha,
    'org.opencontainers.image.source': `https://github.com/${inventory.release.pipeline.repository}`,
    'io.itemba.msaidizi.source-tree': inventory.source.gitTreeDigest,
    'io.itemba.msaidizi.tracked-source-sha256': inventory.source.trackedSourceSha256,
    'io.itemba.msaidizi.tracked-file-count': String(inventory.source.trackedFileCount),
    'io.itemba.msaidizi.evidence-artifact-sha256': inventory.evidence.artifactSha256,
    'io.itemba.msaidizi.evidence-payload-digest': inventory.evidence.payloadDigest,
    'io.itemba.msaidizi.evidence-manifest-digest': inventory.evidence.manifestDigest,
    'io.itemba.msaidizi.evidence-application-build-digest':
      inventory.evidence.applicationBuildDigest,
    'io.itemba.msaidizi.evidence-prisma-digest': inventory.evidence.prismaSchemaMigrationDigest,
    'io.itemba.msaidizi.release-workflow': inventory.release.pipeline.workflow,
    'io.itemba.msaidizi.release-run-id': inventory.release.pipeline.runId,
    'io.itemba.msaidizi.release-run-attempt': inventory.release.pipeline.runAttempt,
  };
  for (const [label, expected] of Object.entries(expectedLabels)) {
    if (labels[label] !== expected) {
      throw new Error(`Target image OCI label ${label} does not match the signed inventory.`);
    }
  }

  if (input.containerInspection !== undefined) {
    const container = singleDockerInspection(input.containerInspection, 'container');
    if (container.Image !== imageInspect.Id) {
      throw new Error('Running backend container does not use the verified image configuration.');
    }
    if (container.Config?.Image !== inventory.backendImage.reference) {
      throw new Error('Running backend container was not created from the exact signed image.');
    }
  }

  return {
    inventorySha256,
    imageConfigurationDigest: imageInspect.Id,
    backendImageReference: inventory.backendImage.reference,
    evidenceArtifactSha256: evidenceSha256,
  };
}

export function verifyPromotionInventoryShape(input) {
  const inventory = requireRecord(input, 'promotion inventory');
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
    inventory.contract !== MSAIDIZI_PROMOTION_INVENTORY_CONTRACT ||
    inventory.environment !== 'production'
  ) {
    throw new Error('Promotion inventory contract or environment is unsupported.');
  }
  boundedIdentifier(inventory.targetId, 'production target ID');
  if (!RINGS.has(inventory.ring)) {
    throw new Error('Promotion inventory has an unsupported ring.');
  }

  const source = requireRecord(inventory.source, 'promotion source');
  requireExactKeys(
    source,
    ['commitSha', 'gitTreeDigest', 'trackedFileCount', 'trackedSourceSha256'],
    'promotion source',
  );
  requireGitObjectId(source.commitSha, 'source commit');
  requireGitObjectId(source.gitTreeDigest, 'source tree');
  requireSha256(source.trackedSourceSha256, 'tracked source digest');
  if (!Number.isInteger(source.trackedFileCount) || source.trackedFileCount < 1) {
    throw new Error('Promotion source file count is invalid.');
  }

  const image = requireRecord(inventory.backendImage, 'promotion backend image');
  requireExactKeys(image, ['digest', 'reference', 'repository'], 'promotion backend image');
  const parsedImage = immutableImage(image.reference);
  if (parsedImage.repository !== image.repository || parsedImage.digest !== image.digest) {
    throw new Error('Promotion backend image fields are inconsistent.');
  }

  const evidence = requireRecord(inventory.evidence, 'promotion evidence');
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
  for (const [label, value] of [
    ['evidence artifact', evidence.artifactSha256],
    ['evidence payload', evidence.payloadDigest],
    ['manifest', evidence.manifestDigest],
    ['application build', evidence.applicationBuildDigest],
    ['Prisma schema/migration', evidence.prismaSchemaMigrationDigest],
  ]) {
    requireSha256(value, `${label} digest`);
  }
  boundedIdentifier(evidence.signatureKeyId, 'evidence signature key ID');
  boundedIdentifier(evidence.runId, 'evidence run ID');
  requireCanonicalTimestamp(evidence.generatedAt, 'evidence generatedAt');
  requireCanonicalTimestamp(evidence.expiresAt, 'evidence expiresAt');
  if (!Number.isInteger(evidence.executedCaseCount) || evidence.executedCaseCount < 1) {
    throw new Error('Promotion evidence case count is invalid.');
  }

  const release = requireRecord(inventory.release, 'promotion release');
  requireExactKeys(
    release,
    ['contract', 'issuedAt', 'payloadDigest', 'pipeline', 'signatureKeyId'],
    'promotion release',
  );
  if (release.contract !== 'msaidizi-crud-evidence-release/v1') {
    throw new Error('Promotion release contract is unsupported.');
  }
  requireCanonicalTimestamp(release.issuedAt, 'release issuedAt');
  requireSha256(release.payloadDigest, 'release payload digest');
  boundedIdentifier(release.signatureKeyId, 'release signature key ID');
  const pipeline = requireRecord(release.pipeline, 'promotion pipeline');
  requireExactKeys(
    pipeline,
    ['repository', 'runAttempt', 'runId', 'workflow'],
    'promotion pipeline',
  );
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pipeline.repository)) {
    throw new Error('Promotion pipeline repository is invalid.');
  }
  if (pipeline.workflow !== CRUD_EVIDENCE_RELEASE_WORKFLOW) {
    throw new Error(
      'Promotion pipeline workflow is not the trusted CRUD evidence release workflow.',
    );
  }
  if (!/^[1-9][0-9]{0,19}$/.test(pipeline.runId)) {
    throw new Error('Promotion pipeline run ID is invalid.');
  }
  if (!/^[1-9][0-9]{0,19}$/.test(pipeline.runAttempt)) {
    throw new Error('Promotion pipeline run attempt is invalid.');
  }
  return inventory;
}

function requireDistinctVerificationKeys(evidenceKeyPem, releaseKeyPem) {
  const evidenceSpki = publicKeySpkiDigest(evidenceKeyPem, 'evidence');
  const releaseSpki = publicKeySpkiDigest(releaseKeyPem, 'release');
  if (safeHexEqual(evidenceSpki, releaseSpki)) {
    throw new Error('Evidence and release verification keys must remain purpose-separated.');
  }
}

function publicKeySpkiDigest(value, label) {
  let key;
  try {
    key = createPublicKey(value);
  } catch {
    throw new Error(`${label} verification key is invalid.`);
  }
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (key.asymmetricKeyType !== 'ec' || !['prime256v1', 'P-256'].includes(curve)) {
    throw new Error(`${label} verification key must be EC P-256.`);
  }
  return sha256Hex(key.export({ type: 'spki', format: 'der' }));
}

function singleDockerInspection(input, label) {
  const value = Array.isArray(input) ? input : [input];
  if (value.length !== 1)
    throw new Error(`Docker ${label} inspection must contain exactly one item.`);
  return requireRecord(value[0], `Docker ${label} inspection`);
}

function requireAcceptedDigest(actual, expected, label) {
  requireSha256(expected, `${label} digest`);
  if (!safeHexEqual(actual, expected)) {
    throw new Error(`${label} digest does not match the protected acceptance value.`);
  }
}

function requireAcceptedImageDigest(actual, expected) {
  if (!isImageDigest(expected) || actual !== expected) {
    throw new Error(
      'Backend image digest does not match the protected production-accepted image digest.',
    );
  }
}

function requireCanonicalTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} is not a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireExactKeys(value, keys, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireGitObjectId(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} is not a lowercase immutable Git object ID.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256.`);
  }
}

function boundedIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isImageDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left ?? '') || !/^[a-f0-9]{64}$/.test(right ?? '')) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}
