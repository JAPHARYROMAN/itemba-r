import {
  MsaidiziDeviceStatus,
  MsaidiziHostActionStatus,
  MsaidiziRecoveryCommandStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';
import { MsaidiziRecoveryService } from './msaidizi-recovery.service';

jest.mock('../msaidizi-devices/direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const deviceId = '55555555-5555-4555-8555-555555555555';
const recoveryId = '66666666-6666-4666-8666-666666666666';
const hostActionId = '77777777-7777-4777-8777-777777777777';
const originalActionId = '88888888-8888-4888-8888-888888888888';
const user = {
  id: '99999999-9999-4999-8999-999999999999',
  companyId: 'company-1',
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
  roleScopes: ['COMPANY'],
} as AuthUser;
const peer = {
  certificateSha256: 'A'.repeat(64),
  publicKeyPem: 'PUBLIC KEY',
  publicKeySha256: 'B'.repeat(64),
  publicKeySpkiSha256: 'C'.repeat(64),
  validFrom: new Date(0),
  validTo: new Date(Date.now() + 60_000),
  chainAuthorized: true,
};

function auditHarness() {
  return {
    logStrictInTransaction: jest.fn(
      (tx: { auditLog?: { create: (input: unknown) => unknown } }, input) =>
        tx.auditLog?.create({ data: input }),
    ),
  };
}

describe('Msaidizi trusted recovery broker', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue(peer);
  });

  it('requires recent human authorization for the exact original action phrase', async () => {
    const action = hostAction();
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
      } as never,
      { assertReady: jest.fn() } as never,
      auditHarness() as never,
    );

    await expect(
      service.request({ hostActionId, confirmationPhrase: 'RESTORE something-else' }, user),
    ).rejects.toThrow(`RESTORE ${originalActionId}`);
  });

  it('persists one signed command without exposing recovery as a model capability', async () => {
    const action = committedActionWithRecoveryEvidence();
    const upsert = jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' }));
    const tx = {
      msaidiziRecoveryCommand: { upsert },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
      msaidiziTaskEvent: { findFirst: jest.fn().mockResolvedValue(committedRecoveryEvent()) },
      msaidiziRecoveryCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const signer = {
      assertReady: jest.fn(),
      issue: jest.fn().mockReturnValue({
        manifestJson: '{}',
        manifestSha256: 'c'.repeat(64),
        signature: 'signature',
        signingKeyId: 'recovery-root-1',
      }),
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await service.request(
      { hostActionId, confirmationPhrase: `RESTORE ${originalActionId}` },
      user,
    );

    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId,
        originalActionId,
        recoveryRecordSha256: 'd'.repeat(64),
        expectedRestoredStateSha256: 'e'.repeat(64),
        schemaVersion: 2,
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          hostActionId,
          requestedByUserId: user.id,
          originalActionId,
          recoveryRecordSha256: 'd'.repeat(64),
          expectedRestoredStateSha256: 'e'.repeat(64),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('keeps human request, list, and detail access inside the caller company scope', async () => {
    const findAction = jest.fn().mockResolvedValue(null);
    const list = jest.fn().mockResolvedValue([]);
    const detail = jest.fn().mockResolvedValue(null);
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: findAction },
        msaidiziRecoveryCommand: { findMany: list, findFirst: detail },
      } as never,
      { assertReady: jest.fn() } as never,
      auditHarness() as never,
    );

    await expect(
      service.request({ hostActionId, confirmationPhrase: `RESTORE ${originalActionId}` }, user),
    ).rejects.toThrow('Host action not found');
    await service.list({}, user);
    await expect(service.findOne(recoveryId, user)).rejects.toThrow('Recovery command not found');

    expect(findAction).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: hostActionId,
          task: { companyId: { in: ['company-1'] } },
        }),
      }),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hostAction: { task: { companyId: { in: ['company-1'] } } } },
      }),
    );
    expect(detail).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: recoveryId,
          hostAction: { task: { companyId: { in: ['company-1'] } } },
        },
      }),
    );
  });

  it('binds administrative recovery to the operator-supplied current-state digest', async () => {
    const action = committedActionWithRecoveryEvidence({ capability: 'registry.value.set' });
    const tx = {
      msaidiziRecoveryCommand: {
        upsert: jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
      msaidiziTaskEvent: { findFirst: jest.fn().mockResolvedValue(committedRecoveryEvent()) },
      msaidiziRecoveryCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const signer = {
      assertReady: jest.fn(),
      issue: jest.fn().mockReturnValue({
        manifestJson: '{}',
        manifestSha256: 'c'.repeat(64),
        signature: 'signature',
        signingKeyId: 'recovery-root-1',
      }),
    };
    const expected = 'f'.repeat(64);
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await service.request(
      {
        hostActionId,
        expectedCurrentStateSha256: expected,
        confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
      },
      user,
    );

    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCurrentStateSha256: expected,
        expectedRestoredStateSha256: 'e'.repeat(64),
      }),
    );
  });

  it('rejects committed recovery when mutable summary data diverges from typed immutable evidence', async () => {
    const action = committedActionWithRecoveryEvidence({
      resultSummary: {
        ...committedRecoverySummary(),
        recoveryProvenanceSha256: '0'.repeat(64),
      },
    });
    const signer = { assertReady: jest.fn(), issue: jest.fn() };
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
        msaidiziTaskEvent: {
          findFirst: jest.fn().mockResolvedValue(committedRecoveryEvent()),
        },
      } as never,
      signer as never,
      auditHarness() as never,
    );

    await expect(
      service.request({ hostActionId, confirmationPhrase: `RESTORE ${originalActionId}` }, user),
    ).rejects.toThrow('no proved recovery record');
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('permits CAS recovery of an uncertain action only with an accepted recovery checkpoint chain', async () => {
    const action = uncertainActionWithRecoveryEvidence();
    const tx = {
      msaidiziRecoveryCommand: {
        upsert: jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
      msaidiziTaskEvent: { findFirst: jest.fn().mockResolvedValue(recoveryEvidenceEvent()) },
      msaidiziRecoveryCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const signer = {
      assertReady: jest.fn(),
      issue: jest.fn().mockReturnValue({
        manifestJson: '{}',
        manifestSha256: 'c'.repeat(64),
        signature: 'signature',
        signingKeyId: 'recovery-root-1',
      }),
    };
    const expected = 'f'.repeat(64);
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await service.request(
      {
        hostActionId,
        expectedCurrentStateSha256: expected,
        confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
      },
      user,
    );

    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        originalActionId,
        recoveryRecordSha256: 'd'.repeat(64),
        expectedCurrentStateSha256: expected,
        expectedRestoredStateSha256: 'e'.repeat(64),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ uncertainCheckpointRecovery: true }),
        }),
      }),
    );
  });

  it('permits a late committed recovery only from the immutable late-evidence event', async () => {
    const action = lateCommittedActionWithRecoveryEvidence();
    const tx = {
      msaidiziRecoveryCommand: {
        upsert: jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const signer = {
      assertReady: jest.fn(),
      issue: jest.fn().mockReturnValue({
        manifestJson: '{}',
        manifestSha256: 'c'.repeat(64),
        signature: 'signature',
        signingKeyId: 'recovery-root-1',
      }),
    };
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
        msaidiziTaskEvent: {
          findFirst: jest.fn().mockResolvedValue(lateCommittedRecoveryEvent()),
        },
        msaidiziRecoveryCommand: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      signer as never,
      auditHarness() as never,
    );
    const expected = 'f'.repeat(64);

    await service.request(
      {
        hostActionId,
        expectedCurrentStateSha256: expected,
        confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
      },
      user,
    );

    expect(signer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryRecordSha256: 'd'.repeat(64),
        expectedRestoredStateSha256: 'e'.repeat(64),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ lateCommittedCheckpointRecovery: true }),
        }),
      }),
    );
  });

  it('rejects a late committed checkpoint presented through a non-late event type', async () => {
    const signer = { assertReady: jest.fn(), issue: jest.fn() };
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: {
          findFirst: jest.fn().mockResolvedValue(lateCommittedActionWithRecoveryEvidence()),
        },
        msaidiziTaskEvent: { findFirst: jest.fn().mockResolvedValue(committedRecoveryEvent()) },
      } as never,
      signer as never,
      auditHarness() as never,
    );
    const expected = 'f'.repeat(64);

    await expect(
      service.request(
        {
          hostActionId,
          expectedCurrentStateSha256: expected,
          confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
        },
        user,
      ),
    ).rejects.toThrow('no proved recovery record');
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('rejects uncertain recovery without the accepted recovery checkpoint chain', async () => {
    const action = hostAction({
      capability: 'registry.value.set',
      status: MsaidiziHostActionStatus.UNKNOWN,
      journalAccepted: true,
      resultSummary: {
        mutationCommitted: false,
        outcomeUncertain: true,
        outcome: 'NeedsAttention',
        preStateSha256: 'e'.repeat(64),
        recoveryProvenanceSha256: 'd'.repeat(64),
        recoveryHandleSha256: '8'.repeat(64),
      },
    });
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
      } as never,
      { assertReady: jest.fn() } as never,
      auditHarness() as never,
    );
    const expected = 'f'.repeat(64);

    await expect(
      service.request(
        {
          hostActionId,
          expectedCurrentStateSha256: expected,
          confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
        },
        user,
      ),
    ).rejects.toThrow('no proved recovery record');
  });

  it.each([
    {
      layer: 'typed host-action row',
      actionOverrides: { journalHash: 'a'.repeat(64) },
      summaryOverrides: {},
      eventOverrides: {},
    },
    {
      layer: 'stored result summary',
      actionOverrides: {},
      summaryOverrides: { journalEntryHash: 'a'.repeat(64) },
      eventOverrides: {},
    },
    {
      layer: 'immutable task event',
      actionOverrides: {},
      summaryOverrides: {},
      eventOverrides: { journalEntryHash: 'a'.repeat(64) },
    },
    {
      layer: 'all three agreeing evidence projections',
      actionOverrides: { journalHash: 'a'.repeat(64) },
      summaryOverrides: { journalEntryHash: 'a'.repeat(64) },
      eventOverrides: { journalEntryHash: 'a'.repeat(64) },
    },
  ])('rejects a cyclic/reused journal head in the $layer', async (testCase) => {
    const action = uncertainActionWithRecoveryEvidence({
      ...testCase.actionOverrides,
      resultSummary: {
        ...recoveryPreparedSummary(),
        ...testCase.summaryOverrides,
      },
    });
    const signer = { assertReady: jest.fn(), issue: jest.fn() };
    const service = new MsaidiziRecoveryService(
      {
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(action) },
        msaidiziTaskEvent: {
          findFirst: jest.fn().mockResolvedValue(
            recoveryEvidenceEvent({
              ...testCase.eventOverrides,
            }),
          ),
        },
      } as never,
      signer as never,
      auditHarness() as never,
    );
    const expected = 'f'.repeat(64);

    await expect(
      service.request(
        {
          hostActionId,
          expectedCurrentStateSha256: expected,
          confirmationPhrase: `RESTORE ${originalActionId} AT ${expected}`,
        },
        user,
      ),
    ).rejects.toThrow('no proved recovery record');
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('redelivers a stale command so the supervisor can replay its durable result', async () => {
    const command = recoveryCommand({
      status: MsaidiziRecoveryCommandStatus.RECOVERING,
      updatedAt: new Date(0),
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: deviceId }),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          msaidiziRecoveryCommand: {
            findFirst: jest.fn().mockResolvedValue(command),
            updateMany,
          },
        }),
      ),
    };
    const signer = {
      assertReady: jest.fn(),
      redeliverySeconds: 30,
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await expect(service.poll({ deviceId }, {} as never)).resolves.toMatchObject({
      recoveryId,
      manifestSha256: command.manifestSha256,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziRecoveryCommandStatus.DISPATCHED }),
      }),
    );
  });

  it('upgrades a queued v1 manifest from the frozen command target after summary mutation', async () => {
    const legacyManifest = JSON.stringify({
      schemaVersion: 1,
      recoveryId,
      deviceId,
      originalActionId,
      recoveryRecordSha256: 'd'.repeat(64),
      expectedCurrentStateSha256: 'a'.repeat(64),
      idempotencyKey: 'b'.repeat(64),
      issuedAt: new Date(Date.now() - 5_000).toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const base = recoveryCommand();
    const command = recoveryCommand({
      status: MsaidiziRecoveryCommandStatus.QUEUED,
      dispatchCount: 0,
      manifestJson: legacyManifest,
      hostAction: {
        ...base.hostAction,
        resultSummary: {
          preStateSha256: 'f'.repeat(64),
          recoveryProvenanceSha256: '0'.repeat(64),
        },
      },
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const refreshed = {
      manifestJson: '{"schemaVersion":2}',
      manifestSha256: '1'.repeat(64),
      signature: 'v2-signature',
      signingKeyId: 'recovery-root-2',
    };
    const signer = {
      assertReady: jest.fn(),
      redeliverySeconds: 30,
      issue: jest.fn().mockReturnValue(refreshed),
    };
    const service = new MsaidiziRecoveryService(
      {
        msaidiziDevice: { findFirst: jest.fn().mockResolvedValue({ id: deviceId }) },
        $transaction: jest.fn(async (callback) =>
          callback({
            msaidiziRecoveryCommand: {
              findFirst: jest.fn().mockResolvedValue(command),
              updateMany,
            },
          }),
        ),
      } as never,
      signer as never,
      auditHarness() as never,
    );

    await expect(service.poll({ deviceId }, {} as never)).resolves.toMatchObject({
      recoveryId,
      manifestSha256: refreshed.manifestSha256,
    });
    expect(signer.issue).toHaveBeenCalledWith({
      schemaVersion: 2,
      recoveryId,
      deviceId,
      originalActionId,
      recoveryRecordSha256: 'd'.repeat(64),
      expectedCurrentStateSha256: 'a'.repeat(64),
      expectedRestoredStateSha256: 'e'.repeat(64),
      idempotencyKey: 'b'.repeat(64),
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          manifestJson: refreshed.manifestJson,
          manifestSha256: refreshed.manifestSha256,
          manifestSignature: refreshed.signature,
          signingKeyId: refreshed.signingKeyId,
        }),
      }),
    );
  });

  it('stops an expired unseen manifest and still accepts an exact cached late result', async () => {
    const originalManifestSha256 = 'c'.repeat(64);
    let state: Record<string, unknown> = recoveryCommand({
      status: MsaidiziRecoveryCommandStatus.RECOVERING,
      updatedAt: new Date(0),
      manifestJson: JSON.stringify({
        expiresAt: new Date(0).toISOString(),
        recoveryId,
        deviceId,
        originalActionId,
        recoveryRecordSha256: 'd'.repeat(64),
        expectedCurrentStateSha256: 'a'.repeat(64),
        idempotencyKey: 'b'.repeat(64),
      }),
      manifestSha256: originalManifestSha256,
    });
    const updateMany = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const dispatchIncrement = data.dispatchCount as { increment?: number } | undefined;
      state = {
        ...state,
        ...data,
        ...(dispatchIncrement?.increment
          ? { dispatchCount: Number(state.dispatchCount) + dispatchIncrement.increment }
          : {}),
        updatedAt: new Date(),
      };
      return { count: 1 };
    });
    const tx = {
      msaidiziRecoveryCommand: {
        findFirst: jest.fn(async () => state),
        updateMany,
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: deviceId }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const signer = {
      assertReady: jest.fn(),
      redeliverySeconds: 30,
      issue: jest.fn().mockReturnValue({
        manifestJson: '{"replacement":true}',
        manifestSha256: 'f'.repeat(64),
        signature: 'replacement-signature',
        signingKeyId: 'replacement-key',
      }),
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await expect(service.poll({ deviceId }, {} as never)).resolves.toMatchObject({
      recoveryId: null,
      needsAttention: true,
      reason: 'RECOVERY_MANIFEST_EXPIRED_UNSEEN',
    });
    await expect(service.result(successfulResult(), {} as never)).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziRecoveryCommandStatus.SUCCEEDED,
    });

    expect(signer.issue).not.toHaveBeenCalled();
    expect(state.manifestSha256).toBe(originalManifestSha256);
    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({
      status: MsaidiziRecoveryCommandStatus.NEEDS_ATTENTION,
    });
    expect(tx.notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          priority: 'CRITICAL',
          linkedEntityId: recoveryId,
        }),
      }),
    );
  });

  it('allows only three delivery sessions for a future active manifest and accepts its exact cached late result', async () => {
    let state: Record<string, unknown> = recoveryCommand({
      status: MsaidiziRecoveryCommandStatus.RECOVERING,
      updatedAt: new Date(0),
      dispatchCount: 2,
      manifestJson: JSON.stringify({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    const updateMany = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const dispatchIncrement = data.dispatchCount as { increment?: number } | undefined;
      state = {
        ...state,
        ...data,
        ...(dispatchIncrement?.increment
          ? { dispatchCount: Number(state.dispatchCount) + dispatchIncrement.increment }
          : {}),
        updatedAt: new Date(),
      };
      return { count: 1 };
    });
    const taskEventCreate = jest.fn().mockResolvedValue({});
    const notificationUpsert = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziRecoveryCommand: {
        findFirst: jest.fn(async () => state),
        updateMany,
      },
      msaidiziTaskEvent: { create: taskEventCreate },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { upsert: notificationUpsert },
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: deviceId }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const signer = {
      assertReady: jest.fn(),
      redeliverySeconds: 30,
      issue: jest.fn(),
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      signer as never,
      auditHarness() as never,
    );

    await expect(service.poll({ deviceId }, {} as never)).resolves.toMatchObject({
      recoveryId,
      manifestSha256: 'c'.repeat(64),
    });
    expect(state).toMatchObject({
      status: MsaidiziRecoveryCommandStatus.DISPATCHED,
      dispatchCount: 3,
    });

    await expect(service.poll({ deviceId }, {} as never)).resolves.toEqual({
      recoveryId: null,
      needsAttention: true,
      reason: 'RECOVERY_DISPATCH_LIMIT_EXHAUSTED',
    });
    expect(state).toMatchObject({
      status: MsaidiziRecoveryCommandStatus.NEEDS_ATTENTION,
      dispatchCount: 3,
      resultSummary: expect.objectContaining({
        reason: 'RECOVERY_DISPATCH_LIMIT_EXHAUSTED',
      }),
    });
    expect(taskEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'host_action.recovery_delivery_exhausted' }),
      }),
    );
    expect(notificationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          priority: 'CRITICAL',
          linkedEntityId: recoveryId,
        }),
      }),
    );
    expect(signer.issue).not.toHaveBeenCalled();

    const result = successfulResult();
    await expect(service.result(result, {} as never)).resolves.toMatchObject({
      accepted: true,
      replay: false,
      status: MsaidiziRecoveryCommandStatus.SUCCEEDED,
    });
    await expect(service.result(result, {} as never)).resolves.toMatchObject({
      accepted: true,
      replay: true,
      status: MsaidiziRecoveryCommandStatus.SUCCEEDED,
    });
    await expect(
      service.result({ ...result, reason: 'conflicting late result' }, {} as never),
    ).rejects.toThrow('different recovery result');

    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(notificationUpsert).toHaveBeenCalledTimes(2);
  });

  it('accepts an identical terminal replay and rejects a conflicting one', async () => {
    const dto = successfulResult();
    const command = recoveryCommand({ resultDigest: digestFor(dto) });
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: deviceId }),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          msaidiziRecoveryCommand: { findFirst: jest.fn().mockResolvedValue(command) },
        }),
      ),
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      {} as never,
      auditHarness() as never,
    );

    await expect(service.result(dto, {} as never)).resolves.toMatchObject({ replay: true });
    await expect(service.result({ ...dto, reason: 'different' }, {} as never)).rejects.toThrow(
      'different recovery result',
    );
  });

  it('uses the frozen command target after the host-action summary changes', async () => {
    const dto = successfulResult();
    const command = recoveryCommand({
      hostAction: {
        ...recoveryCommand().hostAction,
        resultSummary: { preStateSha256: 'f'.repeat(64) },
      },
    });
    const tx = {
      msaidiziRecoveryCommand: {
        findFirst: jest.fn().mockResolvedValue(command),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: deviceId }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new MsaidiziRecoveryService(
      prisma as never,
      {} as never,
      auditHarness() as never,
    );

    await expect(service.result(dto, {} as never)).resolves.toMatchObject({
      replay: false,
      status: MsaidiziRecoveryCommandStatus.SUCCEEDED,
    });
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'host_action.recovered' }) }),
    );
    expect(tx.notification.upsert).toHaveBeenCalledTimes(1);

    await expect(
      service.result({ ...dto, restoredStateSha256: 'f'.repeat(64) }, {} as never),
    ).rejects.toThrow('immutable pre-action state');
  });

  it('fails closed for a legacy command without a frozen restored-state target', async () => {
    const command = recoveryCommand({ expectedRestoredStateSha256: null });
    const service = new MsaidiziRecoveryService(
      {
        msaidiziDevice: { findFirst: jest.fn().mockResolvedValue({ id: deviceId }) },
        $transaction: jest.fn(async (callback) =>
          callback({
            msaidiziRecoveryCommand: { findFirst: jest.fn().mockResolvedValue(command) },
          }),
        ),
      } as never,
      {} as never,
      auditHarness() as never,
    );

    await expect(service.result(successfulResult(), {} as never)).rejects.toThrow(
      'immutable pre-action state',
    );
  });
});

function hostAction(overrides: Record<string, unknown> = {}) {
  return {
    id: hostActionId,
    taskId: '11111111-1111-4111-8111-111111111111',
    stepId: '22222222-2222-4222-8222-222222222222',
    deviceId,
    actionId: originalActionId,
    capability: 'filesystem.entry.quarantine',
    status: MsaidiziHostActionStatus.SUCCEEDED,
    uncertainOutcome: false,
    expectedPreState: { sha256: 'e'.repeat(64) },
    journalExpectedPreviousSequence: null,
    journalPrepareSequence: null,
    journalPreparePreviousHash: null,
    journalPrepareHash: null,
    journalRecoveryPreparedSequence: null,
    journalRecoveryPreparedPreviousHash: null,
    journalRecoveryPreparedHash: null,
    journalSequence: null,
    journalPreviousHash: null,
    journalHash: null,
    journalReceiptDigest: null,
    journalEvidenceEventCursor: null,
    journalEvidenceAcceptedAt: null,
    recoveryRecordSha256: null,
    expectedRestoredStateSha256: null,
    resultSummary: {
      mutationCommitted: true,
      preStateSha256: 'e'.repeat(64),
      recoveryProvenanceSha256: 'd'.repeat(64),
    },
    task: {
      id: '11111111-1111-4111-8111-111111111111',
      principalId: 'principal-1',
      mandateId: null,
      companyId: 'company-1',
      initiatedByUserId: user.id,
    },
    device: { id: deviceId, status: MsaidiziDeviceStatus.ACTIVE },
    ...overrides,
  };
}

function recoveryPreparedSummary() {
  return {
    mutationCommitted: false,
    outcomeUncertain: true,
    outcome: 'NeedsAttention',
    preStateSha256: 'e'.repeat(64),
    recoveryProvenanceSha256: 'd'.repeat(64),
    recoveryHandleSha256: '8'.repeat(64),
    journalPrepareSequence: 12,
    journalPreparePreviousHash: 'a'.repeat(64),
    journalPrepareEntryHash: 'b'.repeat(64),
    journalRecoveryPreparedSequence: 13,
    journalRecoveryPreparedPreviousHash: 'b'.repeat(64),
    journalRecoveryPreparedEntryHash: 'c'.repeat(64),
    journalSequence: 14,
    journalPreviousHash: 'c'.repeat(64),
    journalEntryHash: 'f'.repeat(64),
    receiptDigest: '9'.repeat(64),
  };
}

function recoveryEvidenceEvent(payloadOverrides: Record<string, unknown> = {}) {
  return {
    cursor: 42n,
    taskId: '11111111-1111-4111-8111-111111111111',
    type: 'host_action.outcome_unknown',
    actorType: 'DEVICE_BROKER',
    actorId: deviceId,
    payload: { ...recoveryPreparedSummary(), ...payloadOverrides },
    integrityVersion: 1,
    previousHash: '7'.repeat(64),
    eventHash: '6'.repeat(64),
  };
}

function committedRecoverySummary() {
  return {
    ...recoveryPreparedSummary(),
    mutationCommitted: true,
    outcomeUncertain: false,
    outcome: 'Completed',
  };
}

function committedRecoveryEvent(payloadOverrides: Record<string, unknown> = {}) {
  return {
    ...recoveryEvidenceEvent(payloadOverrides),
    type: 'host_action.settled',
    payload: { ...committedRecoverySummary(), ...payloadOverrides },
  };
}

function lateCommittedRecoveryEvent(payloadOverrides: Record<string, unknown> = {}) {
  return {
    ...committedRecoveryEvent(payloadOverrides),
    type: 'host_action.late_evidence_reconciled',
  };
}

function committedActionWithRecoveryEvidence(overrides: Record<string, unknown> = {}) {
  return hostAction({
    status: MsaidiziHostActionStatus.SUCCEEDED,
    journalAccepted: true,
    resultSummary: committedRecoverySummary(),
    journalExpectedPreviousSequence: 11,
    journalPrepareSequence: 12,
    journalPreparePreviousHash: 'a'.repeat(64),
    journalPrepareHash: 'b'.repeat(64),
    journalRecoveryPreparedSequence: 13,
    journalRecoveryPreparedPreviousHash: 'b'.repeat(64),
    journalRecoveryPreparedHash: 'c'.repeat(64),
    journalSequence: 14,
    journalPreviousHash: 'c'.repeat(64),
    journalHash: 'f'.repeat(64),
    journalReceiptDigest: '9'.repeat(64),
    journalEvidenceEventCursor: 42n,
    journalEvidenceAcceptedAt: new Date(),
    recoveryRecordSha256: 'd'.repeat(64),
    expectedRestoredStateSha256: 'e'.repeat(64),
    ...overrides,
  });
}

function uncertainActionWithRecoveryEvidence(overrides: Record<string, unknown> = {}) {
  return hostAction({
    capability: 'windows.service.start-mode.set',
    status: MsaidiziHostActionStatus.UNKNOWN,
    uncertainOutcome: true,
    journalAccepted: true,
    resultSummary: recoveryPreparedSummary(),
    journalExpectedPreviousSequence: 11,
    journalPrepareSequence: 12,
    journalPreparePreviousHash: 'a'.repeat(64),
    journalPrepareHash: 'b'.repeat(64),
    journalRecoveryPreparedSequence: 13,
    journalRecoveryPreparedPreviousHash: 'b'.repeat(64),
    journalRecoveryPreparedHash: 'c'.repeat(64),
    journalSequence: 14,
    journalPreviousHash: 'c'.repeat(64),
    journalHash: 'f'.repeat(64),
    journalReceiptDigest: '9'.repeat(64),
    journalEvidenceEventCursor: 42n,
    journalEvidenceAcceptedAt: new Date(),
    recoveryRecordSha256: 'd'.repeat(64),
    expectedRestoredStateSha256: 'e'.repeat(64),
    ...overrides,
  });
}

function lateCommittedActionWithRecoveryEvidence(overrides: Record<string, unknown> = {}) {
  return uncertainActionWithRecoveryEvidence({
    status: MsaidiziHostActionStatus.UNKNOWN,
    uncertainOutcome: true,
    resultSummary: committedRecoverySummary(),
    ...overrides,
  });
}

function recoveryCommand(overrides: Record<string, unknown> = {}) {
  const action = hostAction();
  return {
    id: recoveryId,
    hostActionId,
    deviceId,
    requestedByUserId: user.id,
    originalActionId,
    recoveryRecordSha256: 'd'.repeat(64),
    expectedCurrentStateSha256: 'a'.repeat(64),
    expectedRestoredStateSha256: 'e'.repeat(64),
    status: MsaidiziRecoveryCommandStatus.RECOVERING,
    idempotencyKey: 'b'.repeat(64),
    manifestJson: JSON.stringify({ expiresAt: new Date(Date.now() + 120_000).toISOString() }),
    manifestSha256: 'c'.repeat(64),
    manifestSignature: 'signature',
    signingKeyId: 'recovery-root-1',
    dispatchCount: 1,
    resultDigest: null,
    resultSummary: null,
    supervisorJournalHead: null,
    queuedAt: new Date(),
    dispatchedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    hostAction: { ...action, task: action.task },
    ...overrides,
  };
}

function successfulResult() {
  return {
    deviceId,
    recoveryId,
    outcome: 'SUCCEEDED' as const,
    manifestSha256: 'c'.repeat(64),
    journalHeadSha256: 'a'.repeat(64),
    restoredStateSha256: 'e'.repeat(64),
  };
}

function digestFor(dto: ReturnType<typeof successfulResult>) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: dto.deviceId,
        recoveryId: dto.recoveryId,
        outcome: dto.outcome,
        manifestSha256: dto.manifestSha256,
        journalHeadSha256: dto.journalHeadSha256,
        restoredStateSha256: dto.restoredStateSha256,
        reason: null,
      }),
      'utf8',
    )
    .digest('hex');
}
