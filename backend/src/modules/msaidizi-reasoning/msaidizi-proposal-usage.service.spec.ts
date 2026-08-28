import { ConflictException, HttpException } from '@nestjs/common';
import { MsaidiziProposalUsageStatus, MsaidiziTaskMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MsaidiziProposalUsageService } from './msaidizi-proposal-usage.service';
import {
  bindProposalRequestDigest,
  MsaidiziDraftProposalAuthority,
  proposalInFlightMarker,
} from './msaidizi-proposal-lease';

const DRAFT_AUTHORITY: MsaidiziDraftProposalAuthority = {
  taskId: '33333333-3333-4333-8333-333333333333',
  principalId: 'principal-1',
  initiatedByUserId: 'user-1',
  companyId: 'company-1',
  mandateId: null,
  mode: MsaidiziTaskMode.COLLABORATIVE,
  stateVersion: 0,
};

function draftLease(receiptId = '11111111-1111-4111-8111-111111111111') {
  return {
    authority: DRAFT_AUTHORITY,
    receiptId,
    marker: proposalInFlightMarker(receiptId),
    leasedStateVersion: 1,
  };
}

function autonomy(overrides: Partial<AutonomyConfig> = {}): AutonomyConfig {
  return {
    proposalQuotaWindowSeconds: 3_600,
    proposalReceiptTtlSeconds: 86_400,
    proposalReservationTimeoutSeconds: 300,
    proposalMaxInputTokensPerTurn: 200_000,
    proposalMaxModelTurnsPerWindow: 200,
    proposalMaxCostUsdPerWindow: 20,
    adaptiveReasoningInputUsdPerMillionTokens: 30,
    adaptiveReasoningCacheReadUsdPerMillionTokens: 30,
    adaptiveReasoningCacheCreationUsdPerMillionTokens: 37.5,
    adaptiveReasoningConservativeInputUsdPerMillionTokens: 37.5,
    adaptiveReasoningOutputUsdPerMillionTokens: 150,
    ...overrides,
  } as AutonomyConfig;
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    companyId: 'company-1',
    mode: MsaidiziTaskMode.COLLABORATIVE,
    requestDigest: bindProposalRequestDigest('a'.repeat(64), DRAFT_AUTHORITY),
    proposalDigest: null,
    model: 'model-1',
    inputUsdPerMillionTokens: { toString: () => '37.500000' },
    outputUsdPerMillionTokens: { toString: () => '150.000000' },
    status: MsaidiziProposalUsageStatus.RESERVED,
    reservedModelTurns: 2,
    reservedInputTokens: 400_000n,
    reservedOutputTokens: 12_000n,
    reservedCostUsd: { toString: () => '16.800000' },
    actualModelTurns: 0,
    inputTokens: 0n,
    cacheReadInputTokens: 0n,
    cacheCreationInputTokens: 0n,
    billedInputTokens: 0n,
    outputTokens: 0n,
    actualCostUsd: { toFixed: () => '0.000000' },
    accountedModelTurns: 2,
    accountedCostUsd: { toString: () => '16.800000' },
    failureCode: null,
    reservationExpiresAt: new Date(Date.now() + 300_000),
    expiresAt: new Date(Date.now() + 86_400_000),
    settledAt: null,
    consumedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MsaidiziProposalUsageService', () => {
  it('serializes and persists a pessimistic reservation before any provider work', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      msaidiziTask: { findMany: jest.fn().mockResolvedValue([]) },
      msaidiziProposalUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { accountedModelTurns: null, accountedCostUsd: null },
        }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new MsaidiziProposalUsageService(
      prisma as unknown as PrismaService,
      autonomy(),
    );

    const reservation = await service.reserve({
      userId: 'user-1',
      companyId: 'company-1',
      mode: MsaidiziTaskMode.COLLABORATIVE,
      model: 'model-1',
      requestDigest: 'a'.repeat(64),
    });

    expect(reservation).toMatchObject({
      reservedModelTurns: 2,
      reservedInputTokens: 400_000n,
      reservedOutputTokens: 12_000n,
      reservedCostUsd: '16.800000',
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.msaidiziProposalUsage.create.mock.invocationCallOrder[0],
    );
    expect(tx.msaidiziProposalUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: MsaidiziProposalUsageStatus.RESERVED,
        inputUsdPerMillionTokens: '37.500000',
        outputUsdPerMillionTokens: '150.000000',
        accountedModelTurns: 2,
        accountedCostUsd: '16.800000',
      }),
    });
  });

  it('creates the RESERVED receipt and exact draft marker in one transaction', async () => {
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const receiptCreate = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziTask: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: taskUpdate,
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      msaidiziProposalUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { accountedModelTurns: null, accountedCostUsd: null },
        }),
        create: receiptCreate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    const reservation = await service.reserve({
      userId: 'user-1',
      companyId: 'company-1',
      mode: MsaidiziTaskMode.COLLABORATIVE,
      model: 'model-1',
      requestDigest: 'a'.repeat(64),
      draftAuthority: DRAFT_AUTHORITY,
    });

    expect(reservation.draftLease).toEqual(
      expect.objectContaining({
        authority: DRAFT_AUTHORITY,
        receiptId: reservation.id,
        marker: proposalInFlightMarker(reservation.id),
        leasedStateVersion: 1,
      }),
    );
    expect(taskUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: DRAFT_AUTHORITY.taskId,
        principalId: DRAFT_AUTHORITY.principalId,
        initiatedByUserId: DRAFT_AUTHORITY.initiatedByUserId,
        companyId: DRAFT_AUTHORITY.companyId,
        mode: DRAFT_AUTHORITY.mode,
        status: 'PLANNING',
        activePlanVersion: 0,
        stateVersion: 0,
        statusDetail: null,
        attemptedToolCalls: 0,
        mutations: 0,
        planVersions: { none: {} },
        hostActions: { none: {} },
      }),
      data: {
        statusDetail: proposalInFlightMarker(reservation.id),
        stateVersion: { increment: 1 },
      },
    });
    expect(taskUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      receiptCreate.mock.invocationCallOrder[0],
    );
    expect(receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestDigest: bindProposalRequestDigest('a'.repeat(64), DRAFT_AUTHORITY),
      }),
    });
  });

  it('rolls back before receipt creation when the exact draft lease CAS loses', async () => {
    const receiptCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziTask: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      msaidiziTaskEvent: { create: jest.fn() },
      msaidiziProposalUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { accountedModelTurns: null, accountedCostUsd: null },
        }),
        create: receiptCreate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.reserve({
        userId: 'user-1',
        companyId: 'company-1',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        model: 'model-1',
        requestDigest: 'a'.repeat(64),
        draftAuthority: DRAFT_AUTHORITY,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(receiptCreate).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a concurrent reservation that would cross the rolling cost quota', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziTask: { findMany: jest.fn().mockResolvedValue([]) },
      msaidiziProposalUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { accountedModelTurns: 1, accountedCostUsd: 10 },
        }),
        create,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.reserve({
        userId: 'user-1',
        companyId: 'company-1',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        model: 'model-1',
        requestDigest: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(create).not.toHaveBeenCalled();
  });

  it('settles cache-inclusive provider usage exactly once', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const row = reservationRow();
    const service = new MsaidiziProposalUsageService(
      {
        msaidiziProposalUsage: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany,
        },
      } as unknown as PrismaService,
      autonomy(),
    );

    const settled = await service.settleSuccess(row.id, 'b'.repeat(64), {
      modelTurns: 1,
      usage: {
        inputTokens: 100,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 10,
        outputTokens: 50,
      },
    });

    expect(settled).toMatchObject({
      modelTurns: 1,
      inputTokens: 130n,
      outputTokens: 50n,
      estimatedCostUsd: '0.012375',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: MsaidiziProposalUsageStatus.RESERVED }),
        data: expect.objectContaining({
          status: MsaidiziProposalUsageStatus.SETTLED,
          billedInputTokens: 130n,
          accountedModelTurns: 1,
          accountedCostUsd: '0.012375',
        }),
      }),
    );
  });

  it('settles success and releases only the exact draft marker atomically', async () => {
    const row = reservationRow();
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const receiptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany: taskUpdate },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      msaidiziProposalUsage: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.settleSuccess(
        row.id,
        'b'.repeat(64),
        {
          modelTurns: 1,
          usage: {
            inputTokens: 100,
            cacheReadInputTokens: 20,
            cacheCreationInputTokens: 10,
            outputTokens: 50,
          },
        },
        draftLease(row.id),
      ),
    ).resolves.toMatchObject({ id: row.id, inputTokens: 130n });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: DRAFT_AUTHORITY.taskId,
        stateVersion: 1,
        statusDetail: proposalInFlightMarker(row.id),
        status: 'PLANNING',
        activePlanVersion: 0,
      }),
      data: { statusDetail: null, stateVersion: { increment: 1 } },
    });
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: row.id,
          status: MsaidiziProposalUsageStatus.RESERVED,
        }),
        data: expect.objectContaining({ status: MsaidiziProposalUsageStatus.SETTLED }),
      }),
    );
  });

  it('returns no successful receipt when exact marker release loses its CAS', async () => {
    const row = reservationRow();
    const receiptUpdate = jest.fn();
    const tx = {
      msaidiziTask: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziTaskEvent: { create: jest.fn() },
      msaidiziProposalUsage: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.settleSuccess(
        row.id,
        'b'.repeat(64),
        {
          modelTurns: 1,
          usage: {
            inputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 50,
          },
        },
        draftLease(row.id),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_PROPOSAL_LEASE_LOST' }),
    });
    expect(receiptUpdate).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the full reservation when a provider outcome has no trustworthy usage', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const row = reservationRow();
    const service = new MsaidiziProposalUsageService(
      {
        msaidiziProposalUsage: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany,
        },
      } as unknown as PrismaService,
      autonomy(),
    );

    await service.settleFailure(row.id, 'provider timeout');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: row.id, status: MsaidiziProposalUsageStatus.RESERVED },
      data: expect.objectContaining({
        status: MsaidiziProposalUsageStatus.FAILED,
        failureCode: 'PROVIDER_TIMEOUT',
      }),
    });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('accountedCostUsd');
  });

  it('marks failure and releases its exact marker in the same transaction', async () => {
    const row = reservationRow();
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const receiptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany: taskUpdate },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      msaidiziProposalUsage: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await service.settleFailure(row.id, 'provider timeout', undefined, draftLease(row.id));

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stateVersion: 1,
          statusDetail: proposalInFlightMarker(row.id),
        }),
        data: { statusDetail: null, stateVersion: { increment: 1 } },
      }),
    );
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziProposalUsageStatus.FAILED,
          failureCode: 'PROVIDER_TIMEOUT',
        }),
      }),
    );
  });

  it('recovers only an exact expired marker/receipt pair after a crash', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const lease = draftLease();
    const expired = reservationRow({
      reservationExpiresAt: new Date(now.getTime() - 1),
    });
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const receiptUpdate = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = {
      msaidiziTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: DRAFT_AUTHORITY.taskId,
            principalId: DRAFT_AUTHORITY.principalId,
            initiatedByUserId: DRAFT_AUTHORITY.initiatedByUserId,
            companyId: DRAFT_AUTHORITY.companyId,
            mandateId: DRAFT_AUTHORITY.mandateId,
            mode: DRAFT_AUTHORITY.mode,
            stateVersion: 1,
            statusDetail: lease.marker,
          },
        ]),
        updateMany: taskUpdate,
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      msaidiziProposalUsage: {
        findUnique: jest.fn().mockResolvedValue(expired),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(service.recoverExpiredDraftLeases(now)).resolves.toEqual({ recovered: 1 });
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: DRAFT_AUTHORITY.taskId,
          stateVersion: 1,
          statusDetail: lease.marker,
        }),
        data: { statusDetail: null, stateVersion: { increment: 1 } },
      }),
    );
    expect(receiptUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: expired.id, status: MsaidiziProposalUsageStatus.RESERVED },
      data: {
        status: MsaidiziProposalUsageStatus.FAILED,
        failureCode: 'RESERVATION_EXPIRED_UNKNOWN',
      },
    });
  });

  it('fails closed when an expired marker points to an authority-mismatched receipt', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const lease = draftLease();
    const receiptUpdate = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      msaidiziTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: DRAFT_AUTHORITY.taskId,
            principalId: DRAFT_AUTHORITY.principalId,
            initiatedByUserId: DRAFT_AUTHORITY.initiatedByUserId,
            companyId: DRAFT_AUTHORITY.companyId,
            mandateId: DRAFT_AUTHORITY.mandateId,
            mode: DRAFT_AUTHORITY.mode,
            stateVersion: 1,
            statusDetail: lease.marker,
          },
        ]),
        updateMany: jest.fn(),
      },
      msaidiziTaskEvent: { create: jest.fn() },
      msaidiziProposalUsage: {
        findUnique: jest.fn().mockResolvedValue(
          reservationRow({
            userId: 'other-user',
            reservationExpiresAt: new Date(now.getTime() - 1),
          }),
        ),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(service.recoverExpiredDraftLeases(now)).resolves.toEqual({ recovered: 0 });
    expect(tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: [lease.receiptId] } }),
      }),
    );
  });

  it('recovers one exact expired draft for a direct manual state change', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const lease = draftLease();
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const receiptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: {
        findFirst: jest.fn().mockResolvedValue({ id: DRAFT_AUTHORITY.taskId }),
        updateMany: taskUpdate,
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      msaidiziProposalUsage: {
        findUnique: jest
          .fn()
          .mockResolvedValue(reservationRow({ reservationExpiresAt: new Date(now.getTime() - 1) })),
        updateMany: receiptUpdate,
      },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.recoverExpiredDraftLeaseForTask(
        { authority: DRAFT_AUTHORITY, marker: lease.marker },
        now,
      ),
    ).resolves.toBe('RECOVERED');
    expect(taskUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: DRAFT_AUTHORITY.taskId,
        stateVersion: 1,
        statusDetail: lease.marker,
      }),
      data: { statusDetail: null, stateVersion: { increment: 1 } },
    });
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: lease.receiptId }),
        data: expect.objectContaining({ status: MsaidiziProposalUsageStatus.FAILED }),
      }),
    );
  });

  it('distinguishes a live exact marker and fails closed on malformed or rebound receipts', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const lease = draftLease();
    const exactTask = jest.fn().mockResolvedValue({ id: DRAFT_AUTHORITY.taskId });
    const receipt = jest
      .fn()
      .mockResolvedValue(
        reservationRow({ reservationExpiresAt: new Date(now.getTime() + 60_000) }),
      );
    const tx = {
      msaidiziTask: { findFirst: exactTask, updateMany: jest.fn() },
      msaidiziTaskEvent: { create: jest.fn() },
      msaidiziProposalUsage: { findUnique: receipt, updateMany: jest.fn() },
    };
    const service = new MsaidiziProposalUsageService(
      {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as unknown as PrismaService,
      autonomy(),
    );

    await expect(
      service.recoverExpiredDraftLeaseForTask(
        { authority: DRAFT_AUTHORITY, marker: lease.marker },
        now,
      ),
    ).resolves.toBe('LIVE');

    await expect(
      service.recoverExpiredDraftLeaseForTask({
        authority: DRAFT_AUTHORITY,
        marker: 'MSAIDIZI_PROPOSAL_IN_FLIGHT_V1:not-a-receipt',
      }),
    ).resolves.toBe('BLOCKED');
    expect(exactTask).toHaveBeenCalledTimes(1);

    receipt.mockResolvedValueOnce(
      reservationRow({
        requestDigest: bindProposalRequestDigest('a'.repeat(64), {
          ...DRAFT_AUTHORITY,
          principalId: 'other-principal',
        }),
      }),
    );
    await expect(
      service.recoverExpiredDraftLeaseForTask(
        { authority: DRAFT_AUTHORITY, marker: lease.marker },
        now,
      ),
    ).resolves.toBe('BLOCKED');
    expect(tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
  });

  it('consumes only the exact unexpired settled digest', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new MsaidiziProposalUsageService({} as PrismaService, autonomy());
    const tx = { msaidiziProposalUsage: { updateMany } };

    await service.consume(tx as never, 'receipt-1', 'b'.repeat(64));

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'receipt-1',
          status: MsaidiziProposalUsageStatus.SETTLED,
          proposalDigest: 'b'.repeat(64),
          expiresAt: { gt: expect.any(Date) },
        }),
        data: {
          status: MsaidiziProposalUsageStatus.CONSUMED,
          consumedAt: expect.any(Date),
        },
      }),
    );
  });
});
