import { ConflictException } from '@nestjs/common';
import { MsaidiziDeviceStatus, MsaidiziHostActionStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { directMtlsPeer } from './direct-mtls-peer';
import { ActionResultDto } from './dto/msaidizi-device.dto';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

jest.mock('./direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = 'action-late-evidence-1';
const ACTION_ROW_ID = 'host-action-late-evidence-1';
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = 'step-late-evidence-1';
const LEASE_ID = 'lease-late-evidence-1';
const FENCING_TOKEN = 42n;
const PUBLIC_KEY = 'test-device-public-key';
const CERTIFICATE_SHA256 = 'A'.repeat(64);
const PUBLIC_KEY_SHA256 = createHash('sha256').update(PUBLIC_KEY).digest('hex').toUpperCase();

interface ResultEntryPointSeam {
  settleResult(actionId: string, dto: ActionResultDto): Promise<unknown>;
}

interface EntryPointAction {
  id: string;
  actionId: string;
  taskId: string;
  stepId: string;
  deviceId: string;
  status: MsaidiziHostActionStatus;
  leaseId: string;
  leaseFencingToken: bigint;
  leaseAuthorizationExpiresAt: Date;
  lease: { id: string; fencingToken: bigint };
  uncertainOutcome: boolean;
  errorCode: string | null;
  resultSummary: Record<string, unknown>;
}

function lateEvidenceDto(expiredAt: Date): ActionResultDto {
  return {
    actionId: ACTION_ID,
    taskId: TASK_ID,
    stepId: STEP_ID,
    leaseId: LEASE_ID,
    fencingToken: FENCING_TOKEN.toString(),
    leaseExpiresAt: expiredAt.toISOString(),
    actionTokenSha256: 'B'.repeat(64),
    outcome: 'NeedsAttention',
    outputJson: null,
    outputSha256: null,
    mutationCommitted: false,
    outcomeUncertain: true,
    isIdempotentReplay: true,
    errorCode: 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN',
    provenance: [],
    journalPrepareSequence: 101,
    journalPrepareEntryHash: 'C'.repeat(64),
    journalPreparePreviousHash: 'D'.repeat(64),
    journalRecoveryPreparedSequence: 102,
    journalRecoveryPreparedEntryHash: 'E'.repeat(64),
    journalRecoveryPreparedPreviousHash: 'C'.repeat(64),
    journalSequence: 103,
    journalEntryHash: 'F'.repeat(64),
    journalPreviousHash: 'E'.repeat(64),
    preStateSha256: '1'.repeat(64),
    recoveryProvenanceSha256: '2'.repeat(64),
    recoveryHandleSha256: '3'.repeat(64),
    localBytesRead: 0,
    localBytesWritten: 0,
    externalEgressBytes: 0,
    brokerExternalEgressBytes: 0,
    brokerMaxDeliverySessions: 3,
    brokerMaxRequestAttemptsPerSession: 3,
    brokerSerializedResultUpperBoundBytes: 65_536,
    uncertainExternalEgressBytes: 0,
    egressEvidence: null,
  };
}

function eligibleInterruptedAction(expiredAt: Date): EntryPointAction {
  return {
    id: ACTION_ROW_ID,
    actionId: ACTION_ID,
    taskId: TASK_ID,
    stepId: STEP_ID,
    deviceId: DEVICE_ID,
    status: MsaidiziHostActionStatus.UNKNOWN,
    leaseId: LEASE_ID,
    leaseFencingToken: FENCING_TOKEN,
    leaseAuthorizationExpiresAt: expiredAt,
    lease: { id: LEASE_ID, fencingToken: FENCING_TOKEN },
    uncertainOutcome: true,
    errorCode: 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN',
    resultSummary: { crossedDeviceBoundary: true },
  };
}

function harness(action: EntryPointAction) {
  const deviceFindUnique = jest.fn().mockResolvedValue({
    id: DEVICE_ID,
    status: MsaidiziDeviceStatus.ACTIVE,
    certificateThumbprint: CERTIFICATE_SHA256,
    publicKey: PUBLIC_KEY,
  });
  const actionFindUnique = jest.fn().mockResolvedValue(action);
  const service = new MsaidiziDevicesService(
    {
      msaidiziDevice: { findUnique: deviceFindUnique },
      msaidiziHostAction: { findUnique: actionFindUnique },
    } as never,
    { channelEnabled: true } as never,
    {} as never,
    {} as never,
  );
  const settleResult = jest.fn().mockResolvedValue({
    accepted: true,
    replay: false,
    status: MsaidiziHostActionStatus.UNKNOWN,
  });
  (service as unknown as ResultEntryPointSeam).settleResult = settleResult;
  return { service, settleResult, deviceFindUnique, actionFindUnique };
}

describe('Msaidizi device late-evidence result entry point', () => {
  const request = {} as Request;
  const expiredAt = new Date('2020-01-02T03:04:05.000Z');

  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue({
      certificateSha256: CERTIFICATE_SHA256,
      publicKeyPem: PUBLIC_KEY,
      publicKeySha256: PUBLIC_KEY_SHA256,
      validFrom: new Date('2019-01-01T00:00:00.000Z'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      chainAuthorized: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('admits the exact expired lease only for eligible UNKNOWN lease-expiry recovery evidence', async () => {
    const action = eligibleInterruptedAction(expiredAt);
    const dto = lateEvidenceDto(expiredAt);
    const { service, settleResult, deviceFindUnique, actionFindUnique } = harness(action);

    await expect(service.result(dto, request)).resolves.toEqual({
      accepted: true,
      replay: false,
      status: MsaidiziHostActionStatus.UNKNOWN,
    });

    expect(directMtlsPeer).toHaveBeenCalledWith(request);
    expect(deviceFindUnique).toHaveBeenCalledWith({
      where: { certificateThumbprint: CERTIFICATE_SHA256 },
    });
    expect(actionFindUnique).toHaveBeenCalledWith({
      where: { actionId: ACTION_ID },
      include: { lease: true },
    });
    expect(settleResult).toHaveBeenCalledTimes(1);
    expect(settleResult).toHaveBeenCalledWith(ACTION_ROW_ID, dto);
  });

  it.each([
    [
      'active action',
      {
        status: MsaidiziHostActionStatus.DISPATCHED,
        uncertainOutcome: false,
        errorCode: null,
        resultSummary: {},
      },
    ],
    ['non-uncertain UNKNOWN action', { uncertainOutcome: false }],
    ['different interruption reason', { errorCode: 'DEVICE_DISCONNECTED_WRITE_OUTCOME_UNKNOWN' }],
    [
      'action that never crossed the device boundary',
      { resultSummary: { crossedDeviceBoundary: false } },
    ],
    [
      'action that already accepted a receipt',
      { resultSummary: { crossedDeviceBoundary: true, receiptDigest: '4'.repeat(64) } },
    ],
  ])('rejects an expired receipt for a %s', async (_label, override) => {
    const action = { ...eligibleInterruptedAction(expiredAt), ...override };
    const { service, settleResult } = harness(action);

    await expect(service.result(lateEvidenceDto(expiredAt), request)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(settleResult).not.toHaveBeenCalled();
  });

  it.each([
    ['lease id', { leaseId: 'lease-wrong-generation' }],
    ['fencing token', { fencingToken: '43' }],
    ['signed expiry', { leaseExpiresAt: '2020-01-02T03:04:06.000Z' }],
  ])('rejects late evidence with a mismatched %s binding', async (_label, override) => {
    const action = eligibleInterruptedAction(expiredAt);
    const dto = { ...lateEvidenceDto(expiredAt), ...override } as ActionResultDto;
    const { service, settleResult } = harness(action);

    await expect(service.result(dto, request)).rejects.toBeInstanceOf(ConflictException);
    expect(settleResult).not.toHaveBeenCalled();
  });
});
