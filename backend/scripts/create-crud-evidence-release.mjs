#!/usr/bin/env node

import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  createReleasePayload,
  loadAndVerifyEvidence,
  readBoundedFile,
  releaseExecutionFacts,
  signReleasePayload,
  sourceProvenance,
  verifyReleaseBundle,
} from './crud-evidence-release-lib.mjs';

try {
  const repositoryRoot = resolve(import.meta.dirname, '../..');
  const evidencePath = requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PATH');
  const evidencePublicKeyPath = requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH');
  const releasePrivateKeyPath = requiredAbsolute('MSAIDIZI_CRUD_RELEASE_PRIVATE_KEY_PATH');
  const releasePublicKeyPath = requiredAbsolute('MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH');
  const outputPath = requiredAbsolute('MSAIDIZI_CRUD_RELEASE_OUTPUT_PATH');
  refuseExistingOutput(outputPath);

  const source = sourceProvenance(repositoryRoot);
  const expectedCommit = required('MSAIDIZI_CRUD_RELEASE_SOURCE_COMMIT').toLowerCase();
  if (source.commitSha !== expectedCommit) {
    throw new Error('Checked-out source commit does not match the requested release commit.');
  }
  const execution = releaseExecutionFacts(repositoryRoot);
  const evidencePublicKey = readBoundedFile(
    evidencePublicKeyPath,
    16 * 1024,
    'CRUD evidence public key',
  );
  const releasePrivateKey = readBoundedFile(
    releasePrivateKeyPath,
    16 * 1024,
    'CRUD release private key',
  );
  const releasePublicKey = readBoundedFile(
    releasePublicKeyPath,
    16 * 1024,
    'CRUD release public key',
  );
  const evidence = loadAndVerifyEvidence(evidencePath, {
    publicKeyPem: evidencePublicKey,
    expectedKeyId: required('MSAIDIZI_CRUD_EVIDENCE_KEY_ID'),
    expectedApplicationBuildDigest: execution.applicationBuildDigest,
    expectedPrismaSchemaMigrationDigest: execution.prismaSchemaMigrationDigest,
    requireAllPassed: true,
  });
  const payload = createReleasePayload({
    source,
    evidence: evidence.facts,
    backendImageReference: required('MSAIDIZI_CRUD_RELEASE_BACKEND_IMAGE'),
    repository: required('GITHUB_REPOSITORY'),
    workflow: required('GITHUB_WORKFLOW'),
    runId: required('GITHUB_RUN_ID'),
    runAttempt: required('GITHUB_RUN_ATTEMPT'),
  });
  const releaseKeyId = required('MSAIDIZI_CRUD_RELEASE_KEY_ID');
  const bundle = signReleasePayload(payload, releasePrivateKey, releaseKeyId);

  verifyReleaseBundle(bundle, {
    publicKeyPem: releasePublicKey,
    expectedKeyId: releaseKeyId,
    expectedSource: source,
    expectedBackendImageReference: payload.backendImage.reference,
    expectedArtifactSha256: evidence.facts.artifactSha256,
    expectedPipeline: {
      repository: required('GITHUB_REPOSITORY'),
      workflow: required('GITHUB_WORKFLOW'),
      runId: required('GITHUB_RUN_ID'),
      runAttempt: required('GITHUB_RUN_ATTEMPT'),
    },
  });
  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  console.log(`CRUD evidence release bundle: ${outputPath}`);
  console.log(`Source commit: ${source.commitSha}`);
  console.log(`Tracked source SHA-256: ${source.trackedSourceSha256}`);
  console.log(`Backend image: ${payload.backendImage.reference}`);
  console.log(`Evidence artifact SHA-256: ${evidence.facts.artifactSha256}`);
  console.log(`Release payload digest: ${bundle.payloadDigest}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CRUD evidence release creation failed.');
  process.exit(1);
}

function refuseExistingOutput(path) {
  if (!existsSync(dirname(path))) throw new Error('Release output directory does not exist.');
  const directory = lstatSync(dirname(path));
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('Release output directory must be a real directory, not a symlink.');
  }
  if (existsSync(path))
    throw new Error('Release output already exists and will not be overwritten.');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredAbsolute(name) {
  const value = required(name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return value;
}
