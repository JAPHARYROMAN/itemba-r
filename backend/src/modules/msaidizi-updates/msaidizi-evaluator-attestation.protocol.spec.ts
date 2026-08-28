import {
  attestationBundleDigest,
  canonicalAttestationJson,
  parseArtifactAttestation,
  parseEvaluationRunnerAttestation,
  parseModelReviewAttestation,
  sameEvaluationBinding,
} from './msaidizi-evaluator-attestation.protocol';

describe('Msaidizi evaluator attestation protocol', () => {
  it('accepts only canonical exact runner claims with every required check', () => {
    const parsed = parseEvaluationRunnerAttestation(envelope(runnerClaims()));

    expect(parsed.claims.verdict).toBe('PASS');
    expect(parsed.claims.rollbackVersion).toBe(rollbackVersion);
    expect(parsed.claimsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(parsed.claims.checks).sort()).toEqual([
      'adversarialEvaluation',
      'isolatedWindowsVm',
      'protectedBoundaryDiff',
      'staticAnalysis',
      'supervisorIntegrity',
      'tests',
    ]);
  });

  it('fails closed when a required check is omitted', () => {
    const claims = runnerClaims();
    const checks = { ...claims.checks };
    Reflect.deleteProperty(checks, 'protectedBoundaryDiff');

    expect(() => parseEvaluationRunnerAttestation(envelope({ ...claims, checks }))).toThrow(
      'RUNNER_CHECKS_INVALID',
    );
  });

  it('rejects verdicts inconsistent with signed check evidence', () => {
    expect(() =>
      parseEvaluationRunnerAttestation(
        envelope({ ...runnerClaims(), verdict: 'FAIL', failureCodes: ['TEST_FAILURE'] }),
      ),
    ).toThrow('RUNNER_VERDICT_INCONSISTENT');
  });

  it('rejects credential-like reviewer rationale instead of persisting a redaction', () => {
    expect(() =>
      parseModelReviewAttestation(
        envelope({
          ...reviewClaims(),
          rationale: 'Use api_key=sk-proj-abcdefghijklmnop1234 to reproduce',
        }),
      ),
    ).toThrow('ATTESTATION_DLP_REJECTED');
  });

  it('compares only the normalized immutable binding projection', () => {
    const runner = parseEvaluationRunnerAttestation(envelope(runnerClaims()));
    const review = parseModelReviewAttestation(
      envelope(reviewClaims({ runnerClaimsDigest: runner.claimsDigest })),
    );
    expect(sameEvaluationBinding(runner.claims, review.claims)).toBe(true);

    const changed = parseModelReviewAttestation(
      envelope(
        reviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
          reportArtifactSha256: 'e'.repeat(64),
        }),
      ),
    );
    expect(sameEvaluationBinding(runner.claims, changed.claims)).toBe(false);

    const changedRollbackVersion = parseModelReviewAttestation(
      envelope(
        reviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
          rollbackVersion: '0.8.0',
        }),
      ),
    );
    expect(sameEvaluationBinding(runner.claims, changedRollbackVersion.claims)).toBe(false);
  });

  it('rejects non-canonical and extension-bearing claims', () => {
    const claims = runnerClaims();
    expect(() =>
      parseEvaluationRunnerAttestation({
        claimsJson: JSON.stringify(claims),
        signature: 'A'.repeat(86),
      }),
    ).toThrow('ATTESTATION_NOT_CANONICAL');
    expect(() =>
      parseEvaluationRunnerAttestation(envelope({ ...claims, injectedAuthority: 'deploy' })),
    ).toThrow('RUNNER_CLAIMS_SCHEMA_INVALID');
  });

  it('rejects a non-canonical Base64URL alias of the same signature bytes', () => {
    const canonical = envelope(runnerClaims());
    const aliased = { ...canonical, signature: `${canonical.signature.slice(0, -1)}B` };

    expect(Buffer.from(aliased.signature, 'base64url')).toEqual(
      Buffer.from(canonical.signature, 'base64url'),
    );
    expect(() => parseEvaluationRunnerAttestation(aliased)).toThrow('ATTESTATION_ENVELOPE_INVALID');
  });

  it('binds trusted artifact purpose and candidate presence exactly', () => {
    const source = parseArtifactAttestation(envelope(artifactClaims()));
    const report = parseArtifactAttestation(
      envelope(
        artifactClaims({
          artifactId: reportArtifactId,
          artifactPurpose: 'REPORT',
          candidateId,
          name: 'evaluation-report.json',
          mimeType: 'application/json',
          sha256: reportSha256,
        }),
      ),
    );

    expect(source.claims.candidateId).toBeNull();
    expect(report.claims.candidateId).toBe(candidateId);
    expect(attestationBundleDigest('a'.repeat(64), ['c'.repeat(64), 'b'.repeat(64)])).toBe(
      attestationBundleDigest('a'.repeat(64), ['b'.repeat(64), 'c'.repeat(64)]),
    );
  });

  it('requires v2 runner, reviews, and artifacts to sign the exact generated request', () => {
    const runner = parseEvaluationRunnerAttestation(envelope(generatedRunnerClaims()));
    const review = parseModelReviewAttestation(
      envelope(
        generatedReviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
        }),
      ),
    );
    const artifact = parseArtifactAttestation(envelope(generatedArtifactClaims()));

    expect(runner.claims).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        ...generatedBinding(),
        checks: expect.objectContaining({
          baseRevisionMatch: true,
          ntfsReparseHardLinkAndToctouIsolation: true,
        }),
      }),
    );
    expect(review.claims).toEqual(expect.objectContaining(generatedBinding()));
    expect(artifact.claims).toEqual(expect.objectContaining(generatedBinding()));
    expect(sameEvaluationBinding(runner.claims, review.claims)).toBe(true);
  });

  it('rejects a v2 attestation that omits base-revision or NTFS isolation evidence', () => {
    const missingBinding = generatedRunnerClaims() as Record<string, unknown>;
    Reflect.deleteProperty(missingBinding, 'baseRevisionSha256');
    expect(() => parseEvaluationRunnerAttestation(envelope(missingBinding))).toThrow(
      'RUNNER_CLAIMS_SCHEMA_INVALID',
    );

    const missingCheck = generatedRunnerClaims();
    const checks = { ...missingCheck.checks } as Record<string, unknown>;
    Reflect.deleteProperty(checks, 'ntfsReparseHardLinkAndToctouIsolation');
    expect(() => parseEvaluationRunnerAttestation(envelope({ ...missingCheck, checks }))).toThrow(
      'RUNNER_CHECKS_INVALID',
    );

    const missingUsage = generatedRunnerClaims() as Record<string, unknown>;
    Reflect.deleteProperty(missingUsage, 'finalUsage');
    expect(() => parseEvaluationRunnerAttestation(envelope(missingUsage))).toThrow(
      'RUNNER_CLAIMS_SCHEMA_INVALID',
    );
  });

  it('detects a generated request or protected-policy substitution across reviewers', () => {
    const runner = parseEvaluationRunnerAttestation(envelope(generatedRunnerClaims()));
    const changed = parseModelReviewAttestation(
      envelope(
        generatedReviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
          requestDigest: 'f'.repeat(64),
        }),
      ),
    );
    expect(sameEvaluationBinding(runner.claims, changed.claims)).toBe(false);

    const changedUsage = parseModelReviewAttestation(
      envelope(
        generatedReviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
          finalUsage: { ...generatedTerminalAccounting().finalUsage, bytesRead: '4097' },
        }),
      ),
    );
    expect(sameEvaluationBinding(runner.claims, changedUsage.claims)).toBe(false);
  });
});

const candidateId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const planVersionId = '33333333-3333-4333-8333-333333333333';
const stepId = '44444444-4444-4444-8444-444444444444';
const sourceArtifactId = '55555555-5555-4555-8555-555555555555';
const rollbackArtifactId = '66666666-6666-4666-8666-666666666666';
const reportArtifactId = '77777777-7777-4777-8777-777777777777';
const sourceSha256 = 'a'.repeat(64);
const rollbackSha256 = 'b'.repeat(64);
const reportSha256 = 'c'.repeat(64);
const rollbackVersion = '0.9.0';

function binding() {
  return {
    candidateId,
    taskId,
    planVersionId,
    stepId,
    sourceArtifactId,
    sourceArtifactSha256: sourceSha256,
    rollbackArtifactId,
    rollbackArtifactSha256: rollbackSha256,
    rollbackVersion,
    reportArtifactId,
    reportArtifactSha256: reportSha256,
    evaluationRunId: 'runner-2026-08-25-001',
    cleanSnapshotId: 'windows-11-clean-2026-08-25',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
  };
}

function runnerClaims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: 'UPDATE_EVALUATION_RUNNER',
    signerKeyId: 'runner-key-2026-01',
    ...binding(),
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
    issuedAt: '2026-08-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: '88888888-8888-4888-8888-888888888888',
    ...overrides,
  };
}

function reviewClaims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: 'UPDATE_MODEL_REVIEW',
    signerKeyId: 'review-key-a-2026-01',
    ...binding(),
    runnerClaimsDigest: 'd'.repeat(64),
    reviewerId: 'independent-reviewer-a',
    modelId: 'review-model-a-v1',
    verdict: 'APPROVE',
    rationale: 'All signed checks and the protected boundary diff pass.',
    issuedAt: '2026-08-25T10:01:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: '99999999-9999-4999-8999-999999999999',
    ...overrides,
  };
}

function artifactClaims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: 'TRUSTED_UPDATE_ARTIFACT',
    signerKeyId: 'artifact-key-2026-01',
    artifactId: sourceArtifactId,
    artifactPurpose: 'SOURCE',
    taskId,
    planVersionId,
    stepId,
    candidateId: null,
    name: 'source.zip',
    mimeType: 'application/zip',
    byteSize: '4096',
    sha256: sourceSha256,
    dataClass: 'msaidizi.self-improvement.adapters',
    evaluationRunId: 'runner-2026-08-25-001',
    cleanSnapshotId: 'windows-11-clean-2026-08-25',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
    provenance: {
      producer: 'ISOLATED_WINDOWS_VERIFIER',
      source: 'CLEAN_SNAPSHOT_BUILD',
    },
    issuedAt: '2026-08-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ...overrides,
  };
}

function generatedBinding() {
  return {
    requestDigest: 'd'.repeat(64),
    generationArtifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    generationArtifactSha256: 'e'.repeat(64),
    generationManifestSha256: 'e'.repeat(64),
    protectedPolicyVersion: 'msaidizi-generated-update-policy/v1',
    protectedPolicySha256: 'f'.repeat(64),
    baseRevisionSha256: '1'.repeat(64),
  };
}

function generatedRunnerClaims(overrides: Record<string, unknown> = {}) {
  return {
    ...runnerClaims(),
    schemaVersion: 2,
    ...generatedBinding(),
    ...generatedTerminalAccounting(),
    checks: {
      ...runnerClaims().checks,
      baseRevisionMatch: true,
      ntfsReparseHardLinkAndToctouIsolation: true,
    },
    ...overrides,
  };
}

function generatedReviewClaims(overrides: Record<string, unknown> = {}) {
  return {
    ...reviewClaims(),
    schemaVersion: 2,
    ...generatedBinding(),
    ...generatedTerminalAccounting(),
    ...overrides,
  };
}

function generatedArtifactClaims(overrides: Record<string, unknown> = {}) {
  return {
    ...artifactClaims(),
    schemaVersion: 2,
    ...generatedBinding(),
    ...overrides,
  };
}

function generatedTerminalAccounting() {
  return {
    evaluationLeaseGeneration: 3,
    finalUsage: {
      cpuTimeSeconds: 120,
      bytesRead: '4096',
      bytesWritten: '8192',
      externalEgressBytes: '1024',
      modelTurns: 2,
      modelInputTokens: '2000',
      modelOutputTokens: '500',
      modelCostMicrousd: '125000',
    },
  };
}

function envelope(claims: unknown) {
  return { claimsJson: canonicalAttestationJson(claims), signature: 'A'.repeat(86) };
}
