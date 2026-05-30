import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportsCatalogService } from './reports-catalog.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DataExportStatus, ReportRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type MockPrismaService = PrismaService & {
  salesOrder: { aggregate: jest.Mock; groupBy: jest.Mock };
  reportDefinition: { create: jest.Mock };
  savedReportView: { create: jest.Mock };
  reportRun: { create: jest.Mock };
  financialStatementRun: { findFirst: jest.Mock };
  dataExportLog: { create: jest.Mock };
};

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-A',
    email: 'user-a@itemba.local',
    roles: ['Group Administrator'],
    roleScopes: ['COMPANY'],
    permissions: ['reports.view'],
    companyId: 'company-A',
    companyAccess: [],
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}): MockPrismaService {
  return {
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
    salesOrder: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: {
          totalAmount: 1500,
          paidAmount: 900,
          outstandingAmount: 600,
          discountAmount: 0,
          taxAmount: 0,
        },
      }),
      groupBy: jest.fn().mockResolvedValue([
        {
          customerName: 'Customer A',
          _count: { _all: 1 },
          _sum: { totalAmount: 1000, paidAmount: 700, outstandingAmount: 300, discountAmount: 0 },
        },
        {
          customerName: 'Customer B',
          _count: { _all: 1 },
          _sum: { totalAmount: 500, paidAmount: 200, outstandingAmount: 300, discountAmount: 0 },
        },
      ]),
    },
    reportDefinition: {
      create: jest.fn().mockResolvedValue({
        id: 'definition-A',
        reportCode: 'RDEF-1',
        name: 'Sales margin analysis',
        isSensitive: false,
      }),
    },
    savedReportView: {
      create: jest.fn().mockResolvedValue({ id: 'view-A', name: 'Default view' }),
    },
    reportRun: {
      create: jest.fn().mockResolvedValue({
        id: 'run-A',
        reportRunNumber: 'RBI-1',
        status: ReportRunStatus.COMPLETED,
      }),
    },
    financialStatementRun: {
      findFirst: jest.fn(),
    },
    dataExportLog: {
      create: jest.fn(),
    },
    ...overrides,
  } as unknown as MockPrismaService;
}

function makeService(prisma: MockPrismaService) {
  return new ReportsCatalogService(
    prisma,
    new CompanyScopeService(prisma),
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogsService,
  );
}

describe('ReportsCatalogService enterprise execution', () => {
  it('executes a governed semantic sales query with company scope and lineage metadata', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    const result = await service.semanticQuery(
      {
        datasetKey: 'sales_and_margin',
        dimensions: ['Customer'],
        measures: ['Net sales', 'Outstanding'],
        filters: { companyId: 'company-A' },
      },
      authUser(),
    );

    expect(prisma.salesOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['customerName'],
        where: expect.objectContaining({ companyId: 'company-A', deletedAt: null }),
      }),
    );
    expect(result.dataset.key).toBe('sales_and_margin');
    expect(result.rows).toHaveLength(2);
    expect(result.security.exportAuditRequired).toBe(false);
    expect(result.lineage.sourceSystems).toContain('Sales orders');
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('saves a builder report as definition, saved view, and completed preview run', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    const result = await service.saveBuilderReport(
      {
        name: 'Sales margin analysis',
        datasetKey: 'sales_and_margin',
        dimensions: ['Customer'],
        measures: ['Net sales'],
        filters: { companyId: 'company-A' },
      },
      authUser(),
    );

    expect(prisma.reportDefinition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Sales margin analysis',
          datasetKey: 'sales_and_margin',
          isActive: true,
        }),
      }),
    );
    expect(prisma.savedReportView.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reportDefinitionId: 'definition-A' }) }),
    );
    expect(prisma.reportRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ReportRunStatus.COMPLETED }) }),
    );
    expect(result.preview?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders a report-pack snapshot to a stored export artifact and audit log row', async () => {
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'itemba-report-pack-'));
    const previousExportsDir = process.env.EXPORTS_DIR;
    process.env.EXPORTS_DIR = exportDir;
    const snapshot = {
      id: 'snapshot-A',
      statementRunNumber: 'RPACK-1',
      companyId: 'company-A',
      status: 'GENERATED',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T23:59:59Z'),
      resultSummary: {
        packKey: 'monthly-management-pack',
        snapshotNumber: 'RPACK-1',
        manifestHash: 'source-hash',
        filters: { companyId: 'company-A', currency: 'TZS' },
        sectionManifest: [{ sequence: 1, name: 'Executive summary', status: 'READY' }],
        prerequisiteChecks: [{ name: 'Accounting period exists', status: 'READY' }],
        includedReports: [{ id: 'finance.profit-and-loss', name: 'Profit and Loss', sector: 'FINANCE' }],
        dataQualityWarnings: [],
      },
    };
    const prisma = makePrisma({
      financialStatementRun: { findFirst: jest.fn().mockResolvedValue(snapshot) },
      dataExportLog: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'export-A', exportNumber: 'RPKEXP-1', ...data }),
        ),
      },
    });
    const service = makeService(prisma);

    try {
      const result = await service.renderReportPack(
        'monthly-management-pack',
        { companyId: 'company-A', snapshotId: 'snapshot-A', format: 'CSV' },
        authUser(),
      );

      expect(result.artifact.format).toBe('CSV');
      expect(result.artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(result.artifact.filePath)).toBe(true);
      expect(prisma.dataExportLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DataExportStatus.COMPLETED,
            fileName: result.artifact.fileName,
            filePath: result.artifact.filePath,
          }),
        }),
      );
    } finally {
      process.env.EXPORTS_DIR = previousExportsDir;
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
