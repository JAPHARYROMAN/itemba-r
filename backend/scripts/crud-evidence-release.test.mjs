import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { canonicalJson } from './crud-evidence-runner-lib.mjs';
import {
  CRUD_EVIDENCE_RELEASE_CONTRACT,
  createReleasePayload,
  evidenceReleaseFacts,
  immutableImage,
  readBoundedFile,
  signReleasePayload,
  sourceProvenance,
  verifyReleaseBundle,
  verifySignedCrudEvidence,
} from './crud-evidence-release-lib.mjs';

const generatedAt = '2026-08-27T10:00:00.000Z';
const now = new Date('2026-08-27T10:01:00.000Z');
const evidenceKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const releaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const evidenceKeyId = 'crud-evidence-test-2026-01';
const releaseKeyId = 'crud-release-test-2026-01';
const source = {
  commitSha: '1'.repeat(40),
  gitTreeDigest: '2'.repeat(40),
  trackedSourceSha256: '3'.repeat(64),
  trackedFileCount: 120,
};
const backendImageReference = `ghcr.io/itemba/itemba-r-backend@sha256:${'4'.repeat(64)}`;

test('independently verifies a closed ES256 evidence artifact and every passing case', () => {
  const artifact = signedEvidence();
  assert.equal(verifySignedCrudEvidence(artifact, evidenceVerificationOptions()), artifact);

  assert.throws(
    () =>
      verifySignedCrudEvidence({ ...artifact, unexpected: true }, evidenceVerificationOptions()),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      verifySignedCrudEvidence(
        {
          ...artifact,
          cases: [{ ...artifact.cases[0], outcome: 'failed', httpStatus: 500 }],
        },
        evidenceVerificationOptions(),
      ),
    /non-passing case/,
  );
});

test('rejects evidence payload tampering, a wrong key, and execution provenance drift', () => {
  const artifact = signedEvidence();
  assert.throws(
    () =>
      verifySignedCrudEvidence(
        { ...artifact, manifestDigest: '9'.repeat(64) },
        evidenceVerificationOptions(),
      ),
    /payload digest/,
  );
  const wrongKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(
    () =>
      verifySignedCrudEvidence(artifact, {
        ...evidenceVerificationOptions(),
        publicKeyPem: wrongKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    /did not verify/,
  );
  assert.throws(
    () =>
      verifySignedCrudEvidence(artifact, {
        ...evidenceVerificationOptions(),
        expectedApplicationBuildDigest: '8'.repeat(64),
      }),
    /execution bundle/,
  );
});

test('signs a release binding over the exact source, image digest, and evidence artifact', () => {
  const artifact = signedEvidence();
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const facts = evidenceReleaseFacts(artifactBytes, artifact);
  const payload = createReleasePayload({
    issuedAt: '2026-08-27T10:02:00.000Z',
    source,
    evidence: facts,
    backendImageReference,
    repository: 'itemba/itemba-r',
    workflow: 'Msaidizi CRUD Evidence Release',
    runId: '1234',
    runAttempt: '1',
  });
  const bundle = signReleasePayload(
    payload,
    releaseKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    releaseKeyId,
  );
  const options = {
    publicKeyPem: releaseKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    expectedKeyId: releaseKeyId,
    expectedSource: source,
    expectedBackendImageReference: backendImageReference,
    expectedArtifactSha256: facts.artifactSha256,
    expectedPipeline: {
      repository: 'itemba/itemba-r',
      workflow: 'Msaidizi CRUD Evidence Release',
      runId: '1234',
      runAttempt: '1',
    },
  };
  assert.equal(verifyReleaseBundle(bundle, options), bundle);
  assert.equal(bundle.contract, CRUD_EVIDENCE_RELEASE_CONTRACT);
  assert.equal(bundle.backendImage.digest, `sha256:${'4'.repeat(64)}`);

  assert.throws(
    () =>
      verifyReleaseBundle(
        { ...bundle, backendImage: { ...bundle.backendImage, digest: `sha256:${'5'.repeat(64)}` } },
        options,
      ),
    /internally consistent/,
  );
  assert.throws(
    () => verifyReleaseBundle(bundle, { ...options, expectedArtifactSha256: '6'.repeat(64) }),
    /artifact digest/,
  );
  assert.throws(
    () =>
      verifyReleaseBundle(bundle, {
        ...options,
        expectedPipeline: { ...options.expectedPipeline, workflow: 'Untrusted Workflow' },
      }),
    /pipeline workflow/,
  );
});

test('accepts only immutable digest-qualified backend image references', () => {
  assert.deepEqual(immutableImage(backendImageReference), {
    reference: backendImageReference,
    repository: 'ghcr.io/itemba/itemba-r-backend',
    digest: `sha256:${'4'.repeat(64)}`,
  });
  for (const invalid of [
    'ghcr.io/itemba/itemba-r-backend:latest',
    `ghcr.io/itemba/itemba-r-backend:release@sha256:${'4'.repeat(64)}`,
    `ghcr.io/itemba/../itemba-r-backend@sha256:${'4'.repeat(64)}`,
    `ghcr.io/Itemba/itemba-r-backend@sha256:${'4'.repeat(64)}`,
    `ghcr.io/itemba/itemba-r-backend@sha256:${'4'.repeat(63)}`,
  ]) {
    assert.throws(() => immutableImage(invalid), /immutable digest reference|repository@sha256/);
  }
});

test('hashes a clean tracked source tree and refuses later tracked drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-release-source-'));
  try {
    git(root, 'init');
    git(root, 'config', 'user.email', 'crud-release-test@itemba.local');
    git(root, 'config', 'user.name', 'CRUD Release Test');
    writeFileSync(join(root, 'source.txt'), 'release source v1\n');
    git(root, 'add', 'source.txt');
    git(root, 'commit', '-m', 'source fixture');
    const facts = sourceProvenance(root);
    assert.match(facts.commitSha, /^[a-f0-9]{40}$|^[a-f0-9]{64}$/);
    assert.match(facts.gitTreeDigest, /^[a-f0-9]{40}$|^[a-f0-9]{64}$/);
    assert.match(facts.trackedSourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(facts.trackedFileCount, 1);

    writeFileSync(join(root, 'source.txt'), 'release source drift\n');
    assert.throws(() => sourceProvenance(root), /Tracked source changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects hard-linked release inputs instead of trusting an alias', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-release-input-'));
  try {
    const original = join(root, 'public.pem');
    const alias = join(root, 'public-alias.pem');
    writeFileSync(original, 'bounded release input\n');
    linkSync(original, alias);
    assert.throws(
      () => readBoundedFile(original, 1024, 'release test input'),
      /exactly one hard link/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release schema and workflow keep the promotion path closed and explicit', () => {
  const schema = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'crud-evidence-release.schema.json'), 'utf8'),
  );
  assert.equal(schema.properties.contract.const, CRUD_EVIDENCE_RELEASE_CONTRACT);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.source.additionalProperties, false);
  assert.equal(schema.properties.backendImage.additionalProperties, false);
  assert.equal(schema.properties.evidence.additionalProperties, false);
  assert.equal(schema.properties.pipeline.additionalProperties, false);
  assert.equal(schema.properties.signature.properties.algorithm.const, 'ES256');
  assert.equal(schema.properties.signature.properties.value.minLength, 88);
  assert.equal(schema.properties.signature.properties.value.maxLength, 88);

  const workflow = readFileSync(
    resolve(import.meta.dirname, '../../.github/workflows/crud-evidence-release.yml'),
    'utf8',
  );
  for (const required of [
    'workflow_dispatch:',
    'environment: msaidizi-crud-evidence-release',
    'CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK:',
    'MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PEM',
    'MSAIDIZI_CRUD_RELEASE_PRIVATE_KEY_PEM',
    'npm run evidence:crud',
    'verify-crud-evidence-release.mjs',
    'if-no-files-found: error',
    'retention-days: 30',
    'repository@sha256:<digest>',
    'postgres:16@sha256:',
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'persist-credentials: false',
    'org.opencontainers.image.revision=',
    'io.itemba.msaidizi.source-tree=',
    'io.itemba.msaidizi.tracked-source-sha256=',
    'io.itemba.msaidizi.evidence-artifact-sha256=',
    'io.itemba.msaidizi.evidence-payload-digest=',
    'io.itemba.msaidizi.release-workflow=',
    'Remove the evidence private key after artifact verification',
    'Remove the release private key after binding signature',
    'Release binding must not reuse the evidence signing key',
  ]) {
    assert.match(workflow, new RegExp(escapeRegExp(required)));
  }
  assert.doesNotMatch(workflow, /continue-on-error\s*:\s*true/);
  assert.doesNotMatch(workflow, /evidence_key_id=|release_key_id=/);
  const execute = workflow.indexOf('npm run evidence:crud');
  const verify = workflow.indexOf('verify-crud-evidence-artifact.mjs', execute);
  const image = workflow.indexOf('docker buildx build', verify);
  const releaseKey = workflow.indexOf('Provision the purpose-separated P-256 release-binding key');
  const bind = workflow.indexOf('create-crud-evidence-release.mjs', releaseKey);
  const upload = workflow.indexOf('actions/upload-artifact@', bind);
  assert.ok(execute >= 0 && verify > execute && image > verify);
  assert.ok(releaseKey > image && bind > releaseKey && upload > bind);
  assert.ok(workflow.indexOf('MSAIDIZI_CRUD_RELEASE_PRIVATE_KEY_PEM') > image);
  assert.ok(workflow.indexOf('GHCR_TOKEN') > verify);
});

function signedEvidence() {
  const payload = {
    contract: 'msaidizi-crud-execution-evidence/v2',
    harnessVersion: '2.1.0',
    runId: 'release_test_run',
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

function evidenceVerificationOptions() {
  return {
    publicKeyPem: evidenceKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    expectedKeyId: evidenceKeyId,
    expectedApplicationBuildDigest: 'b'.repeat(64),
    expectedPrismaSchemaMigrationDigest: 'c'.repeat(64),
    requireAllPassed: true,
    now,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
}
