import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';

export const PROVIDER_CONTRACT_ATTESTATION = 'msaidizi-provider-contract-attestation/v2' as const;
export const PROVIDER_CONTRACT_SIGNATURE_ALGORITHM = 'ES256' as const;
export const ANTHROPIC_API_ORIGIN = 'https://api.anthropic.com' as const;
export const FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES = Object.freeze([
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_LOG',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_WEBHOOK_SIGNING_KEY',
] as const);

const CANONICAL_INSTANT_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

const SIGNATURE_DOMAIN = Buffer.from(
  'ITEMBA\0MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION\0V2\0',
  'utf8',
);

export const REQUIRED_PROVIDER_DATA_CLASSES = Object.freeze([
  'audio',
  'browser_sessions',
  'business_records',
  'clipboard',
  'credentials',
  'documents',
  'email',
  'financial_data',
  'personal_data',
  'screenshots',
] as const);

export interface ProviderContractClaims {
  attestationId: string;
  provider: 'anthropic';
  apiOrigin: typeof ANTHROPIC_API_ORIGIN;
  apiAccountId: string;
  /** Operator-controlled secret-manager version/key identifier; never secret material. */
  apiCredentialKeyId: string;
  permittedModelIds: string[];
  coveredDataClasses: string[];
  zeroTraining: true;
  providerRetentionSeconds: 0;
  contractDocumentSha256: string;
  immutableLegalReference: string;
  issuedAt: string;
  effectiveAt: string;
  expiresAt: string;
}

export interface SignedProviderContractAttestation {
  contract: typeof PROVIDER_CONTRACT_ATTESTATION;
  claims: ProviderContractClaims;
  keyId: string;
  signatureAlgorithm: typeof PROVIDER_CONTRACT_SIGNATURE_ALGORITHM;
  signatureBase64: string;
}

export interface VerifyProviderContractAttestationOptions {
  publicKeyPem: string | Buffer;
  expectedKeyId: string;
  expectedArtifactSha256: string;
  expectedSignerSpkiSha256: string;
  expectedProvider: 'anthropic';
  expectedApiOrigin: typeof ANTHROPIC_API_ORIGIN;
  expectedApiAccountId: string;
  expectedApiCredentialKeyId: string;
  expectedModelIds: readonly string[];
  now?: Date;
}

export interface VerifiedProviderContractAttestation {
  artifact: SignedProviderContractAttestation;
  artifactSha256: string;
  signerSpkiSha256: string;
}

export class ProviderContractAttestationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProviderContractAttestationError';
  }
}

export function verifyProviderContractAttestation(
  rawArtifact: string | Buffer,
  options: VerifyProviderContractAttestationOptions,
): VerifiedProviderContractAttestation {
  const bytes = Buffer.isBuffer(rawArtifact) ? rawArtifact : Buffer.from(rawArtifact, 'utf8');
  const artifactSha256 = sha256(bytes);
  requireDigest(options.expectedArtifactSha256, 'expected artifact SHA-256');
  if (artifactSha256 !== options.expectedArtifactSha256) {
    fail(
      'PROVIDER_CONTRACT_ARTIFACT_DIGEST_MISMATCH',
      'Attestation bytes do not match the pinned digest',
    );
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('PROVIDER_CONTRACT_INVALID_UTF8', 'Attestation must be valid UTF-8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('PROVIDER_CONTRACT_INVALID_JSON', 'Attestation must be valid JSON');
  }
  if (canonicalJson(parsed) !== text) {
    fail(
      'PROVIDER_CONTRACT_NONCANONICAL_JSON',
      'Attestation bytes must be exact canonical JSON with no trailing data',
    );
  }

  const artifact = validateEnvelope(parsed);
  if (artifact.keyId !== options.expectedKeyId) {
    fail(
      'PROVIDER_CONTRACT_KEY_ID_MISMATCH',
      'Attestation key ID does not match deployment policy',
    );
  }

  const publicKey = strictP256PublicKey(options.publicKeyPem);
  const signerSpkiSha256 = sha256(publicKey.export({ type: 'spki', format: 'der' }) as Buffer);
  requireDigest(options.expectedSignerSpkiSha256, 'expected signer SPKI SHA-256');
  if (signerSpkiSha256 !== options.expectedSignerSpkiSha256) {
    fail('PROVIDER_CONTRACT_SIGNER_PIN_MISMATCH', 'Signer SPKI does not match deployment policy');
  }

  const signature = strictBase64Signature(artifact.signatureBase64);
  const unsignedArtifact: Omit<SignedProviderContractAttestation, 'signatureBase64'> = {
    contract: artifact.contract,
    claims: artifact.claims,
    keyId: artifact.keyId,
    signatureAlgorithm: artifact.signatureAlgorithm,
  };
  const signatureInput = signingInput(unsignedArtifact);
  if (!verify('sha256', signatureInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) {
    fail('PROVIDER_CONTRACT_SIGNATURE_INVALID', 'Attestation signature is invalid');
  }

  validateClaims(artifact.claims, options);
  return Object.freeze({ artifact, artifactSha256, signerSpkiSha256 });
}

/** Test/operator helper. The private key is never loaded by the runtime verifier. */
export function signProviderContractAttestation(
  claims: ProviderContractClaims,
  privateKeyPem: string | Buffer | KeyObject,
  keyId: string,
): string {
  const privateKey = strictP256PrivateKey(privateKeyPem);
  const unsigned: Omit<SignedProviderContractAttestation, 'signatureBase64'> = {
    contract: PROVIDER_CONTRACT_ATTESTATION,
    claims,
    keyId,
    signatureAlgorithm: PROVIDER_CONTRACT_SIGNATURE_ALGORITHM,
  };
  const signature = sign('sha256', signingInput(unsigned), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return canonicalJson({ ...unsigned, signatureBase64: signature.toString('base64') });
}

function validateEnvelope(value: unknown): SignedProviderContractAttestation {
  const source = strictObject(value, 'attestation envelope');
  exactKeys(source, ['claims', 'contract', 'keyId', 'signatureAlgorithm', 'signatureBase64']);
  if (source.contract !== PROVIDER_CONTRACT_ATTESTATION) {
    fail('PROVIDER_CONTRACT_VERSION_UNSUPPORTED', 'Unsupported attestation contract');
  }
  if (source.signatureAlgorithm !== PROVIDER_CONTRACT_SIGNATURE_ALGORITHM) {
    fail('PROVIDER_CONTRACT_ALGORITHM_INVALID', 'Only ES256 attestations are accepted');
  }
  requireBoundedString(source.keyId, 'keyId', 1, 128, /^[A-Za-z0-9._:-]+$/);
  requireBoundedString(source.signatureBase64, 'signatureBase64', 1, 512);
  return {
    contract: PROVIDER_CONTRACT_ATTESTATION,
    claims: parseClaims(source.claims),
    keyId: source.keyId as string,
    signatureAlgorithm: PROVIDER_CONTRACT_SIGNATURE_ALGORITHM,
    signatureBase64: source.signatureBase64 as string,
  };
}

function parseClaims(value: unknown): ProviderContractClaims {
  const source = strictObject(value, 'claims');
  exactKeys(source, [
    'apiAccountId',
    'apiCredentialKeyId',
    'apiOrigin',
    'attestationId',
    'contractDocumentSha256',
    'coveredDataClasses',
    'effectiveAt',
    'expiresAt',
    'immutableLegalReference',
    'issuedAt',
    'permittedModelIds',
    'provider',
    'providerRetentionSeconds',
    'zeroTraining',
  ]);
  requireBoundedString(source.attestationId, 'attestationId', 1, 128, /^[A-Za-z0-9._:-]+$/);
  requireBoundedString(source.apiAccountId, 'apiAccountId', 1, 256, /^[A-Za-z0-9._:@/-]+$/);
  requireBoundedString(
    source.apiCredentialKeyId,
    'apiCredentialKeyId',
    1,
    256,
    /^[A-Za-z0-9._:@/-]+$/,
  );
  requireBoundedString(source.contractDocumentSha256, 'contractDocumentSha256', 64, 64);
  requireBoundedString(source.immutableLegalReference, 'immutableLegalReference', 1, 2048);
  requireBoundedString(source.issuedAt, 'issuedAt', 20, 40);
  requireBoundedString(source.effectiveAt, 'effectiveAt', 20, 40);
  requireBoundedString(source.expiresAt, 'expiresAt', 20, 40);
  if (source.provider !== 'anthropic') {
    fail(
      'PROVIDER_CONTRACT_PROVIDER_INVALID',
      'Only the configured Anthropic provider is accepted',
    );
  }
  if (source.apiOrigin !== ANTHROPIC_API_ORIGIN) {
    fail(
      'PROVIDER_CONTRACT_API_ORIGIN_INVALID',
      'Provider contract must name the pinned Anthropic API origin',
    );
  }
  if (source.zeroTraining !== true) {
    fail('PROVIDER_CONTRACT_TRAINING_NOT_PROHIBITED', 'zeroTraining must be true');
  }
  if (source.providerRetentionSeconds !== 0) {
    fail('PROVIDER_CONTRACT_RETENTION_NOT_ZERO', 'providerRetentionSeconds must be zero');
  }
  requireDigest(source.contractDocumentSha256 as string, 'contractDocumentSha256');
  validateLegalReference(
    source.immutableLegalReference as string,
    source.contractDocumentSha256 as string,
  );
  const permittedModelIds = strictStringArray(source.permittedModelIds, 'permittedModelIds', 16);
  const coveredDataClasses = strictStringArray(
    source.coveredDataClasses,
    'coveredDataClasses',
    REQUIRED_PROVIDER_DATA_CLASSES.length,
  );
  return {
    attestationId: source.attestationId as string,
    provider: 'anthropic',
    apiOrigin: ANTHROPIC_API_ORIGIN,
    apiAccountId: source.apiAccountId as string,
    apiCredentialKeyId: source.apiCredentialKeyId as string,
    permittedModelIds,
    coveredDataClasses,
    zeroTraining: true,
    providerRetentionSeconds: 0,
    contractDocumentSha256: source.contractDocumentSha256 as string,
    immutableLegalReference: source.immutableLegalReference as string,
    issuedAt: source.issuedAt as string,
    effectiveAt: source.effectiveAt as string,
    expiresAt: source.expiresAt as string,
  };
}

function validateClaims(
  claims: ProviderContractClaims,
  options: VerifyProviderContractAttestationOptions,
): void {
  if (claims.provider !== options.expectedProvider) {
    fail(
      'PROVIDER_CONTRACT_PROVIDER_MISMATCH',
      'Provider does not match the configured model client',
    );
  }
  if (claims.apiOrigin !== options.expectedApiOrigin) {
    fail(
      'PROVIDER_CONTRACT_API_ORIGIN_MISMATCH',
      'API origin does not match the pinned model-client origin',
    );
  }
  if (claims.apiAccountId !== options.expectedApiAccountId) {
    fail('PROVIDER_CONTRACT_ACCOUNT_MISMATCH', 'API account does not match deployment policy');
  }
  if (claims.apiCredentialKeyId !== options.expectedApiCredentialKeyId) {
    fail(
      'PROVIDER_CONTRACT_CREDENTIAL_KEY_MISMATCH',
      'API credential key identifier does not match deployment policy',
    );
  }
  const expectedModels = sortedUnique(options.expectedModelIds, 'expected model IDs');
  if (canonicalJson(claims.permittedModelIds) !== canonicalJson(expectedModels)) {
    fail(
      'PROVIDER_CONTRACT_MODEL_SCOPE_MISMATCH',
      'Permitted models do not exactly match deployment policy',
    );
  }
  if (canonicalJson(claims.coveredDataClasses) !== canonicalJson(REQUIRED_PROVIDER_DATA_CLASSES)) {
    fail(
      'PROVIDER_CONTRACT_DATA_SCOPE_INCOMPLETE',
      'Contract does not cover every data class that Msaidizi may send',
    );
  }

  const issuedAt = canonicalInstant(claims.issuedAt, 'issuedAt');
  const effectiveAt = canonicalInstant(claims.effectiveAt, 'effectiveAt');
  const expiresAt = canonicalInstant(claims.expiresAt, 'expiresAt');
  if (issuedAt.getTime() >= expiresAt.getTime() || effectiveAt.getTime() >= expiresAt.getTime()) {
    fail('PROVIDER_CONTRACT_TIME_RANGE_INVALID', 'Attestation validity range is incoherent');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    fail('PROVIDER_CONTRACT_CLOCK_INVALID', 'Verifier clock is invalid');
  }
  if (now.getTime() < issuedAt.getTime() || now.getTime() < effectiveAt.getTime()) {
    fail('PROVIDER_CONTRACT_NOT_YET_VALID', 'Provider contract is not yet issued and effective');
  }
  if (now.getTime() >= expiresAt.getTime()) {
    fail('PROVIDER_CONTRACT_EXPIRED', 'Provider contract has expired');
  }
}

function validateLegalReference(value: string, documentSha256: string): void {
  if (value !== `urn:sha256:${documentSha256}`) {
    fail(
      'PROVIDER_CONTRACT_LEGAL_REFERENCE_INVALID',
      'Legal reference must be the content-addressed contract-document digest',
    );
  }
}

function strictStringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    fail('PROVIDER_CONTRACT_FIELD_INVALID', `${field} must be a bounded non-empty array`);
  }
  const values = value.map((item) => {
    requireBoundedString(item, field, 1, 200, /^[A-Za-z0-9._:@/-]+$/);
    return item as string;
  });
  const sorted = sortedUnique(values, field);
  if (canonicalJson(values) !== canonicalJson(sorted)) {
    fail('PROVIDER_CONTRACT_FIELD_INVALID', `${field} must be sorted and contain no duplicates`);
  }
  return values;
}

function sortedUnique(values: readonly string[], field: string): string[] {
  if (values.length < 1) fail('PROVIDER_CONTRACT_FIELD_INVALID', `${field} cannot be empty`);
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length) {
    fail('PROVIDER_CONTRACT_FIELD_INVALID', `${field} contains duplicates`);
  }
  return sorted;
}

function strictP256PublicKey(input: string | Buffer): KeyObject {
  const pem = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (/PRIVATE KEY/.test(pem.toString('ascii'))) {
    fail('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID', 'Private-key material is forbidden');
  }
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    fail('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID', 'Verification key is unreadable');
  }
  if (
    key.type !== 'public' ||
    key.asymmetricKeyType !== 'ec' ||
    !['prime256v1', 'P-256'].includes(key.asymmetricKeyDetails?.namedCurve ?? '')
  ) {
    fail('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID', 'Verification key must be public EC P-256');
  }
  return key;
}

function strictP256PrivateKey(input: string | Buffer | KeyObject): KeyObject {
  let key: KeyObject;
  try {
    key = input instanceof KeyObject ? input : createPrivateKey(input);
  } catch {
    fail('PROVIDER_CONTRACT_PRIVATE_KEY_INVALID', 'Signing key is unreadable');
  }
  if (
    key.type !== 'private' ||
    key.asymmetricKeyType !== 'ec' ||
    !['prime256v1', 'P-256'].includes(key.asymmetricKeyDetails?.namedCurve ?? '')
  ) {
    fail('PROVIDER_CONTRACT_PRIVATE_KEY_INVALID', 'Signing key must be private EC P-256');
  }
  return key;
}

function strictBase64Signature(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail('PROVIDER_CONTRACT_SIGNATURE_INVALID', 'Signature is not standard Base64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) {
    fail('PROVIDER_CONTRACT_SIGNATURE_INVALID', 'Signature must be canonical 64-byte P1363 ES256');
  }
  return decoded;
}

function signingInput(
  artifact: Omit<SignedProviderContractAttestation, 'signatureBase64'>,
): Buffer {
  return Buffer.concat([SIGNATURE_DOMAIN, Buffer.from(canonicalJson(artifact), 'utf8')]);
}

function canonicalInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (
    !CANONICAL_INSTANT_PATTERN.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    fail('PROVIDER_CONTRACT_TIME_INVALID', `${field} must be an exact UTC ISO-8601 instant`);
  }
  return parsed;
}

function requireDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    fail('PROVIDER_CONTRACT_DIGEST_INVALID', `${field} must be a lowercase SHA-256 digest`);
  }
}

function strictObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PROVIDER_CONTRACT_SHAPE_INVALID', `${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('PROVIDER_CONTRACT_SHAPE_INVALID', `${field} has an unsupported prototype`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail('PROVIDER_CONTRACT_SHAPE_INVALID', 'Attestation contains missing or unknown fields');
  }
}

function requireBoundedString(
  value: unknown,
  field: string,
  min: number,
  max: number,
  pattern?: RegExp,
): void {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    value.trim() !== value ||
    (pattern && !pattern.test(value))
  ) {
    fail('PROVIDER_CONTRACT_FIELD_INVALID', `${field} is invalid`);
  }
}

export function canonicalProviderContractJson(value: unknown): string {
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('PROVIDER_CONTRACT_SHAPE_INVALID', 'Non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') {
    fail('PROVIDER_CONTRACT_SHAPE_INVALID', 'Unsupported canonical JSON value');
  }
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(',')}}`;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code: string, message: string): never {
  throw new ProviderContractAttestationError(code, message);
}
