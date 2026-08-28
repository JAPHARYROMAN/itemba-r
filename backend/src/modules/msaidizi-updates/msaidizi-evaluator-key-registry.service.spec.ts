import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  attestationSigningPayload,
  canonicalAttestationJson,
  parseEvaluationRunnerAttestation,
} from './msaidizi-evaluator-attestation.protocol';
import { MsaidiziEvaluatorKeyRegistry } from './msaidizi-evaluator-key-registry.service';

describe('MsaidiziEvaluatorKeyRegistry', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('verifies a role-bound ES256 signature through a pinned external registry', () => {
    const fixture = registryFixture();
    const registry = configuredRegistry(fixture);
    registry.onModuleInit();
    const attestation = signedRunner(fixture.privateKeys.runner);

    expect(() => registry.verify(attestation, 'EVALUATION_RUNNER')).not.toThrow();
    expect(() => registry.verify(attestation, 'MODEL_REVIEWER')).toThrow(
      'EVALUATOR_KEY_ROLE_MISMATCH',
    );
  });

  it('rejects a changed allowlist before parsing it', () => {
    const fixture = registryFixture();
    writeFileSync(fixture.registryPath, `${readFileSync(fixture.registryPath, 'utf8')}\n`);

    expect(() => configuredRegistry(fixture).onModuleInit()).toThrow(
      'evaluator key allowlist is unavailable',
    );
  });

  it('rejects substituted public-key content even though the registry path is unchanged', () => {
    const fixture = registryFixture();
    const replacement = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
    writeFileSync(
      fixture.publicKeyPaths.runner,
      replacement.export({ type: 'spki', format: 'pem' }),
    );

    expect(() => configuredRegistry(fixture).onModuleInit()).toThrow(
      'evaluator key allowlist is unavailable',
    );
  });

  it('rejects reuse of an attestation signer as the evaluator mTLS client identity', () => {
    const fixture = registryFixture();
    const runnerSpki = createHash('sha256')
      .update(createPublicKey(fixture.privateKeys.runner).export({ type: 'spki', format: 'der' }))
      .digest('hex');

    expect(() =>
      configuredRegistry(fixture, {
        MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256: runnerSpki,
      }).onModuleInit(),
    ).toThrow('evaluator key allowlist is unavailable');
  });

  it('rejects unknown keys, invalid signature bytes, and future evidence', () => {
    const fixture = registryFixture();
    const registry = configuredRegistry(fixture);
    registry.onModuleInit();

    const unknown = signedRunner(fixture.privateKeys.runner, { signerKeyId: 'unknown-key' });
    expect(() => registry.verify(unknown, 'EVALUATION_RUNNER')).toThrow('EVALUATOR_KEY_UNKNOWN');

    const invalid = signedRunner(fixture.privateKeys.runner);
    invalid.signature = Buffer.alloc(64).toString('base64url');
    expect(() => registry.verify(invalid, 'EVALUATION_RUNNER')).toThrow(
      'EVALUATOR_SIGNATURE_INVALID',
    );

    const now = new Date();
    const future = signedRunner(fixture.privateKeys.runner, {
      issuedAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    });
    expect(() => registry.verify(future, 'EVALUATION_RUNNER', now)).toThrow(
      'EVALUATOR_ATTESTATION_TIME_INVALID',
    );
  });

  it('rejects a byte-equivalent non-canonical Base64URL signature alias', () => {
    const fixture = registryFixture();
    const registry = configuredRegistry(fixture);
    registry.onModuleInit();
    const attestation = signedRunner(fixture.privateKeys.runner);
    const canonicalBytes = Buffer.from(attestation.signature, 'base64url');
    const aliases: Record<string, string> = { A: 'B', Q: 'R', g: 'h', w: 'x' };
    const finalCharacter = attestation.signature.at(-1)!;
    attestation.signature = `${attestation.signature.slice(0, -1)}${aliases[finalCharacter]}`;

    expect(Buffer.from(attestation.signature, 'base64url')).toEqual(canonicalBytes);
    expect(() => registry.verify(attestation, 'EVALUATION_RUNNER')).toThrow(
      'EVALUATOR_SIGNATURE_INVALID',
    );
  });

  it('rejects caller substitution of parsed signer metadata', () => {
    const fixture = registryFixture();
    const registry = configuredRegistry(fixture);
    registry.onModuleInit();
    const signed = signedRunner(fixture.privateKeys.runner);
    const forged = {
      ...signed,
      claims: { ...signed.claims, signerKeyId: 'review-a' },
    };

    expect(() => registry.verify(forged, 'MODEL_REVIEWER')).toThrow(
      'EVALUATOR_ENVELOPE_BINDING_INVALID',
    );
  });

  function registryFixture() {
    const root = mkdtempSync(join(tmpdir(), 'msaidizi-evaluator-'));
    roots.push(root);
    const definitions = [
      ['artifact', 'ARTIFACT_VERIFIER'],
      ['runner', 'EVALUATION_RUNNER'],
      ['review-a', 'MODEL_REVIEWER'],
      ['review-b', 'MODEL_REVIEWER'],
    ] as const;
    const privateKeys: Record<(typeof definitions)[number][0], KeyObject> = {} as never;
    const publicKeyPaths: Record<(typeof definitions)[number][0], string> = {} as never;
    const keys = definitions.map(([keyId, role]) => {
      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      privateKeys[keyId] = pair.privateKey;
      const publicKeyPath = join(root, `${keyId}.pem`);
      publicKeyPaths[keyId] = publicKeyPath;
      writeFileSync(publicKeyPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), {
        mode: 0o600,
      });
      const publicKeySha256 = createHash('sha256')
        .update(pair.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex');
      return { keyId, role, publicKeyPath, publicKeySha256 };
    });
    const registryPath = join(root, 'allowlist.json');
    writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, keys }), { mode: 0o600 });
    chmodSync(registryPath, 0o600);
    const registrySha256 = createHash('sha256').update(readFileSync(registryPath)).digest('hex');
    return { root, registryPath, registrySha256, privateKeys, publicKeyPaths };
  }
});

function configuredRegistry(
  fixture: { registryPath: string; registrySha256: string },
  overrides: Record<string, string> = {},
) {
  return new MsaidiziEvaluatorKeyRegistry(
    new ConfigService({
      MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
      MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH: fixture.registryPath,
      MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: fixture.registrySha256,
      MSAIDIZI_EVALUATOR_MAX_CLOCK_SKEW_SECONDS: 60,
      MSAIDIZI_EVALUATOR_MAX_ATTESTATION_AGE_SECONDS: 86_400,
      ...overrides,
    }),
  );
}

function signedRunner(privateKey: KeyObject, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const claims = {
    schemaVersion: 1,
    type: 'UPDATE_EVALUATION_RUNNER',
    signerKeyId: 'runner',
    candidateId: '11111111-1111-4111-8111-111111111111',
    taskId: '22222222-2222-4222-8222-222222222222',
    planVersionId: '33333333-3333-4333-8333-333333333333',
    stepId: '44444444-4444-4444-8444-444444444444',
    sourceArtifactId: '55555555-5555-4555-8555-555555555555',
    sourceArtifactSha256: 'a'.repeat(64),
    rollbackArtifactId: '66666666-6666-4666-8666-666666666666',
    rollbackArtifactSha256: 'b'.repeat(64),
    rollbackVersion: '0.9.0',
    reportArtifactId: '77777777-7777-4777-8777-777777777777',
    reportArtifactSha256: 'c'.repeat(64),
    evaluationRunId: 'runner-001',
    cleanSnapshotId: 'windows-clean-001',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
    checks: {
      isolatedWindowsVm: true,
      tests: true,
      staticAnalysis: true,
      adversarialEvaluation: true,
      supervisorIntegrity: true,
      protectedBoundaryDiff: true,
    },
    verdict: 'PASS',
    failureCodes: [],
    issuedAt: new Date(now.getTime() - 1_000).toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    nonce: '88888888-8888-4888-8888-888888888888',
    ...overrides,
  };
  const claimsJson = canonicalAttestationJson(claims);
  const signature = sign('sha256', attestationSigningPayload(claimsJson), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return parseEvaluationRunnerAttestation({ claimsJson, signature });
}
