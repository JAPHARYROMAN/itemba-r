import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MsaidiziMandateStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EphemeralSecretFingerprintRegistry } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMsaidiziMandateDto } from './dto/msaidizi-control-plane.dto';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';
import { MsaidiziPrincipalService } from './msaidizi-principal.service';
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

function mandate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mandate-1',
    principalId: 'principal-1',
    companyId: USER.companyId,
    createdByUserId: USER.id,
    name: 'Expense review',
    description: 'Review expenses',
    status: MsaidiziMandateStatus.DRAFT,
    version: 1,
    capabilities: [],
    deviceIds: [],
    budgets: {},
    startsAt: null,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    activatedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-25T00:00:00Z'),
    updatedAt: new Date('2026-08-25T00:00:00Z'),
    ...overrides,
  };
}

function testContext(options: { autopilotEnabled?: boolean } = {}) {
  const prisma = {
    msaidiziMandate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    msaidiziMandateVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    msaidiziDevice: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
  );
  const principals = {
    autopilotEnabled: options.autopilotEnabled ?? true,
    findGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }),
    resolveGlobal: jest.fn().mockResolvedValue({ id: 'principal-1' }),
  };
  const audit = { log: jest.fn() };
  const service = new MsaidiziMandatesService(
    prisma as unknown as PrismaService,
    principals as unknown as MsaidiziPrincipalService,
    new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    audit as unknown as AuditLogsService,
  );
  return { audit, principals, prisma, service };
}

describe('MsaidiziMandatesService immutable history', () => {
  it('atomically appends the complete initial snapshot on create', async () => {
    const { prisma, service } = testContext();
    const created = mandate();
    prisma.msaidiziMandate.create.mockResolvedValue(created);

    await expect(
      service.create(
        {
          name: 'Expense review',
          description: 'Review expenses',
          capabilities: [],
          deviceIds: [],
          budgets: {},
        } as CreateMsaidiziMandateDto,
        USER,
      ),
    ).resolves.toEqual(created);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziMandateVersion.create).toHaveBeenCalledWith({
      data: {
        mandateId: created.id,
        version: 1,
        changeType: 'MSAIDIZI_MANDATE_CREATE',
        changedByUserId: USER.id,
        principalId: created.principalId,
        companyId: created.companyId,
        createdByUserId: created.createdByUserId,
        name: created.name,
        description: created.description,
        status: created.status,
        capabilities: created.capabilities,
        deviceIds: created.deviceIds,
        budgets: created.budgets,
        startsAt: created.startsAt,
        expiresAt: created.expiresAt,
        activatedAt: created.activatedAt,
        revokedAt: created.revokedAt,
        sourceCreatedAt: created.createdAt,
        sourceUpdatedAt: created.updatedAt,
      },
    });
  });

  it('uses version/status CAS, increments the version, and snapshots the redacted update', async () => {
    const { prisma, service } = testContext();
    const existing = mandate();
    const updated = mandate({ name: 'password=[REDACTED SECRET]', version: 2 });
    prisma.msaidiziMandate.findFirst.mockResolvedValue(existing);
    prisma.msaidiziMandate.updateMany.mockResolvedValue({ count: 1 });
    prisma.msaidiziMandate.findUnique.mockResolvedValue(updated);

    await service.update(existing.id, { expectedVersion: 1, name: 'password=hunter2' }, USER);

    expect(prisma.msaidiziMandate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: existing.id,
          status: MsaidiziMandateStatus.DRAFT,
          version: 1,
        }),
        data: expect.objectContaining({
          name: expect.not.stringContaining('hunter2'),
          version: { increment: 1 },
        }),
      }),
    );
    expect(prisma.msaidiziMandateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mandateId: existing.id,
        version: 2,
        changeType: 'MSAIDIZI_MANDATE_UPDATE',
        name: 'password=[REDACTED SECRET]',
      }),
    });
  });

  it.each([
    {
      method: 'activate' as const,
      from: MsaidiziMandateStatus.DRAFT,
      to: MsaidiziMandateStatus.ACTIVE,
      action: 'MSAIDIZI_MANDATE_ACTIVATE',
    },
    {
      method: 'suspend' as const,
      from: MsaidiziMandateStatus.ACTIVE,
      to: MsaidiziMandateStatus.SUSPENDED,
      action: 'MSAIDIZI_MANDATE_SUSPEND',
    },
    {
      method: 'revoke' as const,
      from: MsaidiziMandateStatus.DRAFT,
      to: MsaidiziMandateStatus.REVOKED,
      action: 'MSAIDIZI_MANDATE_REVOKE',
    },
  ])(
    'appends an immutable snapshot when a mandate is $method',
    async ({ method, from, to, action }) => {
      const { prisma, service } = testContext();
      const existing = mandate({ status: from });
      const updated = mandate({ status: to, version: 2 });
      prisma.msaidiziMandate.findFirst.mockResolvedValue(existing);
      prisma.msaidiziMandate.updateMany.mockResolvedValue({ count: 1 });
      prisma.msaidiziMandate.findUnique.mockResolvedValue(updated);

      await service[method](existing.id, 1, USER);

      expect(prisma.msaidiziMandate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: from, version: 1 }),
          data: expect.objectContaining({ status: to, version: { increment: 1 } }),
        }),
      );
      expect(prisma.msaidiziMandateVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mandateId: existing.id,
          version: 2,
          status: to,
          changeType: action,
        }),
      });
    },
  );

  it('scopes history through the live mandate before returning immutable versions', async () => {
    const { prisma, service } = testContext();
    const snapshots = [{ mandateId: 'mandate-1', version: 2 }];
    prisma.msaidiziMandate.findFirst.mockResolvedValue(mandate());
    prisma.msaidiziMandateVersion.findMany.mockResolvedValue(snapshots);

    await expect(service.listVersions('mandate-1', USER)).resolves.toEqual(snapshots);
    expect(prisma.msaidiziMandateVersion.findMany).toHaveBeenCalledWith({
      where: { mandateId: 'mandate-1' },
      orderBy: { version: 'desc' },
    });
  });

  it('returns 404 when a scoped immutable version does not exist', async () => {
    const { prisma, service } = testContext();
    prisma.msaidiziMandate.findFirst.mockResolvedValue(mandate());
    prisma.msaidiziMandateVersion.findUnique.mockResolvedValue(null);

    await expect(service.findVersion('mandate-1', 99, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('MsaidiziMandatesService lifecycle controls', () => {
  it('keeps active authority immutable until explicitly suspended', async () => {
    const { prisma, service } = testContext();
    prisma.msaidiziMandate.findFirst.mockResolvedValue(
      mandate({ status: MsaidiziMandateStatus.ACTIVE }),
    );

    await expect(
      service.update('mandate-1', { expectedVersion: 1, name: 'changed' }, USER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when a caller tries to activate while Autopilot is disabled', () => {
    const { service } = testContext({ autopilotEnabled: false });

    expect(() => service.activate('mandate-1', 1, USER)).toThrow(ServiceUnavailableException);
  });
});
