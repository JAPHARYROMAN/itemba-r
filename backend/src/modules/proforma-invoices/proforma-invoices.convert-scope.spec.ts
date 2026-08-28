import { ForbiddenException } from '@nestjs/common';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { ProformaInvoicesService } from './proforma-invoices.service';

const COMPANY_USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

describe('proforma conversion company authorization', () => {
  it('passes the complete authenticated principal from controller to service', async () => {
    const service = { convertToSalesOrder: jest.fn().mockResolvedValue({ id: 'proforma-a' }) };
    const controller = new ProformaInvoicesController(service as any);

    await controller.convertToSalesOrder('proforma-a', COMPANY_USER);

    expect(service.convertToSalesOrder).toHaveBeenCalledWith('proforma-a', COMPANY_USER);
  });

  it('rejects a foreign-company record before creating or updating any business row', async () => {
    const prisma = {
      salesOrder: { create: jest.fn() },
      salesOrderLine: { createMany: jest.fn() },
      proformaInvoice: { update: jest.fn() },
    } as any;
    const audit = { log: jest.fn() } as any;
    const service = new ProformaInvoicesService(prisma, audit);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'proforma-b',
      companyId: 'company-b',
      status: 'ACCEPTED',
    } as any);

    await expect(service.convertToSalesOrder('proforma-b', COMPANY_USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(service.findOne).toHaveBeenCalledWith('proforma-b', COMPANY_USER);
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(prisma.salesOrderLine.createMany).not.toHaveBeenCalled();
    expect(prisma.proformaInvoice.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
