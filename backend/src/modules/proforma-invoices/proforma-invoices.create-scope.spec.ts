import { ForbiddenException } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';

describe('ProformaInvoicesService.create company scope', () => {
  it('counts only canonical year-delimited numbers when allocating the next number', async () => {
    const count = jest.fn().mockResolvedValue(7);
    const db = { proformaInvoice: { count } };
    const service = new ProformaInvoicesService({} as any, { log: jest.fn() } as any);
    const allocate = (
      service as unknown as {
        generateProformaNumber(client: typeof db, companyId: string): Promise<string>;
      }
    ).generateProformaNumber.bind(service);
    const year = new Date().getFullYear();

    await expect(allocate(db, 'company-a')).resolves.toBe(`PRF-${year}-00008`);
    expect(count).toHaveBeenCalledWith({
      where: { companyId: 'company-a', proformaNumber: { startsWith: `PRF-${year}-` } },
    });
  });

  it('rejects a cross-company create before opening a transaction', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const service = new ProformaInvoicesService(prisma, { log: jest.fn() } as any);

    await expect(
      service.create(
        {
          companyId: 'company-b',
          customerId: 'customer-b',
          proformaDate: '2031-01-01T00:00:00.000Z',
          currency: 'TZS',
          lines: [],
        },
        {
          id: 'user-a',
          companyId: 'company-a',
          companyAccess: [],
          roleScopes: ['COMPANY'],
          permissions: [],
        } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
