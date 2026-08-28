import { PriceListsService } from './price-lists.service';

describe('PriceListsService hard-delete audit attribution', () => {
  it('loads the parent company before deleting a price-list item', async () => {
    const existing = {
      id: 'item-1',
      priceListId: 'price-list-1',
      priceList: { companyId: 'company-1' },
    };
    const prisma = {
      priceListItem: {
        findUnique: jest.fn().mockResolvedValue(existing),
        delete: jest.fn().mockResolvedValue(existing),
      },
    } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new PriceListsService(prisma, auditLogs);

    await service.removeItem('item-1', 'user-1');

    expect(prisma.priceListItem.findUnique).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      include: { priceList: { select: { companyId: true } } },
    });
    expect(prisma.priceListItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PRICE_LIST_ITEM_DELETE',
        entityType: 'PriceListItem',
        entityId: 'item-1',
        userId: 'user-1',
        companyId: 'company-1',
        oldValue: existing,
      }),
    );
  });
});
