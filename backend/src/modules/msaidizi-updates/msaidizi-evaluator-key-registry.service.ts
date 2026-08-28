import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createPublicKey,
  KeyObject,
  timingSafeEqual,
  verify,
  X509Certificate,
} from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  attestationSigningPayload,
  canonicalAttestationJson,
  CanonicalAttestation,
  decodeCanonicalEvaluatorSignature,
  EvaluatorAttestationError,
  EvaluatorKeyRole,
} from './msaidizi-evaluator-attestation.protocol';

interface KeyRegistryEntry {
  keyId: string;
  role: EvaluatorKeyRole;
  publicKeyPath: string;
  publicKeySha256: string;
  notBefore?: string;
  notAfter?: string;
}

interface LoadedKey extends KeyRegistryEntry {
  publicKey: KeyObject;
  fingerprint: string;
  notBeforeTime?: number;
  notAfterTime?: number;
}

const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLES = new Set<EvaluatorKeyRole>([
  'ARTIFACT_VERIFIER',
  'EVALUATION_RUNNER',
  'MODEL_REVIEWER',
]);

@Injectable()
export class MsaidiziEvaluatorKeyRegistry implements OnModuleInit {
  private loaded?: ReadonlyMap<string, LoadedKey>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.enabled) this.load();
  }

  get enabled(): boolean {
    return (
      this.flag('MSAIDIZI_UPDATE_EVALUATOR_ENABLED') && !this.flag('MSAIDIZI_GLOBAL_KILL_SWITCH')
    );
  }

  verify<T extends { signerKeyId: string; issuedAt: string; expiresAt: string }>(
    attestation: CanonicalAttestation<T>,
    requiredRole: EvaluatorKeyRole,
    now = new Date(),
  ): void {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(attestation.claimsJson) as Record<string, unknown>;
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        canonicalAttestationJson(raw) !== attestation.claimsJson ||
        createHash('sha256').update(attestation.claimsJson, 'utf8').digest('hex') !==
          attestation.claimsDigest ||
        raw.signerKeyId !== attestation.claims.signerKeyId ||
        raw.issuedAt !== attestation.claims.issuedAt ||
        raw.expiresAt !== attestation.claims.expiresAt
      ) {
        throw new Error('binding mismatch');
      }
    } catch {
      throw trustError('EVALUATOR_ENVELOPE_BINDING_INVALID');
    }
    const keys = this.assertReady();
    const key = keys.get(attestation.claims.signerKeyId);
    if (!key) throw trustError('EVALUATOR_KEY_UNKNOWN');
    if (key.role !== requiredRole) throw trustError('EVALUATOR_KEY_ROLE_MISMATCH');
    this.assertTimeWindow(attestation.claims.issuedAt, attestation.claims.expiresAt, now, key);
    const signature = decodeCanonicalEvaluatorSignature(attestation.signature);
    if (!signature) throw trustError('EVALUATOR_SIGNATURE_INVALID');
    const valid = verify(
      'sha256',
      attestationSigningPayload(attestation.claimsJson),
      { key: key.publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    if (!valid) throw trustError('EVALUATOR_SIGNATURE_INVALID');
  }

  private assertReady(): ReadonlyMap<string, LoadedKey> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('The signed update evaluator is disabled');
    }
    return this.loaded ?? this.load();
  }

  private load(): ReadonlyMap<string, LoadedKey> {
    const registryPath = this.value('MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH');
    if (!registryPath || !isAbsolute(registryPath)) {
      throw new ServiceUnavailableException('The evaluator key allowlist path is invalid');
    }
    try {
      const resolvedRegistry = this.externalRegularFile(registryPath, MAX_REGISTRY_BYTES);
      this.assertDistinctSecurityPath(resolvedRegistry, 'evaluator key allowlist');
      const registryBytes = readFileSync(resolvedRegistry);
      const configuredPin = this.value('MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256');
      if (!configuredPin || !/^[0-9a-f]{64}$/.test(configuredPin)) {
        throw new Error('evaluator key allowlist pin is missing');
      }
      const actualPin = createHash('sha256').update(registryBytes).digest();
      if (!timingSafeEqual(actualPin, Buffer.from(configuredPin, 'hex'))) {
        throw new Error('evaluator key allowlist pin mismatch');
      }
      const parsed = JSON.parse(registryBytes.toString('utf8')) as unknown;
      const root = strictRecord(parsed, ['keys', 'schemaVersion']);
      if (
        root.schemaVersion !== 1 ||
        !Array.isArray(root.keys) ||
        root.keys.length < 4 ||
        root.keys.length > 32
      ) {
        throw new Error('invalid evaluator key registry');
      }

      const keys = new Map<string, LoadedKey>();
      const fingerprints = new Set<string>();
      const transportSpkis = this.transportSpkiPins();
      for (const rawEntry of root.keys) {
        const entry = parseEntry(rawEntry);
        if (keys.has(entry.keyId)) throw new Error('duplicate evaluator key id');
        const resolvedKey = this.externalRegularFile(entry.publicKeyPath, MAX_PUBLIC_KEY_BYTES);
        this.assertDistinctSecurityPath(resolvedKey, `evaluator public key ${entry.keyId}`);
        const pem = readFileSync(resolvedKey, 'utf8');
        if (/PRIVATE KEY/i.test(pem))
          throw new Error('private evaluator key material is forbidden');
        const publicKey = createPublicKey(pem);
        if (
          publicKey.asymmetricKeyType !== 'ec' ||
          publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
        ) {
          throw new Error('evaluator key is not P-256');
        }
        const fingerprint = createHash('sha256')
          .update(publicKey.export({ type: 'spki', format: 'der' }))
          .digest('hex');
        if (fingerprint !== entry.publicKeySha256) {
          throw new Error('evaluator public key pin mismatch');
        }
        if (transportSpkis.has(fingerprint)) {
          throw new Error('evaluator signing and transport identities are reused');
        }
        if (fingerprints.has(fingerprint)) throw new Error('evaluator key material is reused');
        fingerprints.add(fingerprint);
        keys.set(entry.keyId, {
          ...entry,
          publicKeyPath: resolvedKey,
          publicKey,
          fingerprint,
          notBeforeTime: entry.notBefore ? parseRegistryTime(entry.notBefore) : undefined,
          notAfterTime: entry.notAfter ? parseRegistryTime(entry.notAfter) : undefined,
        });
      }
      const roleCounts = (role: EvaluatorKeyRole) =>
        [...keys.values()].filter((entry) => entry.role === role).length;
      if (
        roleCounts('ARTIFACT_VERIFIER') < 1 ||
        roleCounts('EVALUATION_RUNNER') < 1 ||
        roleCounts('MODEL_REVIEWER') < 2
      ) {
        throw new Error('evaluator allowlist lacks required independent roles');
      }
      this.loaded = keys;
      return keys;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The evaluator key allowlist is unavailable');
    }
  }

  private assertTimeWindow(issuedAt: string, expiresAt: string, now: Date, key: LoadedKey): void {
    const issued = new Date(issuedAt).getTime();
    const expires = new Date(expiresAt).getTime();
    const current = now.getTime();
    const skew = this.boundedInt('MSAIDIZI_EVALUATOR_MAX_CLOCK_SKEW_SECONDS', 60, 0, 300) * 1_000;
    const maxAge =
      this.boundedInt('MSAIDIZI_EVALUATOR_MAX_ATTESTATION_AGE_SECONDS', 86_400, 60, 604_800) *
      1_000;
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > current + skew ||
      issued < current - maxAge ||
      expires <= current ||
      expires <= issued ||
      expires - issued > maxAge ||
      (key.notBeforeTime !== undefined && issued < key.notBeforeTime) ||
      (key.notAfterTime !== undefined && (issued >= key.notAfterTime || expires > key.notAfterTime))
    ) {
      throw trustError('EVALUATOR_ATTESTATION_TIME_INVALID');
    }
  }

  private externalRegularFile(input: string, maximumBytes: number): string {
    if (!isAbsolute(input)) throw new Error('path is not absolute');
    const absolute = resolve(input);
    const link = lstatSync(absolute);
    if (!link.isFile() || link.isSymbolicLink()) throw new Error('path is not a regular file');
    const resolvedPath = realpathSync(absolute);
    const applicationRoot = realpathSync(process.cwd());
    const fromApplication = relative(applicationRoot, resolvedPath);
    if (
      fromApplication === '' ||
      (fromApplication !== '..' &&
        !fromApplication.startsWith(`..${sep}`) &&
        !isAbsolute(fromApplication))
    ) {
      throw new Error('operator key configuration is inside the application tree');
    }
    const stats = statSync(resolvedPath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) {
      throw new Error('operator key configuration size is invalid');
    }
    if (process.platform !== 'win32' && (stats.mode & 0o022) !== 0) {
      throw new Error('operator key configuration is group/world writable');
    }
    return resolvedPath;
  }

  private assertDistinctSecurityPath(candidate: string, label: string): void {
    for (const name of [
      'MSAIDIZI_ACTION_SIGNING_KEY_PATH',
      'MSAIDIZI_UPDATE_SIGNING_KEY_PATH',
      'MSAIDIZI_RECOVERY_SIGNING_KEY_PATH',
      'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH',
      'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH',
      'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH',
      'MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH',
      'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH',
      'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH',
    ]) {
      const configured = this.value(name);
      if (configured && isAbsolute(configured) && resolve(configured) === resolve(candidate)) {
        throw new Error(`${label} reuses ${name}`);
      }
    }
  }

  private transportSpkiPins(): Set<string> {
    const pins = new Set<string>();
    const clientPin = this.value('MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256')?.toLowerCase();
    if (clientPin && /^[0-9a-f]{64}$/.test(clientPin)) pins.add(clientPin);
    for (const name of [
      'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH',
      'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH',
    ] as const) {
      const configured = this.value(name);
      if (!configured) continue;
      const certificatePath = this.externalRegularFile(configured, MAX_PUBLIC_KEY_BYTES);
      const certificate = new X509Certificate(readFileSync(certificatePath));
      pins.add(
        createHash('sha256')
          .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
          .digest('hex'),
      );
    }
    return pins;
  }

  private boundedInt(name: string, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(this.config.get<string | number>(name, fallback));
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
      ? parsed
      : fallback;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(this.value(name)?.toLowerCase() ?? '');
  }

  private value(name: string): string | undefined {
    const value = this.config.get<string>(name) ?? process.env[name];
    return value?.trim() || undefined;
  }
}

function parseEntry(value: unknown): KeyRegistryEntry {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!raw) throw new Error('invalid key registry entry');
  const allowed = ['keyId', 'notAfter', 'notBefore', 'publicKeyPath', 'publicKeySha256', 'role'];
  const actual = Object.keys(raw).sort();
  if (
    actual.some((key) => !allowed.includes(key)) ||
    !actual.includes('keyId') ||
    !actual.includes('role') ||
    !actual.includes('publicKeyPath') ||
    !actual.includes('publicKeySha256')
  ) {
    throw new Error('invalid key registry entry fields');
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.keyId !== 'string' ||
    !KEY_ID.test(record.keyId) ||
    typeof record.role !== 'string' ||
    !ROLES.has(record.role as EvaluatorKeyRole) ||
    typeof record.publicKeyPath !== 'string' ||
    !isAbsolute(record.publicKeyPath) ||
    typeof record.publicKeySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.publicKeySha256) ||
    (record.notBefore !== undefined && typeof record.notBefore !== 'string') ||
    (record.notAfter !== undefined && typeof record.notAfter !== 'string')
  ) {
    throw new Error('invalid key registry entry values');
  }
  return {
    keyId: record.keyId,
    role: record.role as EvaluatorKeyRole,
    publicKeyPath: record.publicKeyPath,
    publicKeySha256: record.publicKeySha256,
    ...(record.notBefore ? { notBefore: record.notBefore as string } : {}),
    ...(record.notAfter ? { notAfter: record.notAfter as string } : {}),
  };
}

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid record');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('invalid record fields');
  }
  return record;
}

function parseRegistryTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error('invalid key validity timestamp');
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('invalid key validity timestamp');
  }
  return parsed;
}

function trustError(code: string): EvaluatorAttestationError {
  return new EvaluatorAttestationError(code);
}
