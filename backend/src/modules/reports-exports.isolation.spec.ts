import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CompanyScopeService } from '../common/services';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { DataExportStatus } from '@prisma/client';
import { DataExportsService } from './data-exports/data-exports.service';
import { SavedReportViewsService } from './saved-report-views/saved-report-views.service';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-A',
    email: 'user-a@itemba.local',
    roles: ['Company User'],
    roleScopes: ['COMPANY'],
    permissions: [],
    companyId: 'company-A',
    companyAccess: [],
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
    dataExportLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    backgroundJob: { create: jest.fn() },
    reportRun: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    reportDefinition: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'report-def-A',
        datasetKey: 'sales_summary',
      }),
    },
    savedReportView: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('Reports and exports company isolation (P0-01 regression)', () => {
  it('data export list rejects another company filter before querying logs', async () => {
    const prisma = makePrisma();
    const service = new DataExportsService(prisma, auditLogs(), new CompanyScopeService(prisma));

    await expect(service.findAll(authUser(), { companyId: 'company-B' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.dataExportLog.findMany).not.toHaveBeenCalled();
  });

  it('data export detail rejects records from another company', async () => {
    const prisma = makePrisma();
    prisma.dataExportLog.findFirst.mockResolvedValue({
      id: 'export-B',
      companyId: 'company-B',
    });
    const service = new DataExportsService(prisma, auditLogs(), new CompanyScopeService(prisma));

    await expect(service.findOne('export-B', authUser())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('data export create rejects an unauthorized target company before enqueueing', async () => {
    const prisma = makePrisma();
    const service = new DataExportsService(prisma, auditLogs(), new CompanyScopeService(prisma));

    await expect(
      service.create({ companyId: 'company-B', exportType: 'OTHER' as any }, authUser()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('data export worker transition uses a real IN_PROGRESS status', async () => {
    const prisma = makePrisma();
    prisma.dataExportLog.update = jest.fn().mockResolvedValue({
      id: 'export-A',
      status: DataExportStatus.IN_PROGRESS,
    });
    const service = new DataExportsService(prisma, auditLogs(), new CompanyScopeService(prisma));

    await service.markRunning('export-A');

    expect(prisma.dataExportLog.update).toHaveBeenCalledWith({
      where: { id: 'export-A' },
      data: { status: DataExportStatus.IN_PROGRESS },
    });
  });

  it('saved report view list rejects another company filter before querying views', async () => {
    const prisma = makePrisma();
    const service = new SavedReportViewsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(service.findAll(authUser(), { companyId: 'company-B' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.savedReportView.findMany).not.toHaveBeenCalled();
  });

  it('saved report view create rejects an unauthorized target company before writing', async () => {
    const prisma = makePrisma();
    const service = new SavedReportViewsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.create(
        {
          reportDefinitionId: 'report-def-A',
          companyId: 'company-B',
          name: 'Company B sales',
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.savedReportView.create).not.toHaveBeenCalled();
  });

  it('saved report view update rejects company reassignment before writing', async () => {
    const prisma = makePrisma();
    prisma.savedReportView.findFirst.mockResolvedValue({
      id: 'view-A',
      reportDefinitionId: 'report-def-A',
      userId: 'user-A',
      companyId: 'company-A',
      isShared: false,
    });
    const service = new SavedReportViewsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.update('view-A', { companyId: 'company-B' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.savedReportView.update).not.toHaveBeenCalled();
  });
});
