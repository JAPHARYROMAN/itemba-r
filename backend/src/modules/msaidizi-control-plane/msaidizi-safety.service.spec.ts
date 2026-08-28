import { ConflictException } from '@nestjs/common';
import {
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  MsaidiziTaskStatus,
  Prisma,
} from '@prisma/client';
import { MsaidiziSafetyService } from './msaidizi-safety.service';

const user = {
  id: 'user-1',
  email: 'operator@example.com',
  roles: ['oversight'],
  permissions: ['msaidizi.use', 'msaidizi.oversight'],
};

function harness() {
  const principal = {
    id: 'principal-1',
    key: 'global-msaidizi',
    status: MsaidiziPrincipalStatus.ACTIVE,
    updatedAt: new Date('2026-08-25T08:00:00.000Z'),
  };
  const activeSchedule = {
    id: 'schedule-1',
    principalId: principal.id,
    mandateId: 'mandate-1',
    createdByUserId: user.id,
    name: 'Daily review',
    status: MsaidiziScheduleStatus.ACTIVE,
    version: 4,
    cronExpression: '0 8 * * *',
    timezone: 'Africa/Nairobi',
    taskTemplate: {},
    concurrencyMode: 'SKIP',
    nextRunAt: null,
    lastRunAt: null,
    createdAt: new Date('2026-08-25T07:00:00.000Z'),
    updatedAt: new Date('2026-08-25T08:00:00.000Z'),
    mandate: { companyId: 'company-1' },
  };
  const tx = {
    msaidiziPrincipal: {
      findUnique: jest.fn().mockResolvedValue(principal),
      upsert: jest
        .fn()
        .mockImplementation(({ update }: { update: { status: string } }) =>
          Promise.resolve({ ...principal, status: update.status }),
        ),
    },
    msaidiziTask: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { status: string } }) =>
          Promise.resolve(
            where.status === MsaidiziTaskStatus.QUEUED
              ? [{ id: 'queued-1', stateVersion: 2 }]
              : [{ id: 'running-1', stateVersion: 4 }],
          ),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziSchedule: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([activeSchedule]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        ...activeSchedule,
        status: MsaidiziScheduleStatus.PAUSED,
        version: 5,
      }),
    },
    msaidiziScheduleVersion: { create: jest.fn() },
    msaidiziTaskEvent: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const autonomy = {
    principalKey: 'global-msaidizi',
    principalGrants: ['finance.read'],
    enabled: true,
    autopilotEnabled: true,
  };
  const config = { get: jest.fn((_key: string, fallback: string) => fallback) };
  const audit = {
    logStrictInTransaction: jest.fn((client: typeof tx, input: unknown) =>
      client.auditLog.create({ data: input }),
    ),
  };
  const service = new MsaidiziSafetyService(
    prisma as never,
    autonomy as never,
    config as never,
    audit as never,
  );
  return { activeSchedule, service, prisma, tx, principal };
}

describe('MsaidiziSafetyService', () => {
  it('atomically disables the principal, pauses queued work and requests cooperative pause', async () => {
    const { activeSchedule, principal, service, tx } = harness();

    const result = await service.disable(user);

    expect(tx.msaidiziPrincipal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { status: MsaidiziPrincipalStatus.DISABLED },
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ status: MsaidiziTaskStatus.QUEUED }),
        data: expect.objectContaining({ status: MsaidiziTaskStatus.PAUSED }),
      }),
    );
    expect(tx.msaidiziTask.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: MsaidiziTaskStatus.RUNNING }),
        data: expect.objectContaining({ status: MsaidiziTaskStatus.PAUSING }),
      }),
    );
    expect(tx.msaidiziSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        id: activeSchedule.id,
        principalId: 'principal-1',
        status: MsaidiziScheduleStatus.ACTIVE,
      },
      data: {
        status: MsaidiziScheduleStatus.PAUSED,
        version: { increment: 1 },
      },
    });
    expect(tx.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduleId: activeSchedule.id,
        version: 5,
        status: MsaidiziScheduleStatus.PAUSED,
        changeType: 'MSAIDIZI_SCHEDULE_AUTOPILOT_DISABLE',
        changedByUserId: user.id,
      }),
    });
    expect(tx.msaidiziTaskEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ taskId: 'queued-1', actorId: user.id }),
        expect.objectContaining({ taskId: 'running-1', actorId: user.id }),
      ]),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'MSAIDIZI_AUTOPILOT_DISABLED' }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        effectiveAutopilotEnabled: false,
        pausedQueuedTasks: 1,
        pausingRunningTasks: 1,
        pausedSchedules: 1,
      }),
    );
    expect(tx.msaidiziSchedule.count).toHaveBeenCalledWith({
      where: {
        principalId: principal.id,
        status: MsaidiziScheduleStatus.ACTIVE,
      },
    });
  });

  it('retries a serializable write conflict instead of partially releasing the latch', async () => {
    const { prisma, service } = harness();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: '5.22.0',
      }),
    );

    await expect(service.disable(user)).resolves.toEqual(
      expect.objectContaining({ operatorLatch: 'DISABLED' }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('never silently skips a routine that remains active after a lost update', async () => {
    const { activeSchedule, prisma, service, tx } = harness();
    tx.msaidiziSchedule.updateMany.mockResolvedValue({ count: 0 });
    tx.msaidiziSchedule.findUnique.mockResolvedValue(activeSchedule);

    await expect(service.disable(user)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.msaidiziScheduleVersion.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('releases only the latch and never resumes tasks or schedules', async () => {
    const { service, tx } = harness();

    const result = await service.enable(user);

    expect(tx.msaidiziPrincipal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: MsaidiziPrincipalStatus.ACTIVE } }),
    );
    expect(tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(tx.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        tasksResumed: 0,
        schedulesActivated: 0,
      }),
    );
  });

  it('reports the persisted latch separately from deployment and external kill switches', async () => {
    const { service, tx } = harness();
    tx.msaidiziSchedule.count.mockResolvedValue(2);
    tx.msaidiziTask.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);

    const result = await service.status();

    expect(result).toEqual(
      expect.objectContaining({
        operatorLatch: MsaidiziPrincipalStatus.ACTIVE,
        effectiveAutopilotEnabled: true,
        externalKillSwitchActive: false,
        activeSchedules: 2,
        readyTasks: 1,
        queuedTasks: 2,
        runningTasks: 3,
        pausingTasks: 4,
        pausedTasks: 5,
      }),
    );
  });
});
