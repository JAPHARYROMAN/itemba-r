import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CompanyScopeService } from '../common/services';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CustomerStatementsService } from './customer-statements/customer-statements.service';
import { SupplierStatementsService } from './supplier-statements/supplier-statements.service';
import { SupplierQuotationsService } from './supplier-quotations/supplier-quotations.service';
import { ThreeWayMatchingService } from './three-way-matching/three-way-matching.service';

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
    customerStatementRun: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    supplierStatementRun: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    customer: { findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
    receivable: { findMany: jest.fn().mockResolvedValue([]) },
    payable: { findMany: jest.fn().mockResolvedValue([]) },
    supplierQuotation: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    threeWayMatch: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchaseOrder: { findFirst: jest.fn() },
    goodsReceivedNote: { findFirst: jest.fn() },
    supplierInvoice: { findFirst: jest.fn() },
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('Procurement and statement company isolation (P0-01 regression)', () => {
  it('customer statement list rejects another company filter before querying runs', async () => {
    const prisma = makePrisma();
    const service = new CustomerStatementsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.findAll({ companyId: 'company-B' }, authUser()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.customerStatementRun.findMany).not.toHaveBeenCalled();
  });

  it('supplier statement generation rejects a supplier outside the selected company', async () => {
    const prisma = makePrisma();
    prisma.supplier.findFirst.mockResolvedValue(null);
    const service = new SupplierStatementsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.generate(
        {
          companyId: 'company-A',
          supplierId: 'supplier-B',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'supplier-B', companyId: 'company-A' }),
      }),
    );
    expect(prisma.supplierStatementRun.create).not.toHaveBeenCalled();
  });

  it('supplier quotation list applies company scope when no query company is supplied', async () => {
    const prisma = makePrisma();
    const service = new SupplierQuotationsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await service.findAll({}, authUser());

    expect(prisma.supplierQuotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: { in: ['company-A'] } }),
      }),
    );
  });

  it('supplier quotation update rejects company reassignment before writing', async () => {
    const prisma = makePrisma();
    prisma.supplierQuotation.findFirst.mockResolvedValue({
      id: 'sq-1',
      companyId: 'company-A',
      status: 'DRAFT',
      lines: [],
    });
    const service = new SupplierQuotationsService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.update('sq-1', { companyId: 'company-B', notes: 'move company' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplierQuotation.update).not.toHaveBeenCalled();
  });

  it('three-way matching rejects cross-company procurement references before creating a match', async () => {
    const prisma = makePrisma();
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);
    const service = new ThreeWayMatchingService(
      prisma,
      auditLogs(),
      new CompanyScopeService(prisma),
    );

    await expect(
      service.create(
        {
          companyId: 'company-A',
          purchaseOrderId: 'po-B',
          matchNumber: 'TWM-1',
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
  });
});
