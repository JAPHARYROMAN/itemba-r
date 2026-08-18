import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  it('returns supplier lists in deterministic alphabetical order', async () => {
    const prisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as any;
    const service = new SuppliersService(
      prisma,
      { log: jest.fn() } as any,
      { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }) } as any,
    );

    await service.findAll({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }, { supplierCode: 'asc' }],
      }),
    );
  });

  it('searches supplier identity and contact fields', async () => {
    const prisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as any;
    const service = new SuppliersService(
      prisma,
      { log: jest.fn() } as any,
      { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }) } as any,
    );

    await service.findAll({ search: 'Mabati' }, { id: 'user-1' } as any);

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'Mabati', mode: 'insensitive' } },
            { legalName: { contains: 'Mabati', mode: 'insensitive' } },
            { contactPerson: { contains: 'Mabati', mode: 'insensitive' } },
            { address: { contains: 'Mabati', mode: 'insensitive' } },
            { vrn: { contains: 'Mabati', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });
});
