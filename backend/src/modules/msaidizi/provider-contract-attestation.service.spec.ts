import { ConfigService } from '@nestjs/config';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTHROPIC_API_ORIGIN,
  ProviderContractClaims,
  REQUIRED_PROVIDER_DATA_CLASSES,
  signProviderContractAttestation,
} from './provider-contract-attestation.protocol';
import { ProviderContractAttestationService } from './provider-contract-attestation.service';

describe('ProviderContractAttestationService', () => {
  const root = mkdtempSync(join(tmpdir(), 'itemba-provider-contract-'));
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPath = join(root, 'provider-contract-public.pem');
  const artifactPath = join(root, 'provider-contract-attestation.json');
  const keyId = 'provider-contract-test-key';
  const signerSpkiSha256 = createHash('sha256')
    .update(keys.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  const models = ['claude-haiku-4-5', 'claude-opus-5'];
  const apiCredentialKeyId = 'anthropic-service/key-v7';

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function claims(overrides: Partial<ProviderContractClaims> = {}): ProviderContractClaims {
    return {
      attestationId: 'service-test-attestation',
      provider: 'anthropic',
      apiOrigin: ANTHROPIC_API_ORIGIN,
      apiAccountId: 'org-service-test',
      apiCredentialKeyId,
      permittedModelIds: models,
      coveredDataClasses: [...REQUIRED_PROVIDER_DATA_CLASSES],
      zeroTraining: true,
      providerRetentionSeconds: 0,
      contractDocumentSha256: 'c'.repeat(64),
      immutableLegalReference: `urn:sha256:${'c'.repeat(64)}`,
      issuedAt: '2000-01-01T00:00:00.000Z',
      effectiveAt: '2000-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function harness(
    overrides: Record<string, string> = {},
    claimOverrides: Partial<ProviderContractClaims> = {},
  ) {
    const raw = signProviderContractAttestation(claims(claimOverrides), keys.privateKey, keyId);
    writeFileSync(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    writeFileSync(artifactPath, raw);
    const values = {
      MSAIDIZI_ENABLED: 'true',
      MSAIDIZI_MODEL: 'claude-opus-5',
      MSAIDIZI_CLASSIFIER_MODEL: 'claude-haiku-4-5',
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: artifactPath,
      MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH: publicKeyPath,
      MSAIDIZI_PROVIDER_CONTRACT_KEY_ID: keyId,
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256: createHash('sha256').update(raw).digest('hex'),
      MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256: signerSpkiSha256,
      MSAIDIZI_PROVIDER_ACCOUNT_ID: 'org-service-test',
      MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: apiCredentialKeyId,
      ...overrides,
    };
    return new ProviderContractAttestationService(new ConfigService(values));
  }

  it('fails closed at module startup when enabled and accepts current signed external evidence', () => {
    const service = harness();
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.assertCurrent(new Date('2026-08-26T12:00:00.000Z'))).toMatchObject({
      signerSpkiSha256,
      artifact: { keyId, claims: { apiAccountId: 'org-service-test' } },
    });

    expect(() =>
      harness({ MSAIDIZI_PROVIDER_CONTRACT_KEY_ID: 'wrong-key' }).onModuleInit(),
    ).toThrow('PROVIDER_CONTRACT_KEY_ID_MISMATCH');
  });

  it('rejects missing or mismatched credential identity and accepts an explicit signed rotation', () => {
    expect(() => harness({ MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: '' }).onModuleInit()).toThrow(
      'PROVIDER_CONTRACT_NOT_CONFIGURED',
    );
    expect(() =>
      harness({ MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: 'anthropic-service/key-v8' }).onModuleInit(),
    ).toThrow('PROVIDER_CONTRACT_CREDENTIAL_KEY_MISMATCH');

    expect(() =>
      harness(
        { MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: 'anthropic-service/key-v8' },
        { apiCredentialKeyId: 'anthropic-service/key-v8' },
      ).onModuleInit(),
    ).not.toThrow();
  });

  it('rechecks time on every assertion so post-startup expiry blocks the next disclosure', () => {
    const service = harness();
    expect(() => service.assertCurrent(new Date('2098-12-31T23:59:59.999Z'))).not.toThrow();
    expect(() => service.assertCurrent(new Date('2099-01-01T00:00:00.000Z'))).toThrow(
      'PROVIDER_CONTRACT_EXPIRED',
    );
  });

  it('rejects partial configuration, application-tree files, hard links and reparse paths', () => {
    const missing = new ProviderContractAttestationService(
      new ConfigService({ MSAIDIZI_ENABLED: 'true' }),
    );
    expect(() => missing.onModuleInit()).toThrow('PROVIDER_CONTRACT_NOT_CONFIGURED');

    const internal = harness({
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: join(process.cwd(), 'package.json'),
    });
    expect(() => internal.onModuleInit()).toThrow('PROVIDER_CONTRACT_PATH_INVALID');

    const hardLink = join(root, 'attestation-hard-link.json');
    try {
      linkSync(artifactPath, hardLink);
      expect(() =>
        harness({ MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: hardLink }).onModuleInit(),
      ).toThrow('PROVIDER_CONTRACT_FILE_INVALID');
    } finally {
      try {
        rmSync(hardLink, { force: true });
      } catch {
        // best-effort test cleanup inside the dedicated temp directory
      }
    }

    const link = join(root, 'attestation-link.json');
    try {
      symlinkSync(artifactPath, link, 'file');
      expect(() =>
        harness({ MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: link }).onModuleInit(),
      ).toThrow('PROVIDER_CONTRACT_FILE_INVALID');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    } finally {
      try {
        rmSync(link, { force: true });
      } catch {
        // best-effort test cleanup inside the dedicated temp directory
      }
    }
  });

  it('rejects private verification material, oversized evidence and file/hash drift', () => {
    const privatePath = join(root, 'forbidden-private.pem');
    writeFileSync(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() =>
      harness({ MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH: privatePath }).onModuleInit(),
    ).toThrow('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID');

    expect(() =>
      harness({ MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256: 'f'.repeat(64) }).onModuleInit(),
    ).toThrow('PROVIDER_CONTRACT_ARTIFACT_DIGEST_MISMATCH');

    writeFileSync(artifactPath, Buffer.alloc(64 * 1024 + 1, 1));
    const config = new ConfigService({
      MSAIDIZI_ENABLED: 'true',
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: artifactPath,
      MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH: publicKeyPath,
      MSAIDIZI_PROVIDER_CONTRACT_KEY_ID: keyId,
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256: '0'.repeat(64),
      MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256: signerSpkiSha256,
      MSAIDIZI_PROVIDER_ACCOUNT_ID: 'org-service-test',
      MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: apiCredentialKeyId,
    });
    expect(() => new ProviderContractAttestationService(config).onModuleInit()).toThrow(
      'PROVIDER_CONTRACT_FILE_INVALID',
    );
  });
});
