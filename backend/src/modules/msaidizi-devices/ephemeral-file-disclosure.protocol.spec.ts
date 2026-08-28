import {
  EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES,
  EPHEMERAL_FILE_DISCLOSURE_PROTOCOL,
  EphemeralFileDisclosureExpectedBinding,
  EphemeralFileDisclosureGrantV1,
  RejectingEphemeralFileDisclosurePort,
  assertEphemeralFileProviderContract,
  canonicalEphemeralFileDisclosureGrantJson,
  ephemeralFileDisclosureGrantSha256,
  parseEphemeralFileDisclosureGrantAgainstExpectedBinding,
} from './ephemeral-file-disclosure.protocol';
import { REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY } from './host-file-ephemerality.policy';

describe('ephemeral host-file disclosure metadata protocol', () => {
  it('has one canonical cross-runtime byte representation without path or content bytes', () => {
    const grant = fixtureGrant();
    const canonical = canonicalEphemeralFileDisclosureGrantJson(grant);

    expect(canonical).toBe(CANONICAL_FIXTURE);
    expect(ephemeralFileDisclosureGrantSha256(grant)).toBe(CANONICAL_FIXTURE_SHA256);
    expect(canonical).not.toContain('finance/credentials.pdf');
    expect(canonical).not.toContain('known-secret-file-canary');
    expect(canonical).not.toContain('contentBase64');
  });

  it('authorizes only the exact signed task/plan/step/device/path/state/provider generation', () => {
    const grant = fixtureGrant();

    expect(
      parseEphemeralFileDisclosureGrantAgainstExpectedBinding(
        grant,
        expectedBinding(grant),
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toEqual(grant);
  });

  it.each([
    ['allowedMimeTypes', ['text/plain']],
    ['actionId', '77777777-7777-4777-8777-777777777777'],
    ['taskId', '77777777-7777-4777-8777-777777777777'],
    ['planVersionId', '77777777-7777-4777-8777-777777777777'],
    ['stepId', '77777777-7777-4777-8777-777777777777'],
    ['deviceId', '77777777-7777-4777-8777-777777777777'],
    ['mandateId', '77777777-7777-4777-8777-777777777777'],
    ['nonce', Buffer.alloc(32, 8).toString('base64url')],
    ['idempotencyKey', 'ephemeral-file-2'],
    ['argumentsSha256', 'f'.repeat(64)],
    ['capability', 'filesystem.file.read'],
    ['capabilityVersion', '2.0.0'],
    ['expectedPreStateSha256', 'f'.repeat(64)],
    ['expectedFileIdentitySha256', 'f'.repeat(64)],
    ['relativePathSha256', 'f'.repeat(64)],
    ['rootId', 'other-root'],
    ['providerContractArtifactSha256', 'f'.repeat(64)],
    ['providerModelId', 'claude-opus-4-1'],
    ['expiresAt', '2030-01-01T00:01:01.000Z'],
    ['issuanceGeneration', 8],
    ['maximumBytes', EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES - 1],
  ] as Array<[keyof EphemeralFileDisclosureExpectedBinding, string | number | readonly string[]]>)(
    'rejects %s binding drift',
    (key, replacement) => {
      const grant = fixtureGrant();
      const expected = { ...expectedBinding(grant), [key]: replacement };

      expect(() =>
        parseEphemeralFileDisclosureGrantAgainstExpectedBinding(
          grant,
          expected,
          new Date('2030-01-01T00:00:00.000Z'),
        ),
      ).toThrow('EPHEMERAL_FILE_GRANT_BINDING_MISMATCH');
    },
  );

  it.each([
    ['unknown field', (grant: Record<string, unknown>) => ({ ...grant, contentBase64: 'secret' })],
    [
      'unsorted MIME list',
      (grant: Record<string, unknown>) => ({
        ...grant,
        allowedMimeTypes: ['text/plain', 'application/pdf'],
      }),
    ],
    [
      'oversized read',
      (grant: Record<string, unknown>) => ({
        ...grant,
        maximumBytes: EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES + 1,
      }),
    ],
    [
      'non-canonical nonce',
      (grant: Record<string, unknown>) => ({ ...grant, nonce: 'A'.repeat(43) }),
    ],
    ['zero generation', (grant: Record<string, unknown>) => ({ ...grant, issuanceGeneration: 0 })],
  ])('rejects %s before authority can be consumed', (_label, mutate) => {
    const grant = fixtureGrant();
    expect(() =>
      parseEphemeralFileDisclosureGrantAgainstExpectedBinding(
        mutate(grant as unknown as Record<string, unknown>),
        expectedBinding(grant),
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toThrow();
  });

  it('rejects expiration and an excessive lifetime before disclosure', () => {
    const expired = fixtureGrant({ expiresAt: '2030-01-01T00:00:00.000Z' });
    expect(() =>
      parseEphemeralFileDisclosureGrantAgainstExpectedBinding(
        expired,
        expectedBinding(expired),
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toThrow('EPHEMERAL_FILE_GRANT_EXPIRED');

    const long = fixtureGrant({ expiresAt: '2030-01-01T00:02:01.000Z' });
    expect(() =>
      parseEphemeralFileDisclosureGrantAgainstExpectedBinding(
        long,
        expectedBinding(long),
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toThrow('EPHEMERAL_FILE_GRANT_LIFETIME_INVALID');
  });

  it('requires the exact zero-training/zero-retention provider contract and model', () => {
    const grant = fixtureGrant();
    expect(() => assertEphemeralFileProviderContract(grant, providerAttestation())).not.toThrow();

    for (const claims of [
      { zeroTraining: false },
      { providerRetentionSeconds: 1 },
      { coveredDataClasses: ['documents'] },
      { coveredDataClasses: ['credentials'] },
      { permittedModelIds: ['claude-opus-4-1'] },
    ]) {
      expect(() => assertEphemeralFileProviderContract(grant, providerAttestation(claims))).toThrow(
        'EPHEMERAL_FILE_PROVIDER_POLICY_DENIED',
      );
    }
    expect(() =>
      assertEphemeralFileProviderContract(
        grant,
        providerAttestation({}, { artifactSha256: 'f'.repeat(64) }),
      ),
    ).toThrow('EPHEMERAL_FILE_PROVIDER_ATTESTATION_MISMATCH');
  });

  it('keeps the production port non-accepting until the atomic stream is provisioned', () => {
    const port = new RejectingEphemeralFileDisclosurePort();
    expect(port.provisioned).toBe(false);
    expect(() => port.disclose()).toThrow(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  });
});

function fixtureGrant(
  overrides: Partial<EphemeralFileDisclosureGrantV1> = {},
): EphemeralFileDisclosureGrantV1 {
  return {
    actionId: '11111111-1111-4111-8111-111111111111',
    allowedMimeTypes: ['application/pdf', 'text/plain'],
    argumentsSha256: 'a'.repeat(64),
    capability: 'filesystem.file.disclose.ephemeral',
    capabilityVersion: '1.0.0',
    deviceId: '22222222-2222-4222-8222-222222222222',
    expectedFileIdentitySha256: 'b'.repeat(64),
    expectedPreStateSha256: 'c'.repeat(64),
    expiresAt: '2030-01-01T00:01:00.000Z',
    idempotencyKey: 'ephemeral-file-1',
    issuanceGeneration: 7,
    mandateId: '33333333-3333-4333-8333-333333333333',
    maximumBytes: EPHEMERAL_FILE_DISCLOSURE_MAX_BYTES,
    nonce: Buffer.alloc(32, 7).toString('base64url'),
    planVersionId: '44444444-4444-4444-8444-444444444444',
    protocol: EPHEMERAL_FILE_DISCLOSURE_PROTOCOL,
    providerContractArtifactSha256: 'd'.repeat(64),
    providerModelId: 'claude-sonnet-4-5',
    relativePathSha256: 'e'.repeat(64),
    rootId: 'managed',
    stepId: '55555555-5555-4555-8555-555555555555',
    taskId: '66666666-6666-4666-8666-666666666666',
    ...overrides,
  };
}

function expectedBinding(
  grant: EphemeralFileDisclosureGrantV1,
): EphemeralFileDisclosureExpectedBinding {
  return {
    actionId: grant.actionId,
    allowedMimeTypes: grant.allowedMimeTypes,
    argumentsSha256: grant.argumentsSha256,
    capability: grant.capability,
    capabilityVersion: grant.capabilityVersion,
    deviceId: grant.deviceId,
    expectedFileIdentitySha256: grant.expectedFileIdentitySha256,
    expectedPreStateSha256: grant.expectedPreStateSha256,
    expiresAt: grant.expiresAt,
    idempotencyKey: grant.idempotencyKey,
    issuanceGeneration: grant.issuanceGeneration,
    mandateId: grant.mandateId,
    maximumBytes: grant.maximumBytes,
    nonce: grant.nonce,
    planVersionId: grant.planVersionId,
    providerContractArtifactSha256: grant.providerContractArtifactSha256,
    providerModelId: grant.providerModelId,
    relativePathSha256: grant.relativePathSha256,
    rootId: grant.rootId,
    stepId: grant.stepId,
    taskId: grant.taskId,
  };
}

function providerAttestation(
  claimOverrides: Record<string, unknown> = {},
  attestationOverrides: Record<string, unknown> = {},
) {
  return {
    artifact: {
      claims: {
        zeroTraining: true,
        providerRetentionSeconds: 0,
        coveredDataClasses: ['credentials', 'documents'],
        permittedModelIds: ['claude-sonnet-4-5'],
        ...claimOverrides,
      },
    },
    artifactSha256: 'd'.repeat(64),
    ...attestationOverrides,
  } as never;
}

const CANONICAL_FIXTURE =
  '{"actionId":"11111111-1111-4111-8111-111111111111","allowedMimeTypes":["application/pdf","text/plain"],"argumentsSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","capability":"filesystem.file.disclose.ephemeral","capabilityVersion":"1.0.0","deviceId":"22222222-2222-4222-8222-222222222222","expectedFileIdentitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","expectedPreStateSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","expiresAt":"2030-01-01T00:01:00.000Z","idempotencyKey":"ephemeral-file-1","issuanceGeneration":7,"mandateId":"33333333-3333-4333-8333-333333333333","maximumBytes":524288,"nonce":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","planVersionId":"44444444-4444-4444-8444-444444444444","protocol":"msaidizi-ephemeral-file-disclosure/v1","providerContractArtifactSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","providerModelId":"claude-sonnet-4-5","relativePathSha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","rootId":"managed","stepId":"55555555-5555-4555-8555-555555555555","taskId":"66666666-6666-4666-8666-666666666666"}';
const CANONICAL_FIXTURE_SHA256 = 'EF8147671CF19E5B242730CADBBE8C0760B73BD8C3435F18919AEED3D0F84724';
