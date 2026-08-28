import { DisbursementsService } from './disbursements.service';

describe('DisbursementsService audit attribution', () => {
  const user = { id: 'user-1' } as any;

  function makeHarness() {
    const run = {
      id: 'run-1',
      payrollRunNumber: 'PAYRUN-1',
      companyId: 'company-1',
      status: 'CALCULATED',
      company: { id: 'company-1', code: 'CMP', name: 'Company One' },
    };
    const tx = { kind: 'transaction-client' };
    const prisma = {
      payrollRun: { findFirst: jest.fn().mockResolvedValue(run) },
      payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const auditLogs = {
      log: jest.fn().mockResolvedValue(undefined),
      logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
    } as any;
    return {
      service: new DisbursementsService(prisma, companyScope, auditLogs),
      prisma,
      tx,
      auditLogs,
    };
  }

  it('writes exactly one attributable row after file generation succeeds', async () => {
    const { service, prisma, tx, auditLogs } = makeHarness();

    await service.generateForRun('run-1', user);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'PAYROLL_DISBURSEMENT_FILES_GENERATED',
        entityType: 'PayrollRun',
        entityId: 'run-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
    expect(prisma.payrollEntry.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('does not claim audit evidence when generation fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.payrollEntry.findMany.mockRejectedValueOnce(new Error('database read failed'));

    await expect(service.generateForRun('run-1', user)).rejects.toThrow('database read failed');
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('does not release the generated manifest when mandatory audit persistence fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(new Error('audit store unavailable'));

    await expect(service.generateForRun('run-1', user)).rejects.toThrow('audit store unavailable');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
