#!/usr/bin/env node

import { isAbsolute } from 'node:path';
import { readBoundedFile, readBoundedJsonFile } from './crud-evidence-release-lib.mjs';
import { verifyTargetOciInspection } from './msaidizi-ring-promotion-lib.mjs';

try {
  const containerPath = optionalAbsolute('MSAIDIZI_PROMOTION_CONTAINER_INSPECT_PATH');
  const verified = verifyTargetOciInspection({
    inventory: readBoundedJsonFile(
      requiredAbsolute('MSAIDIZI_PROMOTION_INVENTORY_PATH'),
      1024 * 1024,
      'promotion inventory',
    ).value,
    evidenceArtifactBytes: readBoundedFile(
      requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PATH'),
      5 * 1024 * 1024,
      'CRUD evidence artifact',
    ),
    imageInspection: readBoundedJsonFile(
      requiredAbsolute('MSAIDIZI_PROMOTION_IMAGE_INSPECT_PATH'),
      1024 * 1024,
      'Docker image inspection',
    ).value,
    containerInspection: containerPath
      ? readBoundedJsonFile(containerPath, 2 * 1024 * 1024, 'Docker container inspection').value
      : undefined,
    acceptedInventorySha256: required('MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256'),
    acceptedEvidenceSha256: required('MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256'),
    acceptedImageDigest: required('MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST'),
  });
  console.log('Msaidizi target OCI verification: PASS');
  console.log(`Backend image: ${verified.backendImageReference}`);
  console.log(`Image configuration digest: ${verified.imageConfigurationDigest}`);
  console.log(`Evidence artifact SHA-256: ${verified.evidenceArtifactSha256}`);
  console.log(`Promotion inventory SHA-256: ${verified.inventorySha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Target OCI verification failed.');
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

function optionalAbsolute(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return value;
}
