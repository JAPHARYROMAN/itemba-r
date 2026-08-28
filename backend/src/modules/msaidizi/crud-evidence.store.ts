import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Capability } from '../../common/capabilities/capability-manifest';
import {
  CrudEvidenceVerification,
  prismaSchemaMigrationDigest,
  verifyCrudEvidenceArtifact,
} from './crud-execution-evidence';
import { readTrustedExternalRegularFile } from './provider-contract-attestation.service';

const DEFAULT_MAX_AGE_HOURS = 168;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;

/**
 * Reads evidence from an operator-owned external path and verifies it on every
 * report request. The report is diagnostic, so configuration and I/O failures
 * become an explicit rejected status rather than making the endpoint disappear.
 */
@Injectable()
export class CrudEvidenceStore {
  private readonly logger = new Logger(CrudEvidenceStore.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  load(
    manifest: readonly Capability[],
    now = new Date(),
    expectedArtifactSha256?: string,
  ): CrudEvidenceVerification {
    const artifactPath = this.value('MSAIDIZI_CRUD_EVIDENCE_PATH');
    const publicKeyPath = this.value('MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH');
    const keyId = this.value('MSAIDIZI_CRUD_EVIDENCE_KEY_ID');
    const applicationBuildDigest = this.value('MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST');
    const configuredPrismaDigest = this.value(
      'MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST',
    );

    if (
      !artifactPath &&
      !publicKeyPath &&
      !keyId &&
      !applicationBuildDigest &&
      !configuredPrismaDigest
    ) {
      return {
        status: 'rejected',
        reason: 'artifact_not_configured',
        detail: 'No signed CRUD execution evidence artifact is configured.',
      };
    }
    if (
      !artifactPath ||
      !publicKeyPath ||
      !keyId ||
      !applicationBuildDigest ||
      !configuredPrismaDigest
    ) {
      return {
        status: 'rejected',
        reason: 'artifact_not_configured',
        detail:
          'CRUD evidence path, key, application-build digest and Prisma schema/migration digest must be configured together.',
      };
    }
    if (!isAbsolute(artifactPath) || !isAbsolute(publicKeyPath)) {
      return {
        status: 'rejected',
        reason: 'artifact_not_configured',
        detail: 'CRUD evidence and public-key paths must be absolute external paths.',
      };
    }

    let runtimePrismaDigest: string;
    try {
      runtimePrismaDigest = prismaSchemaMigrationDigest(
        resolve(process.cwd(), '../database/prisma'),
      );
    } catch (error) {
      this.logger.warn(`Unable to attest runtime Prisma inputs: ${safeError(error)}`);
      return {
        status: 'rejected',
        reason: 'runtime_prisma_attestation_unavailable',
        detail: 'The runtime Prisma schema/migration tree is unavailable or not a real local tree.',
      };
    }
    if (
      !/^[a-f0-9]{64}$/.test(configuredPrismaDigest) ||
      runtimePrismaDigest !== configuredPrismaDigest
    ) {
      return {
        status: 'rejected',
        reason: 'prisma_schema_migration_digest_mismatch',
        detail: 'Configured Prisma provenance does not match the deployed runtime tree.',
      };
    }

    let artifactBytes: Buffer;
    let rawArtifact: string;
    let publicKey: Buffer;
    try {
      const artifactFile = readTrustedExternalRegularFile(
        artifactPath,
        MAX_ARTIFACT_BYTES,
        'CRUD evidence artifact',
      );
      const publicKeyFile = readTrustedExternalRegularFile(
        publicKeyPath,
        MAX_PUBLIC_KEY_BYTES,
        'CRUD evidence public key',
      );
      if (samePath(artifactFile.realPath, publicKeyFile.realPath)) {
        throw new Error('CRUD evidence artifact and public key paths must be distinct');
      }
      artifactBytes = artifactFile.bytes;
      rawArtifact = artifactBytes.toString('utf8');
      publicKey = publicKeyFile.bytes;
    } catch (error) {
      this.logger.warn(`Unable to read configured CRUD evidence: ${safeError(error)}`);
      return {
        status: 'rejected',
        reason: 'artifact_unreadable',
        detail: 'The configured evidence artifact or verification key could not be read.',
      };
    }

    if (expectedArtifactSha256 !== undefined) {
      const actualArtifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
      if (
        !/^[a-f0-9]{64}$/.test(expectedArtifactSha256) ||
        actualArtifactSha256 !== expectedArtifactSha256
      ) {
        return {
          status: 'rejected',
          reason: 'artifact_digest_mismatch',
          detail: 'The CRUD evidence bytes do not match the protected promotion digest.',
        };
      }
    }

    let artifact: unknown;
    try {
      artifact = JSON.parse(rawArtifact) as unknown;
    } catch {
      return {
        status: 'rejected',
        reason: 'artifact_invalid_json',
        detail: 'The configured evidence artifact is not valid JSON.',
      };
    }

    const maxAgeHours = Number(
      this.value('MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS') ?? DEFAULT_MAX_AGE_HOURS,
    );
    if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
      return {
        status: 'rejected',
        reason: 'artifact_not_configured',
        detail: 'MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS must be a positive number.',
      };
    }

    return verifyCrudEvidenceArtifact(artifact, manifest, {
      publicKeyPem: publicKey,
      expectedKeyId: keyId,
      expectedApplicationBuildDigest: applicationBuildDigest,
      expectedPrismaSchemaMigrationDigest: runtimePrismaDigest,
      now,
      maxAgeMs: maxAgeHours * 60 * 60 * 1000,
    });
  }

  private value(name: string): string | undefined {
    const configured = this.config?.get<unknown>(name);
    const value = configured ?? process.env[name];
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value !== 'string') return undefined;
    return value.trim() || undefined;
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
    : left === right;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 256) : 'unknown error';
}
