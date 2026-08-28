import { ConflictException } from '@nestjs/common';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { AutonomyConfig } from './autonomy.config';
import { MsaidiziTasksService } from './msaidizi-tasks.service';
import { msaidiziProposalDigest } from './msaidizi-proposal-digest';
import { proposalInFlightMarker } from '../msaidizi-reasoning/msaidizi-proposal-lease';

const USER: AuthUser = {
  id: 'user-1',
  email: 'owner@example.test',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['msaidizi.use'],
  companyId: 'company-1',
  companyAccess: [],
};

const BUDGETS = {
  maxWallTimeSeconds: 7_200,
  maxModelTurns: 200,
  maxAttemptedToolCalls: 500,
  maxMutations: 100,
  maxLocalBytes: 5_368_709_120,
  maxExternalEgressBytes: 262_144_000,
  maxModelCostUsd: 20,
};

const STEP = {
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
  budgets: {},
  stopConditions: {},
  idempotent: true,
  mutation: false,
};

const ARTIFACT = {
  id: '11111111-1111-4111-8111-111111111111',
  stepId: null,
  kind: 'SCREENSHOT',
  name: 'screen.png',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  byteSize: 512n,
  encrypted: true,
  dataClass: 'internal',
  trustLevel: 'UNTRUSTED',
  provenance: { sourceType: 'SCREENSHOT', instructionAuthority: 'NONE' },
  createdAt: new Date('2026-08-28T08:00:00.000Z'),
};

describe('Msaidizi caller-owned planning drafts', () => {
  it('persists a non-executable draft before text, voice, or visual context is planned', async () => {
    const createTask = jest.fn();
    const event = jest.fn();
    const draft = taskDetail();
    const tx = {
      msaidiziTask: { create: createTask, findFirst: jest.fn().mockResolvedValue(draft) },
      msaidiziTaskEvent: { create: event },
    };
    const prisma = {
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };

    const result = (await service(prisma).createDraft(
      {
        objective: 'Review the captured expense screen',
        mode: MsaidiziTaskMode.COLLABORATIVE,
      },
      USER,
    )) as { id: string; status: string; activePlanVersion: number };

    expect(result).toMatchObject({
      id: draft.id,
      status: MsaidiziTaskStatus.PLANNING,
      activePlanVersion: 0,
    });
    expect(createTask).toHaveBeenCalledWith({
      data: expect.objectContaining({
        initiatedByUserId: USER.id,
        companyId: USER.companyId,
        mode: MsaidiziTaskMode.COLLABORATIVE,
        status: MsaidiziTaskStatus.PLANNING,
        activePlanVersion: 0,
      }),
    });
    expect(event).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: expect.any(String),
        type: 'task.created',
        payload: expect.objectContaining({ draft: true, activePlanVersion: 0 }),
      }),
    });
  });

  it('atomically promotes that exact draft and forces attachment provenance back to UNTRUSTED', async () => {
    const draft = taskDetail({ artifacts: [ARTIFACT] });
    const promoted = taskDetail({
      status: MsaidiziTaskStatus.READY,
      activePlanVersion: 1,
      stateVersion: 1,
      artifacts: [ARTIFACT],
    });
    const updateTask = jest.fn().mockResolvedValue({ count: 1 });
    const createPlan = jest.fn();
    const createSteps = jest.fn();
    const createTask = jest.fn();
    const tx = {
      msaidiziTask: {
        updateMany: updateTask,
        create: createTask,
        findFirst: jest.fn().mockResolvedValue(promoted),
      },
      msaidiziPlanVersion: { create: createPlan },
      msaidiziTaskStep: { createMany: createSteps },
      msaidiziTaskEvent: { create: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(draft) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: draft.principalId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const inputs = {
      _msaidiziArtifactProvenance: [
        {
          artifactId: ARTIFACT.id,
          sourceTaskId: draft.id,
          sha256: ARTIFACT.sha256,
          mimeType: ARTIFACT.mimeType,
          dataClass: ARTIFACT.dataClass,
          // A caller cannot upgrade the stored artifact by editing proposal JSON.
          trustLevel: 'TRUSTED',
          provenance: {},
        },
      ],
    };
    const normalizedInputs = {
      _msaidiziArtifactProvenance: [
        {
          artifactId: ARTIFACT.id,
          sourceTaskId: draft.id,
          sha256: ARTIFACT.sha256,
          mimeType: ARTIFACT.mimeType,
          dataClass: ARTIFACT.dataClass,
          trustLevel: 'UNTRUSTED',
          provenance: ARTIFACT.provenance,
        },
      ],
    };
    const proposalDigest = msaidiziProposalDigest({
      taskId: draft.id,
      title: 'Review captured expenses',
      objective: draft.objective,
      summary: 'Read only the reviewed expense data',
      mode: draft.mode,
      companyId: draft.companyId!,
      inputs: normalizedInputs,
      stopConditions: {},
      budgets: BUDGETS,
      steps: [STEP],
    });
    const receipt = {
      id: '22222222-2222-4222-8222-222222222222',
      expiresAt: new Date('2026-08-29T08:00:00.000Z'),
      proposalDigest,
      modelTurns: 2,
      inputTokens: 1_000n,
      outputTokens: 200n,
      estimatedCostUsd: '0.010000',
    };
    const usage = {
      inspectConsumable: jest.fn().mockResolvedValue(receipt),
      consume: jest.fn(),
    };

    const request = {
      taskId: draft.id,
      title: 'Review captured expenses',
      objective: draft.objective,
      summary: 'Read only the reviewed expense data',
      mode: draft.mode,
      companyId: draft.companyId!,
      proposalUsageId: receipt.id,
      proposalDigest,
      inputs,
      stopConditions: {},
      budgets: BUDGETS,
      steps: [STEP],
    };
    const result = (await service(prisma, usage).plan(request, USER)) as {
      id: string;
      status: string;
    };

    expect(result).toMatchObject({ id: draft.id, status: MsaidiziTaskStatus.READY });
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: draft.id,
        principalId: draft.principalId,
        initiatedByUserId: USER.id,
        companyId: draft.companyId,
        mode: draft.mode,
        status: MsaidiziTaskStatus.PLANNING,
        activePlanVersion: 0,
        stateVersion: 0,
        statusDetail: null,
        mutations: 0,
        planVersions: { none: {} },
        toolAttempts: { none: {} },
        deviceLeases: { none: {} },
        hostActions: { none: {} },
      }),
      data: expect.objectContaining({
        status: MsaidiziTaskStatus.READY,
        activePlanVersion: 1,
        proposalUsageId: receipt.id,
      }),
    });
    expect(createPlan.mock.calls[0][0].data).toMatchObject({
      taskId: draft.id,
      version: 1,
      inputs: normalizedInputs,
      sourceProposalDigest: proposalDigest,
    });
    expect(usage.consume).toHaveBeenCalledWith(tx, receipt.id, proposalDigest);

    // A concurrent/replayed promoter may inspect the same settled receipt, but
    // only one transaction can win the exact unused-draft CAS. In PostgreSQL,
    // the losing transaction also rolls back the receipt consumption update.
    updateTask.mockResolvedValueOnce({ count: 0 });
    await expect(service(prisma, usage).plan(request, USER)).rejects.toThrow(
      'Task draft changed while its reviewed plan was attached',
    );
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(createSteps).toHaveBeenCalledTimes(1);
  });

  it('blocks both visible-marker promotion and cancellation while reasoning is in flight', async () => {
    const receiptId = '22222222-2222-4222-8222-222222222222';
    const marked = taskDetail({
      stateVersion: 1,
      statusDetail: proposalInFlightMarker(receiptId),
    });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(marked) },
      $transaction: jest.fn(),
    };
    const usage = {
      inspectConsumable: jest.fn(),
      consume: jest.fn(),
      recoverExpiredDraftLeaseForTask: jest.fn().mockResolvedValue('LIVE'),
    };
    const tasks = service(prisma, usage);

    await expect(
      tasks.plan(
        {
          taskId: marked.id,
          title: 'Review expenses',
          objective: marked.objective,
          mode: marked.mode,
          companyId: marked.companyId!,
          inputs: {},
          stopConditions: {},
          budgets: BUDGETS,
          steps: [STEP],
        },
        USER,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_PROPOSAL_IN_FLIGHT' }),
    });
    await expect(tasks.cancel(marked.id, USER)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_PROPOSAL_IN_FLIGHT' }),
    });
    expect(usage.recoverExpiredDraftLeaseForTask).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recovers an expired marker before directly promoting the same draft', async () => {
    const receiptId = '22222222-2222-4222-8222-222222222222';
    const marked = taskDetail({
      stateVersion: 1,
      statusDetail: proposalInFlightMarker(receiptId),
    });
    const recovered = taskDetail({ stateVersion: 2, statusDetail: null });
    const promoted = taskDetail({
      stateVersion: 3,
      status: MsaidiziTaskStatus.READY,
      activePlanVersion: 1,
    });
    const updateTask = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany: updateTask, findFirst: jest.fn().mockResolvedValue(promoted) },
      msaidiziPlanVersion: { create: jest.fn() },
      msaidiziTaskStep: { createMany: jest.fn() },
      msaidiziTaskEvent: { create: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    const prisma = {
      msaidiziTask: {
        findFirst: jest.fn().mockResolvedValueOnce(marked).mockResolvedValueOnce(recovered),
      },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: recovered.principalId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const usage = {
      inspectConsumable: jest.fn(),
      consume: jest.fn(),
      recoverExpiredDraftLeaseForTask: jest.fn().mockResolvedValue('RECOVERED'),
    };

    await expect(
      service(prisma, usage).plan(
        {
          taskId: marked.id,
          title: 'Review expenses',
          objective: marked.objective,
          mode: marked.mode,
          companyId: marked.companyId!,
          inputs: {},
          stopConditions: {},
          budgets: BUDGETS,
          steps: [STEP],
        },
        USER,
      ),
    ).resolves.toMatchObject({ id: marked.id, status: MsaidiziTaskStatus.READY });
    expect(usage.recoverExpiredDraftLeaseForTask).toHaveBeenCalledWith({
      authority: expect.objectContaining({
        taskId: marked.id,
        principalId: marked.principalId,
        initiatedByUserId: USER.id,
        stateVersion: 0,
      }),
      marker: proposalInFlightMarker(receiptId),
    });
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stateVersion: 2, statusDetail: null }),
      }),
    );
  });

  it('recovers an expired marker before directly cancelling the same draft', async () => {
    const receiptId = '22222222-2222-4222-8222-222222222222';
    const marked = taskDetail({
      stateVersion: 1,
      statusDetail: proposalInFlightMarker(receiptId),
    });
    const recovered = taskDetail({ stateVersion: 2, statusDetail: null });
    const cancelled = taskDetail({
      stateVersion: 3,
      status: MsaidiziTaskStatus.CANCELLED,
      statusDetail: null,
    });
    const updateTask = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany: updateTask, findFirst: jest.fn().mockResolvedValue(cancelled) },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: {
        findFirst: jest.fn().mockResolvedValueOnce(marked).mockResolvedValueOnce(recovered),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const usage = {
      inspectConsumable: jest.fn(),
      consume: jest.fn(),
      recoverExpiredDraftLeaseForTask: jest.fn().mockResolvedValue('RECOVERED'),
    };

    await expect(service(prisma, usage).cancel(marked.id, USER)).resolves.toMatchObject({
      id: marked.id,
      status: MsaidiziTaskStatus.CANCELLED,
    });
    expect(updateTask).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: marked.id,
        status: MsaidiziTaskStatus.PLANNING,
        stateVersion: 2,
      }),
      data: expect.objectContaining({
        status: MsaidiziTaskStatus.CANCELLED,
        stateVersion: { increment: 1 },
      }),
    });
  });

  it('keeps an unreconciled marker fail-closed during direct state changes', async () => {
    const marked = taskDetail({ stateVersion: 1, statusDetail: 'malformed-marker' });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(marked) },
      $transaction: jest.fn(),
    };
    const usage = {
      inspectConsumable: jest.fn(),
      consume: jest.fn(),
      recoverExpiredDraftLeaseForTask: jest.fn().mockResolvedValue('BLOCKED'),
    };

    await expect(service(prisma, usage).cancel(marked.id, USER)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_PROPOSAL_LEASE_RECOVERY_BLOCKED' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('loses cancellation CAS when a proposal lease increments the draft after its read', async () => {
    const stale = taskDetail({ stateVersion: 0, statusDetail: null });
    const updateTask = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      msaidiziTask: { updateMany: updateTask },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(stale) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };

    await expect(service(prisma).cancel(stale.id, USER)).rejects.toThrow(
      'Task state changed; refresh and retry',
    );
    expect(updateTask).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: stale.id,
        status: MsaidiziTaskStatus.PLANNING,
        stateVersion: 0,
      }),
      data: expect.objectContaining({
        status: MsaidiziTaskStatus.CANCELLED,
        stateVersion: { increment: 1 },
      }),
    });
    expect(tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
  });

  it('does not let a safe one-use receipt fund a changed reviewed plan', async () => {
    const draft = taskDetail();
    const safePlan = {
      taskId: draft.id,
      title: 'Review expenses',
      objective: draft.objective,
      summary: 'Read expenses',
      mode: draft.mode,
      companyId: draft.companyId!,
      inputs: {},
      stopConditions: {},
      budgets: BUDGETS,
      steps: [STEP],
    };
    const proposalDigest = msaidiziProposalDigest(safePlan);
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(draft) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: draft.principalId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn(),
    };
    const usage = {
      inspectConsumable: jest.fn().mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        expiresAt: new Date('2026-08-29T08:00:00.000Z'),
        proposalDigest,
        modelTurns: 1,
        inputTokens: 10n,
        outputTokens: 10n,
        estimatedCostUsd: '0.001000',
      }),
      consume: jest.fn(),
    };

    await expect(
      service(prisma, usage).plan(
        {
          ...safePlan,
          title: 'Changed after receipt settlement',
          proposalUsageId: '22222222-2222-4222-8222-222222222222',
          proposalDigest,
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(usage.consume).not.toHaveBeenCalled();
  });

  it('does not let a receipt settled for one draft fund an identical second draft', async () => {
    const fundedTaskId = '33333333-3333-4333-8333-333333333333';
    const otherDraft = taskDetail({ id: '44444444-4444-4444-8444-444444444444' });
    const fundedPlan = {
      taskId: fundedTaskId,
      title: 'Review expenses',
      objective: otherDraft.objective,
      summary: 'Read expenses',
      mode: otherDraft.mode,
      companyId: otherDraft.companyId!,
      inputs: {},
      stopConditions: {},
      budgets: BUDGETS,
      steps: [STEP],
    };
    const proposalDigest = msaidiziProposalDigest(fundedPlan);
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(otherDraft) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: otherDraft.principalId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn(),
    };
    const usage = {
      inspectConsumable: jest.fn().mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        expiresAt: new Date('2026-08-29T08:00:00.000Z'),
        proposalDigest,
        modelTurns: 1,
        inputTokens: 10n,
        outputTokens: 10n,
        estimatedCostUsd: '0.001000',
      }),
      consume: jest.fn(),
    };

    await expect(
      service(prisma, usage).plan(
        {
          ...fundedPlan,
          taskId: otherDraft.id,
          proposalUsageId: '22222222-2222-4222-8222-222222222222',
          proposalDigest,
        },
        USER,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_PROPOSAL_PLAN_MISMATCH' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(usage.consume).not.toHaveBeenCalled();
  });

  it('excludes only non-authority transport fields from the proposal digest', () => {
    const authorityPlan = {
      taskId: '33333333-3333-4333-8333-333333333333',
      title: 'Review expenses',
      objective: 'Review the captured expense screen',
      summary: 'Read expenses',
      mode: MsaidiziTaskMode.COLLABORATIVE,
      companyId: USER.companyId!,
      inputs: {},
      stopConditions: {},
      budgets: BUDGETS,
      steps: [STEP],
    };
    const funded = msaidiziProposalDigest(authorityPlan);

    expect(
      msaidiziProposalDigest({
        ...authorityPlan,
        proposalUsageId: '22222222-2222-4222-8222-222222222222',
        proposalDigest: funded,
        idempotencyKey: 'transport-only-retry-key',
      }),
    ).toBe(funded);
    expect(
      msaidiziProposalDigest({
        ...authorityPlan,
        taskId: '44444444-4444-4444-8444-444444444444',
      }),
    ).not.toBe(funded);
    expect(msaidiziProposalDigest({ ...authorityPlan, title: 'Changed authority' })).not.toBe(
      funded,
    );
  });

  it('revalidates same-task artifact provenance and keeps it UNTRUSTED on replan', async () => {
    const current = taskDetail({
      status: MsaidiziTaskStatus.READY,
      activePlanVersion: 1,
      artifacts: [ARTIFACT],
    });
    const createdPlan = jest.fn();
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ ...current, activePlanVersion: 2 }),
      },
      msaidiziPlanVersion: { create: createdPlan },
      msaidiziTaskStep: { createMany: jest.fn() },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };

    await service(prisma).replan(
      current.id,
      {
        objective: current.objective,
        summary: 'Replan with the same untrusted screenshot',
        inputs: {
          _msaidiziArtifactProvenance: [
            {
              artifactId: ARTIFACT.id,
              sourceTaskId: current.id,
              sha256: ARTIFACT.sha256,
              mimeType: ARTIFACT.mimeType,
              dataClass: ARTIFACT.dataClass,
              trustLevel: 'TRUSTED',
            },
          ],
        },
        stopConditions: {},
        steps: [STEP],
      },
      USER,
    );

    expect(createdPlan.mock.calls[0][0].data.inputs).toEqual({
      _msaidiziArtifactProvenance: [
        expect.objectContaining({
          artifactId: ARTIFACT.id,
          sourceTaskId: current.id,
          trustLevel: 'UNTRUSTED',
          provenance: ARTIFACT.provenance,
        }),
      ],
    });
  });
});

function service(
  prisma: unknown,
  usage: {
    inspectConsumable: jest.Mock;
    consume: jest.Mock;
    recoverExpiredDraftLeaseForTask?: jest.Mock;
  } = {
    inspectConsumable: jest.fn(),
    consume: jest.fn(),
    recoverExpiredDraftLeaseForTask: jest.fn(),
  },
) {
  const manifest = new ManifestProvider();
  manifest.setForTesting([
    {
      id: 'ExpensesController.findAll',
      controller: 'ExpensesController',
      handler: 'findAll',
      verb: 'GET',
      path: 'expenses',
      permissions: ['msaidizi.use'],
      anyPermissions: [],
      roles: [],
      apiScopes: [],
      guard: 'permission',
      tier: 'green',
      tierReason: 'verb-default',
      params: { path: [], query: [], freeFormQuery: true, hasBody: false },
      agentExcluded: false,
    },
  ]);
  return new MsaidiziTasksService(
    prisma as PrismaService,
    {
      enabled: true,
      hostExecutionEnabled: false,
      autopilotEnabled: false,
      principalKey: 'global-msaidizi',
      principalGrants: ['*'],
      budgetCeilings: {
        ...BUDGETS,
        maxLocalBytes: BigInt(BUDGETS.maxLocalBytes),
        maxExternalEgressBytes: BigInt(BUDGETS.maxExternalEgressBytes),
      },
    } as AutonomyConfig,
    manifest,
    { allowedTiers: ['green', 'amber', 'red'] } as MsaidiziConfig,
    { report: () => ({ releaseGate: { status: 'passed', blockers: [] } }) } as never,
    usage as never,
  );
}

function taskDetail(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-28T08:00:00.000Z');
  return {
    id: '33333333-3333-4333-8333-333333333333',
    principalId: 'principal-1',
    initiatedByUserId: USER.id,
    companyId: USER.companyId,
    mandateId: null,
    scheduleId: null,
    idempotencyKey: null,
    proposalUsageId: null,
    mode: MsaidiziTaskMode.COLLABORATIVE,
    title: 'Review the captured expense screen',
    objective: 'Review the captured expense screen',
    status: MsaidiziTaskStatus.PLANNING,
    activePlanVersion: 0,
    stateVersion: 0,
    hostExecutionAllowed: false,
    ...BUDGETS,
    maxLocalBytes: BigInt(BUDGETS.maxLocalBytes),
    maxExternalEgressBytes: BigInt(BUDGETS.maxExternalEgressBytes),
    modelTurns: 0,
    attemptedToolCalls: 0,
    executedToolCalls: 0,
    mutations: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    modelCostUsd: 0,
    bytesRead: 0n,
    bytesWritten: 0n,
    externalEgressBytes: 0n,
    consumedWallTimeMs: 0n,
    wallTimeCheckpointAt: null,
    statusDetail: null,
    failureCode: null,
    queuedAt: null,
    startedAt: null,
    lastCheckpointAt: null,
    pauseRequestedAt: null,
    cancelRequestedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    principal: { status: 'ACTIVE' },
    mandate: null,
    schedule: null,
    planVersions: [],
    toolAttempts: [],
    artifacts: [],
    deviceLeases: [],
    hostActions: [],
    ...overrides,
  };
}
