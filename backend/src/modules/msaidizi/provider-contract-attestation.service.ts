import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  ANTHROPIC_API_ORIGIN,
  VerifiedProviderContractAttestation,
  verifyProviderContractAttestation,
} from './provider-contract-attestation.protocol';

const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;

export const PROVIDER_CONTRACT_CONFIGURATION_KEYS = Object.freeze([
  'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH',
  'MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH',
  'MSAIDIZI_PROVIDER_CONTRACT_KEY_ID',
  'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256',
  'MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256',
  'MSAIDIZI_PROVIDER_ACCOUNT_ID',
  'MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID',
] as const);

@Injectable()
export class ProviderContractAttestationService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.providerContractRequired()) this.assertCurrent();
  }

  /**
   * Re-reads and verifies the operator-owned attestation. This is intentionally
   * called before every provider request: a contract that expires after process
   * startup must stop the next cloud disclosure without waiting for a restart.
   */
  assertCurrent(now = new Date()): VerifiedProviderContractAttestation {
    const artifactPath = this.required('MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH');
    const publicKeyPath = this.required('MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH');
    const keyId = this.required('MSAIDIZI_PROVIDER_CONTRACT_KEY_ID');
    const artifactSha256 = this.required('MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256');
    const signerSpkiSha256 = this.required('MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256');
    const apiAccountId = this.required('MSAIDIZI_PROVIDER_ACCOUNT_ID');
    const apiCredentialKeyId = this.required('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID');

    const artifact = readTrustedExternalRegularFile(
      artifactPath,
      MAX_ATTESTATION_BYTES,
      'provider-contract attestation',
    );
    const publicKey = readTrustedExternalRegularFile(
      publicKeyPath,
      MAX_PUBLIC_KEY_BYTES,
      'provider-contract public key',
    );
    if (samePath(artifact.realPath, publicKey.realPath)) {
      throw new Error('PROVIDER_CONTRACT_PATH_REUSE: Attestation and public key must be distinct');
    }

    return verifyProviderContractAttestation(artifact.bytes, {
      publicKeyPem: publicKey.bytes,
      expectedKeyId: keyId,
      expectedArtifactSha256: artifactSha256,
      expectedSignerSpkiSha256: signerSpkiSha256,
      expectedProvider: 'anthropic',
      expectedApiOrigin: ANTHROPIC_API_ORIGIN,
      expectedApiAccountId: apiAccountId,
      expectedApiCredentialKeyId: apiCredentialKeyId,
      expectedModelIds: this.expectedModelIds(),
      now,
    });
  }

  private providerContractRequired(): boolean {
    return [
      'MSAIDIZI_ENABLED',
      'MSAIDIZI_AUTONOMY_ENABLED',
      'MSAIDIZI_AUTOPILOT_ENABLED',
      'MSAIDIZI_HOST_EXECUTION_ENABLED',
      'MSAIDIZI_ADAPTIVE_REASONING_ENABLED',
      'MSAIDIZI_UPDATE_EVALUATOR_ENABLED',
    ].some((key) => truthy(this.value(key)));
  }

  private expectedModelIds(): string[] {
    return [
      this.value('MSAIDIZI_MODEL') ?? 'claude-opus-5',
      this.value('MSAIDIZI_CLASSIFIER_MODEL') ?? 'claude-haiku-4-5',
    ]
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort();
  }

  private required(name: (typeof PROVIDER_CONTRACT_CONFIGURATION_KEYS)[number]): string {
    const value = this.value(name);
    if (!value) throw new Error(`PROVIDER_CONTRACT_NOT_CONFIGURED: ${name} is required`);
    return value;
  }

  private value(name: string): string | undefined {
    const configured = this.config.get<unknown>(name);
    if (typeof configured === 'string') return configured.trim() || undefined;
    return undefined;
  }
}

interface TrustedExternalFile {
  bytes: Buffer;
  realPath: string;
}

export function readTrustedExternalRegularFile(
  inputPath: string,
  maxBytes: number,
  label: string,
  applicationRoot = process.cwd(),
): TrustedExternalFile {
  if (!isAbsolute(inputPath)) {
    throw new Error(`PROVIDER_CONTRACT_PATH_INVALID: ${label} path must be absolute`);
  }
  const resolved = resolve(inputPath);
  if (!samePath(resolved, inputPath)) {
    throw new Error(`PROVIDER_CONTRACT_PATH_INVALID: ${label} path must be canonical`);
  }
  if (!outsideRoot(resolved, resolve(applicationRoot))) {
    throw new Error(
      `PROVIDER_CONTRACT_PATH_INVALID: ${label} must be outside the application tree`,
    );
  }

  let before: BigIntStats;
  let realPath: string;
  try {
    before = lstatSync(resolved, { bigint: true });
    realPath = realpathSync.native(resolved);
  } catch {
    throw new Error(`PROVIDER_CONTRACT_FILE_UNREADABLE: ${label} is unavailable`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error(
      `PROVIDER_CONTRACT_FILE_INVALID: ${label} must be a single-link regular non-reparse file`,
    );
  }
  if (!samePath(realPath, resolved)) {
    throw new Error(
      `PROVIDER_CONTRACT_FILE_INVALID: ${label} path traverses a link or reparse point`,
    );
  }
  if (before.size <= 0n || before.size > BigInt(maxBytes)) {
    throw new Error(`PROVIDER_CONTRACT_FILE_INVALID: ${label} size is outside the accepted bound`);
  }

  const noFollow =
    typeof (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW === 'number'
      ? ((constants as { O_NOFOLLOW: number }).O_NOFOLLOW ?? 0)
      : 0;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(resolved, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    requireSameFile(before, opened, label);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    requireSameSnapshot(opened, after, label);
    if (BigInt(bytes.length) !== after.size) {
      throw new Error(`PROVIDER_CONTRACT_FILE_CHANGED: ${label} changed while being read`);
    }
    return { bytes, realPath };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PROVIDER_CONTRACT_')) throw error;
    throw new Error(`PROVIDER_CONTRACT_FILE_UNREADABLE: ${label} could not be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireSameFile(expected: BigIntStats, actual: BigIntStats, label: string): void {
  if (
    !actual.isFile() ||
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.mode !== actual.mode
  ) {
    throw new Error(`PROVIDER_CONTRACT_FILE_CHANGED: ${label} changed before it was opened`);
  }
}

function requireSameSnapshot(expected: BigIntStats, actual: BigIntStats, label: string): void {
  requireSameFile(expected, actual, label);
  if (
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error(`PROVIDER_CONTRACT_FILE_CHANGED: ${label} changed while being read`);
  }
}

function outsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`));
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const withoutLongPrefix = value.replace(/^\\\\\?\\/, '');
    return process.platform === 'win32' ? withoutLongPrefix.toLowerCase() : withoutLongPrefix;
  };
  return normalize(left) === normalize(right);
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}
