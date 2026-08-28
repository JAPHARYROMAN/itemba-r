#!/usr/bin/env node

import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { readBoundedFile, readBoundedJsonFile } from './crud-evidence-release-lib.mjs';
import { verifyPromotionArtifacts } from './msaidizi-ring-promotion-lib.mjs';

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
  const verified = verifyPromotionArtifacts({
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
    acceptedInventorySha256: required('MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256'),
    acceptedEvidenceSha256: required('MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256'),
    acceptedImageDigest: required('MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST'),
  });

  const outputPath = requiredAbsolute('MSAIDIZI_PROMOTION_INVENTORY_OUTPUT_PATH');
  refuseExistingOutput(outputPath);
  writeFileSync(outputPath, `${JSON.stringify(verified.inventory, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  console.log('Msaidizi production ring release verification: PASS');
  console.log(`Production target: ${verified.inventory.targetId}`);
  console.log(`Ring: ${verified.inventory.ring}`);
  console.log(`Source commit: ${verified.inventory.source.commitSha}`);
  console.log(`Source tree: ${verified.inventory.source.gitTreeDigest}`);
  console.log(`Tracked source SHA-256: ${verified.inventory.source.trackedSourceSha256}`);
  console.log(`Backend image: ${verified.inventory.backendImage.reference}`);
  console.log(`Evidence artifact SHA-256: ${verified.evidenceFacts.artifactSha256}`);
  console.log(`Promotion inventory SHA-256: ${verified.inventorySha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Ring promotion verification failed.');
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
  if (!existsSync(dirname(path)))
    throw new Error('Promotion inventory output directory is missing.');
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('Promotion inventory output directory must be a real directory.');
  }
  if (existsSync(path)) throw new Error('Promotion inventory output already exists.');
}
