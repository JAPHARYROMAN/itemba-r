import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { canonicalJson } from './crud-evidence-runner-lib.mjs';
import {
  createReleasePayload,
  evidenceReleaseFacts,
  signReleasePayload,
} from './crud-evidence-release-lib.mjs';
import {
  createPromotionInventory,
  promotionInventoryDigest,
  verifyPromotionArtifacts,
  verifyPromotionCandidate,
  verifyTargetOciInspection,
} from './msaidizi-ring-promotion-lib.mjs';

const generatedAt = '2026-08-27T10:00:00.000Z';
const now = new Date('2026-08-27T10:01:00.000Z');
const evidenceKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const releaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const evidenceKeyId = 'crud-evidence-test-2026-01';
const releaseKeyId = 'crud-release-test-2026-01';
const repository = 'itemba/itemba-r';
const targetId = 'itemba-production-primary';
const ring = '0';
const source = {
  commitSha: '1'.repeat(40),
  gitTreeDigest: '2'.repeat(40),
  trackedSourceSha256: '3'.repeat(64),
  trackedFileCount: 120,
};
const backendImageReference = `ghcr.io/itemba/itemba-r-backend@sha256:${'4'.repeat(64)}`;

test('verifies both ES256 envelopes and every production-accepted digest', () => {
  const fixture = signedReleaseFixture();
  const result = verifyPromotionArtifacts({
    ...fixture.verification,
    now,
  });

  assert.equal(result.inventorySha256, fixture.acceptedInventorySha256);
  assert.equal(result.inventory.source.gitTreeDigest, source.gitTreeDigest);
  assert.equal(result.inventory.source.trackedSourceSha256, source.trackedSourceSha256);
  assert.equal(result.inventory.release.pipeline.workflow, 'Msaidizi CRUD Evidence Release');
  assert.equal(result.evidenceFacts.artifactSha256, fixture.acceptedEvidenceSha256);
});

test('derives a signed candidate without misrepresenting it as production acceptance', () => {
  const fixture = signedReleaseFixture();
  const {
    acceptedInventorySha256: ignoredInventory,
    acceptedEvidenceSha256: ignoredEvidence,
    acceptedImageDigest: ignoredImage,
    ...candidateInput
  } = fixture.verification;
  void ignoredInventory;
  void ignoredEvidence;
  void ignoredImage;
  const result = verifyPromotionCandidate({ ...candidateInput, now });
  assert.equal(result.inventorySha256, fixture.acceptedInventorySha256);
  assert.equal(result.inventory.environment, 'production');

  const inspector = readFileSync(
    resolve(import.meta.dirname, 'inspect-msaidizi-ring-promotion-candidate.mjs'),
    'utf8',
  );
  assert.match(inspector, /ACCEPTANCE STATUS: NOT ACCEPTED/);
});

test('fails closed on inventory, evidence, image, source, or workflow drift', () => {
  const fixture = signedReleaseFixture();
  for (const override of [
    { acceptedInventorySha256: '8'.repeat(64) },
    { acceptedEvidenceSha256: '8'.repeat(64) },
    { acceptedImageDigest: `sha256:${'8'.repeat(64)}` },
    { releaseRunAttempt: '2' },
    { repository: 'attacker/itemba-r' },
  ]) {
    assert.throws(
      () => verifyPromotionArtifacts({ ...fixture.verification, ...override, now }),
      /does not match|pipeline|accepted/i,
    );
  }

  assert.throws(
    () =>
      verifyPromotionArtifacts({
        ...fixture.verification,
        releaseBundle: {
          ...fixture.releaseBundle,
          source: { ...fixture.releaseBundle.source, gitTreeDigest: '9'.repeat(40) },
        },
        now,
      }),
    /signature did not verify|payload digest/i,
  );
});

test('requires purpose-separated P-256 evidence and release trust roots', () => {
  const fixture = signedReleaseFixture();
  assert.throws(
    () =>
      verifyPromotionArtifacts({
        ...fixture.verification,
        releasePublicKeyPem: fixture.verification.evidencePublicKeyPem,
        now,
      }),
    /purpose-separated/,
  );
  assert.throws(
    () =>
      verifyPromotionArtifacts({
        ...fixture.verification,
        releaseKeyId: fixture.verification.evidenceKeyId,
        now,
      }),
    /key IDs must remain purpose-separated/,
  );
});

test('verifies exact target repository digest, OCI labels, and running container image', () => {
  const fixture = signedReleaseFixture();
  const imageConfigurationDigest = `sha256:${'7'.repeat(64)}`;
  const imageInspection = [
    {
      Id: imageConfigurationDigest,
      RepoDigests: [backendImageReference],
      Config: {
        Labels: {
          'org.opencontainers.image.revision': source.commitSha,
          'org.opencontainers.image.source': `https://github.com/${repository}`,
          'io.itemba.msaidizi.source-tree': source.gitTreeDigest,
          'io.itemba.msaidizi.tracked-source-sha256': source.trackedSourceSha256,
          'io.itemba.msaidizi.tracked-file-count': String(source.trackedFileCount),
          'io.itemba.msaidizi.evidence-artifact-sha256': fixture.acceptedEvidenceSha256,
          'io.itemba.msaidizi.evidence-payload-digest': fixture.inventory.evidence.payloadDigest,
          'io.itemba.msaidizi.evidence-manifest-digest': fixture.inventory.evidence.manifestDigest,
          'io.itemba.msaidizi.evidence-application-build-digest':
            fixture.inventory.evidence.applicationBuildDigest,
          'io.itemba.msaidizi.evidence-prisma-digest':
            fixture.inventory.evidence.prismaSchemaMigrationDigest,
          'io.itemba.msaidizi.release-workflow': 'Msaidizi CRUD Evidence Release',
          'io.itemba.msaidizi.release-run-id': '1234',
          'io.itemba.msaidizi.release-run-attempt': '1',
        },
      },
    },
  ];
  const containerInspection = [
    {
      Image: imageConfigurationDigest,
      Config: { Image: backendImageReference },
    },
  ];
  const result = verifyTargetOciInspection({
    inventory: fixture.inventory,
    evidenceArtifactBytes: fixture.evidenceArtifactBytes,
    imageInspection,
    containerInspection,
    acceptedInventorySha256: fixture.acceptedInventorySha256,
    acceptedEvidenceSha256: fixture.acceptedEvidenceSha256,
    acceptedImageDigest: `sha256:${'4'.repeat(64)}`,
  });
  assert.equal(result.imageConfigurationDigest, imageConfigurationDigest);

  assert.throws(
    () =>
      verifyTargetOciInspection({
        inventory: fixture.inventory,
        evidenceArtifactBytes: fixture.evidenceArtifactBytes,
        imageInspection: [
          {
            ...imageInspection[0],
            Config: {
              Labels: {
                ...imageInspection[0].Config.Labels,
                'org.opencontainers.image.revision': '9'.repeat(40),
              },
            },
          },
        ],
        containerInspection,
        acceptedInventorySha256: fixture.acceptedInventorySha256,
        acceptedEvidenceSha256: fixture.acceptedEvidenceSha256,
        acceptedImageDigest: `sha256:${'4'.repeat(64)}`,
      }),
    /org\.opencontainers\.image\.revision/,
  );
  assert.throws(
    () =>
      verifyTargetOciInspection({
        inventory: fixture.inventory,
        evidenceArtifactBytes: fixture.evidenceArtifactBytes,
        imageInspection,
        containerInspection: [
          { Image: `sha256:${'6'.repeat(64)}`, Config: { Image: backendImageReference } },
        ],
        acceptedInventorySha256: fixture.acceptedInventorySha256,
        acceptedEvidenceSha256: fixture.acceptedEvidenceSha256,
        acceptedImageDigest: `sha256:${'4'.repeat(64)}`,
      }),
    /running backend container/i,
  );
});

test('manual workflow and target script keep promotion protected and build-free', () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, '../../.github/workflows/msaidizi-ring-promotion.yml'),
    'utf8',
  );
  const targetScript = readFileSync(
    resolve(import.meta.dirname, '../../deploy/relaunch/promote-msaidizi-ring.sh'),
    'utf8',
  );
  const ringCompose = readFileSync(
    resolve(import.meta.dirname, '../../deploy/relaunch/docker-compose.msaidizi-ring.yml'),
    'utf8',
  );
  for (const required of [
    'workflow_dispatch:',
    "default: 'verify-only'",
    'environment: msaidizi-production-ring-promotion',
    'MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256',
    'MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256',
    'MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST',
    'verify-msaidizi-ring-promotion.mjs',
    'verify-msaidizi-target-oci.mjs',
    'repository@sha256:<digest>',
    'MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH',
    'MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE',
    'MSAIDIZI_DEPLOYED_SOURCE_COMMIT',
    'MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY',
    '/run/msaidizi/promotion-inventory.json',
    'read_only: true',
    '--no-build',
  ]) {
    assert.match(
      `${workflow}\n${targetScript}\n${ringCompose}`,
      new RegExp(escapeRegExp(required)),
    );
  }
  assert.doesNotMatch(workflow, /docker\s+(?:build|buildx)\b/);
  assert.doesNotMatch(workflow, /inspect-msaidizi-ring-promotion-candidate/);
  assert.doesNotMatch(targetScript, /docker(?:\s+compose)?\s+(?:build|buildx)\b/);
  assert.doesNotMatch(`${workflow}\n${targetScript}`, /continue-on-error\s*:\s*true/);
  assert.ok(
    workflow.indexOf('verify-msaidizi-ring-promotion.mjs') <
      workflow.indexOf('promote-msaidizi-ring.sh'),
  );
  assert.ok(targetScript.indexOf('verify-msaidizi-target-oci.mjs') < targetScript.indexOf('up -d'));
});

test('manual release and deployment workflows never splice dispatch inputs into shell source', () => {
  for (const relativePath of [
    '../../.github/workflows/msaidizi-ring-promotion.yml',
    '../../.github/workflows/crud-evidence-release.yml',
    '../../.github/workflows/deploy-production.yml',
  ]) {
    const workflow = readFileSync(resolve(import.meta.dirname, relativePath), 'utf8');
    assert.deepEqual(
      untrustedExpressionsInsideRunBlocks(workflow),
      [],
      `${relativePath} must pass dispatch inputs through env instead of generated shell source`,
    );
  }
});

function signedReleaseFixture() {
  const evidenceArtifact = signedEvidence();
  const evidenceArtifactBytes = Buffer.from(`${JSON.stringify(evidenceArtifact)}\n`);
  const evidenceFacts = evidenceReleaseFacts(evidenceArtifactBytes, evidenceArtifact);
  const payload = createReleasePayload({
    issuedAt: '2026-08-27T10:00:30.000Z',
    source,
    evidence: evidenceFacts,
    backendImageReference,
    repository,
    workflow: 'Msaidizi CRUD Evidence Release',
    runId: '1234',
    runAttempt: '1',
  });
  const releaseBundle = signReleasePayload(
    payload,
    releaseKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    releaseKeyId,
  );
  const inventory = createPromotionInventory(releaseBundle, { targetId, ring });
  const acceptedInventorySha256 = promotionInventoryDigest(inventory);
  return {
    evidenceArtifact,
    evidenceArtifactBytes,
    releaseBundle,
    inventory,
    acceptedInventorySha256,
    acceptedEvidenceSha256: evidenceFacts.artifactSha256,
    verification: {
      evidenceArtifact,
      evidenceArtifactBytes,
      evidencePublicKeyPem: evidenceKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      evidenceKeyId,
      releaseBundle,
      releasePublicKeyPem: releaseKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      releaseKeyId,
      backendImageReference,
      repository,
      releaseRunId: '1234',
      releaseRunAttempt: '1',
      targetId,
      ring,
      acceptedInventorySha256,
      acceptedEvidenceSha256: evidenceFacts.artifactSha256,
      acceptedImageDigest: `sha256:${'4'.repeat(64)}`,
    },
  };
}

function signedEvidence() {
  const payload = {
    contract: 'msaidizi-crud-execution-evidence/v2',
    harnessVersion: '2.1.0',
    runId: 'promotion_test_run',
    generatedAt,
    expiresAt: '2026-09-03T10:00:00.000Z',
    manifestDigest: 'a'.repeat(64),
    provenance: {
      applicationBuildDigest: 'b'.repeat(64),
      prismaSchemaMigrationDigest: 'c'.repeat(64),
    },
    database: { disposable: true, isolatedSchemaNameDigest: 'd'.repeat(64) },
    cases: [
      {
        fixtureId: 'customers-list-positive',
        fixtureVersion: 1,
        capabilityId: 'CustomersController.findAll',
        capabilityContractDigest: 'e'.repeat(64),
        fixtureContractDigest: 'f'.repeat(64),
        controlKind: 'positive',
        outcome: 'passed',
        httpStatus: 200,
        assertions: [{ name: 'returned exact seeded customer', passed: true }],
        finishedAt: '2026-08-27T09:59:00.000Z',
      },
    ],
  };
  const canonical = canonicalJson(payload);
  const signature = cryptoSign('sha256', Buffer.from(canonical), {
    key: evidenceKeys.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    ...payload,
    payloadDigest: createHash('sha256').update(canonical).digest('hex'),
    signature: { algorithm: 'ES256', keyId: evidenceKeyId, value: signature.toString('base64') },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function untrustedExpressionsInsideRunBlocks(workflow) {
  const findings = [];
  const lines = workflow.split(/\r?\n/);
  let runIndent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)[0].length;
    if (runIndent !== null && line.trim() && indent <= runIndent) runIndent = null;
    if (/^\s*run:\s*[>|]-?\s*$/.test(line)) {
      runIndent = indent;
      continue;
    }
    if (runIndent !== null && /\$\{\{\s*(?:inputs\.|github\.event\.)/.test(line)) {
      findings.push({ line: index + 1, source: line.trim() });
    }
  }
  return findings;
}
