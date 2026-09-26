import { Prisma } from '@prisma/client';
import { cashDate, checkDailyBalances, payloadKey } from './cash-desk.domain';
import { CashDeskController } from './cash-desk.controller';
import { CashDeskService } from './cash-desk.service';
import { InvoiceDeskService } from '../invoice-desk/invoice-desk.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
const d = (x: string) => new Prisma.Decimal(x);
describe('Cash Desk ledger', () => {
  it('lets a group reader select an explicit company without opening unbounded financial scope', async () => {
    const db = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'company', name: 'Company' }]) },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const companies = new CompanyScopeService(db as any);
    const org = { accessibleIds: jest.fn().mockResolvedValue({ unrestricted: true }) };
    const invoices = new InvoiceDeskService(db as any, companies, org as any, {} as any);
    const service = new CashDeskService(db as any, companies, org as any, {} as any, invoices);
    const reader = {
      id: 'group-reader',
      email: 'reader@example.test',
      permissions: [],
      roles: [],
      roleScopes: ['GROUP'],
      companyAccess: [],
    };
    const directory = await service.directory(reader);
    expect(directory).toMatchObject({
      companies: [{ id: 'company', name: 'Company' }],
      requiresCompanySelection: true,
    });
    expect(await companies.companyWhereFor(reader)).toEqual({ id: { in: [] } });
    const selected = await service.directory(reader, 'company');
    expect(selected).toMatchObject({ requiresCompanySelection: false });
    expect(db.branch.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              division: expect.objectContaining({ companyId: 'company' }),
            }),
          ]),
        }),
      }),
    );
    await expect(companies.assertCanAccessCompany(reader, 'company', 'WRITE')).rejects.toThrow();
  });
  it('keeps company readers restricted to their grants when selecting the directory', async () => {
    const db = { company: { findMany: jest.fn() }, branch: { findMany: jest.fn() } };
    const companies = new CompanyScopeService(db as any);
    const org = {};
    const invoices = new InvoiceDeskService(db as any, companies, org as any, {} as any);
    const service = new CashDeskService(db as any, companies, org as any, {} as any, invoices);
    await expect(
      service.directory(
        {
          id: 'company-reader',
          email: 'reader@example.test',
          permissions: [],
          roles: [],
          roleScopes: ['COMPANY'],
          companyId: 'allowed',
          companyAccess: [],
        },
        'other-company',
      ),
    ).rejects.toThrow();
    expect(db.branch.findMany).not.toHaveBeenCalled();
    expect(db.company.findMany).not.toHaveBeenCalled();
  });
  it('preserves exact cents across large amounts', () => {
    expect(
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-01'), amount: d('9999999999999999.99') }],
        new Date('2026-01-02'),
        d('-0.10'),
      ).toFixed(2),
    ).toBe('9999999999999999.89');
  });
  it('rejects a backdated withdrawal funded only by a later receipt', () => {
    expect(() =>
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-10'), amount: d('100') }],
        new Date('2026-01-01'),
        d('-20'),
      ),
    ).toThrow('negative balance on 2026-01-01');
  });
  it('checks all subsequent days when reversing an earlier receipt', () => {
    expect(() =>
      checkDailyBalances(
        [
          { businessDate: new Date('2026-01-01'), amount: d('100') },
          { businessDate: new Date('2026-01-02'), amount: d('-80') },
          { businessDate: new Date('2026-01-03'), amount: d('100') },
        ],
        new Date('2026-01-01'),
        d('-50'),
      ),
    ).toThrow('2026-01-02');
  });
  it('allows receipts and payments within the same business day', () => {
    expect(
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-01'), amount: d('0.30') }],
        new Date('2026-01-01'),
        d('-0.20'),
      ).toFixed(2),
    ).toBe('0.10');
  });
  it.each(['2026-02-30', '2099-01-01', 'garbage', '2026-01-01T12:00:00Z'])(
    'rejects invalid/future business date %s',
    (value) => expect(() => cashDate(value)).toThrow(),
  );
  it('fingerprints retries independent of JSON property order', () => {
    expect(payloadKey({ amount: '20', reference: 'A' })).toBe(
      payloadKey({ reference: 'A', amount: '20' }),
    );
    expect(payloadKey({ amount: '20' })).not.toBe(payloadKey({ amount: '21' }));
  });
  it('requires app access with each write permission', () => {
    for (const [method, permission] of [
      ['create', 'manage'],
      ['record', 'record'],
      ['reverse', 'reverse'],
    ] as const)
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CashDeskController.prototype[method])).toEqual([
        'cash_desk.view',
        `cash_desk.${permission}`,
      ]);
  });
});
