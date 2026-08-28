import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, KeyObject, sign } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export interface UpdateManifestFields {
  schemaVersion: 2;
  deploymentId: string;
  candidateId: string;
  deviceId: string;
  operation: 'APPLY' | 'ROLLBACK';
  ring: 0 | 5 | 25 | 100;
  targetId: string;
  version: string;
  rollbackVersion: string;
  sourceArtifactSha256: string;
  rollbackArtifactSha256: string;
  healthTimeoutSeconds: number;
  minimumHealthySoakSeconds: number;
  minimumRingDwellSeconds: number;
  deliveryLeaseId: string;
  deliveryAttempt: number;
  issuedAt: string;
  expiresAt: string;
  idempotencyKey: string;
}

export interface SignedUpdateManifest {
  manifestJson: string;
  manifestSha256: string;
  signature: string;
  signingKeyId: string;
}

/**
 * Signs the exact UTF-8 manifest consumed by the supervisor. The signing key
 * is loaded from an absolute, deployment-owned path and is never persisted in
 * Itemba. Msaidizi can propose bytes but cannot access this service directly.
 */
@Injectable()
export class MsaidiziUpdateManifestSigner {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return (
      this.flag('MSAIDIZI_UPDATE_SUPERVISOR_ENABLED') && !this.flag('MSAIDIZI_GLOBAL_KILL_SWITCH')
    );
  }

  /** Static deployment ownership flag. Unlike `enabled`, this intentionally
   * ignores the live kill switch so a long-lived coordinator keeps polling the
   * durable recovery outbox and can resume after authority is restored. */
  get supervisorConfigured(): boolean {
    return this.flag('MSAIDIZI_UPDATE_SUPERVISOR_ENABLED');
  }

  get keyId(): string {
    return this.config.get<string>('MSAIDIZI_UPDATE_SIGNING_KEY_ID', '').trim();
  }

  get manifestTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_UPDATE_MANIFEST_TTL_SECONDS', 600, 60, 3_600);
  }

  get healthTimeoutSeconds(): number {
    return this.boundedInt('MSAIDIZI_UPDATE_HEALTH_TIMEOUT_SECONDS', 600, 5, 900);
  }

  get minimumHealthySoakSeconds(): number {
    return this.boundedInt('MSAIDIZI_UPDATE_MIN_HEALTHY_SOAK_SECONDS', 300, 1, 899);
  }

  get redeliverySeconds(): number {
    return this.boundedInt('MSAIDIZI_UPDATE_REDELIVERY_SECONDS', 30, 5, 300);
  }

  minimumRingDwellSeconds(ring: 0 | 5 | 25 | 100): number {
    const policy = {
      0: ['MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS', 86_400],
      5: ['MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS', 86_400],
      25: ['MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS', 172_800],
      100: ['MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS', 259_200],
    } as const;
    const [key, protectedMinimum] = policy[ring];
    return this.boundedInt(key, protectedMinimum, protectedMinimum, 2_592_000);
  }

  /** Deployment-owned opt-in. Candidate code and database state cannot enable it. */
  get automaticRolloutEnabled(): boolean {
    return this.flag('MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED');
  }

  /**
   * Immutable deployment ceiling. `-1` is the fail-closed default; enabling
   * the rollout worker without explicitly selecting a ring queues nothing.
   * Candidate state, mandates and model output cannot raise this value.
   */
  get automaticRolloutMaximumRing(): -1 | 0 | 5 | 25 | 100 {
    const value = Number(
      this.config.get<string | number>('MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING', -1),
    );
    return [-1, 0, 5, 25, 100].includes(value) ? (value as -1 | 0 | 5 | 25 | 100) : -1;
  }

  get automaticRolloutSweepSeconds(): number {
    return this.boundedInt('MSAIDIZI_UPDATE_ROLLOUT_SWEEP_SECONDS', 15, 5, 300);
  }

  assertReady(): void {
    if (
      !this.enabled ||
      !this.keyId ||
      this.keyId.length > 128 ||
      this.minimumHealthySoakSeconds >= this.healthTimeoutSeconds
    ) {
      throw new ServiceUnavailableException('The trusted update signer is not configured');
    }
    this.loadPrivateKey();
  }

  issue(
    fields: Omit<UpdateManifestFields, 'issuedAt' | 'expiresAt'>,
    now = new Date(),
  ): SignedUpdateManifest {
    this.assertReady();
    const manifest: UpdateManifestFields = {
      ...fields,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.manifestTtlSeconds * 1_000).toISOString(),
    };
    // Field order is fixed by the object literal/type above. The verifier signs
    // the received bytes rather than reserializing attacker-controlled JSON.
    const manifestJson = JSON.stringify(manifest);
    try {
      const signature = sign('sha256', Buffer.from(manifestJson, 'utf8'), {
        key: this.loadPrivateKey(),
        dsaEncoding: 'ieee-p1363',
      });
      if (signature.length !== 64) throw new Error('unexpected ES256 signature size');
      return {
        manifestJson,
        manifestSha256: createHash('sha256').update(manifestJson, 'utf8').digest('hex'),
        signature: signature.toString('base64url'),
        signingKeyId: this.keyId,
      };
    } catch {
      throw new ServiceUnavailableException('The trusted update signer is unavailable');
    }
  }

  private loadPrivateKey(): KeyObject {
    const keyPath = this.config.get<string>('MSAIDIZI_UPDATE_SIGNING_KEY_PATH', '').trim();
    if (!isAbsolute(keyPath)) {
      throw new ServiceUnavailableException('The trusted update signing key path is invalid');
    }
    try {
      const resolvedPath = realpathSync(keyPath);
      const fromApplication = relative(realpathSync(process.cwd()), resolvedPath);
      if (
        fromApplication === '' ||
        (fromApplication !== '..' &&
          !fromApplication.startsWith(`..${sep}`) &&
          !isAbsolute(fromApplication))
      ) {
        throw new Error('update signing key is inside the application tree');
      }
      const key = createPrivateKey(readFileSync(resolvedPath, 'utf8'));
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('not a P-256 key');
      }
      return key;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The trusted update signer is unavailable');
    }
  }

  private boundedInt(key: string, fallback: number, min: number, max: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  }

  private flag(key: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
      this.config.get<string>(key, 'false').trim().toLowerCase(),
    );
  }
}
