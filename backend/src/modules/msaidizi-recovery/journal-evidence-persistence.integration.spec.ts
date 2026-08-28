import {
  MsaidiziDeviceStatus,
  MsaidiziEffect,
  MsaidiziHostActionStatus,
  MsaidiziTaskStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ActionResultDto } from '../msaidizi-devices/dto/msaidizi-device.dto';
import { MsaidiziDevicesService } from '../msaidizi-devices/msaidizi-devices.service';
import { MsaidiziRecoveryService } from './msaidizi-recovery.service';

interface DeviceSettlementApi {
  settleResult(
    actionId: string,
    dto: ActionResultDto,
  ): Promise<{ accepted: boolean; status: MsaidiziHostActionStatus }>;
}

const taskId = '11111111-1111-4111-8111-111111111111';
const stepId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const hostActionId = '44444444-4444-4444-8444-444444444444';
const actionId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';
const preparePreviousHash = 'a'.repeat(64);
const prepareHash = 'b'.repeat(64);
const recoveryPreparedHash = 'c'.repeat(64);
const terminalHash = 'd'.repeat(64);
const preStateSha256 = 'e'.repeat(64);
const recoveryRecordSha256 = 'f'.repeat(64);
const recoveryHandleSha256 = '9'.repeat(64);

describe('journal evidence durable persistence -> trusted recovery', () => {
  it('retains the exact six receipt hashes needed by recovery validation', async () => {
    const action = unsettledRecoveryAction();
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const deviceTx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      msaidiziHostAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskStep: {
        findUnique: jest.fn().mockResolvedValue({
          id: stepId,
          taskId,
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
    };
    const devicePrisma = {
      msaidiziHostAction: { findUnique: jest.fn().mockResolvedValue(action) },
      $transaction: jest.fn((work: (client: typeof deviceTx) => unknown) => work(deviceTx)),
    };
    const audit = { logStrictInTransaction: jest.fn().mockResolvedValue({}) };
    const devices = new MsaidiziDevicesService(
      devicePrisma as never,
      {} as never,
      {} as never,
      audit as never,
    ) as unknown as DeviceSettlementApi;

    await expect(
      devices.settleResult(hostActionId, recoveryPreparedResult()),
    ).resolves.toMatchObject({
      accepted: true,
      status: MsaidiziHostActionStatus.UNKNOWN,
    });

    const settlementWrite = deviceTx.msaidiziHostAction.updateMany.mock.calls
      .map(([input]) => input)
      .find((input) => input.data.resultSummary !== undefined);
    const evidenceLinkWrite = deviceTx.msaidiziHostAction.updateMany.mock.calls
      .map(([input]) => input)
      .find((input) => input.data.journalEvidenceEventCursor !== undefined);
    const eventWrite = deviceTx.msaidiziTaskEvent.create.mock.calls[0][0].data;
    expect(settlementWrite).toBeDefined();
    expect(evidenceLinkWrite).toBeDefined();

    const expectedReceiptLinks = {
      journalPrepareEntryHash: prepareHash,
      journalPreparePreviousHash: preparePreviousHash,
      journalRecoveryPreparedEntryHash: recoveryPreparedHash,
      journalRecoveryPreparedPreviousHash: prepareHash,
      journalEntryHash: terminalHash,
      journalPreviousHash: recoveryPreparedHash,
    };
    expect(settlementWrite.data.resultSummary).toMatchObject(
      Object.fromEntries(
        Object.entries(expectedReceiptLinks).map(([key, value]) => [key, value.toUpperCase()]),
      ),
    );
    expect(eventWrite.payload).toMatchObject(expectedReceiptLinks);
    expect(evidenceLinkWrite.data).toMatchObject({
      recoveryRecordSha256,
      expectedRestoredStateSha256: preStateSha256,
    });
    const expectedRecoveryProjection = {
      receiptDigest: settlementWrite.data.resultSummary.receiptDigest,
      outcome: 'NeedsAttention',
      outcomeUncertain: true,
      mutationCommitted: false,
      preStateSha256: preStateSha256.toUpperCase(),
      recoveryProvenanceSha256: recoveryRecordSha256.toUpperCase(),
      recoveryHandleSha256: recoveryHandleSha256.toUpperCase(),
      journalPrepareSequence: 12,
      journalRecoveryPreparedSequence: 13,
      journalSequence: 14,
    };
    expect(settlementWrite.data.resultSummary).toMatchObject(expectedRecoveryProjection);
    expect(eventWrite.payload).toMatchObject({
      ...expectedRecoveryProjection,
      preStateSha256,
      recoveryProvenanceSha256: recoveryRecordSha256,
      recoveryHandleSha256,
    });
    expect(evidenceLinkWrite.data.journalReceiptDigest).toBe(
      settlementWrite.data.resultSummary.receiptDigest,
    );

    const persistedAction = {
      ...action,
      ...settlementWrite.data,
      ...evidenceLinkWrite.data,
      task: action.task,
      device: { id: deviceId, status: MsaidiziDeviceStatus.ACTIVE },
    };
    const persistedEvidenceEvent = {
      cursor: 42n,
      taskId,
      type: eventWrite.type,
      actorType: eventWrite.actorType,
      actorId: eventWrite.actorId,
      payload: eventWrite.payload,
      integrityVersion: 1,
      previousHash: '7'.repeat(64),
      eventHash: '8'.repeat(64),
    };
    expect(persistedAction).toMatchObject({
      status: MsaidiziHostActionStatus.UNKNOWN,
      journalAccepted: true,
      journalExpectedPreviousSequence: 11,
      journalPrepareSequence: 12,
      journalPreparePreviousHash: preparePreviousHash.toUpperCase(),
      journalPrepareHash: prepareHash.toUpperCase(),
      journalRecoveryPreparedSequence: 13,
      journalRecoveryPreparedPreviousHash: prepareHash.toUpperCase(),
      journalRecoveryPreparedHash: recoveryPreparedHash.toUpperCase(),
      journalSequence: 14,
      journalPreviousHash: recoveryPreparedHash.toUpperCase(),
      journalHash: terminalHash.toUpperCase(),
      journalReceiptDigest: settlementWrite.data.resultSummary.receiptDigest,
      journalEvidenceEventCursor: 42n,
      journalEvidenceAcceptedAt: expect.any(Date),
      recoveryRecordSha256,
      expectedRestoredStateSha256: preStateSha256,
    });
    const recoveryTx = {
      msaidiziRecoveryCommand: {
        upsert: jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' })),
      },
    };
    const recoveryPrisma = {
      msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(persistedAction) },
      msaidiziTaskEvent: {
        findFirst: jest.fn().mockResolvedValue(persistedEvidenceEvent),
      },
      msaidiziRecoveryCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof recoveryTx) => unknown) => work(recoveryTx)),
    };
    const recoverySigner = {
      assertReady: jest.fn(),
      issue: jest.fn().mockReturnValue({
        manifestJson: '{}',
        manifestSha256: '1'.repeat(64),
        signature: 'test-signature',
        signingKeyId: 'test-recovery-root',
      }),
    };
    const recovery = new MsaidiziRecoveryService(
      recoveryPrisma as never,
      recoverySigner as never,
      audit as never,
    );

    await expect(
      recovery.request(
        {
          hostActionId,
          expectedCurrentStateSha256: terminalHash,
          confirmationPhrase: `RESTORE ${actionId} AT ${terminalHash}`,
        },
        operator(),
      ),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    expect(recoverySigner.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        originalActionId: actionId,
        recoveryRecordSha256,
        expectedCurrentStateSha256: terminalHash,
        expectedRestoredStateSha256: preStateSha256,
        schemaVersion: 2,
      }),
    );
  });
});

function unsettledRecoveryAction() {
  const task = {
    id: taskId,
    status: MsaidiziTaskStatus.RUNNING,
    principalId: 'global-principal',
    mandateId: 'mandate-1',
    companyId: 'company-1',
    initiatedByUserId: userId,
    maxLocalBytes: 10_000n,
    bytesRead: 0n,
    bytesWritten: 0n,
    reservedExternalEgressBytes: 8_000_000n,
    externalEgressBytes: 0n,
  };
  return {
    id: hostActionId,
    actionId,
    taskId,
    stepId,
    deviceId,
    leaseId: 'lease-1',
    leaseFencingToken: 7n,
    leaseAuthorizationExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    actionTokenDigest: '2'.repeat(64),
    dispatches: [
      {
        executionMode: 'EXECUTE',
        actionTokenDigest: '2'.repeat(64),
        dispatchCount: 1,
      },
    ],
    idempotencyKey: `host:${stepId}`,
    status: MsaidiziHostActionStatus.DISPATCHED,
    capability: 'windows.service.start-mode.set',
    capabilityVersion: '2.0.0',
    effect: MsaidiziEffect.WRITE,
    dataClass: 'internal',
    consent: 'SignedMandate',
    argsDigest: '3'.repeat(64),
    expectedPreState: { sha256: preStateSha256 },
    budgetSnapshot: {
      maxWallTimeSeconds: 7_000,
      maxModelTurns: 190,
      maxAttemptedToolCalls: 490,
      maxMutations: 99,
      maxLocalBytes: 8_000,
      maxExternalEgressBytes: 8_000_000,
      maxModelSpendUsd: 19,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 222_222,
    },
    reservedExternalEgressBytes: 8_000_000n,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    dispatchCount: 1,
    acknowledgedDispatchCount: 0,
    acknowledgedAt: null,
    journalExpectedPreviousSequence: 11,
    journalPrepareSequence: null,
    journalPreparePreviousHash: null,
    journalPrepareHash: null,
    journalRecoveryPreparedSequence: null,
    journalRecoveryPreparedPreviousHash: null,
    journalRecoveryPreparedHash: null,
    journalSequence: null,
    journalPreviousHash: null,
    journalHash: null,
    journalAccepted: false,
    journalReceiptDigest: null,
    journalEvidenceEventCursor: null,
    journalEvidenceAcceptedAt: null,
    lateEvidenceAcceptedAt: null,
    recoveryRecordSha256: null,
    expectedRestoredStateSha256: null,
    capabilityExternalEgressBytes: 0n,
    brokerExternalEgressBytes: 0n,
    uncertainExternalEgressBytes: 0n,
    resultSummary: null,
    startedAt: null,
    task,
    step: {
      id: stepId,
      taskId,
      planVersionId: 'plan-1',
      mutation: true,
      arguments: {},
      planVersion: { id: 'plan-1', version: 1, inputs: {} },
    },
    lease: {
      id: 'lease-1',
      fencingToken: 7n,
      status: 'ACTIVE',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
    device: {
      capabilityManifest: {
        runtime: {
          journalSequence: 11,
          journalHeadHash: preparePreviousHash,
        },
      },
    },
  };
}

function recoveryPreparedResult(): ActionResultDto {
  return {
    actionId,
    taskId,
    stepId,
    leaseId: 'lease-1',
    fencingToken: '7',
    leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    actionTokenSha256: '2'.repeat(64),
    outcome: 'NeedsAttention',
    outputJson: null,
    outputSha256: null,
    mutationCommitted: false,
    outcomeUncertain: true,
    isIdempotentReplay: false,
    errorCode: null,
    provenance: [],
    journalPrepareSequence: 12,
    journalPrepareEntryHash: prepareHash,
    journalPreparePreviousHash: preparePreviousHash,
    journalRecoveryPreparedSequence: 13,
    journalRecoveryPreparedEntryHash: recoveryPreparedHash,
    journalRecoveryPreparedPreviousHash: prepareHash,
    journalSequence: 14,
    journalEntryHash: terminalHash,
    journalPreviousHash: recoveryPreparedHash,
    preStateSha256,
    recoveryProvenanceSha256: recoveryRecordSha256,
    recoveryHandleSha256,
    localBytesRead: 0,
    localBytesWritten: 0,
    externalEgressBytes: 0,
    brokerExternalEgressBytes: 1_999_998,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 222_222,
    uncertainExternalEgressBytes: 0,
  };
}

function operator(): AuthUser {
  return {
    id: userId,
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
    roleScopes: ['COMPANY'],
  } as AuthUser;
}
