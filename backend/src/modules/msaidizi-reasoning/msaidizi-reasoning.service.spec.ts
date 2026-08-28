import { ConflictException } from '@nestjs/common';
import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskMode } from '@prisma/client';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { MsaidiziCritic } from './msaidizi-critic.service';
import { MsaidiziOutcomeEvaluator } from './msaidizi-outcome-evaluator.service';
import { MsaidiziPlanner } from './msaidizi-planner.service';
import { MsaidiziPolicyEvaluator } from './msaidizi-policy-evaluator.service';
import { MsaidiziReasoningContextService } from './msaidizi-reasoning-context.service';
import { MsaidiziReasoningService } from './msaidizi-reasoning.service';
import { ProposedPlanDraft, ReasoningContext } from './msaidizi-reasoning.types';
import { MsaidiziDraftProposalAuthority, proposalInFlightMarker } from './msaidizi-proposal-lease';

const DRAFT_AUTHORITY: MsaidiziDraftProposalAuthority = {
  taskId: 'task-1',
  principalId: 'principal-1',
  initiatedByUserId: 'user-1',
  companyId: 'company-1',
  mandateId: null,
  mode: MsaidiziTaskMode.COLLABORATIVE,
  stateVersion: 0,
};

const DRAFT_LEASE = {
  authority: DRAFT_AUTHORITY,
  receiptId: '11111111-1111-4111-8111-111111111111',
  marker: proposalInFlightMarker('11111111-1111-4111-8111-111111111111'),
  leasedStateVersion: 1,
};

describe('MsaidiziReasoningService proposal boundary', () => {
  it('returns a non-persisted, non-queued proposal with explicit save and queue actions', async () => {
    const context = reasoningContext();
    context.draftTaskId = 'task-1';
    context.draftAuthority = DRAFT_AUTHORITY;
    context.artifacts = [
      {
        id: 'artifact-1',
        sourceTaskId: 'task-1',
        kind: 'SCREENSHOT',
        name: 'screen.png',
        mimeType: 'image/png',
        byteSize: 16,
        sha256: 'a'.repeat(64),
        dataClass: 'confidential',
        trustLevel: 'UNTRUSTED',
        storedTrustLevel: 'UNTRUSTED',
        provenance: { sourceType: 'SCREEN' },
        content: Buffer.from('ephemeral-secret'),
      },
    ];
    const draft = proposedDraft();
    const planner = jest.fn().mockResolvedValue({
      authorityDraft: draft,
      candidate: draft,
      modelTurns: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      untrustedEnrichmentUsed: false,
    });
    const reserve = jest.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      reservationExpiresAt: new Date(Date.now() + 300_000),
      draftLease: DRAFT_LEASE,
    });
    const settleSuccess = jest.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      modelTurns: 1,
      inputTokens: 100n,
      outputTokens: 50n,
      estimatedCostUsd: '0.010500',
    });
    const service = new MsaidiziReasoningService(
      { enabled: true, model: 'configured-anthropic-model' } as MsaidiziConfig,
      { enabled: true } as AutonomyConfig,
      {
        resolve: jest.fn().mockResolvedValue(context),
      } as unknown as MsaidiziReasoningContextService,
      {
        propose: planner,
      } as unknown as MsaidiziPlanner,
      {
        preflight: jest.fn().mockReturnValue({ allowed: true, violations: [], checks: [] }),
        evaluate: jest.fn().mockReturnValue({ allowed: true, violations: [], checks: [] }),
      } as unknown as MsaidiziPolicyEvaluator,
      {
        review: jest.fn().mockReturnValue({ acceptable: true, issues: [] }),
      } as unknown as MsaidiziCritic,
      {
        evaluateProposal: jest.fn().mockReturnValue({
          proposedOnly: true,
          stepCount: 1,
          readCount: 1,
          mutationCount: 0,
          externalActionCount: 0,
          irreversibleActionCount: 0,
          recoveryCoverage: 1,
          highestRisk: 'READ',
          stopConditionsDeclared: true,
        }),
      } as unknown as MsaidiziOutcomeEvaluator,
      {
        reserve,
        settleSuccess,
        settleFailure: jest.fn(),
      } as never,
    );

    const result = await service.propose(
      {
        taskId: 'task-1',
        objective: 'Review expenses',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        inputs: {},
        stopConditions: {},
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
        permissions: ['expenses.read'],
        companyId: 'company-1',
      },
    );

    expect(result).toMatchObject({
      status: 'PROPOSED',
      draftTaskId: 'task-1',
      persisted: false,
      queued: false,
      executed: false,
      requiredExplicitActions: {
        selectedMode: MsaidiziTaskMode.COLLABORATIVE,
        save: { method: 'POST', path: '/msaidizi/tasks/plan' },
        queue: { method: 'POST', path: '/msaidizi/tasks' },
      },
      reasoningUsage: {
        model: 'configured-anthropic-model',
        modelTurns: 1,
        estimatedCostUsd: '0.010500',
        providerReportedCostUsd: null,
      },
      proposalUsageReceipt: {
        id: '11111111-1111-4111-8111-111111111111',
        modelTurns: 1,
        inputTokens: '100',
        outputTokens: '50',
        estimatedCostUsd: '0.010500',
        oneUse: true,
      },
    });
    expect(result.proposalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.plan.taskId).toBe('task-1');
    expect(result.plan.inputs).toEqual(
      expect.objectContaining({
        _msaidiziArtifactProvenance: [
          expect.objectContaining({
            artifactId: 'artifact-1',
            sourceTaskId: 'task-1',
            trustLevel: 'UNTRUSTED',
          }),
        ],
      }),
    );
    expect(result.provenance.artifacts).toEqual([
      expect.objectContaining({ id: 'artifact-1', sourceTaskId: 'task-1' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('ephemeral-secret');
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(planner.mock.invocationCallOrder[0]);
    expect(settleSuccess).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      result.proposalDigest,
      expect.objectContaining({ modelTurns: 1 }),
      DRAFT_LEASE,
    );
    expect(context.artifacts![0].content.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes decrypted artifact bytes when proposal preflight rejects before reservation', async () => {
    const content = Buffer.from('preflight-ephemeral-secret');
    const context = contextWithArtifact(content);
    const { service, reserve, planner } = lifecycleService(context, {
      preflightAllowed: false,
    });

    await expect(
      service.propose(
        {
          taskId: 'task-1',
          objective: context.objective,
          mode: context.mode,
          inputs: {},
          stopConditions: {},
        },
        reasoningUser(),
      ),
    ).rejects.toThrow('Unprocessable Entity');

    expect(reserve).not.toHaveBeenCalled();
    expect(planner).not.toHaveBeenCalled();
    expect(content.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes decrypted artifact bytes when the authority model fails after reservation', async () => {
    const content = Buffer.from('provider-ephemeral-secret');
    const context = contextWithArtifact(content);
    const { service, reserve, planner, settleFailure } = lifecycleService(context, {
      providerError: new Error('provider unavailable'),
    });

    await expect(
      service.propose(
        {
          taskId: 'task-1',
          objective: context.objective,
          mode: context.mode,
          inputs: {},
          stopConditions: {},
        },
        reasoningUser(),
      ),
    ).rejects.toThrow('configured reasoning provider did not complete');

    expect(reserve).toHaveBeenCalledTimes(1);
    expect(planner).toHaveBeenCalledTimes(1);
    expect(settleFailure).toHaveBeenCalledTimes(1);
    expect(content.every((byte) => byte === 0)).toBe(true);
  });

  it('never reserves proposal usage or calls a provider after a concurrent draft promotion', async () => {
    const { service, reserve, planner } = lifecycleService(reasoningContext(), {
      contextError: new ConflictException('Task budget changed; retry artifact reasoning'),
    });

    await expect(
      service.propose(
        {
          taskId: 'task-1',
          objective: 'Review expenses',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
        },
        reasoningUser(),
      ),
    ).rejects.toThrow('Task budget changed; retry artifact reasoning');

    expect(reserve).not.toHaveBeenCalled();
    expect(planner).not.toHaveBeenCalled();
  });

  it('zeroes artifact buffers and never calls a provider when the draft lease CAS loses', async () => {
    const content = Buffer.from('lease-loss-ephemeral-secret');
    const context = contextWithArtifact(content);
    const { service, reserve, planner, settleFailure } = lifecycleService(context, {});
    reserve.mockRejectedValueOnce(
      new ConflictException({
        code: 'MSAIDIZI_PROPOSAL_LEASE_UNAVAILABLE',
        message: 'The task draft changed before proposal reasoning could be reserved',
      }),
    );

    await expect(
      service.propose(
        {
          taskId: 'task-1',
          objective: context.objective,
          mode: context.mode,
          inputs: {},
          stopConditions: {},
        },
        reasoningUser(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(planner).not.toHaveBeenCalled();
    expect(settleFailure).not.toHaveBeenCalled();
    expect(content.every((byte) => byte === 0)).toBe(true);
  });

  it('allows only one provider call when two proposals race for one draft', async () => {
    const context = reasoningContext();
    context.draftTaskId = DRAFT_AUTHORITY.taskId;
    context.draftAuthority = DRAFT_AUTHORITY;
    const { service, reserve, planner } = lifecycleService(context, {
      providerError: new Error('stop after proving dispatch count'),
    });
    reserve
      .mockResolvedValueOnce({
        id: DRAFT_LEASE.receiptId,
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        reservationExpiresAt: new Date(Date.now() + 300_000),
        draftLease: DRAFT_LEASE,
      })
      .mockRejectedValueOnce(
        new ConflictException({
          code: 'MSAIDIZI_PROPOSAL_LEASE_UNAVAILABLE',
          message: 'The task draft changed before proposal reasoning could be reserved',
        }),
      );
    const request = {
      taskId: DRAFT_AUTHORITY.taskId,
      objective: context.objective,
      mode: context.mode,
      inputs: {},
      stopConditions: {},
    };

    const outcomes = await Promise.allSettled([
      service.propose(request, reasoningUser()),
      service.propose(request, reasoningUser()),
    ]);

    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(planner).toHaveBeenCalledTimes(1);
  });
});

function contextWithArtifact(content: Buffer): ReasoningContext {
  const context = reasoningContext();
  context.draftTaskId = 'task-1';
  context.draftAuthority = DRAFT_AUTHORITY;
  context.artifacts = [
    {
      id: 'artifact-1',
      sourceTaskId: 'task-1',
      kind: 'FILE',
      name: 'context.txt',
      mimeType: 'text/plain',
      byteSize: content.length,
      sha256: 'a'.repeat(64),
      dataClass: 'confidential',
      trustLevel: 'UNTRUSTED',
      storedTrustLevel: 'UNTRUSTED',
      provenance: { sourceType: 'USER_UPLOAD' },
      content,
    },
  ];
  return context;
}

function lifecycleService(
  context: ReasoningContext,
  options: { preflightAllowed?: boolean; providerError?: Error; contextError?: Error },
) {
  const reserve = jest.fn().mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    reservationExpiresAt: new Date(Date.now() + 300_000),
    ...(context.draftAuthority && { draftLease: DRAFT_LEASE }),
  });
  const settleFailure = jest.fn().mockResolvedValue(undefined);
  const planner = options.providerError
    ? jest.fn().mockRejectedValue(options.providerError)
    : jest.fn().mockResolvedValue({});
  const service = new MsaidiziReasoningService(
    { enabled: true, model: 'configured-anthropic-model' } as MsaidiziConfig,
    { enabled: true } as AutonomyConfig,
    {
      resolve: options.contextError
        ? jest.fn().mockRejectedValue(options.contextError)
        : jest.fn().mockResolvedValue(context),
    } as unknown as MsaidiziReasoningContextService,
    { propose: planner } as unknown as MsaidiziPlanner,
    {
      preflight: jest.fn().mockReturnValue({
        allowed: options.preflightAllowed !== false,
        violations: options.preflightAllowed === false ? [{ code: 'DENIED' }] : [],
        checks: [],
      }),
    } as unknown as MsaidiziPolicyEvaluator,
    {} as MsaidiziCritic,
    {} as MsaidiziOutcomeEvaluator,
    {
      reserve,
      settleFailure,
      settleSuccess: jest.fn(),
    } as never,
  );
  return { service, reserve, planner, settleFailure };
}

function reasoningUser() {
  return {
    id: 'user-1',
    email: 'user@example.com',
    roles: [],
    permissions: ['expenses.read'],
    companyId: 'company-1',
  };
}

function reasoningContext(): ReasoningContext {
  return {
    objective: 'Review expenses',
    mode: MsaidiziTaskMode.COLLABORATIVE,
    companyId: 'company-1',
    inputs: {},
    stopConditions: {},
    budgets: {
      maxWallTimeSeconds: 60,
      maxModelTurns: 10,
      maxAttemptedToolCalls: 10,
      maxMutations: 2,
      maxLocalBytes: 1_000,
      maxExternalEgressBytes: 1_000,
      maxModelCostUsd: 1,
    },
    budgetViolations: [],
    mandate: null,
    capabilities: [],
    memories: [],
    callerPermissions: ['expenses.read'],
    principalPermissions: ['expenses.read'],
    redactionsApplied: false,
  };
}

function proposedDraft(): ProposedPlanDraft {
  return {
    title: 'Review expenses',
    summary: 'Read expenses.',
    steps: [
      {
        key: 'read-expenses',
        name: 'Read expenses',
        target: MsaidiziExecutionTarget.ERP,
        capability: 'ExpensesController.findAll',
        capabilityVersion: '1',
        arguments: { path: {}, query: {} },
        dependsOn: [],
        inputBindings: [],
        expectedEffect: MsaidiziEffect.READ,
        dataClass: 'internal',
        preconditions: {},
        recovery: null,
        budgets: {},
        stopConditions: { after: 1 },
        idempotent: true,
        mutation: false,
      },
    ],
  };
}
