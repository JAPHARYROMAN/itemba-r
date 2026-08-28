import { createHash, generateKeyPairSync } from 'node:crypto';
import schema from './provider-contract-attestation.schema.json';
import {
  ANTHROPIC_API_ORIGIN,
  canonicalProviderContractJson,
  ProviderContractClaims,
  REQUIRED_PROVIDER_DATA_CLASSES,
  signProviderContractAttestation,
  verifyProviderContractAttestation,
} from './provider-contract-attestation.protocol';

describe('provider-contract attestation protocol', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const signerSpkiSha256 = createHash('sha256')
    .update(keys.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  const keyId = 'provider-contract-2026-01';
  const now = new Date('2026-08-26T12:00:00.000Z');
  const models = ['claude-haiku-4-5', 'claude-opus-5'];
  const apiCredentialKeyId = 'anthropic-prod/key-v17';

  function claims(overrides: Partial<ProviderContractClaims> = {}): ProviderContractClaims {
    return {
      attestationId: 'anthropic-itemba-2026-01',
      provider: 'anthropic',
      apiOrigin: ANTHROPIC_API_ORIGIN,
      apiAccountId: 'org-itemba-production',
      apiCredentialKeyId,
      permittedModelIds: models,
      coveredDataClasses: [...REQUIRED_PROVIDER_DATA_CLASSES],
      zeroTraining: true,
      providerRetentionSeconds: 0,
      contractDocumentSha256: 'a'.repeat(64),
      immutableLegalReference: `urn:sha256:${'a'.repeat(64)}`,
      issuedAt: '2026-08-01T00:00:00.000Z',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2027-08-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function signed(overrides: Partial<ProviderContractClaims> = {}) {
    const raw = signProviderContractAttestation(claims(overrides), keys.privateKey, keyId);
    return { raw, digest: createHash('sha256').update(raw).digest('hex') };
  }

  function verify(
    raw: string,
    digest = createHash('sha256').update(raw).digest('hex'),
    expectedApiCredentialKeyId = apiCredentialKeyId,
  ) {
    return verifyProviderContractAttestation(raw, {
      publicKeyPem: publicPem,
      expectedKeyId: keyId,
      expectedArtifactSha256: digest,
      expectedSignerSpkiSha256: signerSpkiSha256,
      expectedProvider: 'anthropic',
      expectedApiOrigin: ANTHROPIC_API_ORIGIN,
      expectedApiAccountId: 'org-itemba-production',
      expectedApiCredentialKeyId,
      expectedModelIds: models,
      now,
    });
  }

  it('accepts exact canonical P-256 evidence bound to account, models, data classes and time', () => {
    const artifact = signed();
    expect(verify(artifact.raw, artifact.digest)).toMatchObject({
      artifactSha256: artifact.digest,
      signerSpkiSha256,
      artifact: {
        keyId,
        claims: {
          zeroTraining: true,
          providerRetentionSeconds: 0,
          apiOrigin: ANTHROPIC_API_ORIGIN,
          apiAccountId: 'org-itemba-production',
          apiCredentialKeyId,
          permittedModelIds: models,
          coveredDataClasses: REQUIRED_PROVIDER_DATA_CLASSES,
        },
      },
    });
  });

  it('publishes a schema that pins the same origin, legal reference, timestamps and signature', () => {
    const published = schema as unknown as {
      properties: {
        claims: {
          required: string[];
          properties: Record<string, { const?: string; pattern?: string }>;
        };
        keyId: { pattern: string };
        signatureBase64: { pattern: string };
      };
    };
    const claimsSchema = published.properties.claims;

    expect(claimsSchema.required).toContain('apiOrigin');
    expect(claimsSchema.required).toContain('apiCredentialKeyId');
    expect(claimsSchema.properties.apiOrigin.const).toBe(ANTHROPIC_API_ORIGIN);
    expect(claimsSchema.properties.apiCredentialKeyId.pattern).toBe('^[A-Za-z0-9._:@/-]{1,256}$');
    expect(claimsSchema.properties.immutableLegalReference.pattern).toBe(
      '^urn:sha256:[a-f0-9]{64}$',
    );
    for (const name of ['issuedAt', 'effectiveAt', 'expiresAt']) {
      expect(claimsSchema.properties[name].pattern).toContain('\\.[0-9]{3}Z$');
    }
    expect(published.properties.keyId.pattern).toBe('^[A-Za-z0-9._:-]{1,128}$');
    expect(published.properties.signatureBase64.pattern).toBe('^[A-Za-z0-9+/]{86}==$');
  });

  it('rejects noncanonical bytes, unknown fields and any signature or digest drift', () => {
    const artifact = signed();
    expect(() => verify(`${artifact.raw}\n`)).toThrow('PROVIDER_CONTRACT_NONCANONICAL_JSON');

    const withUnknown = JSON.parse(artifact.raw) as Record<string, unknown>;
    withUnknown.unknown = true;
    const unknownRaw = JSON.stringify(withUnknown);
    expect(() => verify(unknownRaw)).toThrow('PROVIDER_CONTRACT_SHAPE_INVALID');

    const tampered = artifact.raw.replace('org-itemba-production', 'org-itemba-forged000');
    expect(() => verify(tampered)).toThrow('PROVIDER_CONTRACT_SIGNATURE_INVALID');
    expect(() => verify(artifact.raw, 'f'.repeat(64))).toThrow(
      'PROVIDER_CONTRACT_ARTIFACT_DIGEST_MISMATCH',
    );
  });

  it.each([
    [{ zeroTraining: false }, 'PROVIDER_CONTRACT_TRAINING_NOT_PROHIBITED'],
    [{ providerRetentionSeconds: 1 }, 'PROVIDER_CONTRACT_RETENTION_NOT_ZERO'],
    [{ apiOrigin: 'https://attacker.invalid' as never }, 'PROVIDER_CONTRACT_API_ORIGIN_INVALID'],
    [{ apiAccountId: 'another-account' }, 'PROVIDER_CONTRACT_ACCOUNT_MISMATCH'],
    [{ apiCredentialKeyId: 'anthropic-prod/key-v18' }, 'PROVIDER_CONTRACT_CREDENTIAL_KEY_MISMATCH'],
    [{ permittedModelIds: ['claude-opus-5'] }, 'PROVIDER_CONTRACT_MODEL_SCOPE_MISMATCH'],
    [{ coveredDataClasses: ['credentials'] }, 'PROVIDER_CONTRACT_DATA_SCOPE_INCOMPLETE'],
  ] as Array<[Partial<ProviderContractClaims>, string]>)(
    'rejects unsafe claim %j',
    (claim, code) => {
      const artifact = signed(claim);
      expect(() => verify(artifact.raw, artifact.digest)).toThrow(code);
    },
  );

  it('fails closed on missing credential identity and requires signed rotation to the pinned key ID', () => {
    const { apiCredentialKeyId: _removed, ...missingClaims } = claims();
    void _removed;
    const missingRaw = signProviderContractAttestation(
      missingClaims as ProviderContractClaims,
      keys.privateKey,
      keyId,
    );
    expect(() => verify(missingRaw)).toThrow('PROVIDER_CONTRACT_SHAPE_INVALID');

    const rotated = signed({ apiCredentialKeyId: 'anthropic-prod/key-v18' });
    expect(() => verify(rotated.raw, rotated.digest)).toThrow(
      'PROVIDER_CONTRACT_CREDENTIAL_KEY_MISMATCH',
    );
    expect(() => verify(rotated.raw, rotated.digest, 'anthropic-prod/key-v18')).not.toThrow();

    const v1 = rotated.raw.replace(
      'msaidizi-provider-contract-attestation/v2',
      'msaidizi-provider-contract-attestation/v1',
    );
    expect(() => verify(v1)).toThrow('PROVIDER_CONTRACT_VERSION_UNSUPPORTED');
  });

  it('rejects not-yet-valid, expired, noncanonical and incoherent time ranges', () => {
    const future = signed({ effectiveAt: '2026-09-01T00:00:00.000Z' });
    expect(() => verify(future.raw, future.digest)).toThrow('PROVIDER_CONTRACT_NOT_YET_VALID');

    const expired = signed({ expiresAt: '2026-08-26T12:00:00.000Z' });
    expect(() => verify(expired.raw, expired.digest)).toThrow('PROVIDER_CONTRACT_EXPIRED');

    const noncanonical = signed({ issuedAt: '2026-08-01T00:00:00Z' });
    expect(() => verify(noncanonical.raw, noncanonical.digest)).toThrow(
      'PROVIDER_CONTRACT_TIME_INVALID',
    );

    const incoherent = signed({ effectiveAt: '2027-08-01T00:00:00.000Z' });
    expect(() => verify(incoherent.raw, incoherent.digest)).toThrow(
      'PROVIDER_CONTRACT_TIME_RANGE_INVALID',
    );

    const issuedAfterExpiry = signed({ issuedAt: '2027-08-02T00:00:00.000Z' });
    expect(() => verify(issuedAfterExpiry.raw, issuedAfterExpiry.digest)).toThrow(
      'PROVIDER_CONTRACT_TIME_RANGE_INVALID',
    );

    const futureIssuance = signed({ issuedAt: '2026-09-01T00:00:00.000Z' });
    expect(() => verify(futureIssuance.raw, futureIssuance.digest)).toThrow(
      'PROVIDER_CONTRACT_NOT_YET_VALID',
    );
  });

  it('allows a current attestation issued after an already-effective contract', () => {
    const artifact = signed({
      effectiveAt: '2026-07-01T00:00:00.000Z',
      issuedAt: '2026-08-25T00:00:00.000Z',
    });
    expect(() => verify(artifact.raw, artifact.digest)).not.toThrow();
  });

  it('requires the legal reference to address the exact contract-document digest', () => {
    const artifact = signed({ immutableLegalReference: `urn:sha256:${'b'.repeat(64)}` });
    expect(() => verify(artifact.raw, artifact.digest)).toThrow(
      'PROVIDER_CONTRACT_LEGAL_REFERENCE_INVALID',
    );
  });

  it('rejects private verification material, wrong curves, wrong signer pins and malformed P1363', () => {
    const artifact = signed();
    expect(() =>
      verifyProviderContractAttestation(artifact.raw, {
        publicKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        expectedKeyId: keyId,
        expectedArtifactSha256: artifact.digest,
        expectedSignerSpkiSha256: signerSpkiSha256,
        expectedProvider: 'anthropic',
        expectedApiOrigin: ANTHROPIC_API_ORIGIN,
        expectedApiAccountId: 'org-itemba-production',
        expectedApiCredentialKeyId: apiCredentialKeyId,
        expectedModelIds: models,
        now,
      }),
    ).toThrow('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID');

    const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey;
    expect(() =>
      verifyProviderContractAttestation(artifact.raw, {
        publicKeyPem: wrongCurve.export({ type: 'spki', format: 'pem' }),
        expectedKeyId: keyId,
        expectedArtifactSha256: artifact.digest,
        expectedSignerSpkiSha256: signerSpkiSha256,
        expectedProvider: 'anthropic',
        expectedApiOrigin: ANTHROPIC_API_ORIGIN,
        expectedApiAccountId: 'org-itemba-production',
        expectedApiCredentialKeyId: apiCredentialKeyId,
        expectedModelIds: models,
        now,
      }),
    ).toThrow('PROVIDER_CONTRACT_PUBLIC_KEY_INVALID');

    expect(() =>
      verifyProviderContractAttestation(artifact.raw, {
        publicKeyPem: publicPem,
        expectedKeyId: keyId,
        expectedArtifactSha256: artifact.digest,
        expectedSignerSpkiSha256: 'b'.repeat(64),
        expectedProvider: 'anthropic',
        expectedApiOrigin: ANTHROPIC_API_ORIGIN,
        expectedApiAccountId: 'org-itemba-production',
        expectedApiCredentialKeyId: apiCredentialKeyId,
        expectedModelIds: models,
        now,
      }),
    ).toThrow('PROVIDER_CONTRACT_SIGNER_PIN_MISMATCH');

    const parsed = JSON.parse(artifact.raw) as { signatureBase64: string };
    parsed.signatureBase64 = Buffer.alloc(63).toString('base64');
    const malformed = canonicalProviderContractJson(parsed);
    expect(() => verify(malformed)).toThrow('PROVIDER_CONTRACT_SIGNATURE_INVALID');
  });
});
