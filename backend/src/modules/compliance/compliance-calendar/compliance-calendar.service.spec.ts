import { ComplianceObligationStatus } from '@prisma/client';
import { ComplianceCalendarService } from './compliance-calendar.service';

describe('ComplianceCalendarService.findUpcoming', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('excludes terminal obligations while retaining the caller company scope', async () => {
    const complianceObligation = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new ComplianceCalendarService({ complianceObligation } as any);
    const user = {
      companyId: 'company-1',
      companyAccess: [],
      roleScopes: [],
    } as any;

    await service.findUpcoming(user, {});

    const expectedWhere = {
      deletedAt: null,
      dueDate: {
        gte: new Date('2026-08-26T12:00:00.000Z'),
        lte: new Date('2026-11-24T12:00:00.000Z'),
      },
      status: {
        notIn: [
          ComplianceObligationStatus.COMPLETED,
          ComplianceObligationStatus.CANCELLED,
          ComplianceObligationStatus.WAIVED,
        ],
      },
      companyId: { in: ['company-1'] },
    };
    expect(complianceObligation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(complianceObligation.count).toHaveBeenCalledWith({ where: expectedWhere });
  });
});

describe('ComplianceCalendarService.findOverdue', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses a strict past-date filter, excludes terminal obligations, and retains company scope', async () => {
    const complianceObligation = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new ComplianceCalendarService({ complianceObligation } as any);
    const user = {
      companyId: 'company-1',
      companyAccess: [],
      roleScopes: [],
    } as any;

    await service.findOverdue(user, {});

    const expectedWhere = {
      deletedAt: null,
      dueDate: { lt: new Date('2026-08-26T12:00:00.000Z') },
      status: {
        notIn: [
          ComplianceObligationStatus.COMPLETED,
          ComplianceObligationStatus.CANCELLED,
          ComplianceObligationStatus.WAIVED,
        ],
      },
      companyId: { in: ['company-1'] },
    };
    expect(complianceObligation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(complianceObligation.count).toHaveBeenCalledWith({ where: expectedWhere });
  });
});
