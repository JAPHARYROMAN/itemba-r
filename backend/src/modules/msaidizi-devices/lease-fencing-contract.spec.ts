import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ActionProgressDto, ActionResultDto } from './dto/msaidizi-device.dto';

const lease = {
  leaseId: 'lease-action-1',
  fencingToken: '7',
  leaseExpiresAt: '2026-08-25T10:05:00.000Z',
};

describe('device action lease fencing DTOs', () => {
  it('requires the same exact lease fields on progress and terminal results', () => {
    const progress = plainToInstance(ActionProgressDto, {
      actionId: 'action-1',
      taskId: 'task-1',
      stepId: 'step-1',
      ...lease,
      dispatchCount: 1,
      state: 'Started',
      percent: 0,
      messageCode: 'action_started',
      occurredAt: '2026-08-25T10:00:01.000Z',
      journalPrepareSequence: 12,
      journalPreparePreviousHash: 'b'.repeat(64),
      journalPrepareEntryHash: 'c'.repeat(64),
    });
    const result = plainToInstance(ActionResultDto, {
      actionId: 'action-1',
      taskId: 'task-1',
      stepId: 'step-1',
      ...lease,
      actionTokenSha256: 'a'.repeat(64),
      outcome: 'Failed',
      mutationCommitted: false,
      outcomeUncertain: false,
      isIdempotentReplay: false,
      errorCode: 'test_failure',
      provenance: [],
      localBytesRead: 0,
      localBytesWritten: 0,
      externalEgressBytes: 0,
      brokerExternalEgressBytes: 589_824,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 65_536,
      uncertainExternalEgressBytes: 0,
    });

    expect(validateSync(progress)).toEqual([]);
    expect(validateSync(result)).toEqual([]);
  });

  it.each([
    ['missing lease id', { leaseId: undefined }],
    ['malformed lease id', { leaseId: ':lease-action-1' }],
    ['zero fence', { fencingToken: '0' }],
    ['non-canonical fence', { fencingToken: '07' }],
    ['out-of-range fence', { fencingToken: '9223372036854775808' }],
    ['oversized fence', { fencingToken: '1'.repeat(20) }],
    ['non-ISO expiry', { leaseExpiresAt: 'tomorrow' }],
  ])('rejects %s at the transport boundary', (_label, override) => {
    const progress = plainToInstance(ActionProgressDto, {
      actionId: 'action-1',
      taskId: 'task-1',
      stepId: 'step-1',
      ...lease,
      ...override,
      dispatchCount: 1,
      state: 'Started',
      percent: 0,
      messageCode: 'action_started',
      occurredAt: '2026-08-25T10:00:01.000Z',
    });

    expect(validateSync(progress)).not.toEqual([]);
  });
});
