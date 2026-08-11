import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const DEVICE_SECRET = 'device-secret-device-secret-0001';
const TERMINAL_CODE = 'MPL-TEST0001';
const IDEMPOTENCY_KEY = 'offline-purchase-key-0001';

function repUser(): AuthUser {
  return {
    id: 'rep-1',
    email: 'rep@example.com',
    roles: [],
    permissions: ['mobile_pos_lite.use', 'mobile_pos_lite.purchase'],
    companyId: 'company-1',
    companyAccess: [],
  };
}

function terminalRow() {
  return {
    id: 'terminal-1',
    terminalCode: TERMINAL_CODE,
    name: 'Counter 1',
    status: 'ACTIVE',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    assignedUserId: 'rep-1',
    deviceSecretHash: createHash('sha256').update(DEVICE_SECRET).digest('hex'),
    configVersion: 1,
    creditEnabled: false,
    offlineCashEnabled: true,
    company: { id: 'company-1', name: 'Company', code: 'CO' },
    division: { id: 'division-1', name: 'Division', code: 'DV' },
    branch: { id: 'branch-1', name: 'Branch', code: 'BR' },
    assignedUser: { id: 'rep-1', fullName: 'Rep One', status: 'ACTIVE' },
    salesperson: { id: 'employee-1', fullName: 'Rep One', employeeCode: 'EMP-1' },
    generalCustomer: { id: 'customer-1', name: 'Walk-in', customerCode: 'CUST-1' },
    paymentMethods: [],
  };
}

function stockProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Maize Flour',
    baseUnitId: 'unit-1',
    productType: 'FINISHED_GOODS',
    trackInventory: true,
    defaultPurchasePrice: '1500',
    productFamily: null,
    ...overrides,
  };
}

function chainOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    supplierId: 'supplier-1',
    status: 'CONFIRMED',
    purchaseOrderNumber: 'PO-2026-000001',
    totalAmount: '6000',
    lines: [{ productId: 'product-1', unitId: 'unit-1', quantity: '4', unitCost: '1500' }],
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    mobilePosTerminal: {
      findFirst: jest.fn().mockResolvedValue(terminalRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([stockProduct()]),
    },
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ id: 'po-1' }]),
      delete: jest.fn().mockResolvedValue({}),
    },
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    documentNumberSequence: {
      findFirst: jest.fn().mockResolvedValue({ id: 'seq-1' }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const companyScope: any = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    assertGroupScoped: jest.fn(),
  };
  const auditLogs: any = { log: jest.fn().mockResolvedValue(undefined) };
  const salesOrders: any = {};
  const purchaseOrders: any = {
    create: jest.fn().mockResolvedValue(chainOrder({ status: 'DRAFT' })),
    confirm: jest.fn().mockResolvedValue(chainOrder()),
  };
  const goodsReceivedNotes: any = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 'grn-1', status: 'DRAFT', grnNumber: 'GRN-2026-000001' }),
    approve: jest.fn().mockResolvedValue({ id: 'grn-1', status: 'APPROVED' }),
    post: jest.fn().mockResolvedValue({ id: 'grn-1', status: 'POSTED' }),
  };
  const codes: any = { next: jest.fn().mockResolvedValue('GRN-2026-000001') };

  const service = new MobilePosLiteService(
    prisma,
    companyScope,
    auditLogs,
    salesOrders,
    purchaseOrders,
    goodsReceivedNotes,
    codes,
  );

  return { service, prisma, purchaseOrders, goodsReceivedNotes, codes, auditLogs };
}

function purchaseDto(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: 'supplier-1',
    idempotencyKey: IDEMPOTENCY_KEY,
    lines: [{ productId: 'product-1', quantity: 4 }],
    ...overrides,
  } as any;
}

describe('MobilePosLiteService createPurchase', () => {
  it('runs the full PO -> GRN chain and defaults the unit cost from the product', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        supplierId: 'supplier-1',
        purchaseType: 'STOCK_PURCHASE',
        notes: expect.stringContaining(`[MPL-PURCHASE:${IDEMPOTENCY_KEY}]`),
        lines: [
          expect.objectContaining({
            productId: 'product-1',
            quantity: 4,
            unitId: 'unit-1',
            unitCost: 1500,
          }),
        ],
      }),
      expect.objectContaining({ id: 'rep-1' }),
    );
    expect(purchaseOrders.confirm).toHaveBeenCalledWith('po-1', expect.anything());
    expect(goodsReceivedNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        purchaseOrderId: 'po-1',
        supplierId: 'supplier-1',
        grnNumber: 'GRN-2026-000001',
        lines: [
          expect.objectContaining({
            productId: 'product-1',
            receivedQuantity: 4,
            acceptedQuantity: 4,
            rejectedQuantity: 0,
            unitCost: 1500,
          }),
        ],
      }),
      expect.anything(),
    );
    expect(goodsReceivedNotes.approve).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(goodsReceivedNotes.post).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(prisma.mobilePosTerminal.update).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      grnNumber: 'GRN-2026-000001',
      totalAmount: 6000,
    });
  });

  it('replays a completed purchase without creating or receiving anything again', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.approve).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      grnNumber: 'GRN-2026-000001',
      totalAmount: 6000,
    });
  });

  it('resumes an interrupted chain from its recorded state (approved GRN -> post only)', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CONFIRMED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'APPROVED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.approve).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(result.grnNumber).toBe('GRN-2026-000001');
  });

  it('never receives again when the PO was already received outside this flow', async () => {
    const { service, prisma, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue(null);

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ id: 'po-1', grnNumber: null, totalAmount: 6000 }),
    );
  });

  it('drops its duplicate DRAFT and resumes the winner when a concurrent retry created twins', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    purchaseOrders.create.mockResolvedValue(chainOrder({ id: 'po-2', status: 'DRAFT' }));
    // Pre-check misses, twins query then shows the winner first.
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(chainOrder({ id: 'po-1', status: 'CONFIRMED' }));
    prisma.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-1' }, { id: 'po-2' }]);
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 'po-2' } });
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(result.id).toBe('po-1');
  });

  it('rejects a supplier outside the terminal company/branch scope', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.supplier.findFirst.mockResolvedValue(null);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects products that are unavailable for the terminal', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('One or more products are unavailable for this terminal');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects non-stock products', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([stockProduct({ productType: 'SERVICE' })]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('is not a stock item');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects lines whose product has no resolvable purchase cost', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockProduct({ defaultPurchasePrice: null, productFamily: null }),
    ]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('does not have a purchase cost');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });
});
