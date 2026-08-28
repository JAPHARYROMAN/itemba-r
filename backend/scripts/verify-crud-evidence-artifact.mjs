#!/usr/bin/env node

import { isAbsolute, resolve } from 'node:path';
import {
  loadAndVerifyEvidence,
  readBoundedFile,
  releaseExecutionFacts,
  sourceProvenance,
} from './crud-evidence-release-lib.mjs';

try {
  const repositoryRoot = resolve(import.meta.dirname, '../..');
  const source = sourceProvenance(repositoryRoot);
  const expectedCommit = required('MSAIDIZI_CRUD_RELEASE_SOURCE_COMMIT').toLowerCase();
  if (source.commitSha !== expectedCommit) {
    throw new Error('Checked-out source commit does not match the requested release commit.');
  }
  const execution = releaseExecutionFacts(repositoryRoot);
  const evidence = loadAndVerifyEvidence(requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PATH'), {
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
  console.log('CRUD evidence artifact verification: PASS');
  console.log(`Source commit: ${source.commitSha}`);
  console.log(`Application build digest: ${execution.applicationBuildDigest}`);
  console.log(`Prisma schema/migration digest: ${execution.prismaSchemaMigrationDigest}`);
  console.log(`Evidence cases: ${evidence.facts.executedCaseCount}`);
  console.log(`Evidence artifact SHA-256: ${evidence.facts.artifactSha256}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'CRUD evidence artifact verification failed.',
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
