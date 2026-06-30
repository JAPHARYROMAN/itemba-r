import { BadRequestException } from '@nestjs/common';
import { ThreeWayMatchingService } from './three-way-matching.service';

function makeService(overrides: { existingMatch?: any } = {}) {
  const purchaseOrder = {
    id: 'po-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    lines: [{ productId: 'p1', quantity: 10, unitCost: 5, lineTotal: 50 }],
  };
  const supplierInvoice = {
    id: 'inv-1',
    companyId: 'company-1',
    totalAmount: 50,
    lines: [{ productId: 'p1', quantity: 10, discountAmount: 0, taxAmount: 0 }],
  };

  const prisma = {
    threeWayMatch: {
      // First call is the duplicate guard (defaults to no duplicate), then the create.
      findFirst: jest.fn().mockResolvedValue(overrides.existingMatch ?? null),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 'twm-1', ...data })),
    },
    purchaseOrder: { findFirst: jest.fn().mockResolvedValue(purchaseOrder) },
    supplierInvoice: { findFirst: jest.fn().mockResolvedValue(supplierInvoice) },
    goodsReceivedNote: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = { resolve: jest.fn() } as any;
  const postingEngine = { postLines: jest.fn() } as any;
  const codes = { next: jest.fn().mockResolvedValue('TWM-2026-000007') } as any;

  const service = new ThreeWayMatchingService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );

  return { service, prisma, codes };
}

const user = { id: 'user-1' } as any;
const dto = {
  matchNumber: 'CLIENT-SUPPLIED-999',
  companyId: 'company-1',
  purchaseOrderId: 'po-1',
  supplierInvoiceId: 'inv-1',
} as any;

describe('ThreeWayMatchingService.create', () => {
  it('server-generates matchNumber via codes.next and ignores the client field', async () => {
    const { service, prisma, codes } = makeService();

    const result = await service.create(dto, user);

    expect(codes.next).toHaveBeenCalledWith({
      entityType: 'ThreeWayMatch',
      companyId: 'company-1',
    });
    expect(prisma.threeWayMatch.create).toHaveBeenCalledTimes(1);
    const created = prisma.threeWayMatch.create.mock.calls[0][0].data;
    expect(created.matchNumber).toBe('TWM-2026-000007');
    expect(result.matchNumber).toBe('TWM-2026-000007');
  });

  it('rejects a second active match for the same supplier invoice', async () => {
    const { service, prisma, codes } = makeService({
      existingMatch: { id: 'twm-existing' },
    });

    await expect(service.create(dto, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
    expect(codes.next).not.toHaveBeenCalled();
  });

  it('keeps the computed variance intact (MATCHED with zero variance for an equal invoice)', async () => {
    const { service, prisma } = makeService();

    await service.create(dto, user);

    const created = prisma.threeWayMatch.create.mock.calls[0][0].data;
    expect(created.matchStatus).toBe('MATCHED');
    expect(Number(created.quantityVariance)).toBe(0);
    expect(Number(created.amountVariance)).toBe(0);
  });
});
