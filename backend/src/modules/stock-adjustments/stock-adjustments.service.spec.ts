import { StockAdjustmentsService } from './stock-adjustments.service';

function makeService() {
  const prisma = {
    stockAdjustment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'sa-1', ...data, lines: [] })),
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
  const service = new StockAdjustmentsService(prisma, auditLogs, inventoryMovements, companyScope);
  return { service, prisma };
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
