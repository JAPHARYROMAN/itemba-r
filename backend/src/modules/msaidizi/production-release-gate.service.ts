import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrudCoverageService } from './crud-coverage.service';
import { readTrustedExternalRegularFile } from './provider-contract-attestation.service';
import {
  VerifiedProductionReleaseBinding,
  verifyProductionReleaseBinding,
} from './production-release-gate.protocol';

const MAX_INVENTORY_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export const PRODUCTION_RELEASE_CONFIGURATION_KEYS = Object.freeze([
  'MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH',
  'MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256',
  'MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256',
  'MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST',
  'MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE',
  'MSAIDIZI_DEPLOYED_SOURCE_COMMIT',
  'MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY',
] as const);

const AUTONOMOUS_PRODUCTION_SWITCHES = Object.freeze([
  'MSAIDIZI_AUTONOMY_ENABLED',
  'MSAIDIZI_TASK_WORKER_ENABLED',
  'MSAIDIZI_AUTOPILOT_ENABLED',
  'MSAIDIZI_HOST_EXECUTION_ENABLED',
  'MSAIDIZI_ADAPTIVE_REASONING_ENABLED',
  'MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED',
  'MSAIDIZI_UPDATE_EVALUATOR_ENABLED',
] as const);

/**
 * Runtime consumer of the separately protected promotion decision.
 *
 * Human-user chat remains compatible: ordinary MSAIDIZI_ENABLED does not
 * require a production ring. Any autonomous production switch does. The
 * service verifies both the accepted release/image inventory and the complete
 * live CRUD matrix before Nest begins serving requests.
 */
@Injectable()
export class ProductionReleaseGateService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly crudCoverage: CrudCoverageService,
  ) {}

  onModuleInit(): void {
    if (this.productionReleaseRequired()) this.assertCurrent();
  }

  assertCurrent(): VerifiedProductionReleaseBinding {
    const expectedEvidenceSha256 = this.required('MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256');
    const coverage = this.crudCoverage.report(expectedEvidenceSha256);
    if (coverage.releaseGate.status !== 'passed') {
      const blockerCodes = coverage.releaseGate.blockers
        .map((item) => item.code)
        .sort()
        .join(',');
      throw new Error(
        `PRODUCTION_RELEASE_CRUD_EVIDENCE_REJECTED:${blockerCodes || 'unknown_blocker'}`,
      );
    }

    const inventory = readTrustedExternalRegularFile(
      this.required('MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH'),
      MAX_INVENTORY_BYTES,
      'production promotion inventory',
    );
    const evidence = readTrustedExternalRegularFile(
      this.required('MSAIDIZI_CRUD_EVIDENCE_PATH'),
      MAX_EVIDENCE_BYTES,
      'production CRUD evidence artifact',
    );
    if (samePath(inventory.realPath, evidence.realPath)) {
      throw new Error('PRODUCTION_RELEASE_PATH_REUSE');
    }

    return verifyProductionReleaseBinding({
      inventoryBytes: inventory.bytes,
      evidenceArtifactBytes: evidence.bytes,
      expectedInventorySha256: this.required('MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256'),
      expectedEvidenceSha256,
      expectedImageDigest: this.required('MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST'),
      expectedBackendImageReference: this.required('MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE'),
      expectedSourceCommit: this.required('MSAIDIZI_DEPLOYED_SOURCE_COMMIT'),
      expectedRepository: this.required('MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY'),
      expectedEvidenceKeyId: this.required('MSAIDIZI_CRUD_EVIDENCE_KEY_ID'),
      expectedApplicationBuildDigest: this.required(
        'MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST',
      ),
      expectedPrismaSchemaMigrationDigest: this.required(
        'MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST',
      ),
    });
  }

  productionReleaseRequired(): boolean {
    return (
      this.value('NODE_ENV') === 'production' &&
      AUTONOMOUS_PRODUCTION_SWITCHES.some((name) => truthy(this.value(name)))
    );
  }

  private required(name: string): string {
    const value = this.value(name);
    if (!value) throw new Error(`PRODUCTION_RELEASE_NOT_CONFIGURED:${name}`);
    return value;
  }

  private value(name: string): string | undefined {
    const configured = this.config.get<unknown>(name);
    if (typeof configured !== 'string') return undefined;
    return configured.trim() || undefined;
  }
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
    : left === right;
}
