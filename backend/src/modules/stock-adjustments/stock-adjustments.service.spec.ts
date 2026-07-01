import { StockAdjustmentsService } from './stock-adjustments.service';

function makeService() {
  const prisma = {
    stockAdjustment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'sa-1', ...data, lines: [] })),
      findFirst: jest.fn(async () => ({
        id: 'sa-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        status: 'APPROVED',
        approvedById: 'approver-1',
        approvedAt: new Date('2026-06-17T00:00:00.000Z'),
        postedAt: null,
        lines: [],
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'sa-1', companyId: 'company-1', ...data })),
    },
    inventoryMovement: {
      count: jest.fn(async () => 0),
    },
    division: {
      findFirst: jest.fn(),
    },
    branch: {
      findFirst: jest.fn(async () => ({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      })),
    },
    product: {
      findMany: jest.fn(async () => [{ id: 'product-1', companyId: 'company-1' }]),
    },
    unitOfMeasure: {
      findMany: jest.fn(async () => [{ id: 'unit-1', companyId: 'company-1' }]),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const postingEngine = {
    postLines: jest.fn().mockResolvedValue({ id: 'je-1', journalNumber: 'JE-1' }),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) => ({
      id: `acct-${role}`,
      accountCode: role,
      accountName: role,
    })),
  } as any;
  const service = new StockAdjustmentsService(
    prisma,
    auditLogs,
    inventoryMovements,
    companyScope,
    postingEngine,
    accountResolver,
  );
  return { service, prisma, postingEngine, accountResolver, inventoryMovements };
}

const user = { id: 'user-1', permissions: ['inventory.adjustments.create'] } as any;

describe('StockAdjustmentsService aliases', () => {
  it('normalizes legacy quantity aliases before saving adjustment lines', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        reason: 'Stock take correction',
        lines: [
          {
            productId: 'product-1',
            systemQty: 60,
            countedQty: 30,
            unitId: 'unit-1',
          },
        ],
      } as any,
      user,
    );

    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              expect.objectContaining({
                systemQuantity: 60,
                countedQuantity: 30,
                varianceQuantity: -30,
              }),
            ],
          },
        }),
      }),
    );
  });
});

describe('StockAdjustmentsService approval revert', () => {
  it('reverts an approved unposted adjustment back to draft and clears approval metadata', async () => {
    const { service, prisma } = makeService();

    await service.revertApproval('sa-1', user);

    expect(prisma.inventoryMovement.count).toHaveBeenCalledWith({
      where: {
        referenceType: 'StockAdjustment',
        referenceId: 'sa-1',
      },
    });
    expect(prisma.stockAdjustment.update).toHaveBeenCalledWith({
      where: { id: 'sa-1' },
      data: {
        status: 'DRAFT',
        approvedById: null,
        approvedAt: null,
      },
    });
  });

  it('blocks revert when inventory movements already exist', async () => {
    const { service, prisma } = makeService();
    prisma.inventoryMovement.count.mockResolvedValue(1);

    await expect(service.revertApproval('sa-1', user)).rejects.toThrow(
      'already has inventory movements',
    );
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });
});
