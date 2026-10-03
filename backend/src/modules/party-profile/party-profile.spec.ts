import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartyProfileService } from './party-profile.service';

/**
 * Party linkage, Phase 2 PR-4: profile sections are read lazily, each under its own
 * register permission, inside the party's company and the reader's organisation scope,
 * and come back in one row shape.
 */
const d = (n: number) => new Prisma.Decimal(n);
function setup(permissions: string[]) {
  const db: any = {
    supplier: { findFirst: jest.fn(async () => ({ id: 'sup-1', companyId: 'c1' })) },
    customer: { findFirst: jest.fn(async () => ({ id: 'cus-1', companyId: 'c1' })) },
    supplierPayment: {
      findMany: jest.fn(async () => [
        {
          id: 'p1',
          paymentNumber: 'SPY-3',
          paymentDate: new Date('2026-09-30T00:00:00.000Z'),
          amount: d(100),
          currency: 'TZS',
          status: 'COMPLETED',
          method: 'CASH',
          reference: 'R1',
        },
      ]),
      count: jest.fn(async () => 1),
    },
    cashDeskMovement: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    document: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    customerPackageBalance: {
      findMany: jest.fn(async () => [
        {
          id: 'b1',
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
          quantityOwedByCustomer: d(3),
          quantityOwedToCustomer: d(0),
          depositBalance: d(1500),
          returnablePackage: { name: 'Crate', packageCode: 'CR-1' },
        },
      ]),
      count: jest.fn(async () => 1),
    },
  };
  const companies = { assertCanAccessCompany: jest.fn() };
  const org = { recordWhereFor: jest.fn(async () => ({ branchId: { in: ['b1'] } })) };
  const service = new PartyProfileService(db, companies as any, org as any);
  return { db, companies, org, service, user: { id: 'u', permissions } as any };
}

describe('Party profile sections', () => {
  it('refuses an unknown section, and a section without its own permission, before reading', async () => {
    const { service, user, db } = setup(['suppliers.view']);
    await expect(service.supplier(user, 'sup-1', 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.supplier(user, 'sup-1', 'payments')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('reads a supplier section inside the company and organisation scope and maps rows uniformly', async () => {
    const { service, user, db, companies } = setup(['supplier-payments.view']);
    const page = await service.supplier(user, 'sup-1', 'payments');
    expect(companies.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1');
    const { where } = db.supplierPayment.findMany.mock.calls[0][0];
    expect(where).toEqual({
      companyId: 'c1',
      deletedAt: null,
      branchId: { in: ['b1'] },
      supplierId: 'sup-1',
    });
    expect(db.supplierPayment.count).toHaveBeenCalledWith({ where });
    expect(page).toEqual({
      section: 'payments',
      total: 1,
      rows: [
        {
          id: 'p1',
          number: 'SPY-3',
          date: '2026-09-30T00:00:00.000Z',
          amount: '100.00',
          currency: 'TZS',
          status: 'COMPLETED',
          detail: 'CASH · R1',
          link: null,
        },
      ],
    });
  });

  it('scopes Cash Desk movements through their accounts and documents through ownership or attachments', async () => {
    const { service, user, db } = setup(['cash_desk.view', 'documents.view']);
    await service.supplier(user, 'sup-1', 'cash');
    expect(db.cashDeskMovement.findMany.mock.calls[0][0].where).toEqual({
      supplierId: 'sup-1',
      entries: { some: { account: { companyId: 'c1', branchId: { in: ['b1'] } } } },
    });
    await service.supplier(user, 'sup-1', 'documents');
    const docs = db.document.findMany.mock.calls[0][0].where;
    expect(docs.OR).toHaveLength(3);
    expect(docs.OR).toContainEqual({ ownerType: 'SUPPLIER', ownerId: 'sup-1' });
    expect(docs.AND).toContainEqual({ OR: [{ companyId: 'c1' }, { companyId: null }] });
    expect(docs.AND).toContainEqual({
      OR: [{ divisionId: null, branchId: null }, { branchId: { in: ['b1'] } }],
    });
  });

  it('lists a customer package balance with its quantities and deposit', async () => {
    const { service, user, db } = setup(['customers.view']);
    const page = await service.customer(user, 'cus-1', 'packages');
    expect(db.customerPackageBalance.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'c1',
      customerId: 'cus-1',
    });
    expect(page.rows[0]).toMatchObject({
      number: 'Crate',
      amount: '1500.00',
      detail: 'CR-1 · Owed by customer 3.00 · Owed to customer 0.00',
      link: null,
    });
  });
});
