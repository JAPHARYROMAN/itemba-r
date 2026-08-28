import { spawnSync } from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  canonicalJson,
  executionBundleDigest,
  prismaSchemaMigrationDigest,
} from './crud-evidence-runner-lib.mjs';

export const CRUD_EVIDENCE_RELEASE_CONTRACT = 'msaidizi-crud-evidence-release/v1';
const CRUD_EVIDENCE_CONTRACT = 'msaidizi-crud-execution-evidence/v2';
const CRUD_EVIDENCE_HARNESS_VERSION = '2.1.0';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_RELEASE_BUNDLE_BYTES = 1024 * 1024;

export function readBoundedJsonFile(path, maximumBytes, label) {
  const bytes = readBoundedFile(path, maximumBytes, label);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function readBoundedFile(path, maximumBytes, label) {
  requireAbsoluteRealFile(path, label);
  const bytes = readFileSync(path);
  if (bytes.length < 2 || bytes.length > maximumBytes) {
    throw new Error(`${label} is empty or exceeds ${maximumBytes} bytes.`);
  }
  return bytes;
}

export function verifySignedCrudEvidence(input, options) {
  const artifact = requireRecord(input, 'CRUD evidence artifact');
  requireExactKeys(
    artifact,
    [
      'cases',
      'contract',
      'database',
      'expiresAt',
      'generatedAt',
      'harnessVersion',
      'manifestDigest',
      'payloadDigest',
      'provenance',
      'runId',
      'signature',
    ],
    'CRUD evidence artifact',
  );
  if (
    artifact.contract !== CRUD_EVIDENCE_CONTRACT ||
    artifact.harnessVersion !== CRUD_EVIDENCE_HARNESS_VERSION ||
    typeof artifact.runId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(artifact.runId) ||
    !isSha256(artifact.manifestDigest) ||
    !isSha256(artifact.payloadDigest)
  ) {
    throw new Error('CRUD evidence artifact has an unsupported or malformed signed contract.');
  }

  const provenance = requireRecord(artifact.provenance, 'CRUD evidence provenance');
  requireExactKeys(
    provenance,
    ['applicationBuildDigest', 'prismaSchemaMigrationDigest'],
    'CRUD evidence provenance',
  );
  requireSha256(provenance.applicationBuildDigest, 'application build digest');
  requireSha256(provenance.prismaSchemaMigrationDigest, 'Prisma schema/migration digest');
  if (
    options.expectedApplicationBuildDigest &&
    !safeHexEqual(provenance.applicationBuildDigest, options.expectedApplicationBuildDigest)
  ) {
    throw new Error('CRUD evidence application build digest does not match this execution bundle.');
  }
  if (
    options.expectedPrismaSchemaMigrationDigest &&
    !safeHexEqual(
      provenance.prismaSchemaMigrationDigest,
      options.expectedPrismaSchemaMigrationDigest,
    )
  ) {
    throw new Error('CRUD evidence Prisma digest does not match this source tree.');
  }

  const database = requireRecord(artifact.database, 'CRUD evidence database provenance');
  requireExactKeys(
    database,
    ['disposable', 'isolatedSchemaNameDigest'],
    'CRUD evidence database provenance',
  );
  if (database.disposable !== true || !isSha256(database.isolatedSchemaNameDigest)) {
    throw new Error('CRUD evidence lacks exact disposable database provenance.');
  }

  const generatedAt = parseCanonicalTimestamp(artifact.generatedAt, 'generatedAt');
  const expiresAt = parseCanonicalTimestamp(artifact.expiresAt, 'expiresAt');
  if (expiresAt - generatedAt !== SEVEN_DAYS_MS) {
    throw new Error('CRUD evidence validity must be exactly seven days.');
  }
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxAgeMs = options.maxAgeMs ?? SEVEN_DAYS_MS;
  if (generatedAt > now + CLOCK_SKEW_MS) {
    throw new Error('CRUD evidence generation time is in the future.');
  }
  if (expiresAt < now - CLOCK_SKEW_MS) {
    throw new Error('CRUD evidence has expired.');
  }
  if (now - generatedAt > maxAgeMs) {
    throw new Error('CRUD evidence exceeds the configured release age.');
  }

  if (!Array.isArray(artifact.cases) || artifact.cases.length === 0) {
    throw new Error('CRUD evidence contains no executed cases.');
  }
  const fixtures = new Set();
  let previousFixtureId = '';
  for (const evidenceCase of artifact.cases) {
    verifyEvidenceCase(evidenceCase, {
      generatedAt,
      fixtures,
      previousFixtureId,
      requireAllPassed: options.requireAllPassed !== false,
    });
    previousFixtureId = evidenceCase.fixtureId;
  }

  const signature = requireRecord(artifact.signature, 'CRUD evidence signature');
  requireExactKeys(signature, ['algorithm', 'keyId', 'value'], 'CRUD evidence signature');
  if (
    signature.algorithm !== 'ES256' ||
    signature.keyId !== options.expectedKeyId ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(signature.keyId)
  ) {
    throw new Error('CRUD evidence signature key or algorithm is not trusted.');
  }
  const { payloadDigest, signature: ignored, ...payload } = artifact;
  void ignored;
  const canonicalPayload = canonicalJson(payload);
  const computedDigest = sha256Hex(canonicalPayload);
  if (!safeHexEqual(payloadDigest, computedDigest)) {
    throw new Error('CRUD evidence payload digest does not match its signed payload.');
  }
  verifyP256Signature(canonicalPayload, signature.value, options.publicKeyPem, 'CRUD evidence');
  return artifact;
}

export function evidenceReleaseFacts(artifactBytes, artifact) {
  return {
    artifactSha256: sha256Hex(artifactBytes),
    payloadDigest: artifact.payloadDigest,
    signatureKeyId: artifact.signature.keyId,
    runId: artifact.runId,
    generatedAt: artifact.generatedAt,
    expiresAt: artifact.expiresAt,
    manifestDigest: artifact.manifestDigest,
    applicationBuildDigest: artifact.provenance.applicationBuildDigest,
    prismaSchemaMigrationDigest: artifact.provenance.prismaSchemaMigrationDigest,
    executedCaseCount: artifact.cases.length,
  };
}

export function sourceProvenance(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=no']);
  if (dirty.trim()) {
    throw new Error('Tracked source changed after checkout; refusing a release binding.');
  }
  const commitSha = git(root, ['rev-parse', 'HEAD']).trim().toLowerCase();
  const gitTreeDigest = git(root, ['rev-parse', 'HEAD^{tree}']).trim().toLowerCase();
  requireGitObjectId(commitSha, 'source commit');
  requireGitObjectId(gitTreeDigest, 'source tree');

  const staged = gitBuffer(root, ['ls-files', '--stage', '-z']).toString('utf8');
  const entries = [];
  for (const record of staged.split('\0')) {
    if (!record) continue;
    const match = /^(100644|100755) ([a-f0-9]{40,64}) 0\t(.+)$/.exec(record);
    if (!match || isUnsafeRepositoryPath(match[3])) {
      throw new Error('Tracked source inventory contains an unsupported entry.');
    }
    const absolute = resolve(root, match[3]);
    if (!pathStaysWithin(root, absolute)) {
      throw new Error('Tracked source inventory escaped the repository root.');
    }
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Tracked source entry is not a real file: ${match[3]}`);
    }
    const content = readFileSync(absolute);
    entries.push({
      path: match[3].replaceAll('\\', '/'),
      mode: match[1],
      bytes: content.length,
      sha256: sha256Hex(content),
    });
  }
  if (entries.length === 0) throw new Error('Tracked source inventory is empty.');
  entries.sort((left, right) => compareOrdinalUtf8(left.path, right.path));
  return {
    commitSha,
    gitTreeDigest,
    trackedSourceSha256: sha256Hex(canonicalJson(entries)),
    trackedFileCount: entries.length,
  };
}

export function releaseExecutionFacts(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const backendDir = resolve(root, 'backend');
  return {
    applicationBuildDigest: executionBundleDigest(
      backendDir,
      resolve(backendDir, 'scripts/run-crud-evidence.mjs'),
    ),
    prismaSchemaMigrationDigest: prismaSchemaMigrationDigest(resolve(root, 'database/prisma')),
  };
}

export function immutableImage(reference) {
  if (typeof reference !== 'string' || reference !== reference.toLowerCase()) {
    throw new Error('Backend image reference must be a lowercase immutable digest reference.');
  }
  const match = /^([^\s@]+)@(sha256:[a-f0-9]{64})$/.exec(reference);
  const repositorySegments = match?.[1].split('/') ?? [];
  const registry = repositorySegments[0] ?? '';
  const imageSegments = repositorySegments.slice(1);
  if (
    !match ||
    repositorySegments.length < 2 ||
    !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(registry) ||
    imageSegments.some(
      (segment) =>
        !/^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/.test(segment) ||
        segment === '.' ||
        segment === '..',
    )
  ) {
    throw new Error('Backend image reference must use repository@sha256:<64 lowercase hex>.');
  }
  return { reference, repository: match[1], digest: match[2] };
}

export function createReleasePayload(input) {
  const image = immutableImage(input.backendImageReference);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  parseCanonicalTimestamp(issuedAt, 'release issuedAt');
  requireRepository(input.repository);
  requireGitObjectId(input.source.commitSha, 'source commit');
  requireGitObjectId(input.source.gitTreeDigest, 'source tree');
  requireSha256(input.source.trackedSourceSha256, 'tracked source digest');
  if (!Number.isInteger(input.source.trackedFileCount) || input.source.trackedFileCount < 1) {
    throw new Error('Tracked source file count is invalid.');
  }
  requireReleaseEvidenceFacts(input.evidence);
  const pipeline = {
    repository: input.repository,
    workflow: boundedString(input.workflow, 'workflow', 1, 128),
    runId: boundedDigits(input.runId, 'runId'),
    runAttempt: boundedDigits(input.runAttempt, 'runAttempt'),
  };
  return {
    contract: CRUD_EVIDENCE_RELEASE_CONTRACT,
    issuedAt,
    source: { ...input.source },
    backendImage: image,
    evidence: { ...input.evidence },
    pipeline,
  };
}

export function signReleasePayload(payload, privateKeyPem, keyId) {
  requireKeyId(keyId, 'release binding');
  const canonicalPayload = canonicalJson(payload);
  const privateKey = createPrivateKey(privateKeyPem);
  assertP256Key(privateKey, 'release binding private key');
  const signature = cryptoSign('sha256', Buffer.from(canonicalPayload, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) {
    throw new Error('Release binding signature is not canonical ES256 P1363.');
  }
  return {
    ...payload,
    payloadDigest: sha256Hex(canonicalPayload),
    signature: { algorithm: 'ES256', keyId, value: signature.toString('base64') },
  };
}

export function verifyReleaseBundle(input, options) {
  const bundle = requireRecord(input, 'CRUD evidence release bundle');
  requireExactKeys(
    bundle,
    [
      'backendImage',
      'contract',
      'evidence',
      'issuedAt',
      'payloadDigest',
      'pipeline',
      'signature',
      'source',
    ],
    'CRUD evidence release bundle',
  );
  if (bundle.contract !== CRUD_EVIDENCE_RELEASE_CONTRACT) {
    throw new Error('CRUD evidence release contract is unsupported.');
  }
  const issuedAt = parseCanonicalTimestamp(bundle.issuedAt, 'release issuedAt');

  const source = requireRecord(bundle.source, 'release source');
  requireExactKeys(
    source,
    ['commitSha', 'gitTreeDigest', 'trackedFileCount', 'trackedSourceSha256'],
    'release source',
  );
  requireGitObjectId(source.commitSha, 'source commit');
  requireGitObjectId(source.gitTreeDigest, 'source tree');
  requireSha256(source.trackedSourceSha256, 'tracked source digest');
  if (!Number.isInteger(source.trackedFileCount) || source.trackedFileCount < 1) {
    throw new Error('Tracked source file count is invalid.');
  }
  const imageRecord = requireRecord(bundle.backendImage, 'release backend image');
  requireExactKeys(imageRecord, ['digest', 'reference', 'repository'], 'release backend image');
  const image = immutableImage(imageRecord.reference);
  if (image.repository !== imageRecord.repository || image.digest !== imageRecord.digest) {
    throw new Error('Release backend image fields are not internally consistent.');
  }

  const evidence = requireRecord(bundle.evidence, 'release evidence facts');
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
    'release evidence facts',
  );
  requireReleaseEvidenceFacts(evidence);
  const evidenceGeneratedAt = Date.parse(evidence.generatedAt);
  const evidenceExpiresAt = Date.parse(evidence.expiresAt);
  if (issuedAt < evidenceGeneratedAt - CLOCK_SKEW_MS || issuedAt > evidenceExpiresAt) {
    throw new Error('Release binding was not issued inside the evidence validity window.');
  }

  const pipeline = requireRecord(bundle.pipeline, 'release pipeline');
  requireExactKeys(pipeline, ['repository', 'runAttempt', 'runId', 'workflow'], 'release pipeline');
  requireRepository(pipeline.repository);
  boundedString(pipeline.workflow, 'workflow', 1, 128);
  boundedDigits(pipeline.runId, 'runId');
  boundedDigits(pipeline.runAttempt, 'runAttempt');

  const signature = requireRecord(bundle.signature, 'release signature');
  requireExactKeys(signature, ['algorithm', 'keyId', 'value'], 'release signature');
  if (signature.algorithm !== 'ES256' || signature.keyId !== options.expectedKeyId) {
    throw new Error('Release binding signature key or algorithm is not trusted.');
  }
  const { payloadDigest, signature: ignored, ...payload } = bundle;
  void ignored;
  requireSha256(payloadDigest, 'release payload digest');
  const canonicalPayload = canonicalJson(payload);
  if (!safeHexEqual(payloadDigest, sha256Hex(canonicalPayload))) {
    throw new Error('Release binding payload digest does not match.');
  }
  verifyP256Signature(canonicalPayload, signature.value, options.publicKeyPem, 'release binding');

  for (const [label, actual, expected] of [
    ['source commit', source.commitSha, options.expectedSource?.commitSha],
    ['source tree', source.gitTreeDigest, options.expectedSource?.gitTreeDigest],
    [
      'tracked source digest',
      source.trackedSourceSha256,
      options.expectedSource?.trackedSourceSha256,
    ],
    ['backend image', image.reference, options.expectedBackendImageReference],
    ['evidence artifact digest', evidence.artifactSha256, options.expectedArtifactSha256],
  ]) {
    if (expected !== undefined && actual !== expected) {
      throw new Error(`Release binding ${label} does not match the expected release input.`);
    }
  }
  if (
    options.expectedSource?.trackedFileCount !== undefined &&
    source.trackedFileCount !== options.expectedSource.trackedFileCount
  ) {
    throw new Error('Release binding tracked source file count does not match.');
  }
  if (options.expectedPipeline) {
    for (const [label, actual, expected] of [
      ['repository', pipeline.repository, options.expectedPipeline.repository],
      ['workflow', pipeline.workflow, options.expectedPipeline.workflow],
      ['run ID', pipeline.runId, String(options.expectedPipeline.runId)],
      ['run attempt', pipeline.runAttempt, String(options.expectedPipeline.runAttempt)],
    ]) {
      if (actual !== expected) {
        throw new Error(`Release binding pipeline ${label} does not match the verifier context.`);
      }
    }
  }
  return bundle;
}

export function loadAndVerifyEvidence(path, options) {
  const artifact = readBoundedJsonFile(path, MAX_EVIDENCE_BYTES, 'CRUD evidence artifact');
  const verified = verifySignedCrudEvidence(artifact.value, options);
  return {
    bytes: artifact.bytes,
    artifact: verified,
    facts: evidenceReleaseFacts(artifact.bytes, verified),
  };
}

export function loadAndVerifyReleaseBundle(path, options) {
  const bundle = readBoundedJsonFile(
    path,
    MAX_RELEASE_BUNDLE_BYTES,
    'CRUD evidence release bundle',
  );
  return verifyReleaseBundle(bundle.value, options);
}

function verifyEvidenceCase(input, options) {
  const item = requireRecord(input, 'CRUD evidence case');
  requireExactKeys(
    item,
    [
      'assertions',
      'capabilityContractDigest',
      'capabilityId',
      'controlKind',
      'finishedAt',
      'fixtureContractDigest',
      'fixtureId',
      'fixtureVersion',
      'httpStatus',
      'outcome',
    ],
    'CRUD evidence case',
  );
  if (
    typeof item.fixtureId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(item.fixtureId) ||
    options.fixtures.has(item.fixtureId) ||
    item.fixtureId.localeCompare(options.previousFixtureId) < 0
  ) {
    throw new Error('CRUD evidence case identifiers are malformed, duplicated, or unsorted.');
  }
  if (
    !Number.isInteger(item.fixtureVersion) ||
    item.fixtureVersion < 1 ||
    typeof item.capabilityId !== 'string' ||
    item.capabilityId.length < 1 ||
    item.capabilityId.length > 256 ||
    !isSha256(item.capabilityContractDigest) ||
    !isSha256(item.fixtureContractDigest)
  ) {
    throw new Error(`CRUD evidence case ${item.fixtureId} has malformed contract fields.`);
  }
  if (
    ![
      'positive',
      'permission_denial',
      'company_isolation',
      'audit_attribution',
      'service_principal_task_scope',
    ].includes(item.controlKind)
  ) {
    throw new Error(`CRUD evidence case ${item.fixtureId} has an unsupported control kind.`);
  }
  if (!['passed', 'failed', 'skipped'].includes(item.outcome)) {
    throw new Error(`CRUD evidence case ${item.fixtureId} has an unsupported outcome.`);
  }
  if (options.requireAllPassed && item.outcome !== 'passed') {
    throw new Error(`CRUD evidence release contains non-passing case ${item.fixtureId}.`);
  }
  const successfulStatus =
    item.controlKind === 'permission_denial'
      ? item.httpStatus === 403
      : item.controlKind === 'company_isolation'
        ? item.httpStatus === 403 || item.httpStatus === 404
        : Number.isInteger(item.httpStatus) && item.httpStatus >= 200 && item.httpStatus < 300;
  if (item.outcome === 'passed' && !successfulStatus) {
    throw new Error(`CRUD evidence case ${item.fixtureId} has a dishonest success status.`);
  }
  if (
    !Array.isArray(item.assertions) ||
    item.assertions.length < 1 ||
    item.assertions.length > 64
  ) {
    throw new Error(`CRUD evidence case ${item.fixtureId} has an invalid assertion set.`);
  }
  for (const rawAssertion of item.assertions) {
    const assertion = requireRecord(rawAssertion, `${item.fixtureId} assertion`);
    const keys = assertion.detail === undefined ? ['name', 'passed'] : ['detail', 'name', 'passed'];
    requireExactKeys(assertion, keys, `${item.fixtureId} assertion`);
    if (
      typeof assertion.name !== 'string' ||
      assertion.name.length < 1 ||
      assertion.name.length > 256 ||
      typeof assertion.passed !== 'boolean' ||
      (item.outcome === 'passed' && assertion.passed !== true) ||
      (assertion.detail !== undefined &&
        (typeof assertion.detail !== 'string' || assertion.detail.length > 512))
    ) {
      throw new Error(`CRUD evidence case ${item.fixtureId} has a malformed assertion.`);
    }
  }
  const finishedAt = parseCanonicalTimestamp(item.finishedAt, `${item.fixtureId}.finishedAt`);
  if (
    finishedAt > options.generatedAt + CLOCK_SKEW_MS ||
    finishedAt < options.generatedAt - TWO_HOURS_MS
  ) {
    throw new Error(`CRUD evidence case ${item.fixtureId} finished outside the signed run window.`);
  }
  options.fixtures.add(item.fixtureId);
}

function requireReleaseEvidenceFacts(value) {
  for (const [label, item] of [
    ['artifact digest', value.artifactSha256],
    ['payload digest', value.payloadDigest],
    ['manifest digest', value.manifestDigest],
    ['application build digest', value.applicationBuildDigest],
    ['Prisma schema/migration digest', value.prismaSchemaMigrationDigest],
  ]) {
    requireSha256(item, label);
  }
  requireKeyId(value.signatureKeyId, 'evidence');
  if (typeof value.runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.runId)) {
    throw new Error('Evidence run ID is invalid.');
  }
  const generatedAt = parseCanonicalTimestamp(value.generatedAt, 'evidence generatedAt');
  const expiresAt = parseCanonicalTimestamp(value.expiresAt, 'evidence expiresAt');
  if (expiresAt - generatedAt !== SEVEN_DAYS_MS) {
    throw new Error('Release evidence validity must be exactly seven days.');
  }
  if (!Number.isInteger(value.executedCaseCount) || value.executedCaseCount < 1) {
    throw new Error('Evidence executed case count is invalid.');
  }
}

function verifyP256Signature(canonicalPayload, encodedSignature, publicKeyPem, label) {
  const signature = decodeCanonicalP1363(encodedSignature, label);
  let key;
  try {
    key = createPublicKey(publicKeyPem);
    assertP256Key(key, `${label} public key`);
  } catch {
    throw new Error(`${label} public verification key is not EC P-256.`);
  }
  const valid = cryptoVerify(
    'sha256',
    Buffer.from(canonicalPayload, 'utf8'),
    { key, dsaEncoding: 'ieee-p1363' },
    signature,
  );
  if (!valid) throw new Error(`${label} ES256 signature did not verify.`);
}

function decodeCanonicalP1363(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} signature is not canonical base64.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) {
    throw new Error(`${label} signature is not canonical 64-byte P1363.`);
  }
  return decoded;
}

function assertP256Key(key, label) {
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (key.asymmetricKeyType !== 'ec' || !['prime256v1', 'P-256'].includes(curve)) {
    throw new Error(`${label} must use EC P-256.`);
  }
}

function git(root, args) {
  return gitBuffer(root, args).toString('utf8');
}

function gitBuffer(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: null, windowsHide: true });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message || result.stderr?.toString('utf8') || `git ${args.join(' ')} failed.`,
    );
  }
  return result.stdout;
}

function pathStaysWithin(root, absolute) {
  const normalizedRoot = `${resolve(root).replaceAll('\\', '/').replace(/\/$/, '')}/`;
  const normalized = resolve(absolute).replaceAll('\\', '/');
  return `${normalized}/`.startsWith(normalizedRoot);
}

function isUnsafeRepositoryPath(path) {
  return (
    !path ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function requireAbsoluteRealFile(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} path must identify a real file, not a symlink.`);
  }
  if (stat.nlink !== undefined && stat.nlink !== 1) {
    throw new Error(`${label} path must have exactly one hard link.`);
  }
}

function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireSha256(value, label) {
  if (!isSha256(value)) throw new Error(`${label} must be lowercase SHA-256.`);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function safeHexEqual(left, right) {
  if (!isSha256(left) || !isSha256(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCanonicalTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} is not a valid canonical UTC timestamp.`);
  }
  return parsed;
}

function requireGitObjectId(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase immutable Git object ID.`);
  }
}

function requireKeyId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error(`${label} key ID is invalid.`);
  }
}

function requireRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('Pipeline repository must use owner/name.');
  }
}

function boundedString(value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function boundedDigits(value, label) {
  const result = String(value ?? '');
  if (!/^[1-9][0-9]{0,19}$/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function compareOrdinalUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
