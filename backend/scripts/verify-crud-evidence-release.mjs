#!/usr/bin/env node

import { isAbsolute, resolve } from 'node:path';
import {
  loadAndVerifyEvidence,
  loadAndVerifyReleaseBundle,
  readBoundedFile,
  releaseExecutionFacts,
  sourceProvenance,
} from './crud-evidence-release-lib.mjs';

try {
  const repositoryRoot = resolve(import.meta.dirname, '../..');
  const source = sourceProvenance(repositoryRoot);
  const execution = releaseExecutionFacts(repositoryRoot);
  const evidencePath = requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PATH');
  const evidence = loadAndVerifyEvidence(evidencePath, {
    publicKeyPem: readBoundedFile(
      requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH'),
      16 * 1024,
      'CRUD evidence public key',
    ),
    expectedKeyId: required('MSAIDIZI_CRUD_EVIDENCE_KEY_ID'),
    expectedApplicationBuildDigest: execution.applicationBuildDigest,
    expectedPrismaSchemaMigrationDigest: execution.prismaSchemaMigrationDigest,
    requireAllPassed: true,
  });
  const expectedCommit = required('MSAIDIZI_CRUD_RELEASE_SOURCE_COMMIT').toLowerCase();
  if (source.commitSha !== expectedCommit) {
    throw new Error('Checked-out source commit does not match the requested release commit.');
  }
  const bundle = loadAndVerifyReleaseBundle(requiredAbsolute('MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH'), {
    publicKeyPem: readBoundedFile(
      requiredAbsolute('MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH'),
      16 * 1024,
      'CRUD release public key',
    ),
    expectedKeyId: required('MSAIDIZI_CRUD_RELEASE_KEY_ID'),
    expectedSource: source,
    expectedBackendImageReference: required('MSAIDIZI_CRUD_RELEASE_BACKEND_IMAGE'),
    expectedArtifactSha256: evidence.facts.artifactSha256,
    expectedPipeline: {
      repository: required('GITHUB_REPOSITORY'),
      workflow: required('GITHUB_WORKFLOW'),
      runId: required('GITHUB_RUN_ID'),
      runAttempt: required('GITHUB_RUN_ATTEMPT'),
    },
  });
  if (
    bundle.evidence.payloadDigest !== evidence.facts.payloadDigest ||
    bundle.evidence.applicationBuildDigest !== execution.applicationBuildDigest ||
    bundle.evidence.prismaSchemaMigrationDigest !== execution.prismaSchemaMigrationDigest
  ) {
    throw new Error(
      'Release bundle evidence facts do not match the independently verified artifact.',
    );
  }
  console.log('CRUD evidence release verification: PASS');
  console.log(`Source commit: ${source.commitSha}`);
  console.log(`Backend image: ${bundle.backendImage.reference}`);
  console.log(`Evidence cases: ${evidence.facts.executedCaseCount}`);
  console.log(`Release payload digest: ${bundle.payloadDigest}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'CRUD evidence release verification failed.',
  );
  process.exit(1);
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
