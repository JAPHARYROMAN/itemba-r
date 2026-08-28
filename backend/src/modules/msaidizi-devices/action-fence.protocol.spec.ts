import {
  MsaidiziEffect,
  MsaidiziDeviceLeaseStatus,
  MsaidiziHostActionFenceStatus,
  MsaidiziHostActionStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { staticStepInputs } from '../msaidizi-tasks/msaidizi-input-bindings';
import { ActionFencedReceiptDto } from './dto/msaidizi-device.dto';
import { HostActionPolicyError, MsaidiziDevicesService } from './msaidizi-devices.service';

const predecessorHash = 'A'.repeat(64);
const tombstoneHash = 'B'.repeat(64);
const oldActionTokenDigest = 'C'.repeat(64);
const nowSeconds = Math.floor(Date.now() / 1_000);

interface FencePrivateApi {
  claimFenceActionCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
    manifest: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  settleActionFenceReceipt(
    dto: ActionFencedReceiptDto,
    deviceId: string,
  ): Promise<Record<string, unknown>>;
}

function auditHarness() {
  return { logStrictInTransaction: jest.fn().mockResolvedValue({}) };
}

function interruptedAction(fence: Record<string, unknown> | null = null) {
  return {
    id: 'host-action-1',
    actionId: 'action-1',
    taskId: 'task-1',
    stepId: 'step-1',
    deviceId: 'device-1',
    leaseId: 'lease-action-1',
    leaseFencingToken: 7n,
    actionTokenDigest: oldActionTokenDigest,
    dispatchCount: 1,
    acknowledgedDispatchCount: 0,
    acknowledgedAt: null,
    startedAt: null,
    status: MsaidiziHostActionStatus.UNKNOWN,
    uncertainOutcome: true,
    uncertainExternalEgressBytes: 8_000n,
    errorCode: 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN',
    resultSummary: { crossedDeviceBoundary: true },
    journalExpectedPreviousSequence: 11,
    journalPreviousHash: predecessorHash,
    journalSequence: null,
    journalHash: null,
    journalAccepted: false,
    journalReceiptDigest: null,
    journalEvidenceEventCursor: null,
    lateEvidenceAcceptedAt: null,
    endedAt: new Date(Date.now() - 30_000),
    lease: {
      id: 'lease-action-1',
      status: MsaidiziDeviceLeaseStatus.EXPIRED,
      fencingToken: 7n,
    },
    task: {
      status: MsaidiziTaskStatus.NEEDS_ATTENTION,
      principalId: 'principal-1',
      mandateId: 'mandate-1',
      initiatedByUserId: 'operator-1',
      companyId: 'company-1',
    },
    step: { mutation: true, status: MsaidiziTaskStepStatus.NEEDS_ATTENTION },
    fence,
    dispatches: [
      {
        dispatchCount: 1,
        executionMode: 'EXECUTE',
        actionTokenDigest: oldActionTokenDigest,
        leaseId: 'lease-action-1',
        leaseFencingToken: 7n,
      },
    ],
  };
}

function fenceRow(overrides: Record<string, unknown> = {}) {
  return {
    fenceId: '11111111-1111-4111-8111-111111111111',
    hostActionId: 'host-action-1',
    deviceId: 'device-1',
    status: MsaidiziHostActionFenceStatus.PENDING,
    oldLeaseId: 'lease-action-1',
    oldLeaseFencingToken: 7n,
    oldActionTokenDigest,
    journalPreviousSequence: 11,
    journalPreviousHash: predecessorHash,
    dispatchCount: 0,
    maxDispatches: 3,
    dispatchedAt: null,
    receiptDigest: null,
    tombstoneSequence: null,
    tombstonePreviousHash: null,
    tombstoneHash: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

function issuanceHarness(
  options: {
    existingFence?: Record<string, unknown> | null;
    activeLease?: boolean;
    fenceCasCount?: number;
  } = {},
) {
  const persistedFence = options.existingFence === undefined ? null : options.existingFence;
  const action = interruptedAction(persistedFence);
  const createdFence = fenceRow();
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    msaidiziHostAction: { findUnique: jest.fn().mockResolvedValue(action) },
    msaidiziDeviceLease: {
      findFirst: jest.fn().mockResolvedValue(options.activeLease ? { id: 'new-lease' } : null),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    msaidiziHostActionFence: {
      create: jest.fn().mockResolvedValue(createdFence),
      updateMany: jest.fn().mockResolvedValue({ count: options.fenceCasCount ?? 1 }),
    },
    msaidiziHostActionFenceDispatch: { create: jest.fn().mockResolvedValue({}) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({ cursor: 51n }) },
  };
  const prisma = {
    msaidiziHostAction: { findMany: jest.fn().mockResolvedValue([action]) },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const issued = {
    compactToken: 'fence-token-1',
    tokenId: createdFence.fenceId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 120,
  };
  const fenceSigner = {
    issue: jest.fn().mockReturnValue(issued),
  };
  const raw = new MsaidiziDevicesService(
    prisma as never,
    { redeliverySeconds: 15 } as never,
    {} as never,
    auditHarness() as never,
    undefined,
    undefined,
    fenceSigner as never,
  );
  return {
    action,
    createdFence,
    fenceSigner,
    prisma,
    service: raw as unknown as FencePrivateApi,
    tx,
  };
}

function runtime() {
  return {
    runningActionCount: 0,
    centralLedgerConnected: true,
    journalSequence: 11,
    journalHeadHash: predecessorHash,
    receivedAt: new Date().toISOString(),
  };
}

describe('protocol-v3 durable action fence issuance', () => {
  it('persists a bounded signed command without creating or renewing a device lease', async () => {
    const { action, createdFence, fenceSigner, service, tx } = issuanceHarness();

    await expect(
      service.claimFenceActionCommand(action.deviceId, runtime(), { commandProtocolVersion: 3 }),
    ).resolves.toMatchObject({
      kind: 'fence-action',
      fence: {
        request: {
          fenceId: createdFence.fenceId,
          deviceId: action.deviceId,
          actionId: action.actionId,
          taskId: action.taskId,
          stepId: action.stepId,
          oldLeaseId: action.leaseId,
          oldFencingToken: action.leaseFencingToken.toString(),
          oldActionTokenSha256: oldActionTokenDigest,
          journalPreviousSequence: 11,
          journalPreviousHash: predecessorHash,
          dispatchCount: 1,
          expiresAt: expect.any(String),
        },
        compactToken: 'fence-token-1',
      },
    });

    expect(fenceSigner.issue).toHaveBeenCalledWith(
      expect.objectContaining({ fenceId: createdFence.fenceId, dispatchCount: 1 }),
      expect.any(Date),
    );
    expect(tx.msaidiziHostActionFence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fenceId: createdFence.fenceId,
          status: MsaidiziHostActionFenceStatus.PENDING,
          dispatchCount: 0,
          receiptDigest: null,
        }),
        data: expect.objectContaining({
          status: MsaidiziHostActionFenceStatus.DISPATCHED,
          dispatchCount: { increment: 1 },
        }),
      }),
    );
    expect(tx.msaidiziHostActionFenceDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fenceId: createdFence.fenceId,
        dispatchCount: 1,
        fenceTokenDigest: createHash('sha256').update('fence-token-1').digest('hex').toUpperCase(),
      }),
    });
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });

  it('preserves v2 ping-only behavior and never creates fence state', async () => {
    const { fenceSigner, prisma, service, tx } = issuanceHarness();

    await expect(
      service.claimFenceActionCommand('device-1', runtime(), { commandProtocolVersion: 2 }),
    ).resolves.toBeNull();

    expect(prisma.msaidiziHostAction.findMany).not.toHaveBeenCalled();
    expect(tx.msaidiziHostActionFence.create).not.toHaveBeenCalled();
    expect(fenceSigner.issue).not.toHaveBeenCalled();
  });

  it('refuses fencing while any new active lease exists', async () => {
    const { fenceSigner, service, tx } = issuanceHarness({ activeLease: true });

    await expect(
      service.claimFenceActionCommand('device-1', runtime(), { commandProtocolVersion: 3 }),
    ).resolves.toBeNull();

    expect(tx.msaidiziHostActionFence.create).not.toHaveBeenCalled();
    expect(fenceSigner.issue).not.toHaveBeenCalled();
  });

  it('redelivers the same persisted fence after restart without rotating old authority', async () => {
    const persisted = fenceRow({
      status: MsaidiziHostActionFenceStatus.DISPATCHED,
      dispatchCount: 1,
      dispatchedAt: new Date(Date.now() - 60_000),
    });
    const { fenceSigner, service, tx } = issuanceHarness({ existingFence: persisted });
    const tombstonedRuntime = {
      ...runtime(),
      journalSequence: 12,
      journalHeadHash: tombstoneHash,
    };

    await expect(
      service.claimFenceActionCommand('device-1', tombstonedRuntime, {
        commandProtocolVersion: 3,
      }),
    ).resolves.toMatchObject({
      kind: 'fence-action',
      fence: { request: { fenceId: persisted.fenceId, dispatchCount: 2 } },
    });

    expect(tx.msaidiziHostActionFence.create).not.toHaveBeenCalled();
    expect(fenceSigner.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        fenceId: persisted.fenceId,
        oldLeaseId: persisted.oldLeaseId,
        oldFencingToken: persisted.oldLeaseFencingToken.toString(),
        dispatchCount: 2,
      }),
      expect.any(Date),
    );
  });

  it('refuses an advanced journal head until a prior fence dispatch makes it replayable', async () => {
    const { fenceSigner, service, tx } = issuanceHarness();

    await expect(
      service.claimFenceActionCommand(
        'device-1',
        { ...runtime(), journalSequence: 12, journalHeadHash: tombstoneHash },
        { commandProtocolVersion: 3 },
      ),
    ).resolves.toBeNull();

    expect(tx.msaidiziHostActionFence.create).not.toHaveBeenCalled();
    expect(fenceSigner.issue).not.toHaveBeenCalled();
  });

  it('does not create dispatch history when the persisted fence CAS loses', async () => {
    const { service, tx } = issuanceHarness({ fenceCasCount: 0 });

    await expect(
      service.claimFenceActionCommand('device-1', runtime(), { commandProtocolVersion: 3 }),
    ).resolves.toBeNull();

    expect(tx.msaidiziHostActionFenceDispatch.create).not.toHaveBeenCalled();
  });
});

describe('protocol-v3 unresolved-fence lease exclusion', () => {
  it('refuses to create a new device lease before no-prepared evidence is accepted', async () => {
    const task = {
      id: 'task-2',
      status: MsaidiziTaskStatus.RUNNING,
      mode: MsaidiziTaskMode.AUTOPILOT,
      principalId: 'principal-1',
      initiatedByUserId: 'operator-1',
      companyId: 'company-1',
      mandateId: 'mandate-1',
      maxWallTimeSeconds: 7_200,
      maxModelTurns: 200,
      maxAttemptedToolCalls: 500,
      maxMutations: 100,
      maxLocalBytes: 10_000n,
      maxExternalEgressBytes: 20_000_000n,
      maxModelCostUsd: new Prisma.Decimal(20),
      startedAt: new Date(),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: new Date(),
      modelTurns: 0,
      attemptedToolCalls: 1,
      mutations: 0,
      bytesRead: 0n,
      bytesWritten: 0n,
      externalEgressBytes: 0n,
      reservedExternalEgressBytes: 0n,
      modelCostUsd: new Prisma.Decimal(0),
      principal: { status: MsaidiziPrincipalStatus.ACTIVE },
      mandate: {
        id: 'mandate-1',
        status: MsaidiziMandateStatus.ACTIVE,
        startsAt: null,
        expiresAt: null,
        deviceIds: ['device-1'],
        budgets: {},
        capabilities: [
          {
            capability: 'system.status.read',
            version: '1.0.0',
            effects: [MsaidiziEffect.READ],
            dataClasses: ['Internal'],
          },
        ],
      },
    };
    const step = {
      id: 'step-2',
      taskId: task.id,
      planVersionId: 'plan-2',
      status: MsaidiziTaskStepStatus.RUNNING,
      capability: 'system.status.read',
      capabilityVersion: '1.0.0',
      expectedEffect: MsaidiziEffect.READ,
      dataClass: 'Internal',
      mutation: false,
      arguments: {},
      preconditions: { deviceId: 'device-1' },
      budgets: {},
      startedAt: new Date(),
      bytesRead: 0n,
      bytesWritten: 0n,
      localIoAccountingValid: true,
      task,
      planVersion: { id: 'plan-2', version: 1, inputs: {} },
    };
    const device = {
      id: 'device-1',
      principalId: task.principalId,
      status: 'ACTIVE',
      capabilityManifest: {
        capabilities: [
          {
            id: step.capability,
            version: step.capabilityVersion,
            effect: 0,
            dataClass: 1,
            consent: 2,
            recovery: 0,
          },
        ],
      },
    };
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          consumedWallTimeMs: task.consumedWallTimeMs,
          wallTimeCheckpointAt: task.wallTimeCheckpointAt,
          maxWallTimeSeconds: task.maxWallTimeSeconds,
        }),
      },
      msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziHostAction: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
      },
      msaidiziDeviceLease: { create: jest.fn() },
      msaidiziToolAttempt: { updateMany: jest.fn() },
    };
    const prisma = {
      msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(step) },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue(
          (() => {
            const inputs = staticStepInputs(
              task.id,
              step.planVersion.id,
              step.id,
              'attempt-2',
              step.arguments,
            );
            return {
              argsDigest: inputs.argumentsSha256,
              resolvedInputProvenance: inputs.provenance,
              inputProvenanceSha256: inputs.provenanceSha256,
            };
          })(),
        ),
      },
      msaidiziDevice: { findFirst: jest.fn().mockResolvedValue(device) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new MsaidiziDevicesService(
      prisma as never,
      {
        channelReady: () => true,
        leasePepper: 'p'.repeat(64),
        leaseTtlSeconds: 30,
      } as never,
      { assertReady: jest.fn() } as never,
      auditHarness() as never,
    );

    await expect(service.queueHostAction(task.id, step.id, 'attempt-2')).rejects.toEqual(
      expect.objectContaining<Partial<HostActionPolicyError>>({
        code: 'HOST_DEVICE_LATE_EVIDENCE_PENDING',
      }),
    );
    expect(tx.msaidiziHostAction.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        deviceId: device.id,
        status: MsaidiziHostActionStatus.UNKNOWN,
        uncertainOutcome: true,
        journalAccepted: false,
        lateEvidenceAcceptedAt: null,
      }),
    });
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.create).not.toHaveBeenCalled();
  });
});

function receiptDto(
  compactToken = 'fence-token-1',
  dispatchCount = 1,
  recordedAtSeconds = nowSeconds,
): ActionFencedReceiptDto {
  return {
    fenceId: '11111111-1111-4111-8111-111111111111',
    deviceId: 'device-1',
    actionId: 'action-1',
    taskId: 'task-1',
    stepId: 'step-1',
    oldLeaseId: 'lease-action-1',
    oldFencingToken: '7',
    oldActionTokenSha256: oldActionTokenDigest,
    fenceDispatchCount: dispatchCount,
    compactToken,
    fenceTokenSha256: createHash('sha256').update(compactToken).digest('hex').toUpperCase(),
    outcome: 'NoPrepared',
    journalPreviousSequence: 11,
    journalPreviousHash: predecessorHash,
    tombstoneSequence: 12,
    tombstonePreviousHash: predecessorHash,
    tombstoneEntryHash: tombstoneHash,
    recordedAt: new Date(recordedAtSeconds * 1_000).toISOString(),
  };
}

function receiptHarness(
  options: {
    actionCasCount?: number;
    fence?: Record<string, unknown>;
    dto?: ActionFencedReceiptDto;
    issuedAtSeconds?: number;
  } = {},
) {
  const dto = options.dto ?? receiptDto();
  const issuedAtSeconds = options.issuedAtSeconds ?? nowSeconds;
  const action = interruptedAction();
  const tokenDigest = createHash('sha256').update(dto.compactToken).digest('hex').toUpperCase();
  const dispatch = {
    dispatchCount: dto.fenceDispatchCount,
    fenceTokenDigest: tokenDigest,
    tokenId: dto.fenceId,
    tokenIssuedAt: new Date(issuedAtSeconds * 1_000),
    tokenExpiresAt: new Date((issuedAtSeconds + 120) * 1_000),
  };
  const fence = {
    ...fenceRow({ status: MsaidiziHostActionFenceStatus.DISPATCHED, dispatchCount: 1 }),
    hostAction: action,
    dispatches: [dispatch],
    ...options.fence,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    msaidiziHostActionFence: {
      findUnique: jest.fn().mockResolvedValue(fence),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziHostAction: {
      findUnique: jest.fn().mockResolvedValue(action),
      updateMany: jest.fn().mockResolvedValue({ count: options.actionCasCount ?? 1 }),
    },
    msaidiziDeviceLease: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({ cursor: 61n }) },
    msaidiziTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziToolAttempt: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    msaidiziHostActionFence: { findUnique: jest.fn().mockResolvedValue(fence) },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const fenceSigner = {
    verify: jest.fn().mockReturnValue({
      valid: true,
      errorCode: null,
      claims: {
        fenceId: dto.fenceId,
        deviceId: dto.deviceId,
        actionId: dto.actionId,
        taskId: dto.taskId,
        stepId: dto.stepId,
        oldLeaseId: dto.oldLeaseId,
        oldFencingToken: dto.oldFencingToken,
        oldActionTokenSha256: dto.oldActionTokenSha256,
        journalPreviousSequence: dto.journalPreviousSequence,
        journalPreviousHash: dto.journalPreviousHash,
        dispatchCount: dto.fenceDispatchCount,
        issuedAt: issuedAtSeconds,
        expiresAt: issuedAtSeconds + 120,
      },
    }),
  };
  const raw = new MsaidiziDevicesService(
    prisma as never,
    {} as never,
    {} as never,
    auditHarness() as never,
    undefined,
    undefined,
    fenceSigner as never,
  );
  return {
    action,
    dispatch,
    dto,
    fence,
    fenceSigner,
    prisma,
    service: raw as unknown as FencePrivateApi,
    tx,
  };
}

describe('protocol-v3 ActionFenced(NoPrepared) settlement', () => {
  it('accepts exact durable evidence, refunds uncertainty, and leaves the task non-runnable', async () => {
    const { action, dto, service, tx } = receiptHarness();

    await expect(service.settleActionFenceReceipt(dto, dto.deviceId)).resolves.toEqual({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.FAILED,
      taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MsaidiziHostActionStatus.UNKNOWN,
          acknowledgedDispatchCount: 0,
          journalSequence: null,
          leaseId: dto.oldLeaseId,
          leaseFencingToken: 7n,
        }),
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.FAILED,
          uncertainOutcome: false,
          errorCode: 'DEVICE_LEASE_EXPIRED_NO_PREPARED_CONFIRMED',
          uncertainExternalEgressBytes: 0n,
          journalSequence: dto.tombstoneSequence,
          journalHash: dto.tombstoneEntryHash,
          journalAccepted: true,
          lateEvidenceAcceptedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: action.taskId,
        status: MsaidiziTaskStatus.NEEDS_ATTENTION,
        externalEgressBytes: { gte: action.uncertainExternalEgressBytes },
      },
      data: {
        externalEgressBytes: { decrement: action.uncertainExternalEgressBytes },
        lastCheckpointAt: expect.any(Date),
      },
    });
    expect(tx.msaidiziTask.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.msaidiziTaskStep.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
  });

  it.each([
    ['old fencing token', { oldFencingToken: '8' }],
    ['predecessor hash', { journalPreviousHash: 'D'.repeat(64) }],
    ['tombstone sequence', { tombstoneSequence: 13 }],
    ['tombstone predecessor', { tombstonePreviousHash: 'E'.repeat(64) }],
    ['token digest', { fenceTokenSha256: 'F'.repeat(64) }],
  ])('rejects a tampered %s without entering the settlement transaction', async (_label, patch) => {
    const dto = { ...receiptDto(), ...patch } as ActionFencedReceiptDto;
    const { prisma, service } = receiptHarness({ dto });

    await expect(service.settleActionFenceReceipt(dto, dto.deviceId)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed when the UNKNOWN action CAS loses', async () => {
    const { dto, service, tx } = receiptHarness({ actionCasCount: 0 });

    await expect(service.settleActionFenceReceipt(dto, dto.deviceId)).rejects.toThrow(
      'eligibility changed',
    );
    expect(tx.msaidiziHostActionFence.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a later dispatch token as an idempotent replay of the same persisted tombstone', async () => {
    const first = receiptHarness();
    await first.service.settleActionFenceReceipt(first.dto, first.dto.deviceId);
    const receiptDigest = first.tx.msaidiziHostAction.updateMany.mock.calls[0][0].data
      .journalReceiptDigest as string;
    const secondIssuedAtSeconds = nowSeconds + 60;
    const secondDto = receiptDto('fence-token-2', 2, secondIssuedAtSeconds);
    const secondTokenDigest = createHash('sha256')
      .update(secondDto.compactToken)
      .digest('hex')
      .toUpperCase();
    const acknowledgedFence = {
      ...fenceRow({
        status: MsaidiziHostActionFenceStatus.ACKNOWLEDGED,
        dispatchCount: 2,
        receiptDigest,
        tombstoneSequence: secondDto.tombstoneSequence,
        tombstonePreviousHash: secondDto.tombstonePreviousHash,
        tombstoneHash: secondDto.tombstoneEntryHash,
        acknowledgedAt: new Date(),
      }),
      hostAction: { ...interruptedAction(), status: MsaidiziHostActionStatus.FAILED },
      dispatches: [
        first.dispatch,
        {
          dispatchCount: 2,
          fenceTokenDigest: secondTokenDigest,
          tokenId: secondDto.fenceId,
          tokenIssuedAt: new Date(secondIssuedAtSeconds * 1_000),
          tokenExpiresAt: new Date((secondIssuedAtSeconds + 120) * 1_000),
        },
      ],
    };
    const second = receiptHarness({
      fence: acknowledgedFence,
      dto: secondDto,
      issuedAtSeconds: secondIssuedAtSeconds,
    });

    await expect(
      second.service.settleActionFenceReceipt(secondDto, secondDto.deviceId),
    ).resolves.toEqual({
      accepted: true,
      replay: true,
      status: MsaidiziHostActionStatus.FAILED,
      taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
    });
    expect(second.fenceSigner.verify).toHaveBeenCalledWith(
      secondDto.compactToken,
      expect.any(Date),
      true,
    );
    expect(secondDto.recordedAt).toBe(new Date(secondIssuedAtSeconds * 1_000).toISOString());
    expect(second.prisma.$transaction).not.toHaveBeenCalled();
  });
});
