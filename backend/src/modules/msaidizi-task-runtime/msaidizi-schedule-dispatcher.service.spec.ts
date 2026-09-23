import { ConfigService } from '@nestjs/config';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  MsaidiziTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MsaidiziScheduleDispatcherService } from './msaidizi-schedule-dispatcher.service';

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

const DEPLOYMENT_BUDGET = {
  maxWallTimeSeconds: 7_200,
  maxModelTurns: 200,
  maxAttemptedToolCalls: 500,
  maxMutations: 100,
  maxLocalBytes: 5_368_709_120n,
  maxExternalEgressBytes: 262_144_000n,
  maxModelCostUsd: 20,
};

function autonomy(overrides: Partial<AutonomyConfig> = {}) {
  return {
    enabled: true,
    autopilotEnabled: true,
    hostExecutionEnabled: false,
    principalGrants: ['expenses.view'],
    budgetCeilings: DEPLOYMENT_BUDGET,
    ...overrides,
  } as unknown as AutonomyConfig;
}

function switches(overrides: Record<string, string> = {}) {
  return config({
    JOB_WORKER_ENABLED: 'true',
    MSAIDIZI_TASK_WORKER_ENABLED: 'true',
    MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
    ...overrides,
  });
}

function dueSchedule(overrides: Record<string, unknown> = {}) {
  const dueAt = new Date('2026-08-25T05:00:00.000Z');
  return {
    id: 'schedule-1',
    principalId: 'principal-1',
    mandateId: 'mandate-1',
    createdByUserId: 'user-1',
    name: 'Morning review',
    status: MsaidiziScheduleStatus.ACTIVE,
    version: 1,
    cronExpression: '0 8 * * *',
    timezone: 'Africa/Nairobi',
    taskTemplate: {
      title: 'Morning review',
      objective: 'Review expenses',
      budgets: { maxAttemptedToolCalls: 25 },
      steps: [
        {
          key: 'load-expenses',
          name: 'Load expenses',
          target: MsaidiziExecutionTarget.ERP,
          capability: 'ExpensesController.findAll',
          capabilityVersion: '1',
          arguments: { path: {}, query: {} },
          dependsOn: [],
          expectedEffect: MsaidiziEffect.READ,
          dataClass: 'internal',
          preconditions: {},
          budgets: {},
          stopConditions: {},
          idempotent: true,
          mutation: false,
        },
      ],
    },
    concurrencyMode: 'SKIP',
    nextRunAt: dueAt,
    lastRunAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    principal: { status: MsaidiziPrincipalStatus.ACTIVE },
    mandate: {
      id: 'mandate-1',
      principalId: 'principal-1',
      companyId: 'company-1',
      createdByUserId: 'user-1',
      name: 'Finance reads',
      description: 'Read finance',
      status: MsaidiziMandateStatus.ACTIVE,
      version: 1,
      capabilities: [
        {
          capability: 'ExpensesController.findAll',
          effects: [MsaidiziEffect.READ],
          dataClasses: ['internal'],
        },
      ],
      deviceIds: [],
      budgets: { maxAttemptedToolCalls: 10, maxModelCostUsd: 5 },
      startsAt: null,
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      activatedAt: new Date('2026-08-20T00:00:00.000Z'),
      revokedAt: null,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
    ...overrides,
  };
}

function transactionHarness(options: { claimCounts?: number[]; overlapping?: unknown } = {}) {
  const claimCounts = [...(options.claimCounts ?? [1])];
  const tx = {
    $queryRaw: jest
      .fn()
      .mockImplementation(async (query: { sql: string }) =>
        query.sql.includes('msaidizi_principals')
          ? [{ status: MsaidiziPrincipalStatus.ACTIVE }]
          : [dueSchedule().mandate],
      ),
    msaidiziSchedule: {
      updateMany: jest.fn().mockImplementation(async () => ({ count: claimCounts.shift() ?? 0 })),
      findUnique: jest.fn(),
    },
    msaidiziScheduleVersion: { create: jest.fn() },
    msaidiziTask: {
      findFirst: jest.fn().mockResolvedValue(options.overlapping ?? null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziPrincipal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziPlanVersion: { create: jest.fn().mockResolvedValue({}) },
    msaidiziTaskStep: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziSchedule: { findMany: jest.fn() },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = {
    logStrictInTransaction: jest.fn((client: typeof tx, input: unknown) =>
      client.auditLog.create({ data: input }),
    ),
  };
  return { prisma, tx, audit };
}

describe('MsaidiziScheduleDispatcherService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-25T05:00:01Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it('atomically queues one governed task and advances the durable occurrence cursor', async () => {
    const schedule = dueSchedule();
    const { prisma, tx, audit } = transactionHarness();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );

    await expect(
      service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z')),
    ).resolves.toEqual({ inspected: 1, dispatched: 1, skipped: 0, blocked: 0, failed: 0 });

    expect(tx.msaidiziSchedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextRunAt: schedule.nextRunAt,
          version: schedule.version,
          updatedAt: schedule.updatedAt,
        }),
        data: {
          lastRunAt: schedule.nextRunAt,
          nextRunAt: new Date('2026-08-26T05:00:00.000Z'),
        },
      }),
    );
    expect(tx.msaidiziTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziTaskStatus.QUEUED,
          mandateId: schedule.mandateId,
          scheduleId: schedule.id,
          companyId: 'company-1',
          maxAttemptedToolCalls: 10,
          maxModelCostUsd: 5,
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt: null,
        }),
      }),
    );
    const createdAt = tx.msaidiziTask.create.mock.calls[0][0].data.createdAt;
    expect(createdAt).toBeInstanceOf(Date);
    expect(tx.msaidiziTaskStep.createMany.mock.calls[0][0].data[0].createdAt).toBe(createdAt);
    expect(tx.msaidiziTaskEvent.createMany).toHaveBeenCalledTimes(1);
    const creationAuthority = {
      protocol: 'MSAIDIZI_SCHEDULE_AUTHORITY_V1',
      principalId: schedule.principalId,
      companyId: schedule.mandate.companyId,
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      scheduleUpdatedAt: schedule.updatedAt.toISOString(),
      mandateId: schedule.mandateId,
      mandateVersion: schedule.mandate.version,
      mandateUpdatedAt: schedule.mandate.updatedAt.toISOString(),
    };
    expect(
      tx.msaidiziTaskEvent.createMany.mock.calls[0][0].data[0].payload.creationAuthority,
    ).toEqual(creationAuthority);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'MSAIDIZI_SCHEDULE_DISPATCH',
          mandateId: schedule.mandateId,
          newValue: expect.objectContaining({ creationAuthority }),
        }),
      }),
    );
  });

  it('lets only one worker win the occurrence CAS', async () => {
    const schedule = dueSchedule();
    const { prisma, tx, audit } = transactionHarness({ claimCounts: [1, 0] });
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );

    const first = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));
    const second = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));

    expect(first.dispatched).toBe(1);
    expect(second.skipped).toBe(1);
    expect(tx.msaidiziTask.create).toHaveBeenCalledTimes(1);
  });

  it('stops later occurrences when the kill switch changes during a batch', async () => {
    const { prisma, tx, audit } = transactionHarness({ claimCounts: [1, 1] });
    prisma.msaidiziSchedule.findMany.mockResolvedValue([
      dueSchedule(),
      dueSchedule({ id: 'schedule-2' }),
    ]);
    const runtime = new ConfigService({
      JOB_WORKER_ENABLED: 'true',
      MSAIDIZI_TASK_WORKER_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
    });
    audit.logStrictInTransaction.mockImplementationOnce(async (client, input) => {
      const result = await client.auditLog.create({ data: input });
      runtime.set('MSAIDIZI_GLOBAL_KILL_SWITCH', 'true');
      return result;
    });
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      runtime,
      audit as never,
    );
    expect(await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01Z'))).toMatchObject({
      dispatched: 1,
      skipped: 1,
    });
    expect(tx.msaidiziTask.create).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziSchedule.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rechecks the kill switch after waiting for the transaction connection', async () => {
    const { prisma, tx, audit } = transactionHarness();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([dueSchedule()]);
    const runtime = new ConfigService({
      JOB_WORKER_ENABLED: 'true',
      MSAIDIZI_TASK_WORKER_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
    });
    prisma.$transaction.mockImplementationOnce((work) => {
      runtime.set('MSAIDIZI_GLOBAL_KILL_SWITCH', 'true');
      return work(tx);
    });
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      runtime,
      audit as never,
    );
    expect(await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01Z'))).toMatchObject({
      dispatched: 0,
      skipped: 1,
    });
    expect(tx.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTask.create).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    'principal-disabled',
    'mandate-missing',
    'mandate-revoked',
    'mandate-version',
    'mandate-timestamp',
    'mandate-expired',
    'kill-after-lock',
  ])('refuses a stale authority claim: %s', async (change) => {
    const { prisma, tx, audit } = transactionHarness();
    const schedule = dueSchedule();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    const runtime = new ConfigService({
      JOB_WORKER_ENABLED: 'true',
      MSAIDIZI_TASK_WORKER_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
    });
    tx.$queryRaw.mockImplementation(async (query: { sql: string }) => {
      expect(query.sql).toContain('FOR UPDATE');
      if (query.sql.includes('msaidizi_principals'))
        return [{ status: change === 'principal-disabled' ? 'DISABLED' : 'ACTIVE' }];
      if (change === 'mandate-missing') return [];
      if (change === 'kill-after-lock') runtime.set('MSAIDIZI_GLOBAL_KILL_SWITCH', 'true');
      if (change === 'mandate-expired') jest.setSystemTime(schedule.mandate.expiresAt);
      return [
        {
          ...schedule.mandate,
          ...(change === 'mandate-revoked' && { status: 'REVOKED' }),
          ...(change === 'mandate-version' && { version: 2 }),
          ...(change === 'mandate-timestamp' && { updatedAt: new Date('2026-08-25T00:00:00Z') }),
        },
      ];
    });
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      runtime,
      audit as never,
    );
    expect(await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01Z'))).toMatchObject({
      dispatched: 0,
      skipped: 1,
    });
    expect(tx.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziTask.create).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.createMany).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('retries an unacknowledged transaction at the same occurrence without duplicating work', async () => {
    const schedule = dueSchedule();
    const { prisma, tx, audit } = transactionHarness();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    (prisma.$transaction as jest.Mock)
      .mockRejectedValueOnce(new Error('connection ended before commit acknowledgement'))
      .mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );

    const unknown = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));
    const retried = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));

    expect(unknown.failed).toBe(1);
    expect(retried.dispatched).toBe(1);
    expect(tx.msaidiziTask.create).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: `msaidizi-schedule:${schedule.id}:${schedule.nextRunAt.getTime()}`,
        }),
      }),
    );
  });

  it('records recovery-time authority without inventing historical creation authority', async () => {
    const schedule = dueSchedule({ version: 8 });
    const { prisma, tx, audit } = transactionHarness();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    tx.msaidiziTask.findUnique.mockResolvedValue({
      id: 'old-task',
      scheduleId: schedule.id,
      status: MsaidiziTaskStatus.READY,
      stateVersion: 1,
    });
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );
    expect(
      (await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01Z'))).dispatched,
    ).toBe(1);
    expect(tx.msaidiziTask.create).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.createMany).not.toHaveBeenCalled();
    const event = tx.msaidiziTaskEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({
      type: 'task.queued',
      payload: { recovered: true, observedAuthority: { scheduleVersion: 8, mandateVersion: 1 } },
    });
    expect(event.payload).not.toHaveProperty('creationAuthority');
    const evidence = tx.auditLog.create.mock.calls[0][0].data;
    expect(evidence).toMatchObject({
      action: 'MSAIDIZI_SCHEDULE_DISPATCH_RECONCILED',
      newValue: { observedAuthority: event.payload.observedAuthority },
    });
    expect(evidence.newValue).not.toHaveProperty('creationAuthority');
  });

  it('advances and records a SKIP occurrence without creating overlapping work', async () => {
    const schedule = dueSchedule();
    const { prisma, tx, audit } = transactionHarness({
      overlapping: { id: 'prior-task', status: MsaidiziTaskStatus.NEEDS_ATTENTION },
    });
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );

    const result = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));

    expect(result.skipped).toBe(1);
    expect(tx.msaidiziTask.create).not.toHaveBeenCalled();
    expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'schedule.occurrence_skipped' }),
      }),
    );
  });

  it('pauses and audits an invalid due template instead of skipping it silently', async () => {
    const schedule = dueSchedule({ taskTemplate: { title: '', objective: '', steps: [] } });
    const { prisma, tx, audit } = transactionHarness();
    prisma.msaidiziSchedule.findMany.mockResolvedValue([schedule]);
    tx.msaidiziSchedule.findUnique.mockResolvedValue({
      ...schedule,
      status: MsaidiziScheduleStatus.PAUSED,
      version: 2,
    });
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(),
      audit as never,
    );

    const result = await service.dispatchDueSchedules(20, new Date('2026-08-25T05:00:01.000Z'));

    expect(result.blocked).toBe(1);
    expect(tx.msaidiziSchedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          version: 1,
          updatedAt: schedule.updatedAt,
        }),
        data: {
          status: MsaidiziScheduleStatus.PAUSED,
          version: { increment: 1 },
        },
      }),
    );
    expect(tx.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduleId: schedule.id,
        version: 2,
        status: MsaidiziScheduleStatus.PAUSED,
        changeType: 'MSAIDIZI_SCHEDULE_DISPATCH_BLOCKED',
        changedByUserId: null,
      }),
    });
    expect(tx.msaidiziTask.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MSAIDIZI_SCHEDULE_DISPATCH_BLOCKED' }),
      }),
    );
  });

  it.each([
    ['autonomy', autonomy({ enabled: false })],
    ['autopilot', autonomy({ autopilotEnabled: false })],
  ])('does not inspect due work while %s is disabled', async (_name, policy) => {
    const { prisma, audit } = transactionHarness();
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      policy,
      switches(),
      audit as never,
    );
    await expect(service.dispatchDueSchedules()).resolves.toEqual({
      inspected: 0,
      dispatched: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
    });
    expect(prisma.msaidiziSchedule.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['task worker', { MSAIDIZI_TASK_WORKER_ENABLED: 'false' }],
    ['job worker', { JOB_WORKER_ENABLED: 'false' }],
    ['global kill', { MSAIDIZI_GLOBAL_KILL_SWITCH: 'true' }],
  ])('does not inspect due work when the %s gate is closed', async (_name, values) => {
    const { prisma, audit } = transactionHarness();
    const service = new MsaidiziScheduleDispatcherService(
      prisma as unknown as PrismaService,
      autonomy(),
      switches(values),
      audit as never,
    );
    await service.dispatchDueSchedules();
    expect(prisma.msaidiziSchedule.findMany).not.toHaveBeenCalled();
  });
});
