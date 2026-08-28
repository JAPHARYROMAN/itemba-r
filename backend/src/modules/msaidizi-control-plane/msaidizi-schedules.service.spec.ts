import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EphemeralSecretFingerprintRegistry } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateMsaidiziScheduleDto,
  MsaidiziScheduleConcurrencyMode,
} from './dto/msaidizi-control-plane.dto';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
import { MsaidiziSchedulesService } from './msaidizi-schedules.service';
import { PersistenceSecretGuard } from './persistence-secret-guard';

const USER: AuthUser = {
  id: 'user-1',
  email: 'manager@itemba.local',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['msaidizi.use'],
  companyId: 'company-1',
  companyAccess: [],
};

const TASK_TEMPLATE = {
  title: 'Daily review',
  objective: 'Review expenses',
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
};

const MANDATE_CAPABILITIES = [
  {
    capability: 'ExpensesController.findAll',
    effects: [MsaidiziEffect.READ],
    dataClasses: ['internal'],
  },
];

function schedule(overrides: Record<string, unknown> = {}) {
  const updatedAt = new Date('2026-08-25T00:00:00Z');
  return {
    id: 'schedule-1',
    principalId: 'principal-1',
    mandateId: 'mandate-1',
    createdByUserId: USER.id,
    name: 'Daily review',
    status: MsaidiziScheduleStatus.DRAFT,
    version: 1,
    cronExpression: '0 8 * * *',
    timezone: 'Africa/Nairobi',
    taskTemplate: TASK_TEMPLATE,
    concurrencyMode: 'SKIP',
    nextRunAt: null,
    lastRunAt: null,
    createdAt: updatedAt,
    updatedAt,
    mandate: {
      id: 'mandate-1',
      companyId: USER.companyId,
      status: MsaidiziMandateStatus.SUSPENDED,
      version: 2,
      startsAt: null,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
    ...overrides,
  };
}

function testContext(options: { autopilotEnabled?: boolean } = {}) {
  const prisma = {
    $queryRaw: jest.fn(),
    msaidiziSchedule: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    msaidiziScheduleVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    msaidiziMandate: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
  );
  const mandates = { findOne: jest.fn() };
  const principals = {
    autopilotEnabled: options.autopilotEnabled ?? true,
    findGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }),
  };
  const audit = { log: jest.fn() };
  const service = new MsaidiziSchedulesService(
    prisma as unknown as PrismaService,
    mandates as unknown as MsaidiziMandatesService,
    principals as unknown as MsaidiziPrincipalService,
    new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    audit as unknown as AuditLogsService,
  );
  return { audit, mandates, principals, prisma, service };
}

describe('MsaidiziSchedulesService immutable history', () => {
  it('atomically appends the complete initial snapshot on create', async () => {
    const { mandates, prisma, service } = testContext();
    const created = schedule();
    mandates.findOne.mockResolvedValue({
      id: created.mandateId,
      principalId: created.principalId,
      companyId: USER.companyId,
      status: MsaidiziMandateStatus.DRAFT,
      capabilities: MANDATE_CAPABILITIES,
    });
    prisma.msaidiziSchedule.create.mockResolvedValue(created);

    await expect(
      service.create(
        {
          mandateId: created.mandateId,
          name: created.name,
          cronExpression: created.cronExpression,
          timezone: created.timezone,
          taskTemplate: TASK_TEMPLATE,
          concurrencyMode: MsaidiziScheduleConcurrencyMode.SKIP,
        } as CreateMsaidiziScheduleDto,
        USER,
      ),
    ).resolves.toEqual(created);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
      data: {
        scheduleId: created.id,
        version: 1,
        changeType: 'MSAIDIZI_SCHEDULE_CREATE',
        changedByUserId: USER.id,
        principalId: created.principalId,
        mandateId: created.mandateId,
        companyId: USER.companyId,
        createdByUserId: created.createdByUserId,
        name: created.name,
        status: created.status,
        cronExpression: created.cronExpression,
        timezone: created.timezone,
        taskTemplate: TASK_TEMPLATE,
        concurrencyMode: created.concurrencyMode,
        nextRunAt: created.nextRunAt,
        lastRunAt: created.lastRunAt,
        sourceCreatedAt: created.createdAt,
        sourceUpdatedAt: created.updatedAt,
      },
    });
  });

  it('requires the caller version while using version/updatedAt CAS and appending version 2', async () => {
    const { prisma, service } = testContext();
    const existing = schedule();
    const updated = schedule({ name: 'Updated review', version: 2 });
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);
    prisma.msaidiziMandate.findUnique.mockResolvedValue({ capabilities: MANDATE_CAPABILITIES });
    prisma.msaidiziSchedule.updateMany.mockResolvedValue({ count: 1 });
    prisma.msaidiziSchedule.findUnique.mockResolvedValue(updated);

    await expect(
      service.update(existing.id, { expectedVersion: 1, name: 'Updated review' }, USER),
    ).resolves.toEqual(updated);

    expect(prisma.msaidiziSchedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: existing.id,
          status: existing.status,
          version: 1,
          updatedAt: existing.updatedAt,
        }),
        data: expect.objectContaining({ name: 'Updated review', version: { increment: 1 } }),
      }),
    );
    expect(prisma.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduleId: existing.id,
        version: 2,
        changeType: 'MSAIDIZI_SCHEDULE_UPDATE',
        name: 'Updated review',
      }),
    });
  });

  it('rejects an explicitly stale routine version before attempting a write', async () => {
    const { prisma, service } = testContext();
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(schedule());

    await expect(
      service.update('schedule-1', { expectedVersion: 2, name: 'stale' }, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
  });

  it('fails the mutation transaction when its immutable snapshot cannot be appended', async () => {
    const { audit, prisma, service } = testContext();
    const existing = schedule();
    const updated = schedule({ name: 'Updated review', version: 2 });
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);
    prisma.msaidiziMandate.findUnique.mockResolvedValue({ capabilities: MANDATE_CAPABILITIES });
    prisma.msaidiziSchedule.updateMany.mockResolvedValue({ count: 1 });
    prisma.msaidiziSchedule.findUnique.mockResolvedValue(updated);
    prisma.msaidiziScheduleVersion.create.mockRejectedValue(new Error('history unavailable'));

    await expect(
      service.update(existing.id, { expectedVersion: 1, name: 'Updated review' }, USER),
    ).rejects.toThrow('history unavailable');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('arms nextRunAt and appends the activation snapshot under one CAS transaction', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T04:59:30.000Z'));
    try {
      const { prisma, service } = testContext();
      const existing = schedule({
        mandate: {
          ...schedule().mandate,
          status: MsaidiziMandateStatus.ACTIVE,
        },
      });
      const updated = schedule({
        status: MsaidiziScheduleStatus.ACTIVE,
        version: 2,
        nextRunAt: new Date('2026-08-25T05:00:00.000Z'),
        mandate: existing.mandate,
      });
      prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ status: MsaidiziPrincipalStatus.ACTIVE }])
        .mockResolvedValueOnce([
          {
            id: existing.mandateId,
            principalId: existing.principalId,
            status: MsaidiziMandateStatus.ACTIVE,
            version: existing.mandate.version,
            capabilities: MANDATE_CAPABILITIES,
            startsAt: existing.mandate.startsAt,
            expiresAt: existing.mandate.expiresAt,
          },
        ]);
      prisma.msaidiziSchedule.updateMany.mockResolvedValue({ count: 1 });
      prisma.msaidiziSchedule.findUnique.mockResolvedValue(updated);

      await expect(service.activate(existing.id, USER, 1)).resolves.toEqual(updated);
      expect(prisma.msaidiziSchedule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            version: 1,
            updatedAt: existing.updatedAt,
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
            mandate: {
              is: expect.objectContaining({
                id: existing.mandateId,
                version: existing.mandate.version,
                status: MsaidiziMandateStatus.ACTIVE,
              }),
            },
          }),
          data: {
            status: MsaidiziScheduleStatus.ACTIVE,
            version: { increment: 1 },
            nextRunAt: new Date('2026-08-25T05:00:00.000Z'),
          },
        }),
      );
      expect(prisma.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          version: 2,
          status: MsaidiziScheduleStatus.ACTIVE,
          changeType: 'MSAIDIZI_SCHEDULE_ACTIVATE',
        }),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    {
      method: 'pause' as const,
      from: MsaidiziScheduleStatus.ACTIVE,
      to: MsaidiziScheduleStatus.PAUSED,
      action: 'MSAIDIZI_SCHEDULE_PAUSE',
    },
    {
      method: 'archive' as const,
      from: MsaidiziScheduleStatus.DRAFT,
      to: MsaidiziScheduleStatus.ARCHIVED,
      action: 'MSAIDIZI_SCHEDULE_ARCHIVE',
    },
  ])(
    'appends an immutable snapshot when a routine is $method',
    async ({ method, from, to, action }) => {
      const { prisma, service } = testContext();
      const existing = schedule({ status: from });
      const updated = schedule({ status: to, version: 2 });
      prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);
      prisma.msaidiziSchedule.updateMany.mockResolvedValue({ count: 1 });
      prisma.msaidiziSchedule.findUnique.mockResolvedValue(updated);

      await service[method](existing.id, USER, 1);

      expect(prisma.msaidiziSchedule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: from,
            version: 1,
            updatedAt: existing.updatedAt,
          }),
          data: expect.objectContaining({ status: to, version: { increment: 1 } }),
        }),
      );
      expect(prisma.msaidiziScheduleVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 2, status: to, changeType: action }),
      });
    },
  );

  it('scopes history through the live routine before returning immutable versions', async () => {
    const { prisma, service } = testContext();
    const snapshots = [{ scheduleId: 'schedule-1', version: 2 }];
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(schedule());
    prisma.msaidiziScheduleVersion.findMany.mockResolvedValue(snapshots);

    await expect(service.listVersions('schedule-1', USER)).resolves.toEqual(snapshots);
    expect(prisma.msaidiziScheduleVersion.findMany).toHaveBeenCalledWith({
      where: { scheduleId: 'schedule-1' },
      orderBy: { version: 'desc' },
    });
  });

  it('returns 404 when a scoped immutable routine version does not exist', async () => {
    const { prisma, service } = testContext();
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(schedule());
    prisma.msaidiziScheduleVersion.findUnique.mockResolvedValue(null);

    await expect(service.findVersion('schedule-1', 99, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('MsaidiziSchedulesService lifecycle controls', () => {
  it('does not activate a routine unless its mandate is currently active', async () => {
    const { prisma, service } = testContext();
    const existing = schedule();
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);

    await expect(service.activate(existing.id, USER, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks and locks current principal and mandate authority inside activation', async () => {
    const { prisma, service } = testContext();
    const existing = schedule({
      mandate: {
        ...schedule().mandate,
        status: MsaidiziMandateStatus.ACTIVE,
      },
    });
    prisma.msaidiziSchedule.findFirst.mockResolvedValue(existing);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ status: MsaidiziPrincipalStatus.ACTIVE }])
      .mockResolvedValueOnce([
        {
          id: existing.mandateId,
          principalId: existing.principalId,
          status: MsaidiziMandateStatus.SUSPENDED,
          version: existing.mandate.version + 1,
          capabilities: MANDATE_CAPABILITIES,
          startsAt: null,
          expiresAt: existing.mandate.expiresAt,
        },
      ]);

    await expect(service.activate(existing.id, USER, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.msaidiziSchedule.updateMany).not.toHaveBeenCalled();
    expect(prisma.msaidiziScheduleVersion.create).not.toHaveBeenCalled();
  });
});
