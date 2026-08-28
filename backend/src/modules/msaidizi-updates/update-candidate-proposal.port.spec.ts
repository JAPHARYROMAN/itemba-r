import { createHash } from 'node:crypto';
import {
  assertUpdateCandidateProposalStep,
  containsPersistedSecretWithGeneratedUpdateAllowance,
  generatedUpdateManifest,
  generatedUpdateRequiredChecks,
  mandateAuthorizesUpdateCandidateProposal,
  parseUpdateCandidateProposalArguments,
  persistableUpdateProposalStepArguments,
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
  updateCandidateProposalDigest,
} from './update-candidate-proposal.port';

describe('generated update proposal policy', () => {
  it('preserves a realistic validated source payload and produces deterministic bigint-safe bindings', () => {
    const raw = generatedArguments();
    const step = generatedStep(raw);
    const parsed = assertUpdateCandidateProposalStep(step);

    expect(parsed.proposalKind).toBe('GENERATED_PIPELINE');
    expect(containsPersistedSecretWithGeneratedUpdateAllowance({ steps: [step] })).toBe(false);
    expect(persistableUpdateProposalStepArguments(step)).toEqual(raw);

    const first = updateCandidateProposalDigest('task', 'plan', 'step', parsed);
    const second = updateCandidateProposalDigest('task', 'plan', 'step', parsed);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(generatedUpdateManifest('task', 'plan', 'step', 'attempt', parsed as never)).toEqual(
      generatedUpdateManifest('task', 'plan', 'step', 'attempt', parsed as never),
    );
  });

  it('rejects decoded credentials before any persistence exemption can apply', () => {
    const raw = generatedArguments('const token = "sk-proj-abcdefghijklmnop123456";\n');
    const step = generatedStep(raw);

    expect(() => assertUpdateCandidateProposalStep(step)).toThrow('UPDATE_PROPOSAL_SECRET_REFUSED');
    expect(containsPersistedSecretWithGeneratedUpdateAllowance({ steps: [step] })).toBe(true);
    expect(() => persistableUpdateProposalStepArguments(step)).toThrow(
      'UPDATE_PROPOSAL_SECRET_REFUSED',
    );
  });

  it('does not mask a secret-bearing sibling or schema extension', () => {
    const step = generatedStep(generatedArguments()) as ReturnType<typeof generatedStep> & {
      apiToken?: string;
    };
    step.apiToken = 'sk-proj-abcdefghijklmnop123456';
    expect(containsPersistedSecretWithGeneratedUpdateAllowance({ steps: [step] })).toBe(true);

    const extended = { ...generatedArguments(), apiToken: 'sk-proj-abcdefghijklmnop123456' };
    expect(() => parseUpdateCandidateProposalArguments(extended)).toThrow('exact internal schema');
  });

  it.each([
    'windows-companion/src/Msaidizi.Companion.Service/Program.cs',
    'WINDOWS-COMPANION/Directory.Build.props',
    'windows-companion/src/Msaidizi.Companion.Contracts/Msaidizi.Companion.Contracts.csproj',
    'backend/src/modules/msaidizi-control-plane/unrelated-name.ts',
    'backend/src/modules/msaidizi-tasks/unrelated-name.ts',
    'backend/src/modules/msaidizi/provider-contract-attestation-helper.ts',
    'backend/src/common/policies/external-destination-authority.ts',
    'backend/NEST-CLI.JSON',
    'backend/tsconfig.build.json',
  ])('rejects protected supervisor or build-wiring path %s', (relativePath) => {
    expect(() =>
      parseUpdateCandidateProposalArguments(generatedArguments(undefined, relativePath)),
    ).toThrow('UPDATE_PROPOSAL_PROTECTED_SCOPE');
  });

  it.each([
    'windows-companion/src/Msaidizi.Companion.Service/Capabilities/ReceiptPrinterCapability.cs',
    'backend/src/modules/orders/provider-contract-attestation-report.ts',
  ])('allows a non-protected near miss %s', (relativePath) => {
    const scope = relativePath.startsWith('windows-companion') ? 'ADAPTERS' : 'APPLICATION';
    expect(() =>
      parseUpdateCandidateProposalArguments(generatedArguments(undefined, relativePath, scope)),
    ).not.toThrow();
  });

  it.each([
    'backend/src/modules/orders/CON.ts',
    'backend/src/modules/orders/NUL',
    'backend/src/modules/orders/file.ts.',
    'backend/src/modules/orders/folder /file.ts',
  ])('rejects an NTFS alias path %s', (relativePath) => {
    expect(() =>
      parseUpdateCandidateProposalArguments(generatedArguments(undefined, relativePath)),
    ).toThrow('UPDATE_PROPOSAL_PROTECTED_SCOPE');
  });

  it('rejects case-insensitive duplicate paths and requires canonical invariant ordering', () => {
    const raw = generatedArguments();
    raw.changes = [
      raw.changes[0],
      { ...raw.changes[0], relativePath: raw.changes[0].relativePath.toUpperCase() },
    ];
    expect(() => parseUpdateCandidateProposalArguments(raw)).toThrow(
      'UPDATE_PROPOSAL_CHANGESET_INVALID',
    );

    const ordered = generatedArguments();
    ordered.changes = [
      change('backend/src/modules/orders/zeta.ts'),
      change('backend/src/modules/orders/alpha.ts'),
    ];
    expect(() => parseUpdateCandidateProposalArguments(ordered)).toThrow(
      'UPDATE_PROPOSAL_CHANGESET_NOT_CANONICAL',
    );
  });

  it('requires the exact v2 mandate and signs base-revision plus NTFS isolation checks', () => {
    const step = generatedStep(generatedArguments());
    expect(
      mandateAuthorizesUpdateCandidateProposal(
        [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
            effects: ['WRITE'],
            dataClasses: [step.dataClass],
          },
        ],
        step,
      ),
    ).toBe(true);
    expect(
      mandateAuthorizesUpdateCandidateProposal(
        [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            effects: ['WRITE'],
            dataClasses: [step.dataClass],
          },
        ],
        step,
      ),
    ).toBe(false);
    expect(generatedUpdateRequiredChecks()).toEqual(
      expect.objectContaining({
        baseRevisionMatch: true,
        ntfsReparseHardLinkAndToctouIsolation: true,
        dualIndependentModelReview: true,
      }),
    );
  });
});

function generatedArguments(
  source = [
    'export function calculateInvoiceTotal(lines: readonly number[]): number {',
    '  return lines.reduce((total, value) => total + value, 0);',
    '}',
    '',
  ].join('\n'),
  relativePath = 'backend/src/modules/orders/invoice-total.ts',
  scope = 'APPLICATION',
) {
  return {
    name: 'Bounded invoice calculation improvement',
    version: '1.2.3',
    scope,
    rollbackVersion: '1.2.2',
    rationale: 'Improve a bounded application calculation and verify it in an isolated VM.',
    baseRevisionSha256: 'a'.repeat(64),
    changes: [change(relativePath, source)],
    evaluationBudget: {
      maxWallTimeSeconds: 900,
      maxCpuTimeSeconds: 1_800,
      maxBytesRead: '104857600',
      maxBytesWritten: '104857600',
      maxExternalEgressBytes: '1048576',
      maxModelTurns: 4,
      maxModelInputTokens: '50000',
      maxModelOutputTokens: '10000',
      maxModelCostMicrousd: '5000000',
    },
  };
}

function change(relativePath: string, source = 'export const value = 1;\n') {
  const content = Buffer.from(source, 'utf8');
  return {
    relativePath,
    operation: 'ADD',
    expectedPreSha256: null,
    contentBase64: content.toString('base64'),
    contentSha256: createHash('sha256').update(content).digest('hex'),
  };
}

function generatedStep(argumentsValue: ReturnType<typeof generatedArguments>) {
  return {
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    arguments: argumentsValue,
    expectedEffect: 'WRITE',
    dataClass: proposalDataClass(argumentsValue.scope as never),
    idempotent: true,
    mutation: true,
  };
}
