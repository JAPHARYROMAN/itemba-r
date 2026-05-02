import {
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
  DataQualityIssueType,
  ReportRunStatus,
} from '@prisma/client';
import { DataQualityCheckRunnerService } from './data-quality-check-runner.service';

const prisma = {
  inventoryBalance: { findMany: jest.fn() },
  company: { findMany: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  receivable: { findMany: jest.fn() },
  reportRun: { findMany: jest.fn() },
  fuelDailyReconciliation: { findMany: jest.fn() },
  dataQualityIssue: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

describe('DataQualityCheckRunnerService', () => {
  let service: DataQualityCheckRunnerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataQualityCheckRunnerService(prisma as any);

    prisma.inventoryBalance.findMany.mockResolvedValue([]);
    prisma.company.findMany.mockResolvedValue([]);
    prisma.journalEntry.findMany.mockResolvedValue([]);
    prisma.receivable.findMany.mockResolvedValue([]);
    prisma.reportRun.findMany.mockResolvedValue([]);
    prisma.fuelDailyReconciliation.findMany.mockResolvedValue([]);
    prisma.dataQualityIssue.findFirst.mockResolvedValue(null);
    prisma.dataQualityIssue.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `issue-${data.entityId}`, ...data }),
    );
  });

  it('creates traceable issues for stale report runs and unposted fuel reconciliations', async () => {
    prisma.reportRun.findMany.mockResolvedValue([
      {
        id: 'run-1',
        companyId: 'company-1',
        reportRunNumber: 'RPT-RUN-1',
        status: ReportRunStatus.RUNNING,
      },
    ]);
    prisma.fuelDailyReconciliation.findMany.mockResolvedValue([
      {
        id: 'recon-1',
        companyId: 'company-1',
        reconciliationNumber: 'RECON-1',
        reconciliationDate: new Date('2026-04-20'),
        status: 'APPROVED',
      },
    ]);

    const result = await service.runAll({ companyId: 'company-1' });

    expect(result.issuesFound).toBe(2);
    expect(prisma.dataQualityIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'ReportRun',
          entityId: 'run-1',
          issueType: DataQualityIssueType.INCONSISTENT_STATUS,
          severity: DataQualityIssueSeverity.MEDIUM,
          metadata: expect.objectContaining({ checkKey: 'stale_report_run' }),
        }),
      }),
    );
    expect(prisma.dataQualityIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'FuelDailyReconciliation',
          entityId: 'recon-1',
          issueType: DataQualityIssueType.UNRECONCILED_RECORD,
          severity: DataQualityIssueSeverity.HIGH,
          metadata: expect.objectContaining({
            checkKey: 'unposted_fuel_daily_reconciliation',
          }),
        }),
      }),
    );
  });

  it('does not duplicate open or acknowledged issues for the same entity and issue type', async () => {
    prisma.inventoryBalance.findMany.mockResolvedValue([
      {
        id: 'balance-1',
        companyId: 'company-1',
        productId: 'product-1',
        inventoryLocationId: 'location-1',
        quantityOnHand: -5,
      },
    ]);
    prisma.dataQualityIssue.findFirst.mockResolvedValue({
      id: 'existing-issue',
      status: DataQualityIssueStatus.ACKNOWLEDGED,
    });

    const result = await service.runAll({ companyId: 'company-1' });

    expect(result.issuesFound).toBe(0);
    expect(result.existingOpenCount).toBe(1);
    expect(prisma.dataQualityIssue.create).not.toHaveBeenCalled();
  });

  it('scopes all check queries to the current company when supplied', async () => {
    await service.runAll({ companyId: 'company-1' });

    expect(prisma.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
    expect(prisma.reportRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
    expect(prisma.fuelDailyReconciliation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
  });
});
