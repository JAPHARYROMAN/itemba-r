import { createHash } from 'node:crypto';
import { ActionResultDto } from './dto/msaidizi-device.dto';
import { resultReceiptDigest } from './msaidizi-devices.service';

const legacyOutput = JSON.stringify({ amount: 12.5, ok: true });

const legacyReceipt: ActionResultDto = {
  actionId: 'action-golden-v1',
  taskId: 'task-golden-v1',
  stepId: 'step-golden-v1',
  leaseId: 'lease-golden-v1',
  fencingToken: '41',
  leaseExpiresAt: '2026-08-26T12:34:56.000Z',
  actionTokenSha256: 'A'.repeat(64),
  outcome: 'Completed',
  outputJson: legacyOutput,
  outputSha256: createHash('sha256').update(legacyOutput).digest('hex'),
  mutationCommitted: true,
  outcomeUncertain: false,
  isIdempotentReplay: false,
  errorCode: null,
  provenance: [
    {
      sourceType: 'WindowsRegistry',
      sourceIdentifierHash: 'B'.repeat(64),
      contentSha256: 'C'.repeat(64),
      trust: 'TrustedSystem',
      observedAt: '2026-08-26T12:34:50.000Z',
    },
  ],
  journalPrepareSequence: 101,
  journalPrepareEntryHash: 'D'.repeat(64),
  journalPreparePreviousHash: 'E'.repeat(64),
  journalSequence: 102,
  journalEntryHash: 'F'.repeat(64),
  journalPreviousHash: 'D'.repeat(64),
  preStateSha256: '1'.repeat(64),
  recoveryProvenanceSha256: '2'.repeat(64),
  recoveryHandleSha256: '3'.repeat(64),
  localBytesRead: 17,
  localBytesWritten: 29,
  externalEgressBytes: 0,
  brokerExternalEgressBytes: 900,
  brokerMaxDeliverySessions: 3,
  brokerMaxRequestAttemptsPerSession: 3,
  brokerSerializedResultUpperBoundBytes: 100,
  uncertainExternalEgressBytes: 0,
};

describe('host action result receipt digest compatibility', () => {
  it('keeps the pre-RecoveryPrepared receipt identity frozen', () => {
    expect(resultReceiptDigest(legacyReceipt, 'Completed')).toBe(
      'F7E26E88E4BF58586C417D703C7BD647A5B740FD377D6B7A45502A1309BE218A',
    );
  });

  it('treats explicit null RecoveryPrepared fields like an old omitted receipt', () => {
    expect(
      resultReceiptDigest(
        {
          ...legacyReceipt,
          journalRecoveryPreparedSequence: null,
          journalRecoveryPreparedEntryHash: null,
          journalRecoveryPreparedPreviousHash: null,
        },
        'Completed',
      ),
    ).toBe('F7E26E88E4BF58586C417D703C7BD647A5B740FD377D6B7A45502A1309BE218A');
  });
});
