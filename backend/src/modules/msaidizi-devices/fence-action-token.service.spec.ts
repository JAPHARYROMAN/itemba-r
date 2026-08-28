import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FenceActionTokenService } from './fence-action-token.service';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';

describe('FenceActionTokenService', () => {
  it('issues and verifies the exact protocol-v3 ES256 fence contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'msaidizi-fence-token-'));
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const keyPath = join(directory, 'fence-key.pem');
      writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      const config = new MsaidiziDeviceConfig({
        get: (key: string, fallback?: string | number) =>
          ({
            MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
            MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
            MSAIDIZI_DEVICE_LEASE_PEPPER: 'l'.repeat(64),
            MSAIDIZI_ACTION_SIGNING_KEY_PATH: keyPath,
            MSAIDIZI_ACTION_SIGNING_KEY_ID: 'test-fence-key',
            MSAIDIZI_ACTION_TOKEN_TTL_SECONDS: '120',
          })[key] ?? fallback,
      } as ConfigService);
      const service = new FenceActionTokenService(config);
      const now = new Date('2026-08-27T10:00:00.000Z');
      const claims = {
        fenceId: '11111111-1111-4111-8111-111111111111',
        deviceId: 'device-1',
        actionId: 'action-1',
        taskId: 'task-1',
        stepId: 'step-1',
        oldLeaseId: 'lease-action-1',
        oldFencingToken: '9223372036854775807',
        oldActionTokenSha256: 'A'.repeat(64),
        journalPreviousSequence: 11,
        journalPreviousHash: 'B'.repeat(64),
        dispatchCount: 2,
      };

      const issued = service.issue(claims, now);
      const [encodedHeader, encodedPayload, encodedSignature] = issued.compactToken.split('.');
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

      expect(header).toEqual({ alg: 'ES256', kid: 'test-fence-key', typ: 'fence+jwt' });
      expect(Object.keys(payload).sort()).toEqual(
        [
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
        ].sort(),
      );
      expect(payload).toMatchObject({
        jti: claims.fenceId,
        command_type: 'FENCE_ACTION',
        fence_id: claims.fenceId,
        old_lease_id: claims.oldLeaseId,
        old_fencing_token: claims.oldFencingToken,
        old_action_token_sha256: claims.oldActionTokenSha256,
        journal_previous_sequence: 11,
        journal_previous_hash: claims.journalPreviousHash,
        dispatch_count: 2,
        iat: now.getTime() / 1_000,
        exp: now.getTime() / 1_000 + 120,
      });
      expect(
        verify(
          'sha256',
          Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(encodedSignature, 'base64url'),
        ),
      ).toBe(true);
      expect(service.verify(issued.compactToken, new Date(now.getTime() + 60_000))).toMatchObject({
        valid: true,
        claims: {
          ...claims,
          issuedAt: now.getTime() / 1_000,
          expiresAt: now.getTime() / 1_000 + 120,
        },
      });
      expect(service.verify(issued.compactToken, new Date(now.getTime() + 151_000))).toMatchObject({
        valid: false,
        errorCode: 'FENCE_TOKEN_TIME_INVALID',
      });
      expect(
        service.verify(issued.compactToken, new Date(now.getTime() + 151_000), true),
      ).toMatchObject({ valid: true });

      const tampered = `${encodedHeader}.${Buffer.from(
        JSON.stringify({ ...payload, old_fencing_token: '8' }),
        'utf8',
      ).toString('base64url')}.${encodedSignature}`;
      expect(service.verify(tampered, now)).toMatchObject({
        valid: false,
        errorCode: 'FENCE_TOKEN_SIGNATURE_INVALID',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
