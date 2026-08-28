import {
  MsaidiziEffect,
  MsaidiziDeviceStatus,
  MsaidiziHostActionFenceStatus,
  MsaidiziHostActionStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import {
  ActionProgressDto,
  ActionResultDto,
  CompanionHeartbeatDto,
} from './dto/msaidizi-device.dto';
import * as EgressReceiptProtocol from './egress-receipt.protocol';
import * as EgressReceiptVerifier from './egress-receipt-verifier';
import { HostActionPolicyError, MsaidiziDevicesService } from './msaidizi-devices.service';

interface PrivateDeviceApi {
  claimReplayResultCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
    capabilityManifest: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  claimExecuteCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
    authenticatedIdentity?: { certificateThumbprint: string; publicKeySha256: string },
  ): Promise<Record<string, unknown> | null>;
  settleResult(actionId: string, dto: ActionResultDto): Promise<Record<string, unknown>>;
  verifyEgressSettlement(
    action: Record<string, any>,
    dto: ActionResultDto,
    outcome: string,
  ): Promise<Record<string, any>>;
  settleInterruptedAction(
    actionId: string,
    reason: string,
    unknown: boolean,
    cancelled: boolean,
  ): Promise<void>;
  heartbeat(
    dto: CompanionHeartbeatDto,
    request: Request,
  ): Promise<{ accepted: boolean; ignored: boolean; serverTime: Date }>;
  progress(dto: ActionProgressDto, request: Request): Promise<Record<string, unknown>>;
  expireDeviceLeases(deviceId: string): Promise<void>;
}

interface PrivatePollDeviceApi extends PrivateDeviceApi {
  authenticateDevice(
    request: Request,
    deviceId: string,
  ): Promise<{ id: string; capabilityManifest: Record<string, unknown> }>;
  cancelUndispatchedActions(deviceId: string): Promise<void>;
  cancelCommands(deviceId: string, limit: number): Promise<Array<Record<string, unknown>>>;
  poll(
    dto: { deviceId: string; maxCommands: number },
    request: Request,
  ): Promise<{ commands: Array<Record<string, unknown>> }>;
}

const baseHash = 'a'.repeat(64);
const prepareHash = 'b'.repeat(64);
const terminalHash = 'c'.repeat(64);
const authenticatedCertificateThumbprint = '9'.repeat(64);
const authenticatedPublicKey = 'test-only-device-public-key';
const authenticatedPublicKeySha256 = createHash('sha256')
  .update(authenticatedPublicKey)
  .digest('hex')
  .toUpperCase();

function auditHarness() {
  return {
    logStrictInTransaction: jest.fn(
      (tx: { auditLog?: { create: (input: unknown) => unknown } }, input: unknown) =>
        tx.auditLog?.create({ data: input }),
    ),
  };
}

function actionBudgets(maxExternalEgressBytes = 4_000) {
  const brokerSerializedResultUpperBoundBytes = Math.floor(
    Math.min(16_777_216, Math.floor(maxExternalEgressBytes / 4)) / 9,
  );
  return {
    maxWallTimeSeconds: 7_000,
    maxModelTurns: 190,
    maxAttemptedToolCalls: 490,
    maxMutations: 99,
    maxLocalBytes: 8_000,
    maxExternalEgressBytes,
    maxModelSpendUsd: 19,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes,
  };
}

function taskBudgetState() {
  return {
    id: 'task-1',
    status: MsaidiziTaskStatus.RUNNING,
    principalId: 'principal-1',
    initiatedByUserId: 'operator-1',
    companyId: 'company-1',
    mandateId: 'mandate-1',
    activePlanVersion: 1,
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
    externalEgressBytes: 1_000_000n,
    reservedExternalEgressBytes: 2_000_000n,
    modelCostUsd: new Prisma.Decimal(0),
    principal: { status: MsaidiziPrincipalStatus.ACTIVE },
    mandate: {
      id: 'mandate-1',
      status: MsaidiziMandateStatus.ACTIVE,
      startsAt: null,
      expiresAt: null,
      deviceIds: ['device-1'],
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
}

function queuedAction() {
  const task = taskBudgetState();
  return {
    id: 'host-action-1',
    actionId: 'action-1',
    actionTokenDigest: 'd'.repeat(64),
    taskId: task.id,
    stepId: 'step-1',
    deviceId: 'device-1',
    leaseId: 'lease-action-1',
    leaseFencingToken: 7n,
    leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    idempotencyKey: 'host:step-1',
    status: MsaidiziHostActionStatus.QUEUED,
    queuedAt: new Date(),
    dispatchedAt: null,
    capability: 'system.status.read',
    capabilityVersion: '1.0.0',
    effect: MsaidiziEffect.READ,
    dataClass: 'Internal',
    consent: 'SignedMandate',
    recovery: 'NotApplicable',
    argsDigest: createHash('sha256').update('{}').digest('hex'),
    expectedPreState: {},
    budgetSnapshot: actionBudgets(17_000_000),
    reservedExternalEgressBytes: 0n,
    brokerMaxDeliverySessions: 0,
    brokerMaxRequestAttemptsPerSession: 0,
    brokerSerializedResultUpperBoundBytes: 0,
    dispatchCount: 0,
    acknowledgedDispatchCount: 0,
    acknowledgedAt: null,
    journalExpectedPreviousSequence: null,
    journalPreviousHash: null,
    task,
    step: {
      id: 'step-1',
      taskId: task.id,
      planVersionId: 'plan-1',
      mutation: false,
      arguments: {},
      planVersion: { id: 'plan-1', version: 1, inputs: {} },
    },
    lease: {
      id: 'lease-action-1',
      fencingToken: 7n,
      status: 'ACTIVE',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  };
}

function wireCapabilityEffect(effect: MsaidiziEffect): string {
  switch (effect) {
    case MsaidiziEffect.READ:
      return 'Observe';
    case MsaidiziEffect.WRITE:
      return 'LocalWrite';
    case MsaidiziEffect.EXTERNAL:
      return 'ExternalWrite';
    case MsaidiziEffect.IRREVERSIBLE:
      return 'Irreversible';
  }
}

function liveDeviceSnapshot(
  action: Record<string, any>,
  runtime: Record<string, unknown>,
): Record<string, any> {
  const manifestSha256 = 'e'.repeat(64);
  return {
    id: action.deviceId,
    principalId: action.task.principalId,
    status: MsaidiziDeviceStatus.ACTIVE,
    certificateThumbprint: authenticatedCertificateThumbprint,
    publicKey: authenticatedPublicKey,
    updatedAt: new Date('2026-08-28T10:00:00.000Z'),
    capabilityManifest: {
      deviceId: action.deviceId,
      component: 'service',
      componentVersion: '1.0.0',
      commandProtocolVersion: 3,
      manifestSha256,
      capturedAt: '2026-08-28T10:00:00.000Z',
      capabilities: [
        {
          id: action.capability,
          version: action.capabilityVersion,
          dataClass: action.dataClass,
          effect: wireCapabilityEffect(action.effect),
          consent: action.consent,
          recovery: action.recovery,
          requiredPrivilege: 'StandardUser',
          supportedOsVersions: ['11'],
          argumentsSchema: { type: 'object', additionalProperties: false },
          resultSchema: { type: 'object', additionalProperties: false },
          idempotency: 'IdempotentReplay',
          touchesTrustedRoot: false,
        },
      ],
      runtime: {
        executionEnabled: true,
        killSwitchEngaged: false,
        centralLedgerConnected: true,
        manifestMatches: true,
        capabilityManifestSha256: manifestSha256,
        runningActionCount: 0,
        journalSequence: 11,
        journalHeadHash: baseHash,
        receivedAt: new Date().toISOString(),
        ...runtime,
      },
    },
  };
}

function claimHarness(
  options: {
    anotherActive?: boolean;
    reserveCount?: number;
    latestJournal?: Record<string, unknown> | null;
    action?: Record<string, any>;
    authoritativeWallTime?: {
      consumedWallTimeMs: bigint;
      wallTimeCheckpointAt: Date | null;
      maxWallTimeSeconds: number;
    };
    liveTask?: Record<string, any>;
    livePrincipalStatus?: MsaidiziPrincipalStatus;
    liveDevice?: Record<string, any> | ((runtime: Record<string, unknown>) => Record<string, any>);
  } = {},
) {
  const action = options.action ?? queuedAction();
  let currentRuntime: Record<string, unknown> = {};
  const hostFindFirst = jest
    .fn()
    .mockResolvedValueOnce(options.anotherActive ? { id: 'other-action' } : null)
    .mockResolvedValueOnce(options.latestJournal ?? null);
  const taskUpdateMany = jest
    .fn()
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: options.reserveCount ?? 1 });
  const tx = {
    $queryRaw: jest.fn().mockImplementation((query: TemplateStringsArray | string) => {
      const sql = Array.isArray(query) ? query.join(' ') : String(query);
      if (sql.includes('msaidizi_principals')) {
        return Promise.resolve([
          {
            id: action.task.principalId,
            status: options.livePrincipalStatus ?? MsaidiziPrincipalStatus.ACTIVE,
          },
        ]);
      }
      if (sql.includes('msaidizi_mandates')) {
        return Promise.resolve([{ id: action.task.mandateId }]);
      }
      return Promise.resolve([{ id: action.id }]);
    }),
    $executeRaw: jest.fn().mockResolvedValue(1),
    msaidiziHostAction: {
      findFirst: hostFindFirst,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziHostActionDispatch: { create: jest.fn().mockResolvedValue({}) },
    msaidiziTask: {
      findUnique: jest
        .fn()
        .mockImplementation(
          async (args: { select?: { consumedWallTimeMs?: boolean; status?: boolean } }) =>
            args.select?.consumedWallTimeMs && !args.select?.status
              ? (options.authoritativeWallTime ?? {
                  consumedWallTimeMs: action.task.consumedWallTimeMs,
                  wallTimeCheckpointAt: new Date(),
                  maxWallTimeSeconds: action.task.maxWallTimeSeconds,
                })
              : (options.liveTask ?? action.task),
        ),
      updateMany: taskUpdateMany,
    },
    msaidiziDevice: {
      findUnique: jest.fn().mockImplementation(async () => {
        if (typeof options.liveDevice === 'function') return options.liveDevice(currentRuntime);
        return options.liveDevice ?? liveDeviceSnapshot(action, currentRuntime);
      }),
    },
    msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziHostAction: { findMany: jest.fn().mockResolvedValue([action]) },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const signer = {
    issue: jest.fn().mockReturnValue({
      compactToken: 'signed-token',
      tokenId: 'token-1',
      issuedAt: Math.floor(Date.now() / 1_000),
      expiresAt: Math.floor(Date.now() / 1_000) + 60,
    }),
  };
  const rawService = new MsaidiziDevicesService(
    prisma as never,
    { redeliverySeconds: 15, leaseTtlSeconds: 30 } as never,
    signer as never,
    auditHarness() as never,
  );
  const service = rawService as unknown as PrivateDeviceApi;
  const claimExecuteCommand = service.claimExecuteCommand.bind(service);
  service.claimExecuteCommand = (
    claimedDeviceId,
    observedRuntime,
    authenticatedIdentity = {
      certificateThumbprint: authenticatedCertificateThumbprint,
      publicKeySha256: authenticatedPublicKeySha256,
    },
  ) => {
    currentRuntime = observedRuntime;
    return claimExecuteCommand(claimedDeviceId, observedRuntime, authenticatedIdentity);
  };
  return { action, prisma, service, signer, tx };
}

function lateEvidenceAction(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof dispatchedAction> {
  const action = dispatchedAction(MsaidiziHostActionStatus.UNKNOWN);
  action.dispatchedAt = new Date(Date.now() - 60_000);
  action.step = { ...action.step, mutation: true };
  action.capability = 'registry.value.set';
  action.capabilityVersion = '2.0.0';
  action.effect = MsaidiziEffect.WRITE;
  action.expectedPreState = { sha256: 'f'.repeat(64) };
  action.uncertainOutcome = true;
  action.errorCode = 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN';
  action.resultSummary = {
    reason: action.errorCode,
    crossedDeviceBoundary: true,
    reservedExternalEgressBytes: '8000000',
    uncertainExternalEgressBytes: '8000000',
    totalExternalEgressBytes: '8000000',
  };
  action.journalExpectedPreviousSequence = 11;
  action.journalPreviousHash = baseHash;
  action.journalSequence = 13;
  action.journalHash = 'c'.repeat(64);
  return Object.assign(action, overrides);
}

function replayClaimHarness(
  options: {
    action?: ReturnType<typeof lateEvidenceAction>;
    pendingEvidenceCount?: number;
    activeLease?: Record<string, unknown> | null;
  } = {},
) {
  const action = options.action ?? lateEvidenceAction();
  const lease = {
    id: `evidence-${action.id}-${action.dispatchCount + 1}`,
    fencingToken: 19n,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    msaidiziDeviceLease: {
      findFirst: jest.fn().mockResolvedValue(options.activeLease ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue(lease),
    },
    msaidiziHostAction: {
      findUnique: jest.fn().mockResolvedValue(action),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziHostActionDispatch: { create: jest.fn().mockResolvedValue({}) },
    msaidiziTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({ cursor: 51n }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziHostAction: {
      findMany: jest.fn().mockResolvedValue([action]),
      count: jest.fn().mockResolvedValue(options.pendingEvidenceCount ?? 0),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const signer = {
    issue: jest.fn().mockReturnValue({
      compactToken: 'signed-replay-token',
      tokenId: 'replay-token-1',
      issuedAt: Math.floor(Date.now() / 1_000),
      expiresAt: Math.floor(Date.now() / 1_000) + 120,
    }),
  };
  const audit = auditHarness();
  const config = {
    redeliverySeconds: 15,
    leaseTtlSeconds: 30,
    tokenTtlSeconds: 120,
    leasePepper: 'test-only-replay-lease-pepper-at-least-32-bytes',
    globalKillSwitchActive: false,
    channelReady: jest.fn().mockReturnValue(true),
  };
  const rawService = new MsaidiziDevicesService(
    prisma as never,
    config as never,
    signer as never,
    audit as never,
    undefined,
    undefined,
    undefined,
    { isExactHead: jest.fn().mockResolvedValue(true) } as never,
  );
  return {
    action,
    audit,
    config,
    lease,
    prisma,
    rawService,
    service: rawService as unknown as PrivateDeviceApi,
    signer,
    tx,
  };
}

function validResult(overrides: Partial<ActionResultDto> = {}): ActionResultDto {
  const outputJson = JSON.stringify({ ok: true });
  return {
    actionId: 'action-1',
    taskId: 'task-1',
    stepId: 'step-1',
    leaseId: 'lease-action-1',
    fencingToken: '7',
    leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    actionTokenSha256: 'd'.repeat(64),
    outcome: 'Completed',
    outputJson,
    outputSha256: createHash('sha256').update(outputJson).digest('hex'),
    mutationCommitted: false,
    outcomeUncertain: false,
    isIdempotentReplay: false,
    errorCode: null,
    provenance: [],
    journalPrepareSequence: 12,
    journalPrepareEntryHash: prepareHash,
    journalPreparePreviousHash: baseHash,
    journalSequence: 13,
    journalEntryHash: terminalHash,
    journalPreviousHash: prepareHash,
    preStateSha256: null,
    recoveryProvenanceSha256: null,
    recoveryHandleSha256: null,
    localBytesRead: 20,
    localBytesWritten: 10,
    externalEgressBytes: 100,
    brokerExternalEgressBytes: 1_999_998,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    uncertainExternalEgressBytes: 50,
    ...overrides,
  };
}

function alreadyRunningResult(overrides: Partial<ActionResultDto> = {}): ActionResultDto {
  return validResult({
    outcome: 'AlreadyRunning',
    outputJson: null,
    outputSha256: null,
    journalPrepareSequence: null,
    journalPrepareEntryHash: null,
    journalPreparePreviousHash: null,
    journalSequence: null,
    journalEntryHash: null,
    journalPreviousHash: null,
    localBytesRead: 0,
    localBytesWritten: 0,
    externalEgressBytes: 0,
    uncertainExternalEgressBytes: 0,
    ...overrides,
  });
}

function meteredAction(
  status: MsaidiziHostActionStatus = MsaidiziHostActionStatus.DISPATCHED,
): Record<string, any> {
  const action = dispatchedAction(status);
  action.capability = 'command.emergency.execute';
  action.capabilityVersion = '1.0.0';
  action.task = {
    ...action.task,
    mode: MsaidiziTaskMode.AUTOPILOT,
    mandateId: 'mandate-1',
  };
  action.device = {
    ...action.device,
    egressBoundaryKeyId: 'boundary-key-1',
    egressBoundaryPublicKey: 'unused-by-mocked-verifier',
    egressBoundaryPublicKeySha256: '1'.repeat(64),
    egressDestinationPolicySha256: '2'.repeat(64),
    egressExecutionIdentitySha256: '3'.repeat(64),
  };
  return action;
}

function meteredEgressProofFixture() {
  const now = Date.now();
  const proof = {
    actionTokenSha256: 'd'.repeat(64),
    authorization: {
      attestation: {
        bootId: '40000000-0000-4000-8000-000000000004',
      },
      lease: {
        leaseId: '50000000-0000-4000-8000-000000000005',
      },
    },
    receipt: {
      receiptId: '60000000-0000-4000-8000-000000000006',
      startedAtUnixMilliseconds: now - 2_000,
      endedAtUnixMilliseconds: now - 1_000,
      sequence: 9,
      outcome: 'completed',
      measuredExternalEgressBytes: 0,
      uncertainExternalEgressBytes: 0,
    },
  };
  return {
    proof,
    verified: {
      proof,
      attestationSha256: '4'.repeat(64),
      leaseSha256: '5'.repeat(64),
      receiptSha256: '6'.repeat(64),
      egressEvidenceSha256: '7'.repeat(64),
      receiptPublicKeySha256: '8'.repeat(64),
      chargedExternalEgressBytes: 0,
    },
  };
}

function dispatchedAction(
  status: MsaidiziHostActionStatus = MsaidiziHostActionStatus.DISPATCHED,
): Record<string, any> {
  const task = taskBudgetState();
  return {
    ...queuedAction(),
    status,
    dispatchedAt: new Date(),
    budgetSnapshot: actionBudgets(8_000_000),
    reservedExternalEgressBytes: 8_000_000n,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    dispatchCount: 1,
    dispatches: [
      {
        actionTokenDigest: 'd'.repeat(64),
        dispatchCount: 1,
        executionMode: 'EXECUTE',
        tokenIssuedAt: null,
        tokenExpiresAt: null,
        leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    ],
    acknowledgedDispatchCount: 0,
    acknowledgedAt: null,
    journalExpectedPreviousSequence: 11,
    capabilityExternalEgressBytes: 0n,
    brokerExternalEgressBytes: 0n,
    uncertainExternalEgressBytes: 0n,
    journalPrepareSequence: null,
    journalPreparePreviousHash: null,
    journalPrepareHash: null,
    journalSequence: null,
    journalHash: null,
    journalAccepted: false,
    journalReceiptDigest: null,
    journalEvidenceEventCursor: null,
    journalEvidenceAcceptedAt: null,
    lateEvidenceAcceptedAt: null,
    resultSummary: null,
    startedAt: null,
    task: {
      ...task,
      reservedExternalEgressBytes: 8_000_000n,
      externalEgressBytes: 1_000_000n,
    },
    step: { ...queuedAction().step, mutation: false },
    device: {
      capabilityManifest: {
        runtime: { journalSequence: 11, journalHeadHash: baseHash },
      },
    },
  };
}

function acknowledgeDispatch(action: Record<string, any>): void {
  action.acknowledgedDispatchCount = action.dispatchCount;
  action.acknowledgedAt = new Date(action.dispatchedAt.getTime() + 1);
}

function settlementHarness(action: Record<string, any> = dispatchedAction()) {
  const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    msaidiziHostAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziHostActionFence: {
      findUnique: jest.fn().mockResolvedValue(action.fence ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziToolAttempt: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    msaidiziTaskStep: {
      findUnique: jest.fn().mockResolvedValue({
        id: action.stepId,
        taskId: action.taskId,
        budgets: { maxLocalBytes: 8_000 },
        bytesRead: 0n,
        bytesWritten: 0n,
        localIoAccountingValid: true,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziTask: {
      findUnique: jest.fn().mockResolvedValue(action.task),
      updateMany: taskUpdateMany,
    },
    msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({ cursor: 42n }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziHostAction: {
      findUnique: jest.fn().mockResolvedValue(action),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const service = new MsaidiziDevicesService(
    prisma as never,
    {} as never,
    {} as never,
    auditHarness() as never,
  );
  return { action, prisma, service: service as unknown as PrivateDeviceApi, taskUpdateMany, tx };
}

describe('host-action external egress reservations', () => {
  it('atomically reserves the exact signed action ceiling with task counter CAS', async () => {
    const { service, signer, tx } = claimHarness();

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toMatchObject({
      kind: 'execute',
      action: { request: { dispatchCount: 1 } },
    });

    const issuedBudget = signer.issue.mock.calls[0][0].budgets.maxExternalEgressBytes;
    expect(signer.issue.mock.calls[0][0].dispatchCount).toBe(1);
    expect(signer.issue.mock.calls[0][0].leaseExpiresAt.getTime() - Date.now()).toBeGreaterThan(
      60 * 60 * 1_000,
    );
    expect(tx.msaidiziHostActionDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hostActionId: 'host-action-1',
        dispatchCount: 1,
        actionTokenDigest: createHash('sha256').update('signed-token').digest('hex').toUpperCase(),
        executionMode: 'EXECUTE',
        leaseId: 'lease-action-1',
        leaseFencingToken: 7n,
        leaseAuthorizationExpiresAt: signer.issue.mock.calls[0][0].leaseExpiresAt,
      }),
    });
    const leaseRenewal = tx.msaidiziDeviceLease.updateMany.mock.calls[0][0].data.expiresAt as Date;
    expect(leaseRenewal.getTime() - Date.now()).toBeLessThanOrEqual(30_000);
    expect(leaseRenewal.getTime()).toBeLessThan(
      signer.issue.mock.calls[0][0].leaseExpiresAt.getTime(),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          device: {
            is: expect.objectContaining({
              certificateThumbprint: authenticatedCertificateThumbprint,
              publicKey: authenticatedPublicKey,
              capabilityManifest: { equals: expect.any(Object) },
            }),
          },
        }),
        data: expect.objectContaining({
          reservedExternalEgressBytes: BigInt(issuedBudget),
        }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalEgressBytes: 1_000_000n,
          reservedExternalEgressBytes: 2_000_000n,
          maxExternalEgressBytes: 20_000_000n,
        }),
        data: expect.objectContaining({
          reservedExternalEgressBytes: { increment: BigInt(issuedBudget) },
        }),
      }),
    );
  });

  it('refuses device authority from the database checkpoint when the broker clock is behind', async () => {
    const databaseNow = new Date('2026-08-28T10:00:00.000Z');
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-08-28T09:59:30.000Z').getTime());
    try {
      const { service, signer, tx } = claimHarness({
        authoritativeWallTime: {
          consumedWallTimeMs: 7_200_000n,
          wallTimeCheckpointAt: databaseNow,
          maxWallTimeSeconds: 7_200,
        },
      });

      await expect(
        service.claimExecuteCommand('device-1', {
          journalSequence: 11,
          journalHeadHash: baseHash,
          centralLedgerConnected: true,
          receivedAt: databaseNow.toISOString(),
        }),
      ).resolves.toBeNull();

      expect(signer.issue).not.toHaveBeenCalled();
      expect(tx.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('revalidates the locked live mandate instead of signing from the candidate snapshot', async () => {
    const action = queuedAction();
    const liveTask = {
      ...action.task,
      mandate: {
        ...action.task.mandate,
        version: 2,
        deviceIds: [],
        capabilities: [],
      },
    };
    const { service, signer, tx } = claimHarness({ action, liveTask });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('locks the live principal before task/device authority and rejects disabled-principal redelivery', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({
      action,
      livePrincipalStatus: MsaidiziPrincipalStatus.DISABLED,
    });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();

    const firstLock = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(firstLock).toContain('msaidizi_principals');
    expect(firstLock).toContain('FOR SHARE');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'capability manifest effect drift',
      mutate: (device: Record<string, any>) => {
        device.capabilityManifest.capabilities[0].effect = 'LocalWrite';
      },
    },
    {
      label: 'runtime kill-switch drift',
      mutate: (device: Record<string, any>) => {
        device.capabilityManifest.runtime.killSwitchEngaged = true;
      },
    },
    {
      label: 'runtime manifest generation drift',
      mutate: (device: Record<string, any>) => {
        device.capabilityManifest.runtime.capabilityManifestSha256 = 'f'.repeat(64);
      },
    },
  ])('refuses redelivery after locked $label', async ({ mutate }) => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({
      action,
      liveDevice: (runtime) => {
        const device = liveDeviceSnapshot(action, runtime);
        mutate(device);
        return device;
      },
    });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'certificate rotation',
      mutate: (device: Record<string, any>) => {
        device.certificateThumbprint = '8'.repeat(64);
      },
    },
    {
      label: 'public-key rotation',
      mutate: (device: Record<string, any>) => {
        device.publicKey = 'rotated-device-public-key';
      },
    },
  ])('refuses redelivery after post-authentication $label', async ({ mutate }) => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({
      action,
      liveDevice: (runtime) => {
        const device = liveDeviceSnapshot(action, runtime);
        mutate(device);
        return device;
      },
    });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a locked runtime whose receivedAt is ahead of the database clock', async () => {
    const databaseNow = new Date();
    const action = dispatchedAction();
    action.dispatchedAt = new Date(databaseNow.getTime() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({
      action,
      authoritativeWallTime: {
        consumedWallTimeMs: 1_000n,
        wallTimeCheckpointAt: databaseNow,
        maxWallTimeSeconds: 7_200,
      },
    });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date(databaseNow.getTime() + 1).toISOString(),
      }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('refuses redelivery when the locked task has exhausted a hard ceiling', async () => {
    const databaseNow = new Date();
    const action = dispatchedAction();
    action.dispatchedAt = new Date(databaseNow.getTime() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({
      action,
      authoritativeWallTime: {
        consumedWallTimeMs: 7_200_000n,
        wallTimeCheckpointAt: databaseNow,
        maxWallTimeSeconds: 7_200,
      },
    });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: databaseNow.toISOString(),
      }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
  });

  it('uses the database checkpoint clock for the final mandate window', async () => {
    const databaseNow = new Date('2026-08-28T10:00:00.000Z');
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-08-28T09:00:00.000Z').getTime());
    try {
      const action = queuedAction();
      const liveTask = {
        ...action.task,
        mandate: {
          ...action.task.mandate,
          version: 2,
          startsAt: new Date('2026-08-28T10:00:01.000Z'),
        },
      };
      const { service, signer, tx } = claimHarness({
        action,
        liveTask,
        authoritativeWallTime: {
          consumedWallTimeMs: 1_000n,
          wallTimeCheckpointAt: databaseNow,
          maxWallTimeSeconds: 7_200,
        },
      });

      await expect(
        service.claimExecuteCommand('device-1', {
          journalSequence: 11,
          journalHeadHash: baseHash,
          centralLedgerConnected: true,
          receivedAt: databaseNow.toISOString(),
        }),
      ).resolves.toBeNull();

      expect(signer.issue).not.toHaveBeenCalled();
      expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('issues privileged command authority only from an exact mandate and one-shot step grant', async () => {
    const action = queuedAction();
    const commandArguments = {
      argv: ['/d', '/s', '/c', 'whoami'],
      executable: 'cmd',
      maximumOutputBytes: 65_536,
      timeoutSeconds: 30,
    };
    const argumentsSha256 = createHash('sha256')
      .update(JSON.stringify(commandArguments))
      .digest('hex');
    Object.assign(action, {
      capability: 'command.privileged.execute',
      capabilityVersion: '1.0.0',
      effect: MsaidiziEffect.IRREVERSIBLE,
      dataClass: 'Credential',
      consent: 'OneShotApproval',
      argsDigest: argumentsSha256,
      expectedPreState: {
        sha256: '88323c68c98b95a7c22adccb1bd442c3ac1da0b06df6d582b7d747dacc3682c6',
      },
      step: {
        ...action.step,
        mutation: true,
        arguments: commandArguments,
      },
      task: {
        ...action.task,
        mandate: {
          ...action.task.mandate,
          capabilities: [
            {
              capability: 'command.privileged.execute',
              version: '1.0.0',
              effects: [MsaidiziEffect.IRREVERSIBLE],
              dataClasses: ['Credential'],
            },
          ],
        },
        events: [
          {
            actorType: 'HUMAN',
            actorId: 'operator-1',
            payload: {
              protocol: 'msaidizi-one-shot-step-consent/v1',
              planVersionId: 'plan-1',
              planVersion: 1,
              stepId: 'step-1',
              capability: 'command.privileged.execute',
              capabilityVersion: '1.0.0',
              argumentsSha256: argumentsSha256.toUpperCase(),
              consentGrant: 'one_shot_approval',
              instructionAuthority: 'NONE',
            },
          },
        ],
      },
    });
    const { service, signer } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toMatchObject({
      kind: 'execute',
      action: {
        request: {
          capabilityId: 'command.privileged.execute',
          capabilityVersion: '1.0.0',
          argumentsSha256: argumentsSha256.toUpperCase(),
          expectedPreStateSha256:
            '88323C68C98B95A7C22ADCCB1BD442C3AC1DA0B06DF6D582B7D747DACC3682C6',
        },
      },
    });
    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'command.privileged.execute',
        capabilityVersion: '1.0.0',
        argumentsSha256: argumentsSha256.toUpperCase(),
        expectedPreStateSha256: '88323C68C98B95A7C22ADCCB1BD442C3AC1DA0B06DF6D582B7D747DACC3682C6',
        consentGrant: 'one_shot_approval',
      }),
    );
  });

  it('fails the dispatch transaction when the task reservation CAS loses a race', async () => {
    const { service } = claimHarness({ reserveCount: 0 });
    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<HostActionPolicyError>>({
        code: 'HOST_TASK_BUDGET_RESERVATION_RACE',
      }),
    );
  });

  it('does not claim a different action while the device has an active action', async () => {
    const { service, signer, tx } = claimHarness({ anotherActive: true });
    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('refuses B while its heartbeat still reports the predecessor of accepted terminal A', async () => {
    const latestJournal = {
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    const { service, signer, tx } = claimHarness({ latestJournal });
    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('binds first dispatch B to the exact accepted terminal A heartbeat', async () => {
    const latestJournal = {
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    const { service, tx } = claimHarness({ latestJournal });
    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 13,
        journalHeadHash: terminalHash,
        centralLedgerConnected: true,
      }),
    ).resolves.toMatchObject({ kind: 'execute' });
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journalExpectedPreviousSequence: 13,
          journalPreviousHash: terminalHash.toUpperCase(),
        }),
      }),
    );
  });

  it('redelivers the same active B from its terminal journal slot without reserving twice', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    acknowledgeDispatch(action);
    action.journalExpectedPreviousSequence = 13;
    action.journalPreviousHash = terminalHash;
    const latestJournal = {
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    const { service, signer, tx } = claimHarness({ action, latestJournal });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 15,
        journalHeadHash: 'd'.repeat(64),
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({
      kind: 'execute',
      action: { request: { dispatchCount: 2 } },
    });

    expect(signer.issue).toHaveBeenCalledTimes(1);
    expect(signer.issue.mock.calls[0][0].dispatchCount).toBe(2);
    expect(tx.msaidiziHostActionDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hostActionId: 'host-action-1',
        dispatchCount: 2,
        actionTokenDigest: createHash('sha256').update('signed-token').digest('hex').toUpperCase(),
      }),
    });
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dispatchCount: 1 }),
        data: expect.objectContaining({
          dispatchCount: { increment: 1 },
          acknowledgedDispatchCount: 0,
          acknowledgedAt: null,
        }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastCheckpointAt: expect.any(Date) } }),
    );
  });

  it('tightens every redelivery token to the locked task remaining budget', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalPreviousHash = baseHash;
    const liveTask = {
      ...action.task,
      bytesRead: 9_500n,
      maxLocalBytes: 10_000n,
      modelCostUsd: new Prisma.Decimal(19),
      maxModelCostUsd: new Prisma.Decimal(20),
    };
    const { service, signer, tx } = claimHarness({ action, liveTask });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ kind: 'execute' });

    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchCount: 2,
        budgets: expect.objectContaining({
          maxLocalBytes: 500,
          maxModelSpendUsd: 1,
          maxExternalEgressBytes: 8_000_000,
        }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not redeliver after the centrally persisted delivery-session cap', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalExpectedPreviousSequence = 13;
    action.journalPreviousHash = terminalHash;
    action.dispatchCount = 3;
    acknowledgeDispatch(action);
    const latestJournal = {
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    const { service, signer, tx } = claimHarness({ action, latestJournal });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 15,
        journalHeadHash: 'd'.repeat(64),
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not burn a redelivery session while the companion reports the action running', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.RUNNING);
    action.dispatchedAt = new Date(Date.now() - 60_000);
    const { service, signer, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 1,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not spend a redelivery session on an idle heartbeat cached before dispatch', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 30_000);
    acknowledgeDispatch(action);
    const { service, signer, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date(action.dispatchedAt.getTime() - 1).toISOString(),
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('redelivers a lost initial poll without reserving twice and accepts its older terminal token', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({ action });

    const redelivery = await service.claimExecuteCommand('device-1', {
      journalSequence: 11,
      journalHeadHash: baseHash,
      centralLedgerConnected: true,
      runningActionCount: 0,
      receivedAt: new Date().toISOString(),
    });

    expect(redelivery).toMatchObject({
      kind: 'execute',
      action: {
        request: {
          actionId: action.actionId,
          idempotencyKey: action.idempotencyKey,
          leaseId: action.leaseId,
          fencingToken: action.leaseFencingToken.toString(),
          dispatchCount: 2,
        },
      },
    });
    expect(signer.issue).toHaveBeenCalledTimes(1);
    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: action.actionId,
        idempotencyKey: action.idempotencyKey,
        leaseId: action.leaseId,
        fencingToken: action.leaseFencingToken.toString(),
        dispatchCount: 2,
      }),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispatchCount: 1,
          acknowledgedDispatchCount: 0,
          acknowledgedAt: null,
        }),
        data: expect.objectContaining({
          dispatchCount: { increment: 1 },
          acknowledgedDispatchCount: 0,
          acknowledgedAt: null,
        }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastCheckpointAt: expect.any(Date) } }),
    );

    // Model the committed generation-two claim. A generation-one result may
    // already be in flight when the broker safely redelivers, so settlement
    // must accept its immutable historical token without charging twice.
    const issued = signer.issue.mock.results[0].value;
    action.dispatchCount = 2;
    action.dispatchedAt = new Date();
    action.actionTokenDigest = createHash('sha256').update(issued.compactToken).digest('hex');
    action.dispatches.push({
      actionTokenDigest: action.actionTokenDigest,
      dispatchCount: 2,
      executionMode: 'EXECUTE',
      tokenIssuedAt: new Date(issued.issuedAt * 1_000),
      tokenExpiresAt: new Date(issued.expiresAt * 1_000),
      leaseAuthorizationExpiresAt: signer.issue.mock.calls[0][0].leaseExpiresAt,
    });
    const settlement = settlementHarness(action);
    await expect(
      settlement.service.settleResult('host-action-1', validResult()),
    ).resolves.toMatchObject({ accepted: true, replay: false });
    expect(settlement.tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dispatchCount: 2 }),
      }),
    );
    expect(settlement.taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_000_000n },
        }),
      }),
    );
  });

  it('does not redeliver an unacknowledged command before the stale-delivery window', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date();
    action.journalPreviousHash = baseHash;
    const { service, signer, tx, prisma } = claimHarness({ action });
    prisma.msaidiziHostAction.findMany.mockResolvedValueOnce([]);

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(prisma.msaidiziHostAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: MsaidiziHostActionStatus.DISPATCHED,
              dispatchedAt: { lte: expect.any(Date) },
            }),
          ]),
        }),
      }),
    );
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale receipt ACK from an earlier dispatch generation', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.dispatchCount = 2;
    action.acknowledgedDispatchCount = 1;
    action.acknowledgedAt = new Date(action.dispatchedAt.getTime() + 1);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not trust an idle heartbeat observed between dispatch and Started progress', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.RUNNING);
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.startedAt = new Date(Date.now() - 30_000);
    const { service, signer, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date(action.dispatchedAt.getTime() + 1_000).toISOString(),
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('redelivers after a fresh idle heartbeat proves the RUNNING session ended', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.RUNNING);
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.startedAt = new Date(Date.now() - 30_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 13,
        journalHeadHash: terminalHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ kind: 'execute' });
    expect(signer.issue).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.RUNNING,
          dispatchCount: { increment: 1 },
          journalSequence: 13,
          journalHash: terminalHash.toUpperCase(),
        }),
      }),
    );
  });

  it('advances a pinned recovery checkpoint exactly once to the terminal replay head', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.RUNNING);
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.startedAt = new Date(Date.now() - 30_000);
    action.journalPreviousHash = baseHash;
    action.journalSequence = 13;
    action.journalHash = 'c'.repeat(64);
    const { service, tx } = claimHarness({ action });

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 14,
        journalHeadHash: 'd'.repeat(64),
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ kind: 'execute' });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journalSequence: 14,
          journalHash: 'D'.repeat(64),
        }),
      }),
    );
  });

  it('refuses Accepted/RUNNING redelivery from predecessor or prepare journal slots', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.RUNNING);
    action.dispatchedAt = new Date(Date.now() - 60_000);
    action.startedAt = new Date(Date.now() - 30_000);
    action.journalPreviousHash = baseHash;
    const { service, signer, tx } = claimHarness({ action });

    for (const runtime of [
      { journalSequence: 11, journalHeadHash: baseHash },
      { journalSequence: 12, journalHeadHash: prepareHash },
    ]) {
      await expect(
        service.claimExecuteCommand('device-1', {
          ...runtime,
          centralLedgerConnected: true,
          runningActionCount: 0,
          receivedAt: new Date().toISOString(),
        }),
      ).resolves.toBeNull();
    }
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('treats an invalid expected pre-state on mutation redelivery as unknown', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    acknowledgeDispatch(action);
    action.step = { ...action.step, mutation: true };
    action.expectedPreState = {};
    const { service } = claimHarness({ action });
    const settle = jest.spyOn(service, 'settleInterruptedAction').mockResolvedValue();

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(settle).toHaveBeenCalledWith(action.id, 'HOST_EXPECTED_PRE_STATE_INVALID', true, false);
  });

  it('treats a missing consent grant on mutation redelivery as unknown', async () => {
    const action = dispatchedAction();
    action.dispatchedAt = new Date(Date.now() - 60_000);
    acknowledgeDispatch(action);
    action.step = { ...action.step, mutation: true };
    action.expectedPreState = { sha256: 'f'.repeat(64) };
    action.consent = 'EmergencyOperator';
    const { service } = claimHarness({ action });
    const settle = jest.spyOn(service, 'settleInterruptedAction').mockResolvedValue();

    await expect(
      service.claimExecuteCommand('device-1', {
        journalSequence: 11,
        journalHeadHash: baseHash,
        centralLedgerConnected: true,
        runningActionCount: 0,
        receivedAt: new Date().toISOString(),
      }),
    ).resolves.toBeNull();
    expect(settle).toHaveBeenCalledWith(action.id, 'HOST_CONSENT_GRANT_MISSING', true, false);
  });

  it('releases a valid reservation and charges each trusted egress component once', async () => {
    const { service, taskUpdateMany, tx } = settlementHarness();
    await service.settleResult('host-action-1', validResult());

    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_000_000n },
          externalEgressBytes: { increment: 2_000_148n },
        }),
      }),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseId: 'lease-action-1',
          leaseFencingToken: 7n,
          leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
          dispatchCount: 1,
          journalExpectedPreviousSequence: 11,
          journalPreviousHash: null,
          journalSequence: null,
          journalHash: null,
        }),
        data: expect.objectContaining({
          capabilityExternalEgressBytes: 100n,
          brokerExternalEgressBytes: 1_999_998n,
          uncertainExternalEgressBytes: 50n,
          journalAccepted: true,
        }),
      }),
    );
  });

  it('persists an accepted recovery-prepared chain on an uncertain mutation', async () => {
    const action = dispatchedAction();
    action.step = { ...action.step, mutation: true };
    action.expectedPreState = { sha256: 'f'.repeat(64) };
    const { service, tx } = settlementHarness(action);
    const recoveryPreparedHash = 'c'.repeat(64);
    const checkpointTerminalHash = 'd'.repeat(64);

    await expect(
      service.settleResult(
        'host-action-1',
        validResult({
          outcome: 'NeedsAttention',
          outputJson: null,
          outputSha256: null,
          mutationCommitted: false,
          outcomeUncertain: true,
          journalRecoveryPreparedSequence: 13,
          journalRecoveryPreparedEntryHash: recoveryPreparedHash,
          journalRecoveryPreparedPreviousHash: prepareHash,
          journalSequence: 14,
          journalEntryHash: checkpointTerminalHash,
          journalPreviousHash: recoveryPreparedHash,
          preStateSha256: 'f'.repeat(64),
          recoveryProvenanceSha256: 'e'.repeat(64),
          recoveryHandleSha256: '9'.repeat(64),
          externalEgressBytes: 0,
          uncertainExternalEgressBytes: 0,
        }),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.UNKNOWN,
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.UNKNOWN,
          journalAccepted: true,
          journalSequence: 14,
          journalPreviousHash: recoveryPreparedHash.toUpperCase(),
          journalHash: checkpointTerminalHash.toUpperCase(),
          resultSummary: expect.objectContaining({
            journalRecoveryPreparedSequence: 13,
            journalRecoveryPreparedEntryHash: recoveryPreparedHash.toUpperCase(),
            journalRecoveryPreparedPreviousHash: prepareHash.toUpperCase(),
            recoveryProvenanceSha256: 'E'.repeat(64),
            recoveryHandleSha256: '9'.repeat(64),
          }),
        }),
      }),
    );
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'host_action.outcome_unknown',
        payload: expect.objectContaining({
          journalPrepareEntryHash: prepareHash,
          journalPreparePreviousHash: baseHash,
          journalRecoveryPreparedEntryHash: recoveryPreparedHash,
          journalRecoveryPreparedPreviousHash: prepareHash,
          journalEntryHash: checkpointTerminalHash,
          journalPreviousHash: recoveryPreparedHash,
          recoveryProvenanceSha256: 'e'.repeat(64),
          recoveryHandleSha256: '9'.repeat(64),
        }),
      }),
    });
  });

  it('attaches exact late recovery evidence after lease expiry without recounting or retrying', async () => {
    const action = dispatchedAction(MsaidiziHostActionStatus.UNKNOWN);
    action.step = { ...action.step, mutation: true };
    action.expectedPreState = { sha256: 'f'.repeat(64) };
    action.uncertainOutcome = true;
    action.errorCode = 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN';
    action.resultSummary = {
      reason: action.errorCode,
      crossedDeviceBoundary: true,
      reservedExternalEgressBytes: '8000000',
      uncertainExternalEgressBytes: '8000000',
      totalExternalEgressBytes: '8000000',
    };
    action.journalPreviousHash = baseHash;
    action.journalSequence = 13;
    action.journalHash = 'c'.repeat(64);
    const { service, tx, taskUpdateMany } = settlementHarness(action);

    await expect(
      service.settleResult(
        'host-action-1',
        validResult({
          outcome: 'NeedsAttention',
          outputJson: null,
          outputSha256: null,
          mutationCommitted: false,
          outcomeUncertain: true,
          journalRecoveryPreparedSequence: 13,
          journalRecoveryPreparedEntryHash: 'c'.repeat(64),
          journalRecoveryPreparedPreviousHash: prepareHash,
          journalSequence: 14,
          journalEntryHash: 'd'.repeat(64),
          journalPreviousHash: 'c'.repeat(64),
          preStateSha256: 'f'.repeat(64),
          recoveryProvenanceSha256: 'e'.repeat(64),
          recoveryHandleSha256: '9'.repeat(64),
          localBytesRead: 0,
          localBytesWritten: 0,
          externalEgressBytes: 0,
          uncertainExternalEgressBytes: 0,
        }),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      status: MsaidiziHostActionStatus.UNKNOWN,
      evidenceOnly: true,
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MsaidiziHostActionStatus.UNKNOWN,
          journalAccepted: false,
          leaseId: 'lease-action-1',
          leaseFencingToken: 7n,
          leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
        data: expect.objectContaining({
          journalAccepted: true,
          journalRecoveryPreparedSequence: 13,
          journalSequence: 14,
          journalEvidenceEventCursor: 42n,
          lateEvidenceAcceptedAt: expect.any(Date),
          recoveryRecordSha256: 'e'.repeat(64),
          expectedRestoredStateSha256: 'f'.repeat(64),
        }),
      }),
    );
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'host_action.late_evidence_reconciled',
          payload: expect.objectContaining({ receiptDigest: expect.any(String) }),
        }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lease-action-1',
        deviceId: action.deviceId,
        taskId: action.taskId,
        stepId: action.stepId,
        fencingToken: 7n,
        status: 'ACTIVE',
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
  });

  it('atomically conflicts a dispatched fence when authoritative terminal evidence wins', async () => {
    const action = lateEvidenceAction({
      fence: {
        fenceId: '11111111-1111-4111-8111-111111111111',
        hostActionId: 'host-action-1',
        deviceId: 'device-1',
        status: MsaidiziHostActionFenceStatus.DISPATCHED,
        oldLeaseId: 'lease-action-1',
        oldLeaseFencingToken: 7n,
        oldActionTokenDigest: 'd'.repeat(64),
        journalPreviousSequence: 11,
        journalPreviousHash: baseHash,
        receiptDigest: null,
      },
    });
    const { service, tx } = settlementHarness(action);

    await expect(
      service.settleResult(
        action.id,
        validResult({
          mutationCommitted: true,
          preStateSha256: 'f'.repeat(64),
          localBytesRead: 0,
          localBytesWritten: 0,
        }),
      ),
    ).resolves.toMatchObject({ accepted: true, evidenceOnly: true });

    expect(tx.msaidiziHostActionFence.updateMany).toHaveBeenCalledWith({
      where: {
        fenceId: action.fence.fenceId,
        hostActionId: action.id,
        deviceId: action.deviceId,
        status: {
          in: [MsaidiziHostActionFenceStatus.PENDING, MsaidiziHostActionFenceStatus.DISPATCHED],
        },
        oldLeaseId: action.fence.oldLeaseId,
        oldLeaseFencingToken: action.fence.oldLeaseFencingToken,
        oldActionTokenDigest: action.fence.oldActionTokenDigest,
        journalPreviousSequence: action.fence.journalPreviousSequence,
        journalPreviousHash: action.fence.journalPreviousHash,
        receiptDigest: null,
      },
      data: { status: MsaidiziHostActionFenceStatus.CONFLICTED },
    });
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'host_action.fence_superseded_by_terminal_evidence',
        payload: expect.objectContaining({ fenceId: action.fence.fenceId }),
      }),
    });
  });

  it('persists the complete anti-replay identity for accepted late metered evidence', async () => {
    const action = lateEvidenceAction();
    const metered = meteredAction(MsaidiziHostActionStatus.UNKNOWN);
    action.capability = metered.capability;
    action.capabilityVersion = metered.capabilityVersion;
    action.task = metered.task;
    action.device = metered.device;
    const { proof, verified } = meteredEgressProofFixture();
    const { service, taskUpdateMany, tx } = settlementHarness(action);
    jest.spyOn(service, 'verifyEgressSettlement').mockResolvedValue({
      required: true,
      valid: true,
      errorCode: null,
      proof: null,
      verified,
      authorizedDispatchCount: 1,
    });

    await expect(
      service.settleResult(
        action.id,
        validResult({
          mutationCommitted: true,
          preStateSha256: 'f'.repeat(64),
          localBytesRead: 0,
          localBytesWritten: 0,
        }),
      ),
    ).resolves.toMatchObject({ accepted: true, evidenceOnly: true });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          egressEvidenceSha256: verified.egressEvidenceSha256,
          egressReceiptId: proof.receipt.receiptId,
          egressAuthorizationLeaseId: proof.authorization.lease.leaseId,
          egressBoundaryBootId: proof.authorization.attestation.bootId,
          egressReceiptSequence: proof.receipt.sequence,
        }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('requests historical receipt verification only for eligible late evidence', async () => {
    const action = meteredAction();
    const lateAction = lateEvidenceAction();
    lateAction.capability = action.capability;
    lateAction.capabilityVersion = action.capabilityVersion;
    lateAction.task = action.task;
    lateAction.device = action.device;
    const { proof, verified } = meteredEgressProofFixture();
    const active = settlementHarness(action);
    const late = settlementHarness(lateAction);
    const verifySpy = jest
      .spyOn(EgressReceiptVerifier, 'verifyEgressReceiptProof')
      .mockReturnValue(verified as never);
    const parseWireSpy = jest
      .spyOn(EgressReceiptProtocol, 'parseWireEgressReceiptProof')
      .mockReturnValue(proof as never);
    const evidenceDigestSpy = jest
      .spyOn(EgressReceiptProtocol, 'egressEvidenceSha256')
      .mockReturnValue(verified.egressEvidenceSha256);

    try {
      const dto = validResult({
        egressEvidence: {} as never,
        outputJson: null,
        outputSha256: null,
        externalEgressBytes: 0,
        uncertainExternalEgressBytes: 0,
      });
      await active.service.settleResult(action.id, dto);
      await late.service.settleResult(
        lateAction.id,
        validResult({
          ...dto,
          mutationCommitted: true,
          preStateSha256: 'f'.repeat(64),
        }),
      );

      expect(verifySpy).toHaveBeenCalledTimes(2);
      expect(verifySpy.mock.calls[0][1]).toEqual(
        expect.objectContaining({ timeValidationMode: 'CURRENT' }),
      );
      expect(verifySpy.mock.calls[1][1]).toEqual(
        expect.objectContaining({ timeValidationMode: 'HISTORICAL_TERMINAL_RECEIPT' }),
      );
    } finally {
      evidenceDigestSpy.mockRestore();
      parseWireSpy.mockRestore();
      verifySpy.mockRestore();
    }
  });

  it('accepts a completed two-link cached terminal receipt as evidence without recounting it', async () => {
    const action = lateEvidenceAction({
      dispatches: [
        {
          actionTokenDigest: 'd'.repeat(64),
          dispatchCount: 1,
          executionMode: 'EXECUTE',
        },
      ],
    });
    const { service, tx, taskUpdateMany } = settlementHarness(action);

    await expect(
      service.settleResult(
        action.id,
        validResult({
          mutationCommitted: true,
          preStateSha256: 'f'.repeat(64),
          localBytesRead: 0,
          localBytesWritten: 0,
        }),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      status: MsaidiziHostActionStatus.UNKNOWN,
      evidenceOnly: true,
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journalAccepted: true,
          journalSequence: 13,
          resultSummary: expect.objectContaining({
            outcome: 'Completed',
            mutationCommitted: true,
            outputSha256: expect.stringMatching(/^[0-9A-F]{64}$/),
            reportedOutputJsonSha256: expect.stringMatching(/^[0-9A-F]{64}$/),
          }),
        }),
      }),
    );
    const acceptedEvidence = tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    expect(acceptedEvidence).not.toHaveProperty('journalRecoveryPreparedSequence');
    expect(acceptedEvidence).not.toHaveProperty('journalRecoveryPreparedPreviousHash');
    expect(acceptedEvidence).not.toHaveProperty('journalRecoveryPreparedHash');
    expect(acceptedEvidence).not.toHaveProperty('recoveryRecordSha256');
    expect(acceptedEvidence).not.toHaveProperty('expectedRestoredStateSha256');
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('quarantines replay-only execution evidence once and removes it from replay delivery', async () => {
    const action = lateEvidenceAction({
      actionTokenDigest: 'e'.repeat(64),
      dispatches: [
        {
          actionTokenDigest: 'd'.repeat(64),
          dispatchCount: 1,
          executionMode: 'EXECUTE',
        },
        {
          actionTokenDigest: 'e'.repeat(64),
          dispatchCount: 2,
          executionMode: 'REPLAY_RESULT_ONLY',
        },
      ],
    });
    const { service, taskUpdateMany, tx } = settlementHarness(action);
    const dto = validResult({
      actionTokenSha256: 'e'.repeat(64),
      mutationCommitted: true,
      preStateSha256: 'f'.repeat(64),
      localBytesRead: 0,
      localBytesWritten: 0,
    });

    await expect(service.settleResult(action.id, dto)).rejects.toThrow(
      'cached late evidence was rejected and quarantined',
    );

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: action.id,
          errorCode: 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN',
          leaseId: dto.leaseId,
          leaseFencingToken: 7n,
        }),
        data: expect.objectContaining({
          errorCode: 'DEVICE_LATE_EVIDENCE_REJECTED',
          resultSummary: expect.objectContaining({
            lateEvidenceRejectionCode: 'EGRESS_ACTION_TOKEN_BINDING_MISMATCH',
            rejectedReceiptDigest: expect.stringMatching(/^[0-9A-F]{64}$/),
          }),
        }),
      }),
    );
    expect(tx.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: dto.leaseId,
          deviceId: action.deviceId,
          taskId: action.taskId,
          stepId: action.stepId,
          fencingToken: 7n,
          status: 'ACTIVE',
        }),
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();

    const quarantineData = tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    Object.assign(action, quarantineData);
    const quarantinedEvents = tx.msaidiziTaskEvent.create.mock.calls.length;
    await expect(service.settleResult(action.id, dto)).rejects.toThrow('already rejected');
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledTimes(quarantinedEvents);

    const replay = replayClaimHarness({ action });
    await expect(
      replay.service.claimReplayResultCommand(
        action.deviceId,
        {
          journalSequence: 14,
          journalHeadHash: 'd'.repeat(64),
          centralLedgerConnected: true,
          runningActionCount: 0,
          receivedAt: new Date().toISOString(),
        },
        { commandProtocolVersion: 2 },
      ),
    ).resolves.toBeNull();
    expect(replay.signer.issue).not.toHaveBeenCalled();
    expect(replay.tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
  });

  it('revalidates the settlement-row lease generation after the entry-point snapshot', async () => {
    const action = dispatchedAction();
    action.leaseId = 'lease-new-generation';
    action.leaseFencingToken = 8n;
    action.leaseAuthorizationExpiresAt = new Date('2099-02-01T00:00:00.000Z');
    action.lease = { id: action.leaseId, fencingToken: action.leaseFencingToken };
    const { service, tx } = settlementHarness(action);

    await expect(service.settleResult(action.id, validResult())).rejects.toThrow(
      'signed lease generation',
    );
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a settlement CAS lost to a newer lease without manufacturing a result conflict', async () => {
    const action = dispatchedAction();
    const { prisma, service, taskUpdateMany, tx } = settlementHarness(action);
    const newerGeneration = {
      ...action,
      leaseId: 'lease-new-generation',
      leaseFencingToken: 8n,
      leaseAuthorizationExpiresAt: new Date('2099-02-01T00:00:00.000Z'),
      lease: { id: 'lease-new-generation', fencingToken: 8n },
    };
    prisma.msaidiziHostAction.findUnique
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(newerGeneration);
    tx.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.settleResult(action.id, validResult())).rejects.toThrow(
      'stale signed lease generation',
    );

    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a settlement CAS lost to a newer journal generation without accounting it', async () => {
    const action = dispatchedAction();
    const { prisma, service, taskUpdateMany, tx } = settlementHarness(action);
    const newerJournalGeneration = {
      ...action,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    prisma.msaidiziHostAction.findUnique
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(newerJournalGeneration);
    tx.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.settleResult(action.id, validResult())).rejects.toThrow(
      'settlement eligibility changed before persistence',
    );

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispatchCount: 1,
          journalExpectedPreviousSequence: 11,
          journalPreviousHash: null,
          journalSequence: null,
          journalHash: null,
        }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('acknowledges AlreadyRunning only when a CAS-loss reread is terminal', async () => {
    const action = dispatchedAction();
    const terminal = {
      ...action,
      status: MsaidiziHostActionStatus.SUCCEEDED,
      endedAt: new Date(),
    };
    const { prisma, service, taskUpdateMany, tx } = settlementHarness(action);
    prisma.msaidiziHostAction.findUnique
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(terminal);
    prisma.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.settleResult(action.id, alreadyRunningResult())).resolves.toMatchObject({
      accepted: true,
      replay: true,
      terminal: true,
      status: MsaidiziHostActionStatus.SUCCEEDED,
    });

    expect(prisma.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispatchCount: 1,
          journalExpectedPreviousSequence: 11,
          journalPreviousHash: null,
          journalSequence: null,
          journalHash: null,
        }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('never falsely acknowledges AlreadyRunning after an active generation-change CAS loss', async () => {
    const action = dispatchedAction();
    const changedActiveGeneration = {
      ...action,
      status: MsaidiziHostActionStatus.RUNNING,
      dispatchCount: 2,
      journalSequence: 13,
      journalHash: terminalHash,
    };
    const { prisma, service, taskUpdateMany, tx } = settlementHarness(action);
    prisma.msaidiziHostAction.findUnique
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(changedActiveGeneration);
    prisma.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.settleResult(action.id, alreadyRunningResult())).rejects.toThrow(
      'Running action generation changed before persistence',
    );

    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it('rejects late-evidence CAS loss to a newer lease without manufacturing a result conflict', async () => {
    const action = lateEvidenceAction();
    const { prisma, service, taskUpdateMany, tx } = settlementHarness(action);
    const newerGeneration = {
      ...action,
      leaseId: 'lease-new-generation',
      leaseFencingToken: 8n,
      leaseAuthorizationExpiresAt: new Date('2099-02-01T00:00:00.000Z'),
      lease: { id: 'lease-new-generation', fencingToken: 8n },
    };
    prisma.msaidiziHostAction.findUnique
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(newerGeneration);
    tx.msaidiziHostAction.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.settleResult(
        action.id,
        validResult({
          mutationCommitted: true,
          preStateSha256: 'f'.repeat(64),
          localBytesRead: 0,
          localBytesWritten: 0,
        }),
      ),
    ).rejects.toThrow('stale signed lease generation');

    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    'browser.uri.open',
    'ui.element.invoke',
    'browser.form.text.set',
    'browser.form.secret.set',
    'browser.file.upload',
    'browser.download.invoke',
    'command.emergency.execute',
    'command.privileged.execute',
  ])(
    'full-charges and requires attention when metered capability %s omits signed egress evidence',
    async (capability) => {
      const action = dispatchedAction();
      action.capability = capability;
      const { service, taskUpdateMany, tx } = settlementHarness(action);

      await service.settleResult('host-action-1', validResult({ egressEvidence: null }));

      expect(taskUpdateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            reservedExternalEgressBytes: { decrement: 8_000_000n },
            externalEgressBytes: { increment: 8_000_000n },
          }),
        }),
      );
      expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MsaidiziHostActionStatus.UNKNOWN,
            uncertainOutcome: true,
            errorCode: 'EGRESS_RECEIPT_PROOF_MISSING',
            capabilityExternalEgressBytes: 0n,
            brokerExternalEgressBytes: 0n,
            uncertainExternalEgressBytes: 8_000_000n,
            journalAccepted: false,
          }),
        }),
      );
    },
  );

  it('persists bounded untrusted output and exact typed provenance for adaptive reasoning', async () => {
    const provenance = [
      {
        sourceType: 'HostFile',
        sourceIdentifierHash: 'd'.repeat(64),
        contentSha256: 'e'.repeat(64),
        trust: 'UntrustedContent',
        observedAt: '2026-08-25T10:00:00.000Z',
      },
    ];
    const { service, tx } = settlementHarness();
    await service.settleResult('host-action-1', validResult({ provenance }));

    const summary = tx.msaidiziHostAction.updateMany.mock.calls[0][0].data.resultSummary;
    expect(summary).toMatchObject({
      provenance: [
        {
          ...provenance[0],
          sourceIdentifierHash: 'D'.repeat(64),
          contentSha256: 'E'.repeat(64),
        },
      ],
      observation: {
        available: true,
        trustLevel: 'UNTRUSTED',
        sourceType: 'HOST_RESULT',
        value: { ok: true },
      },
    });
  });

  it('converts the full reservation to spent after dispatch without a trusted result', async () => {
    const { service, taskUpdateMany } = settlementHarness();
    await service.settleInterruptedAction('host-action-1', 'DEVICE_LEASE_EXPIRED', false, false);
    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_000_000n },
          externalEgressBytes: { increment: 8_000_000n },
        }),
      }),
    );
  });

  it('charges zero for a queued action that never crossed the device boundary', async () => {
    const queued = { ...dispatchedAction(MsaidiziHostActionStatus.QUEUED) };
    queued.reservedExternalEgressBytes = 0n;
    queued.task = { ...queued.task, reservedExternalEgressBytes: 0n };
    const { service, taskUpdateMany } = settlementHarness(queued);
    await service.settleInterruptedAction(
      'host-action-1',
      'CANCELLED_BEFORE_DISPATCH',
      false,
      true,
    );
    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 0n },
          externalEgressBytes: { increment: 0n },
        }),
      }),
    );
  });

  it('accepts a durable terminal receipt bound to an earlier authorized dispatch', async () => {
    const action = dispatchedAction();
    action.dispatchCount = 2;
    action.journalPreviousHash = baseHash;
    action.actionTokenDigest = 'e'.repeat(64);
    action.dispatches = [
      { actionTokenDigest: 'd'.repeat(64), dispatchCount: 1, executionMode: 'EXECUTE' },
      { actionTokenDigest: 'e'.repeat(64), dispatchCount: 2, executionMode: 'EXECUTE' },
    ];
    const { service, tx } = settlementHarness(action);

    await expect(service.settleResult('host-action-1', validResult())).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.SUCCEEDED,
    });
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journalAccepted: true,
          resultSummary: expect.objectContaining({ dispatchCount: 1 }),
        }),
      }),
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(tx.$executeRaw.mock.calls[0][0])).toContain('exactAcknowledgedAt');
  });

  it('fails closed when no explicit EXECUTE dispatch history authorizes the receipt', async () => {
    const action = dispatchedAction();
    action.dispatches = [];
    const { service, taskUpdateMany, tx } = settlementHarness(action);

    await expect(service.settleResult(action.id, validResult())).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.FAILED,
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.FAILED,
          errorCode: 'DEVICE_RESULT_INVALID',
          journalAccepted: false,
          uncertainExternalEgressBytes: 8_000_000n,
        }),
      }),
    );
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_000_000n },
          externalEgressBytes: { increment: 8_000_000n },
        }),
      }),
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(tx.$executeRaw.mock.calls[0][0])).toContain('exactAcknowledgedAt');
  });

  it('rejects a terminal receipt whose token digest was never authorized', async () => {
    const action = dispatchedAction();
    action.dispatchCount = 2;
    action.actionTokenDigest = 'e'.repeat(64);
    action.dispatches = [
      { actionTokenDigest: 'd'.repeat(64), dispatchCount: 1, executionMode: 'EXECUTE' },
      { actionTokenDigest: 'e'.repeat(64), dispatchCount: 2, executionMode: 'EXECUTE' },
    ];
    const { service, tx } = settlementHarness(action);

    await service.settleResult('host-action-1', validResult({ actionTokenSha256: 'f'.repeat(64) }));
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ journalAccepted: false }),
      }),
    );
  });

  it('converts the full reservation when any terminal protocol evidence is invalid', async () => {
    const { service, taskUpdateMany, tx } = settlementHarness();
    await service.settleResult('host-action-1', validResult({ outputSha256: 'd'.repeat(64) }));
    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ externalEgressBytes: { increment: 8_000_000n } }),
      }),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capabilityExternalEgressBytes: 0n,
          brokerExternalEgressBytes: 0n,
          uncertainExternalEgressBytes: 8_000_000n,
          journalAccepted: false,
        }),
      }),
    );
  });

  it('requires the mutation receipt pre-state digest to match the issued action', async () => {
    const action = dispatchedAction();
    action.step = { ...action.step, mutation: true };
    action.expectedPreState = { sha256: 'f'.repeat(64) };
    const { service, taskUpdateMany, tx } = settlementHarness(action);

    await service.settleResult(
      'host-action-1',
      validResult({ mutationCommitted: true, preStateSha256: 'e'.repeat(64) }),
    );

    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ externalEgressBytes: { increment: 8_000_000n } }),
      }),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.UNKNOWN,
          journalAccepted: false,
          uncertainExternalEgressBytes: 8_000_000n,
        }),
      }),
    );
  });

  it('accepts digest-only terminal replay only for the already stored output digest', async () => {
    const original = settlementHarness();
    const originalDto = validResult();
    await original.service.settleResult('host-action-1', originalDto);
    const settledData = original.tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    const terminal = {
      ...dispatchedAction(MsaidiziHostActionStatus.SUCCEEDED),
      capabilityExternalEgressBytes: 100n,
      brokerExternalEgressBytes: 1_999_998n,
      uncertainExternalEgressBytes: 50n,
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
      journalAccepted: true,
      resultSummary: settledData.resultSummary,
    };
    const replay = settlementHarness(terminal);

    await expect(
      replay.service.settleResult(
        'host-action-1',
        validResult({ outputJson: null, isIdempotentReplay: true }),
      ),
    ).resolves.toMatchObject({ accepted: true, replay: true });
    expect(replay.tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(replay.taskUpdateMany).not.toHaveBeenCalled();
  });

  it('fails closed and charges the reservation for digest-only active cache-loss recovery', async () => {
    const { service, taskUpdateMany, tx } = settlementHarness();

    await service.settleResult(
      'host-action-1',
      validResult({ outputJson: null, isIdempotentReplay: true }),
    );

    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ externalEgressBytes: { increment: 8_000_000n } }),
      }),
    );
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.FAILED,
          journalAccepted: false,
          uncertainExternalEgressBytes: 8_000_000n,
        }),
      }),
    );
  });

  it('acknowledges an identical digest-only retry after a lost settlement acknowledgement', async () => {
    const action = dispatchedAction();
    const { service, taskUpdateMany, tx } = settlementHarness(action);
    const dto = validResult({ outputJson: null, isIdempotentReplay: true });

    await service.settleResult('host-action-1', dto);
    const settledData = tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    Object.assign(action, settledData);
    const taskWritesAfterSettlement = taskUpdateMany.mock.calls.length;
    const actionWritesAfterSettlement = tx.msaidiziHostAction.updateMany.mock.calls.length;

    await expect(service.settleResult('host-action-1', dto)).resolves.toMatchObject({
      accepted: true,
      replay: true,
      status: MsaidiziHostActionStatus.FAILED,
    });
    expect(taskUpdateMany).toHaveBeenCalledTimes(taskWritesAfterSettlement);
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledTimes(actionWritesAfterSettlement);
  });

  it('acknowledges the exact originally invalid receipt without accepting changed output bytes', async () => {
    const action = dispatchedAction();
    const { service, taskUpdateMany, tx } = settlementHarness(action);
    const dto = validResult({ outputSha256: 'd'.repeat(64), isIdempotentReplay: true });

    await service.settleResult('host-action-1', dto);
    Object.assign(action, tx.msaidiziHostAction.updateMany.mock.calls[0][0].data);
    const taskWritesAfterSettlement = taskUpdateMany.mock.calls.length;
    const actionWritesAfterSettlement = tx.msaidiziHostAction.updateMany.mock.calls.length;

    await expect(service.settleResult('host-action-1', dto)).resolves.toMatchObject({
      accepted: true,
      replay: true,
      status: MsaidiziHostActionStatus.FAILED,
    });
    expect(taskUpdateMany).toHaveBeenCalledTimes(taskWritesAfterSettlement);
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledTimes(actionWritesAfterSettlement);

    await expect(
      service.settleResult(
        'host-action-1',
        validResult({
          outputJson: '{"changed":true}',
          outputSha256: 'd'.repeat(64),
          isIdempotentReplay: true,
        }),
      ),
    ).rejects.toThrow('conflicting terminal result');
  });

  it('revalidates terminal replay output and rejects arbitrary replacement JSON', async () => {
    const terminal = {
      ...dispatchedAction(MsaidiziHostActionStatus.SUCCEEDED),
      capabilityExternalEgressBytes: 100n,
      brokerExternalEgressBytes: 1_999_998n,
      uncertainExternalEgressBytes: 50n,
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
      journalAccepted: true,
      resultSummary: { receiptDigest: 'e'.repeat(64) },
    };
    const { service, tx } = settlementHarness(terminal);
    const arbitrary = '{"admin":true}';
    await expect(
      service.settleResult(
        'host-action-1',
        validResult({
          outputJson: arbitrary,
          outputSha256: createHash('sha256').update(arbitrary).digest('hex'),
          isIdempotentReplay: true,
        }),
      ),
    ).rejects.toThrow('conflicting terminal result');
    expect(tx.msaidiziTaskStep.updateMany).toHaveBeenCalled();
  });

  it('rejects a replay that changes the immutable prepaid broker charge', async () => {
    const terminal = {
      ...dispatchedAction(MsaidiziHostActionStatus.SUCCEEDED),
      capabilityExternalEgressBytes: 100n,
      brokerExternalEgressBytes: 1_999_998n,
      uncertainExternalEgressBytes: 50n,
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareHash: prepareHash,
      journalSequence: 13,
      journalHash: terminalHash,
      journalAccepted: true,
      resultSummary: { receiptDigest: 'e'.repeat(64) },
    };
    const { service } = settlementHarness(terminal);
    await expect(
      service.settleResult(
        'host-action-1',
        validResult({ brokerExternalEgressBytes: 1_999_999, isIdempotentReplay: true }),
      ),
    ).rejects.toThrow('conflicting terminal result');
  });
});

describe('lease-expired mutation result replay dispatch', () => {
  const terminalRuntime = () => ({
    journalSequence: 14,
    journalHeadHash: 'd'.repeat(64),
    centralLedgerConnected: true,
    runningActionCount: 0,
    receivedAt: new Date().toISOString(),
  });

  it('issues a mode-bound evidence transport lease without reopening task execution', async () => {
    const { action, audit, lease, service, signer, tx } = replayClaimHarness();

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toMatchObject({
      kind: 'replay-result',
      action: {
        request: {
          executionMode: 'REPLAY_RESULT_ONLY',
          actionId: action.actionId,
          taskId: action.taskId,
          stepId: action.stepId,
          deviceId: action.deviceId,
          leaseId: lease.id,
          fencingToken: lease.fencingToken.toString(),
          dispatchCount: 2,
          leaseExpiresAt: expect.any(String),
        },
        compactToken: 'signed-replay-token',
      },
    });

    expect(tx.msaidiziDeviceLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'evidence-host-action-1-2',
        taskId: action.taskId,
        stepId: action.stepId,
        deviceId: action.deviceId,
        leaseTokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresAt: expect.any(Date),
      }),
    });
    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: 'REPLAY_RESULT_ONLY',
        actionId: action.actionId,
        taskId: action.taskId,
        stepId: action.stepId,
        deviceId: action.deviceId,
        mandateId: action.task.mandateId,
        capabilityId: action.capability,
        capabilityVersion: action.capabilityVersion,
        expectedPreStateSha256: 'F'.repeat(64),
        leaseId: lease.id,
        fencingToken: lease.fencingToken.toString(),
        dispatchCount: 2,
        consentGrant: null,
        budgets: action.budgetSnapshot,
      }),
    );
    expect(tx.msaidiziHostActionDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hostActionId: action.id,
        dispatchCount: 2,
        actionTokenDigest: createHash('sha256')
          .update('signed-replay-token')
          .digest('hex')
          .toUpperCase(),
        executionMode: 'REPLAY_RESULT_ONLY',
        tokenId: 'replay-token-1',
        leaseId: lease.id,
        leaseFencingToken: lease.fencingToken,
      }),
    });
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: action.id,
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          journalAccepted: false,
          lateEvidenceAcceptedAt: null,
          dispatchCount: 1,
        }),
        data: expect.objectContaining({
          leaseId: lease.id,
          leaseFencingToken: lease.fencingToken,
          actionTokenDigest: expect.stringMatching(/^[0-9A-F]{64}$/),
          dispatchCount: { increment: 1 },
          acknowledgedDispatchCount: 0,
          acknowledgedAt: null,
          journalSequence: 14,
          journalHash: 'D'.repeat(64),
        }),
      }),
    );
    const actionUpdate = tx.msaidiziHostAction.updateMany.mock.calls[0][0].data;
    expect(actionUpdate).not.toHaveProperty('status');
    expect(actionUpdate).not.toHaveProperty('budgetSnapshot');
    expect(actionUpdate).not.toHaveProperty('reservedExternalEgressBytes');
    expect(tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: action.taskId,
        type: 'host_action.result_replay_requested',
        actorType: 'DEVICE_BROKER',
        actorId: action.deviceId,
        payload: expect.objectContaining({
          executionMode: 'REPLAY_RESULT_ONLY',
          dispatchCount: 2,
          journalSequence: 14,
          journalHeadHash: '[REDACTED SECRET]',
        }),
      }),
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'MSAIDIZI_HOST_ACTION_RESULT_REPLAY_REQUESTED',
        entityId: action.actionId,
        taskId: action.taskId,
        stepId: action.stepId,
        deviceId: action.deviceId,
        newValue: expect.objectContaining({ executionMode: 'REPLAY_RESULT_ONLY' }),
      }),
    );
  });

  it('atomically rotates the exact active replay transport lease before redelivery', async () => {
    const action = lateEvidenceAction();
    const activeLease = {
      id: action.leaseId,
      taskId: action.taskId,
      stepId: action.stepId,
      fencingToken: action.leaseFencingToken,
    };
    const { service, tx } = replayClaimHarness({ action, activeLease });

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toMatchObject({ kind: 'replay-result' });

    expect(tx.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith({
      where: {
        id: action.leaseId,
        deviceId: action.deviceId,
        taskId: action.taskId,
        stepId: action.stepId,
        fencingToken: action.leaseFencingToken,
        status: 'ACTIVE',
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
    expect(tx.msaidiziDeviceLease.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.msaidiziDeviceLease.create.mock.invocationCallOrder[0],
    );
  });

  it('refuses replay delivery while an unrelated active device lease exists', async () => {
    const { service, signer, tx } = replayClaimHarness({
      activeLease: {
        id: 'other-lease',
        taskId: 'other-task',
        stepId: 'other-step',
        fencingToken: 99n,
      },
    });

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toBeNull();

    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('can safely ask the companion whether a pinned +2 head is a two-link terminal', async () => {
    const { service, signer } = replayClaimHarness();

    await expect(
      service.claimReplayResultCommand(
        'device-1',
        {
          ...terminalRuntime(),
          journalSequence: 13,
          journalHeadHash: 'c'.repeat(64),
        },
        { commandProtocolVersion: 2 },
      ),
    ).resolves.toMatchObject({ kind: 'replay-result' });
    expect(signer.issue).toHaveBeenCalledTimes(1);
  });

  it('refuses a different runtime head after the +3 terminal head is pinned', async () => {
    const action = lateEvidenceAction({ journalSequence: 14, journalHash: 'e'.repeat(64) });
    const { service, signer, tx } = replayClaimHarness({ action });

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toBeNull();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
  });

  it('re-reads the locked action before creating a deterministic evidence lease', async () => {
    const { action, service, signer, tx } = replayClaimHarness();
    tx.msaidiziHostAction.findUnique.mockResolvedValue({
      ...action,
      dispatchCount: action.dispatchCount + 1,
    });

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toBeNull();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it.each([
    ['missing protocol declaration', {}],
    ['legacy protocol v1', { commandProtocolVersion: 1 }],
  ])('does not send replay-result commands to %s companions', async (_label, manifest) => {
    const { prisma, service, signer, tx } = replayClaimHarness();

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), manifest),
    ).resolves.toBeNull();

    expect(prisma.msaidiziHostAction.findMany).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing head', { ...terminalRuntime(), journalHeadHash: undefined }],
    ['predecessor slot', { ...terminalRuntime(), journalSequence: 11, journalHeadHash: baseHash }],
    ['non-terminal sequence', { ...terminalRuntime(), journalSequence: 13 }],
    ['reused predecessor hash', { ...terminalRuntime(), journalHeadHash: baseHash }],
  ])('refuses replay from a %s checkpoint', async (_label, runtime) => {
    const { service, signer, tx } = replayClaimHarness();

    await expect(
      service.claimReplayResultCommand('device-1', runtime, { commandProtocolVersion: 2 }),
    ).resolves.toBeNull();

    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('stops replay-result delivery at the original broker session ceiling', async () => {
    const action = lateEvidenceAction({ dispatchCount: 3 });
    const { prisma, service, signer, tx } = replayClaimHarness({ action });

    await expect(
      service.claimReplayResultCommand('device-1', terminalRuntime(), {
        commandProtocolVersion: 2,
      }),
    ).resolves.toBeNull();

    expect(prisma.msaidiziHostAction.findMany).toHaveBeenCalledTimes(1);
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('blocks newer execution while capped late mutation evidence remains unresolved', async () => {
    const action = lateEvidenceAction({ dispatchCount: 3 });
    const { prisma, rawService, signer } = replayClaimHarness({
      action,
      pendingEvidenceCount: 1,
    });
    const runtime = {
      ...terminalRuntime(),
      executionEnabled: true,
      killSwitchEngaged: false,
      manifestMatches: true,
    };
    const device = {
      id: 'device-1',
      capabilityManifest: { commandProtocolVersion: 2, runtime },
    };
    const broker = rawService as unknown as PrivatePollDeviceApi;
    jest.spyOn(broker, 'authenticateDevice').mockResolvedValue(device);
    jest.spyOn(broker, 'expireDeviceLeases').mockResolvedValue(undefined);
    jest.spyOn(broker, 'cancelUndispatchedActions').mockResolvedValue(undefined);
    jest.spyOn(broker, 'cancelCommands').mockResolvedValue([]);
    const execute = jest.spyOn(broker, 'claimExecuteCommand').mockResolvedValue(null);

    await expect(
      broker.poll({ deviceId: 'device-1', maxCommands: 1 }, {} as Request),
    ).resolves.toMatchObject({ commands: [{ kind: 'ping' }] });

    expect(prisma.msaidiziHostAction.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deviceId: 'device-1',
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          journalAccepted: false,
          lateEvidenceAcceptedAt: null,
          step: { mutation: true },
        }),
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('fails closed on reconnect after lease expiry when the mutation has no local journal record', async () => {
    const action = lateEvidenceAction({
      acknowledgedDispatchCount: 0,
      acknowledgedAt: null,
      journalSequence: null,
      journalHash: null,
    });
    const { prisma, rawService, signer, tx } = replayClaimHarness({
      action,
      pendingEvidenceCount: 1,
    });
    const runtime = {
      executionEnabled: true,
      killSwitchEngaged: false,
      manifestMatches: true,
      centralLedgerConnected: true,
      runningActionCount: 0,
      journalSequence: action.journalExpectedPreviousSequence,
      journalHeadHash: action.journalPreviousHash,
      receivedAt: new Date().toISOString(),
    };
    const broker = rawService as unknown as PrivatePollDeviceApi;
    jest.spyOn(broker, 'authenticateDevice').mockResolvedValue({
      id: action.deviceId,
      capabilityManifest: { commandProtocolVersion: 2, runtime },
    });
    const expiry = jest.spyOn(broker, 'expireDeviceLeases').mockResolvedValue(undefined);
    jest.spyOn(broker, 'cancelUndispatchedActions').mockResolvedValue(undefined);
    jest.spyOn(broker, 'cancelCommands').mockResolvedValue([]);
    const execute = jest.spyOn(broker, 'claimExecuteCommand').mockResolvedValue(null);

    await expect(
      broker.poll({ deviceId: action.deviceId, maxCommands: 1 }, {} as Request),
    ).resolves.toMatchObject({ commands: [{ kind: 'ping' }] });

    expect(expiry).toHaveBeenCalledWith(action.deviceId);
    expect(prisma.msaidiziHostAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          journalAccepted: false,
          lateEvidenceAcceptedAt: null,
        }),
      }),
    );
    expect(prisma.msaidiziHostAction.count).toHaveBeenCalledTimes(1);
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.create).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('device heartbeat generation ordering', () => {
  it('acks a delayed duplicate snapshot without freshening its pre-dispatch zero', async () => {
    const sentAt = '2026-08-25T10:00:00.000Z';
    const liveDevice = {
      id: 'device-1',
      status: 'ACTIVE',
      capabilityManifest: {
        manifestSha256: 'e'.repeat(64),
        runtime: {
          sentAt,
          receivedAt: '2026-08-25T10:00:01.000Z',
          runningActionCount: 0,
          journalSequence: 11,
          journalHeadHash: baseHash,
        },
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue(liveDevice),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const rawService = new MsaidiziDevicesService(
      prisma as never,
      { leaseTtlSeconds: 30 } as never,
      {} as never,
      auditHarness() as never,
    );
    const service = rawService as unknown as PrivateDeviceApi & {
      authenticateDevice(request: Request, deviceId: string): Promise<typeof liveDevice>;
    };
    jest.spyOn(service, 'authenticateDevice').mockResolvedValue(liveDevice);

    await expect(
      service.heartbeat(
        {
          deviceId: 'device-1',
          component: 'service',
          componentVersion: '1.0.0',
          executionEnabled: true,
          killSwitchEngaged: false,
          centralLedgerConnected: true,
          runningActionCount: 0,
          journalSequence: 11,
          journalHeadHash: baseHash,
          capabilityManifestSha256: 'e'.repeat(64),
          sentAt,
        },
        {} as Request,
      ),
    ).resolves.toMatchObject({ accepted: true, ignored: true });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziDevice.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });

  it('records a fresh device heartbeat without renewing any unproven action lease', async () => {
    const liveDevice = {
      id: 'device-1',
      status: 'ACTIVE',
      capabilityManifest: {
        manifestSha256: 'e'.repeat(64),
        runtime: {
          sentAt: '2026-08-25T09:59:00.000Z',
          receivedAt: '2026-08-25T09:59:01.000Z',
          runningActionCount: 0,
          journalSequence: 11,
          journalHeadHash: baseHash,
        },
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue(liveDevice),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const rawService = new MsaidiziDevicesService(
      prisma as never,
      { leaseTtlSeconds: 30 } as never,
      {} as never,
      auditHarness() as never,
    );
    const service = rawService as unknown as PrivateDeviceApi & {
      authenticateDevice(request: Request, deviceId: string): Promise<typeof liveDevice>;
    };
    jest.spyOn(service, 'authenticateDevice').mockResolvedValue(liveDevice);

    await expect(
      service.heartbeat(
        {
          deviceId: 'device-1',
          component: 'service',
          componentVersion: '1.0.0',
          executionEnabled: true,
          killSwitchEngaged: false,
          centralLedgerConnected: true,
          runningActionCount: 0,
          journalSequence: 11,
          journalHeadHash: baseHash,
          capabilityManifestSha256: 'e'.repeat(64),
          sentAt: '2026-08-25T10:00:00.000Z',
        },
        {} as Request,
      ),
    ).resolves.toMatchObject({ accepted: true, ignored: false });

    expect(tx.msaidiziDevice.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });
});

describe('lease expiry fencing', () => {
  it('settles actions only when the exact expiry/fence CAS wins', async () => {
    const lease = {
      id: 'lease-action-1',
      fencingToken: 7n,
      expiresAt: new Date('2026-08-25T09:00:00.000Z'),
      hostActions: [
        {
          id: 'host-action-1',
          status: MsaidiziHostActionStatus.DISPATCHED,
          step: { mutation: true },
        },
      ],
    };
    const prisma = {
      msaidiziDeviceLease: {
        findMany: jest.fn().mockResolvedValue([lease]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const rawService = new MsaidiziDevicesService(
      prisma as never,
      {} as never,
      {} as never,
      auditHarness() as never,
    );
    const service = rawService as unknown as PrivateDeviceApi;
    const settle = jest.spyOn(service, 'settleInterruptedAction').mockResolvedValue(undefined);

    await service.expireDeviceLeases('device-1');

    expect(prisma.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: lease.id,
          fencingToken: 7n,
          status: 'ACTIVE',
          expiresAt: { lte: expect.any(Date) },
        }),
      }),
    );
    expect(settle).not.toHaveBeenCalled();

    prisma.msaidiziDeviceLease.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.expireDeviceLeases('device-1');
    expect(settle).toHaveBeenCalledWith(
      'host-action-1',
      'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN',
      true,
      false,
    );
  });
});

describe('generation-bound device progress', () => {
  function progressHarness() {
    const action = dispatchedAction();
    action.dispatchCount = 2;
    action.journalPreviousHash = baseHash;
    const tx = {
      msaidiziHostAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const rawService = new MsaidiziDevicesService(
      prisma as never,
      { leaseTtlSeconds: 30 } as never,
      {} as never,
      auditHarness() as never,
    );
    const service = rawService as unknown as PrivateDeviceApi & {
      requireActionForPeer(actionId: string, request: Request): Promise<typeof action>;
    };
    jest.spyOn(service, 'requireActionForPeer').mockResolvedValue(action);
    return { action, service, tx };
  }

  function progress(dispatchCount: number): ActionProgressDto {
    return {
      actionId: 'action-1',
      taskId: 'task-1',
      stepId: 'step-1',
      leaseId: 'lease-action-1',
      fencingToken: '7',
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      dispatchCount,
      state: 'Accepted',
      percent: 0,
      messageCode: 'COMMAND_ACCEPTED',
      occurredAt: '2026-08-25T10:00:00.000Z',
    };
  }

  function startedProgress(overrides: Partial<ActionProgressDto> = {}): ActionProgressDto {
    return {
      ...progress(2),
      state: 'Started',
      messageCode: 'action_started',
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash,
      journalPrepareEntryHash: 'c'.repeat(64),
      ...overrides,
    };
  }

  it('rejects stale progress and persists only the exact signed dispatch generation', async () => {
    const { service, tx } = progressHarness();

    await expect(service.progress(progress(1), {} as Request)).rejects.toThrow(
      'stale dispatch generation',
    );
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();

    await expect(service.progress(progress(2), {} as Request)).resolves.toEqual({ accepted: true });
    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dispatchCount: 2 }),
        data: expect.objectContaining({
          status: MsaidiziHostActionStatus.RUNNING,
          acknowledgedDispatchCount: 2,
          acknowledgedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects a receipt from a different lease fence before acknowledging the action', async () => {
    const { service, tx } = progressHarness();

    await expect(
      service.progress({ ...progress(2), fencingToken: '8' }, {} as Request),
    ).rejects.toThrow('does not match the signed lease generation');
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });

  it('CAS-persists and echoes the exact Prepared binding before accepting Started', async () => {
    const { service, tx } = progressHarness();

    await expect(service.progress(startedProgress(), {} as Request)).resolves.toEqual({
      accepted: true,
      actionId: 'action-1',
      dispatchCount: 2,
      journalPrepareSequence: 12,
      journalPreparePreviousHash: baseHash.toUpperCase(),
      journalPrepareEntryHash: 'C'.repeat(64),
    });

    expect(tx.msaidiziHostAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'host-action-1',
          dispatchCount: 2,
          journalExpectedPreviousSequence: 11,
          journalPreviousHash: baseHash,
          OR: expect.arrayContaining([
            expect.objectContaining({ journalPrepareSequence: null }),
            expect.objectContaining({
              journalPrepareSequence: 12,
              journalPreparePreviousHash: baseHash.toUpperCase(),
              journalPrepareHash: 'C'.repeat(64),
            }),
          ]),
        }),
        data: expect.objectContaining({
          journalPrepareSequence: 12,
          journalPreparePreviousHash: baseHash.toUpperCase(),
          journalPrepareHash: 'C'.repeat(64),
        }),
      }),
    );
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'host_action.progress',
          payload: expect.objectContaining({
            journalPrepareSequence: 12,
            journalPreparePreviousHash: baseHash.toUpperCase(),
            journalPrepareEntryHash: 'C'.repeat(64),
          }),
        }),
      }),
    );
  });

  it.each([
    ['missing tuple', { journalPrepareSequence: undefined }],
    ['wrong predecessor', { journalPreparePreviousHash: 'd'.repeat(64) }],
    ['wrong sequence', { journalPrepareSequence: 13 }],
    ['degenerate hash', { journalPrepareEntryHash: baseHash }],
  ])('rejects Started with a %s without durable acknowledgement', async (_name, overrides) => {
    const { service, tx } = progressHarness();

    await expect(service.progress(startedProgress(overrides), {} as Request)).rejects.toThrow(
      'does not bind the expected Prepared record',
    );
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });

  it('idempotently echoes the same Prepared binding after a lost-response retry', async () => {
    const { action, service } = progressHarness();
    const first = await service.progress(startedProgress(), {} as Request);
    action.status = MsaidiziHostActionStatus.RUNNING;
    action.startedAt = new Date();
    action.journalPrepareSequence = 12;
    action.journalPreparePreviousHash = baseHash.toUpperCase();
    action.journalPrepareHash = 'C'.repeat(64);

    await expect(service.progress(startedProgress(), {} as Request)).resolves.toEqual(first);
  });

  it('rejects a conflicting Prepared binding already accepted for the action', async () => {
    const { action, service, tx } = progressHarness();
    action.journalPrepareSequence = 12;
    action.journalPreparePreviousHash = baseHash.toUpperCase();
    action.journalPrepareHash = 'E'.repeat(64);

    await expect(service.progress(startedProgress(), {} as Request)).rejects.toThrow(
      'conflicts with the accepted Prepared record',
    );
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back progress when the exact active unexpired lease fence cannot be renewed', async () => {
    const { service, tx } = progressHarness();
    tx.msaidiziDeviceLease.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.progress(progress(2), {} as Request)).rejects.toThrow(
      'lease expired or its fencing generation changed',
    );
    expect(tx.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'lease-action-1',
          fencingToken: 7n,
          status: 'ACTIVE',
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it('renews the live lease only up to the immutable signed authorization deadline', async () => {
    const { action, service, tx } = progressHarness();
    const authorizationDeadline = new Date(Date.now() + 15_000);
    action.leaseAuthorizationExpiresAt = authorizationDeadline;

    await service.progress(
      { ...progress(2), leaseExpiresAt: authorizationDeadline.toISOString() },
      {} as Request,
    );

    expect(tx.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: authorizationDeadline }),
      }),
    );
  });

  it('rejects progress after the signed authorization deadline', async () => {
    const { action, service, tx } = progressHarness();
    const expired = new Date(Date.now() - 1_000);
    action.leaseAuthorizationExpiresAt = expired;

    await expect(
      service.progress({ ...progress(2), leaseExpiresAt: expired.toISOString() }, {} as Request),
    ).rejects.toThrow('does not match the signed lease generation');
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });

  it('never acknowledges an old execute token after lease expiry marked the mutation UNKNOWN', async () => {
    const { action, service, tx } = progressHarness();
    action.status = MsaidiziHostActionStatus.UNKNOWN;
    action.step = { ...action.step, mutation: true };
    action.uncertainOutcome = true;
    action.errorCode = 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN';
    action.resultSummary = {
      crossedDeviceBoundary: true,
      receiptDigest: null,
    };

    await expect(service.progress(progress(2), {} as Request)).rejects.toThrow(
      'no longer active for execution',
    );
    expect(tx.msaidiziHostAction.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
  });
});
