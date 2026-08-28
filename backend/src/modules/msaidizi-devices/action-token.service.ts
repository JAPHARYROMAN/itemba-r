import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, KeyObject, randomUUID, sign } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';

export interface ActionBudgetClaims {
  maxWallTimeSeconds: number;
  maxModelTurns: number;
  maxAttemptedToolCalls: number;
  maxMutations: number;
  maxLocalBytes: number;
  maxExternalEgressBytes: number;
  maxModelSpendUsd: number;
  brokerMaxDeliverySessions: number;
  brokerMaxRequestAttemptsPerSession: number;
  brokerSerializedResultUpperBoundBytes: number;
}

export interface ExactActionClaims {
  executionMode: 'EXECUTE' | 'REPLAY_RESULT_ONLY';
  actionId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  deviceId: string;
  mandateId: string;
  capabilityId: string;
  capabilityVersion: string;
  argumentsSha256: string;
  expectedPreStateSha256: string | null;
  inputProvenanceSha256: string | null;
  idempotencyKey: string;
  leaseId: string;
  /** Canonical positive decimal string; never serialize a Prisma BigInt as JSON number. */
  fencingToken: string;
  /** Authoritative persisted lease expiry; serialized into the JWT as epoch seconds. */
  leaseExpiresAt: Date;
  /** Signed transport generation; intentionally excluded from idempotency. */
  dispatchCount: number;
  consentGrant: 'active_user' | 'one_shot_approval' | 'emergency_operator' | null;
  budgets: ActionBudgetClaims;
}

export interface IssuedActionToken {
  compactToken: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}

/** Issues the strict ES256 at+jwt consumed by the Windows companion. */
@Injectable()
export class ActionTokenService {
  constructor(private readonly config: MsaidiziDeviceConfig) {}

  assertReady(): void {
    this.loadPrivateKey();
  }

  issue(exact: ExactActionClaims, now = new Date()): IssuedActionToken {
    const keyId = this.config.signingKeyId;
    if (!this.config.channelReady() || !keyId) {
      throw new ServiceUnavailableException('The device action signer is not safely configured');
    }
    if (keyId.length > 128) {
      throw new ServiceUnavailableException('The device action signing key id is invalid');
    }
    if (!new Set(['EXECUTE', 'REPLAY_RESULT_ONLY']).has(exact.executionMode)) {
      throw new ServiceUnavailableException('The device action execution mode is invalid');
    }
    if (
      !Number.isSafeInteger(exact.dispatchCount) ||
      exact.dispatchCount < 1 ||
      exact.dispatchCount > exact.budgets.brokerMaxDeliverySessions
    ) {
      throw new ServiceUnavailableException('The device action dispatch generation is invalid');
    }

    const issuedAt = Math.floor(now.getTime() / 1_000);
    const leaseExpiresAt = Math.floor(
      (exact.leaseExpiresAt instanceof Date ? exact.leaseExpiresAt.getTime() : Number.NaN) / 1_000,
    );
    if (
      !isSafeLeaseId(exact.leaseId) ||
      !isPositiveInt64Decimal(exact.fencingToken) ||
      !Number.isSafeInteger(leaseExpiresAt) ||
      leaseExpiresAt <= issuedAt
    ) {
      throw new ServiceUnavailableException('The device action lease fence is invalid');
    }
    const expiresAt = Math.min(issuedAt + this.config.tokenTtlSeconds, leaseExpiresAt);
    const tokenId = randomUUID();
    const header = { alg: 'ES256', kid: keyId, typ: 'at+jwt' };
    const payload = {
      iss: this.config.tokenIssuer,
      aud: this.config.tokenAudience,
      sub: this.config.tokenSubject,
      jti: tokenId,
      execution_mode: exact.executionMode,
      action_id: exact.actionId,
      task_id: exact.taskId,
      plan_version_id: exact.planVersionId,
      step_id: exact.stepId,
      device_id: exact.deviceId,
      mandate_id: exact.mandateId,
      capability_id: exact.capabilityId,
      capability_version: exact.capabilityVersion,
      arguments_sha256: exact.argumentsSha256,
      expected_pre_state_sha256: exact.expectedPreStateSha256,
      input_provenance_sha256: exact.inputProvenanceSha256,
      idempotency_key: exact.idempotencyKey,
      lease_id: exact.leaseId,
      fencing_token: exact.fencingToken,
      lease_expires_at: leaseExpiresAt,
      dispatch_count: exact.dispatchCount,
      ...(exact.consentGrant ? { consent_grant: exact.consentGrant } : {}),
      budgets: exact.budgets,
      iat: issuedAt,
      exp: expiresAt,
    };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    try {
      const privateKey = this.loadPrivateKey();
      const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      if (signature.length !== 64) throw new Error('unexpected ES256 signature size');
      return {
        compactToken: `${signingInput}.${signature.toString('base64url')}`,
        tokenId,
        issuedAt,
        expiresAt,
      };
    } catch {
      throw new ServiceUnavailableException('The device action signer is unavailable');
    }
  }

  private loadPrivateKey(): KeyObject {
    const keyPath = this.config.signingKeyPath;
    if (!this.config.channelReady() || !keyPath || !isAbsolute(keyPath)) {
      throw new ServiceUnavailableException('The device action signer is not safely configured');
    }
    try {
      const resolvedPath = realpathSync(keyPath);
      const privateKey = createPrivateKey(readFileSync(resolvedPath, 'utf8'));
      if (
        privateKey.asymmetricKeyType !== 'ec' ||
        privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      ) {
        throw new Error('not a P-256 EC key');
      }
      return privateKey;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The device action signer is unavailable');
    }
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function isSafeLeaseId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function isPositiveInt64Decimal(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}
