import { GlobalSearchService } from './global-search.service';
import { DeskSearchService } from './desk-search.service';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

describe('ERP search destinations', () => {
  it('opens existing detail pages and uses the inventory search parameter', async () => {
    const record = {
      id: 'record & branch',
      name: 'Alpha',
      code: 'ALPHA',
      supplierCode: 'SUP-1',
      productCode: 'ITEM & 1',
      salesOrderNumber: 'SO-1',
      purchaseOrderNumber: 'PO-1',
      supplierInvoices: [],
      currency: 'TZS',
      totalAmount: 100,
      status: 'ACTIVE',
    };
    const delegate = () => ({ findMany: jest.fn().mockResolvedValue([record]) });
    const prisma = {
      company: delegate(),
      supplier: delegate(),
      product: delegate(),
      salesOrder: delegate(),
      purchaseOrder: delegate(),
    };
    const company = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'a' }),
      accessibleCompanyIds: jest.fn().mockResolvedValue(['a']),
    };
    const desks = { search: jest.fn().mockResolvedValue([]) };
    const service = new GlobalSearchService(
      prisma as unknown as PrismaService,
      company as unknown as CompanyScopeService,
      {} as OrganizationScopeService,
      desks as unknown as DeskSearchService,
    );
    const user = {
      id: 'reader',
      companyId: 'a',
      permissions: [
        'companies.read',
        'suppliers.view',
        'products.view',
        'sales.view',
        'purchases.view',
      ],
    } as AuthUser;
    const response = await service.search({ q: 'alpha' }, user);
    expect(response.groups.flatMap((group) => group.results.map((row) => row.href))).toEqual([
      '/companies/record%20%26%20branch',
      '/operations/suppliers/record%20%26%20branch',
      '/inventory?tab=catalog&view=products&q=ITEM%20%26%201',
      '/operations/sales-orders/record%20%26%20branch',
      '/operations/purchase-orders/record%20%26%20branch',
    ]);
    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'a', deletedAt: null }),
      }),
    );
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'a', deletedAt: null }),
      }),
    );
  });
});
