import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MsaidiziUpdateManifestSigner } from './msaidizi-update-manifest-signer.service';

describe('MsaidiziUpdateManifestSigner', () => {
  it('keeps the deployment-owned automatic ring ceiling closed unless it is exact', () => {
    const signerFor = (value: unknown) =>
      new MsaidiziUpdateManifestSigner({
        get: (key: string, fallback: unknown) =>
          key === 'MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING' ? (value ?? fallback) : fallback,
      } as never);

    expect(signerFor(undefined).automaticRolloutMaximumRing).toBe(-1);
    expect(signerFor('25').automaticRolloutMaximumRing).toBe(25);
    expect(signerFor('99').automaticRolloutMaximumRing).toBe(-1);
    expect(signerFor(Number.NaN).automaticRolloutMaximumRing).toBe(-1);
  });

  it('refuses every new dispatch while the central kill switch is active', () => {
    const signer = new MsaidiziUpdateManifestSigner({
      get: (key: string, fallback: unknown) =>
        key === 'MSAIDIZI_UPDATE_SUPERVISOR_ENABLED' || key === 'MSAIDIZI_GLOBAL_KILL_SWITCH'
          ? 'true'
          : fallback,
    } as never);

    expect(() => signer.assertReady()).toThrow('not configured');
  });

  it('issues an exact P-1363 P-256 manifest bound to device, artifacts and policy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'msaidizi-update-signer-'));
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const keyPath = join(directory, 'update-private.pem');
      writeFileSync(
        keyPath,
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        'utf8',
      );
      const values: Record<string, string> = {
        MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: 'true',
        MSAIDIZI_UPDATE_SIGNING_KEY_PATH: keyPath,
        MSAIDIZI_UPDATE_SIGNING_KEY_ID: 'bootstrap-test',
        MSAIDIZI_UPDATE_MANIFEST_TTL_SECONDS: '600',
      };
      const signer = new MsaidiziUpdateManifestSigner({
        get: (key: string, fallback: unknown) => values[key] ?? fallback,
      } as never);

      const issued = signer.issue(
        {
          schemaVersion: 2,
          deploymentId: '11111111-1111-4111-8111-111111111111',
          candidateId: '22222222-2222-4222-8222-222222222222',
          deviceId: '33333333-3333-4333-8333-333333333333',
          operation: 'APPLY',
          ring: 0,
          targetId: 'itemba.msaidizi.application',
          version: '1.2.3',
          rollbackVersion: '1.2.2',
          sourceArtifactSha256: 'a'.repeat(64),
          rollbackArtifactSha256: 'b'.repeat(64),
          healthTimeoutSeconds: 120,
          minimumHealthySoakSeconds: 60,
          minimumRingDwellSeconds: 86_400,
          deliveryLeaseId: '44444444-4444-4444-8444-444444444444',
          deliveryAttempt: 1,
          idempotencyKey: 'c'.repeat(64),
        },
        new Date('2026-08-25T12:00:00.000Z'),
      );

      expect(issued.signingKeyId).toBe('bootstrap-test');
      expect(
        verify(
          'sha256',
          Buffer.from(issued.manifestJson, 'utf8'),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(issued.signature, 'base64url'),
        ),
      ).toBe(true);
      expect(JSON.parse(issued.manifestJson)).toEqual(
        expect.objectContaining({
          deviceId: '33333333-3333-4333-8333-333333333333',
          sourceArtifactSha256: 'a'.repeat(64),
          rollbackVersion: '1.2.2',
          minimumHealthySoakSeconds: 60,
          minimumRingDwellSeconds: 86_400,
          deliveryAttempt: 1,
          expiresAt: '2026-08-25T12:10:00.000Z',
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
