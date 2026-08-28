import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const POSITIVE_INT64 = /^[1-9][0-9]{0,18}$/;
const CLOCK_SKEW_SECONDS = 30;

const HEADER_KEYS = ['alg', 'kid', 'typ'] as const;
const CLAIM_KEYS = [
  'iss',
  'aud',
  'sub',
  'jti',
  'command_type',
  'fence_id',
  'device_id',
  'action_id',
  'task_id',
  'step_id',
  'old_lease_id',
  'old_fencing_token',
  'old_action_token_sha256',
  'journal_previous_sequence',
  'journal_previous_hash',
  'dispatch_count',
  'iat',
  'exp',
] as const;

export interface FenceActionClaims {
  fenceId: string;
  deviceId: string;
  actionId: string;
  taskId: string;
  stepId: string;
  oldLeaseId: string;
  oldFencingToken: string;
  oldActionTokenSha256: string;
  journalPreviousSequence: number;
  journalPreviousHash: string;
  dispatchCount: number;
}

export interface IssuedFenceActionToken {
  compactToken: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface FenceActionTokenVerification {
  valid: boolean;
  errorCode: string | null;
  claims: (FenceActionClaims & { issuedAt: number; expiresAt: number }) | null;
}

@Injectable()
export class FenceActionTokenService {
  constructor(private readonly config: MsaidiziDeviceConfig) {}

  issue(exact: FenceActionClaims, now = new Date()): IssuedFenceActionToken {
    const keyId = this.config.signingKeyId;
    if (!this.config.channelReady() || !keyId || keyId.length > 128) {
      throw new ServiceUnavailableException('The device fence signer is not safely configured');
    }
    if (!validClaims(exact)) {
      throw new ServiceUnavailableException('The device fence command binding is invalid');
    }
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const expiresAt = issuedAt + this.config.tokenTtlSeconds;
    const header = { alg: 'ES256', kid: keyId, typ: 'fence+jwt' };
    const payload = {
      iss: this.config.tokenIssuer,
      aud: this.config.tokenAudience,
      sub: this.config.tokenSubject,
      jti: exact.fenceId,
      command_type: 'FENCE_ACTION',
      fence_id: exact.fenceId,
      device_id: exact.deviceId,
      action_id: exact.actionId,
      task_id: exact.taskId,
      step_id: exact.stepId,
      old_lease_id: exact.oldLeaseId,
      old_fencing_token: exact.oldFencingToken,
      old_action_token_sha256: exact.oldActionTokenSha256.toUpperCase(),
      journal_previous_sequence: exact.journalPreviousSequence,
      journal_previous_hash: exact.journalPreviousHash.toUpperCase(),
      dispatch_count: exact.dispatchCount,
      iat: issuedAt,
      exp: expiresAt,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    try {
      const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
        key: this.loadPrivateKey(),
        dsaEncoding: 'ieee-p1363',
      });
      if (signature.length !== 64) throw new Error('unexpected ES256 signature size');
      return {
        compactToken: `${signingInput}.${signature.toString('base64url')}`,
        tokenId: exact.fenceId,
        issuedAt,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The device fence signer is unavailable');
    }
  }

  verify(
    compactToken: string,
    now = new Date(),
    allowExpiredReplay = false,
  ): FenceActionTokenVerification {
    try {
      const segments = compactToken.split('.');
      if (segments.length !== 3 || segments.some((segment) => !canonicalBase64Url(segment))) {
        return invalid('FENCE_TOKEN_FORMAT_INVALID');
      }
      const [encodedHeader, encodedPayload, encodedSignature] = segments;
      const header = parseObject(encodedHeader);
      const payload = parseObject(encodedPayload);
      if (
        !hasExactKeys(header, HEADER_KEYS) ||
        header.alg !== 'ES256' ||
        header.kid !== this.config.signingKeyId ||
        header.typ !== 'fence+jwt'
      ) {
        return invalid('FENCE_TOKEN_HEADER_INVALID');
      }
      if (!hasExactKeys(payload, CLAIM_KEYS)) {
        return invalid('FENCE_TOKEN_CLAIMS_NOT_STRICT');
      }
      const signature = Buffer.from(encodedSignature, 'base64url');
      if (
        signature.length !== 64 ||
        !verify(
          'sha256',
          Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
          { key: createPublicKey(this.loadPrivateKey()), dsaEncoding: 'ieee-p1363' },
          signature,
        )
      ) {
        return invalid('FENCE_TOKEN_SIGNATURE_INVALID');
      }
      if (
        payload.iss !== this.config.tokenIssuer ||
        payload.aud !== this.config.tokenAudience ||
        payload.sub !== this.config.tokenSubject ||
        payload.command_type !== 'FENCE_ACTION' ||
        payload.jti !== payload.fence_id
      ) {
        return invalid('FENCE_TOKEN_SCOPE_INVALID');
      }
      const claims: FenceActionClaims = {
        fenceId: stringClaim(payload.fence_id),
        deviceId: stringClaim(payload.device_id),
        actionId: stringClaim(payload.action_id),
        taskId: stringClaim(payload.task_id),
        stepId: stringClaim(payload.step_id),
        oldLeaseId: stringClaim(payload.old_lease_id),
        oldFencingToken: stringClaim(payload.old_fencing_token),
        oldActionTokenSha256: stringClaim(payload.old_action_token_sha256),
        journalPreviousSequence: numberClaim(payload.journal_previous_sequence),
        journalPreviousHash: stringClaim(payload.journal_previous_hash),
        dispatchCount: numberClaim(payload.dispatch_count),
      };
      if (!validClaims(claims)) return invalid('FENCE_TOKEN_BINDING_INVALID');
      const issuedAt = numberClaim(payload.iat);
      const expiresAt = numberClaim(payload.exp);
      const nowSeconds = Math.floor(now.getTime() / 1_000);
      if (
        !Number.isSafeInteger(issuedAt) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= issuedAt ||
        expiresAt - issuedAt > this.config.tokenTtlSeconds ||
        issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
        (!allowExpiredReplay && expiresAt <= nowSeconds - CLOCK_SKEW_SECONDS)
      ) {
        return invalid('FENCE_TOKEN_TIME_INVALID');
      }
      return { valid: true, errorCode: null, claims: { ...claims, issuedAt, expiresAt } };
    } catch {
      return invalid('FENCE_TOKEN_INVALID');
    }
  }

  private loadPrivateKey(): KeyObject {
    const keyPath = this.config.signingKeyPath;
    if (!this.config.channelReady() || !keyPath || !isAbsolute(keyPath)) {
      throw new ServiceUnavailableException('The device fence signer is not safely configured');
    }
    try {
      const key = createPrivateKey(readFileSync(realpathSync(keyPath), 'utf8'));
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('not a P-256 EC key');
      }
      return key;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The device fence signer is unavailable');
    }
  }
}

function validClaims(value: FenceActionClaims): boolean {
  return (
    [
      value.fenceId,
      value.deviceId,
      value.actionId,
      value.taskId,
      value.stepId,
      value.oldLeaseId,
    ].every((item) => SAFE_IDENTIFIER.test(item)) &&
    POSITIVE_INT64.test(value.oldFencingToken) &&
    BigInt(value.oldFencingToken) <= 9_223_372_036_854_775_807n &&
    SHA256_HEX.test(value.oldActionTokenSha256) &&
    Number.isSafeInteger(value.journalPreviousSequence) &&
    value.journalPreviousSequence >= 0 &&
    SHA256_HEX.test(value.journalPreviousHash) &&
    Number.isSafeInteger(value.dispatchCount) &&
    value.dispatchCount >= 1 &&
    value.dispatchCount <= 3
  );
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function canonicalBase64Url(value: string): boolean {
  return (
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('not an object');
  }
  return parsed as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected
      .slice()
      .sort()
      .every((key, i) => key === actual[i])
  );
}

function stringClaim(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberClaim(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function invalid(errorCode: string): FenceActionTokenVerification {
  return { valid: false, errorCode, claims: null };
}
