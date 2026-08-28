import { ForbiddenException } from '@nestjs/common';
import { AccessLevel, MobilePosTerminalStatus } from '@prisma/client';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { MobilePosLiteService } from './mobile-pos-lite.service';

const USER = {
  id: 'group-manager',
  companyId: null,
  companyAccess: [{ companyId: 'company-a', accessLevel: AccessLevel.WRITE }],
  roleScopes: ['GROUP'],
  permissions: ['mobile_pos_lite.manage'],
} as any;

function makeHarness() {
  const prisma = {
    mobilePosTerminal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  prisma.$transaction = jest.fn(async (work: (tx: typeof prisma) => unknown) => work(prisma));
  const companyScope = {
    assertGroupScoped: jest.fn(),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['company-a'] } }),
  } as any;
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new MobilePosLiteService(
    prisma,
    companyScope,
    auditLogs,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, companyScope, auditLogs };
}

describe('MobilePosLiteService terminal management company scope', () => {
  it('narrows an unfiltered terminal list to the group principal company grant', async () => {
    const { service, prisma, companyScope } = makeHarness();
    prisma.mobilePosTerminal.findMany.mockImplementation(({ where }: any) => {
      const allowed = new Set(where.companyId.in);
      return [
        {
          id: 'terminal-a',
          companyId: 'company-a',
          terminalCode: 'MPL-A',
          company: { id: 'company-a', name: 'Company A' },
          status: 'ACTIVE',
          name: 'A',
          assignedUser: { id: 'user-a', fullName: 'User A' },
          paymentMethods: [],
        },
        {
          id: 'terminal-b',
          companyId: 'company-b',
          terminalCode: 'MPL-B',
          company: { id: 'company-b', name: 'Company B' },
          status: 'ACTIVE',
          name: 'B',
          assignedUser: { id: 'user-b', fullName: 'User B' },
          paymentMethods: [],
        },
      ].filter((terminal) => allowed.has(terminal.companyId));
    });

    const terminals = await service.findTerminals({} as any, USER);

    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(USER, undefined);
    expect(prisma.mobilePosTerminal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: { in: ['company-a'] } } }),
    );
    expect(terminals.map((terminal: any) => terminal.company.id)).toEqual(['company-a']);
  });

  it('requires company WRITE before creating or validating a terminal', async () => {
    const { service, prisma, companyScope } = makeHarness();
    const denied = new ForbiddenException('write access required');
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(denied);

    await expect(
      service.createTerminal(
        {
          companyId: 'company-a',
          divisionId: 'division-a',
          branchId: 'branch-a',
          salespersonId: 'employee-a',
          generalCustomerId: 'customer-a',
          name: 'Counter A',
          paymentMethods: [],
        } as any,
        USER,
      ),
    ).rejects.toBe(denied);

    expect(companyScope.assertGroupScoped).toHaveBeenCalledWith(
      USER,
      'provision Mobile POS Lite terminals',
    );
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      'company-a',
      AccessLevel.WRITE,
    );
    expect(prisma.mobilePosTerminal.findFirst).not.toHaveBeenCalled();
    expect(prisma.mobilePosTerminal.create).not.toHaveBeenCalled();
  });

  it('requires company WRITE before issuing a replacement activation secret', async () => {
    const { service, prisma, companyScope, auditLogs } = makeHarness();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue({
      id: 'terminal-a',
      companyId: 'company-a',
      status: MobilePosTerminalStatus.ACTIVE,
    });
    const denied = new ForbiddenException('write access required');
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(denied);

    await expect(service.issueActivation('terminal-a', USER)).rejects.toBe(denied);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      'company-a',
      AccessLevel.WRITE,
    );
    expect(prisma.mobilePosTerminal.update).not.toHaveBeenCalled();
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('returns the activation secret once while persisting and auditing only non-secret data', async () => {
    const { service, prisma, companyScope, auditLogs } = makeHarness();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue({
      id: 'terminal-a',
      companyId: 'company-a',
      status: MobilePosTerminalStatus.ACTIVE,
    });
    prisma.mobilePosTerminal.update.mockResolvedValue({ terminalCode: 'MPL-ABC123' });

    const activation = await service.issueActivation('terminal-a', USER);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      'company-a',
      AccessLevel.WRITE,
    );
    expect(activation).toEqual({
      terminalCode: 'MPL-ABC123',
      activationCode: expect.any(String),
      expiresAt: expect.any(String),
      activationPath: expect.stringContaining('/mobile-pos/activate?terminal=MPL-ABC123&code='),
    });
    const persisted = prisma.mobilePosTerminal.update.mock.calls[0][0].data;
    expect(persisted.activationTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.activationTokenHash).not.toBe(activation.activationCode);
    expect(persisted).not.toHaveProperty('activationCode');
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER.id,
        companyId: 'company-a',
        action: 'MOBILE_POS_LITE_ACTIVATION_ISSUED',
      }),
    );
    expect(auditLogs.logStrictInTransaction.mock.calls[0][1]).not.toHaveProperty('activationCode');
    expect(prisma.mobilePosTerminal.update.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('does not return a replacement activation secret when mandatory audit persistence fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue({
      id: 'terminal-a',
      companyId: 'company-a',
      status: MobilePosTerminalStatus.ACTIVE,
    });
    prisma.mobilePosTerminal.update.mockResolvedValue({ terminalCode: 'MPL-ABC123' });
    const failure = new Error('audit append unavailable');
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.issueActivation('terminal-a', USER)).rejects.toBe(failure);
  });

  it('preserves the existing route permission decorators', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.createTerminal),
    ).toEqual(['mobile_pos_lite.manage']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.issueActivation),
    ).toEqual(['mobile_pos_lite.manage']);
  });
});
