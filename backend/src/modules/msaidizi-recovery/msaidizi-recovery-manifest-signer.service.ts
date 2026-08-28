import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, KeyObject, sign } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export interface RecoveryManifestFields {
  schemaVersion: 2;
  recoveryId: string;
  deviceId: string;
  originalActionId: string;
  recoveryRecordSha256: string;
  expectedCurrentStateSha256: string;
  expectedRestoredStateSha256: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedRecoveryManifest {
  manifestJson: string;
  manifestSha256: string;
  signature: string;
  signingKeyId: string;
}

/**
 * Signs exact recovery instructions with a deployment-owned key that is
 * intentionally distinct from the autonomous application-update key.
 */
@Injectable()
export class MsaidiziRecoveryManifestSigner {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return (
      this.flag('MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED') && !this.flag('MSAIDIZI_GLOBAL_KILL_SWITCH')
    );
  }

  get keyId(): string {
    return this.config.get<string>('MSAIDIZI_RECOVERY_SIGNING_KEY_ID', '').trim();
  }

  get manifestTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_RECOVERY_MANIFEST_TTL_SECONDS', 600, 60, 3_600);
  }

  get redeliverySeconds(): number {
    return this.boundedInt('MSAIDIZI_RECOVERY_REDELIVERY_SECONDS', 30, 5, 300);
  }

  assertReady(): void {
    if (!this.enabled || !this.keyId || this.keyId.length > 128) {
      throw new ServiceUnavailableException('The trusted recovery signer is not configured');
    }
    this.loadPrivateKey();
  }

  issue(
    fields: Omit<RecoveryManifestFields, 'issuedAt' | 'expiresAt'>,
    now = new Date(),
  ): SignedRecoveryManifest {
    this.assertReady();
    const manifest: RecoveryManifestFields = {
      ...fields,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.manifestTtlSeconds * 1_000).toISOString(),
    };
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
      throw new ServiceUnavailableException('The trusted recovery signer is unavailable');
    }
  }

  private loadPrivateKey(): KeyObject {
    const keyPath = this.config.get<string>('MSAIDIZI_RECOVERY_SIGNING_KEY_PATH', '').trim();
    if (!isAbsolute(keyPath)) {
      throw new ServiceUnavailableException('The trusted recovery signing key path is invalid');
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
        throw new Error('recovery signing key is inside the application tree');
      }
      const key = createPrivateKey(readFileSync(resolvedPath, 'utf8'));
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('not a P-256 key');
      }
      return key;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The trusted recovery signer is unavailable');
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
