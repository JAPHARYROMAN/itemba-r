import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionTokenService } from './action-token.service';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';

describe('ActionTokenService', () => {
  it('issues a strict P-1363 ES256 token matching the companion contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'msaidizi-action-token-'));
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const keyPath = join(directory, 'action-key.pem');
      writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      const values: Record<string, string> = {
        MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
        MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
        MSAIDIZI_DEVICE_LEASE_PEPPER: 'l'.repeat(64),
        MSAIDIZI_ACTION_SIGNING_KEY_PATH: keyPath,
        MSAIDIZI_ACTION_SIGNING_KEY_ID: 'test-action-key',
      };
      const config = new MsaidiziDeviceConfig({
        get: (key: string, fallback?: string) => values[key] ?? fallback,
      } as ConfigService);
      const service = new ActionTokenService(config);
      const exact = {
        executionMode: 'EXECUTE',
        actionId: 'action-1',
        taskId: 'task-1',
        planVersionId: 'plan-version-1',
        stepId: 'step-1',
        deviceId: 'device-1',
        mandateId: 'mandate-1',
        capabilityId: 'system.status.read',
        capabilityVersion: '1.0.0',
        argumentsSha256: 'A'.repeat(64),
        expectedPreStateSha256: 'B'.repeat(64),
        inputProvenanceSha256: null,
        idempotencyKey: 'msaidizi-host:step-1',
        leaseId: 'lease-action-1',
        fencingToken: '9223372036854775807',
        leaseExpiresAt: new Date('2026-08-25T10:01:30.000Z'),
        dispatchCount: 2,
        consentGrant: 'emergency_operator',
        budgets: {
          maxWallTimeSeconds: 60,
          maxModelTurns: 10,
          maxAttemptedToolCalls: 20,
          maxMutations: 0,
          maxLocalBytes: 1_024,
          maxExternalEgressBytes: 2_048,
          maxModelSpendUsd: 1,
          brokerMaxDeliverySessions: 3,
          brokerMaxRequestAttemptsPerSession: 3,
          brokerSerializedResultUpperBoundBytes: 128,
        },
      } as const;
      const issued = service.issue(exact, new Date('2026-08-25T10:00:00.000Z'));

      const [encodedHeader, encodedPayload, encodedSignature] = issued.compactToken.split('.');
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      const signature = Buffer.from(encodedSignature, 'base64url');

      expect(header).toEqual({ alg: 'ES256', kid: 'test-action-key', typ: 'at+jwt' });
      expect(Object.keys(payload).sort()).toEqual(
        [
          'iss',
          'aud',
          'sub',
          'jti',
          'execution_mode',
          'action_id',
          'task_id',
          'plan_version_id',
          'step_id',
          'device_id',
          'mandate_id',
          'capability_id',
          'capability_version',
          'arguments_sha256',
          'expected_pre_state_sha256',
          'input_provenance_sha256',
          'idempotency_key',
          'lease_id',
          'fencing_token',
          'lease_expires_at',
          'dispatch_count',
          'consent_grant',
          'budgets',
          'iat',
          'exp',
        ].sort(),
      );
      expect(Object.keys(payload.budgets).sort()).toEqual(
        [
          'maxWallTimeSeconds',
          'maxModelTurns',
          'maxAttemptedToolCalls',
          'maxMutations',
          'maxLocalBytes',
          'maxExternalEgressBytes',
          'maxModelSpendUsd',
          'brokerMaxDeliverySessions',
          'brokerMaxRequestAttemptsPerSession',
          'brokerSerializedResultUpperBoundBytes',
        ].sort(),
      );
      expect(payload).toMatchObject({
        iss: 'itemba-msaidizi-broker',
        aud: 'itemba-windows-companion',
        sub: 'msaidizi-global',
        execution_mode: 'EXECUTE',
        plan_version_id: 'plan-version-1',
        arguments_sha256: 'A'.repeat(64),
        lease_id: 'lease-action-1',
        fencing_token: '9223372036854775807',
        lease_expires_at: Date.parse('2026-08-25T10:01:30.000Z') / 1_000,
        dispatch_count: 2,
        consent_grant: 'emergency_operator',
        iat: Date.parse('2026-08-25T10:00:00.000Z') / 1_000,
        exp: Date.parse('2026-08-25T10:01:30.000Z') / 1_000,
      });
      const replayIssued = service.issue(
        { ...exact, executionMode: 'REPLAY_RESULT_ONLY' },
        new Date('2026-08-25T10:00:00.000Z'),
      );
      const replayPayload = JSON.parse(
        Buffer.from(replayIssued.compactToken.split('.')[1], 'base64url').toString('utf8'),
      );
      expect(replayPayload.execution_mode).toBe('REPLAY_RESULT_ONLY');
      expect(() =>
        service.issue(
          { ...exact, executionMode: undefined } as unknown as Parameters<
            ActionTokenService['issue']
          >[0],
          new Date('2026-08-25T10:00:00.000Z'),
        ),
      ).toThrow('The device action execution mode is invalid');
      expect(() =>
        service.issue(
          { ...exact, executionMode: 'INFER_EXECUTE' } as unknown as Parameters<
            ActionTokenService['issue']
          >[0],
          new Date('2026-08-25T10:00:00.000Z'),
        ),
      ).toThrow('The device action execution mode is invalid');
      expect(signature).toHaveLength(64);
      expect(
        verify(
          'sha256',
          Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signature,
        ),
      ).toBe(true);
      for (const invalid of [
        { fencingToken: '0' },
        { fencingToken: '01' },
        { fencingToken: '9223372036854775808' },
        { leaseId: '' },
        { leaseId: ':lease-action-1' },
        { leaseExpiresAt: new Date('2026-08-25T09:59:59.000Z') },
      ]) {
        expect(() =>
          service.issue({ ...exact, ...invalid }, new Date('2026-08-25T10:00:00.000Z')),
        ).toThrow('The device action lease fence is invalid');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
