import { AccessLevel } from '@prisma/client';
import { WestsidesReportsService } from './westsides-reports.service';

describe('WestsidesReportsService.saveDailyClose', () => {
  it('requires write access and audits an exact created close', async () => {
    const created = {
      id: 'close-1',
      companyId: 'company-1',
      branchId: null,
      closeDate: new Date('2031-01-15T00:00:00.000Z'),
    };
    const prisma = {
      westsidesDailyClose: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn(),
      },
    } as any;
    const companyScope = { assertCanAccessCompany: jest.fn() } as any;
    const auditLogs = { log: jest.fn() } as any;
    const service = new WestsidesReportsService(prisma, companyScope, auditLogs);
    const user = { id: 'user-1', fullName: 'Evidence User' } as any;

    await service.saveDailyClose(
      {
        companyId: 'company-1',
        closeDate: '2031-01-15T00:00:00.000Z',
        countedByMethod: { CASH: 100 },
        expectedTotal: 100,
        countedTotal: 100,
        varianceTotal: 0,
      },
      user,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-1',
      AccessLevel.WRITE,
    );
    expect(prisma.westsidesDailyClose.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        branchId: null,
        closeDate: new Date('2031-01-15T00:00:00.000Z'),
      },
    });
    expect(prisma.westsidesDailyClose.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          closeDate: new Date('2031-01-15T00:00:00.000Z'),
        }),
      }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WESTSIDES_DAILY_CLOSE_CREATE',
        entityType: 'WestsidesDailyClose',
        entityId: created.id,
        userId: user.id,
        companyId: created.companyId,
        newValue: created,
      }),
    );
  });
});
