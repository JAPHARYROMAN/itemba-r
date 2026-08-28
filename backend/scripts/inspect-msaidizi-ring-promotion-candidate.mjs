#!/usr/bin/env node

// Offline review helper only. It verifies both signed envelopes and derives the
// canonical target/ring inventory, but it does not accept that inventory and is
// deliberately never called by the protected promotion workflow.

import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { readBoundedFile, readBoundedJsonFile } from './crud-evidence-release-lib.mjs';
import { verifyPromotionCandidate } from './msaidizi-ring-promotion-lib.mjs';

try {
  const evidence = readBoundedJsonFile(
    requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PATH'),
    5 * 1024 * 1024,
    'CRUD evidence artifact',
  );
  const release = readBoundedJsonFile(
    requiredAbsolute('MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH'),
    1024 * 1024,
    'CRUD evidence release bundle',
  );
  const candidate = verifyPromotionCandidate({
    evidenceArtifact: evidence.value,
    evidenceArtifactBytes: evidence.bytes,
    evidencePublicKeyPem: readBoundedFile(
      requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH'),
      16 * 1024,
      'trusted CRUD evidence public key',
    ),
    evidenceKeyId: required('MSAIDIZI_CRUD_EVIDENCE_KEY_ID'),
    releaseBundle: release.value,
    releasePublicKeyPem: readBoundedFile(
      requiredAbsolute('MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH'),
      16 * 1024,
      'trusted CRUD release public key',
    ),
    releaseKeyId: required('MSAIDIZI_CRUD_RELEASE_KEY_ID'),
    backendImageReference: required('MSAIDIZI_PROMOTION_BACKEND_IMAGE'),
    repository: required('MSAIDIZI_PROMOTION_REPOSITORY'),
    releaseRunId: required('MSAIDIZI_PROMOTION_RELEASE_RUN_ID'),
    releaseRunAttempt: required('MSAIDIZI_PROMOTION_RELEASE_RUN_ATTEMPT'),
    targetId: required('MSAIDIZI_PRODUCTION_TARGET_ID'),
    ring: required('MSAIDIZI_PROMOTION_RING'),
  });
  const outputPath = requiredAbsolute('MSAIDIZI_PROMOTION_CANDIDATE_OUTPUT_PATH');
  refuseExistingOutput(outputPath);
  writeFileSync(outputPath, `${JSON.stringify(candidate.inventory, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  console.log('Msaidizi ring promotion candidate signature verification: PASS');
  console.log('ACCEPTANCE STATUS: NOT ACCEPTED');
  console.log(`Candidate target: ${candidate.inventory.targetId}`);
  console.log(`Candidate ring: ${candidate.inventory.ring}`);
  console.log(`Candidate inventory SHA-256: ${candidate.inventorySha256}`);
  console.log(`Candidate evidence SHA-256: ${candidate.evidenceFacts.artifactSha256}`);
  console.log(`Candidate image digest: ${candidate.inventory.backendImage.digest}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Candidate inspection failed.');
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

function refuseExistingOutput(path) {
  if (!existsSync(dirname(path))) throw new Error('Candidate output directory is missing.');
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('Candidate output directory must be a real directory.');
  }
  if (existsSync(path)) throw new Error('Candidate output already exists.');
}
