import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartyLinksService, normalisePartyName } from './party-links.service';

const d = (v: string | number) => new Prisma.Decimal(v);
const viewer = {
  id: 'u1',
  fullName: 'Finance',
  email: 'f@example.invalid',
  permissions: ['party_links.view'],
} as any;
const linker = {
  ...viewer,
  permissions: [
    'party_links.view',
    'party_links.manage',
    'customers.update',
    'suppliers.update',
    'receivables.manage',
    'records.manage',
  ],
};

function empty() {
  return { findMany: jest.fn(async () => []) };
}
function setup(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    $executeRawUnsafe: jest.fn(async () => 1),
    receivable: {
      findFirst: jest.fn(async () => ({
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        customerName: 'Acme Ltd',
        customerId: null,
      })),
      update: jest.fn(async ({ data }: any) => data),
      aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d('0') } })),
    },
    recordEntry: {
      findFirst: jest.fn(async () => ({
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        kind: 'DEBTOR',
        counterparty: 'Acme Ltd',
        supplierId: null,
        customerId: null,
      })),
      update: jest.fn(async ({ data }: any) => data),
    },
    recordEvent: { create: jest.fn(async ({ data }: any) => data) },
    customer: {
      findFirst: jest.fn(async () => ({ id: 'cus-1', name: 'Acme Ltd' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    supplier: { findFirst: jest.fn(async () => null) },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    salesDeskSale: empty(),
    invoiceDeskInvoice: empty(),
    cashDeskMovement: empty(),
    journalEntry: empty(),
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    cashDeskMovement: empty(),
    expense: empty(),
    recordEntry: empty(),
    recordBookExpense: empty(),
    debt: empty(),
    contract: empty(),
    loan: empty(),
    receivable: empty(),
    payable: empty(),
    company: { findMany: jest.fn(async () => [{ id: 'company-1', name: 'Westsides' }]) },
    supplier: { findMany: jest.fn(async () => []) },
    customer: { findMany: jest.fn(async () => []) },
    ...overrides,
  };
  const audit = { logStrictInTransaction: jest.fn() } as any;
  const companies = {
    companyWhereFor: jest.fn(async () => ({})),
    assertCanAccessCompany: jest.fn(),
  } as any;
  const org = { recordWhereFor: jest.fn(async () => ({})), assertCanAccessScope: jest.fn() } as any;
  const service = new PartyLinksService(prisma, audit, companies, org);
  return { service, prisma, tx, audit };
}

describe('normalisePartyName', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalisePartyName('  ACME, Ltd.  ')).toBe('acme ltd');
    expect(normalisePartyName('Acme Ltd')).toBe('acme ltd');
    expect(normalisePartyName(null)).toBe('');
  });
});

describe('PartyLinksService.unlinked', () => {
  it('groups rows by source, company, kind and normalised name, totals per currency, and suggests only a unique master', async () => {
    const { service } = setup({
      receivable: {
        findMany: jest.fn(async () => [
          {
            id: 'r1',
            companyId: 'company-1',
            divisionId: null,
            branchId: null,
            customerName: 'Acme Ltd',
            outstandingAmount: d('100'),
            currency: 'TZS',
            issueDate: new Date('2026-09-01'),
            receivableNumber: 'REC-1',
          },
          {
            id: 'r2',
            companyId: 'company-1',
            divisionId: null,
            branchId: null,
            customerName: 'ACME, ltd',
            outstandingAmount: d('50'),
            currency: 'TZS',
            issueDate: new Date('2026-09-05'),
            receivableNumber: 'REC-2',
          },
          {
            id: 'r3',
            companyId: 'company-1',
            divisionId: null,
            branchId: null,
            customerName: 'Beta Co',
            outstandingAmount: d('10'),
            currency: 'USD',
            issueDate: new Date('2026-09-02'),
            receivableNumber: 'REC-3',
          },
        ]),
      },
      customer: {
        findMany: jest.fn(async () => [
          { id: 'cus-1', name: 'Acme Ltd', legalName: null, companyId: 'company-1' },
          { id: 'cus-2', name: 'Beta Co', legalName: null, companyId: 'company-1' },
          { id: 'cus-3', name: 'Beta Co.', legalName: null, companyId: 'company-1' },
        ]),
      },
    });
    const result = await service.unlinked(viewer, {});
    expect(result.counts.receivables).toBe(3);
    const acme = result.groups.find((g) => g.name === 'Acme Ltd')!;
    expect(acme).toMatchObject({
      source: 'receivables',
      kind: 'customer',
      rows: 2,
      rowIds: ['r1', 'r2'],
      companyName: 'Westsides',
    });
    expect(acme.totals).toEqual([{ currency: 'TZS', amount: '150.00' }]);
    expect(acme.suggestion).toEqual({ id: 'cus-1', name: 'Acme Ltd' });
    const beta = result.groups.find((g) => g.name === 'Beta Co')!;
    expect(beta.suggestion).toBeNull(); // two masters normalise to the same name: never guess
  });

  it('requires the view permission', async () => {
    const { service } = setup();
    await expect(service.unlinked({ ...viewer, permissions: [] }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('PartyLinksService.link', () => {
  it('links a receivable to an active customer in the same company, refreshes the cached balance and audits', async () => {
    const { service, tx, audit } = setup();
    const result = await service.link(linker, 'receivables', 'r1', 'cus-1', 'req-1');
    expect(result).toMatchObject({
      kind: 'customer',
      partyId: 'cus-1',
      partyName: 'Acme Ltd',
      alreadyLinked: false,
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"receivables"'),
      'r1',
    );
    expect(tx.receivable.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { customerId: 'cus-1' },
    });
    expect(tx.customer.updateMany).toHaveBeenCalled();
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'PARTY_LINKED', entityType: 'Receivable', entityId: 'r1' }),
    );
  });

  it('links a NoteBook debtor by identity only: the record and its own event, no ERP table', async () => {
    const { service, tx } = setup();
    await service.link(linker, 'record_entries', 'rec-1', 'cus-1');
    expect(tx.recordEntry.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { customerId: 'cus-1' },
    });
    expect(tx.recordEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PARTY_LINKED' }) }),
    );
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent for the same party and conflicts for a different one', async () => {
    const same = setup();
    same.tx.receivable.findFirst.mockResolvedValue({
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerName: 'Acme Ltd',
      customerId: 'cus-1',
    });
    await expect(same.service.link(linker, 'receivables', 'r1', 'cus-1')).resolves.toMatchObject({
      alreadyLinked: true,
    });
    expect(same.tx.receivable.update).not.toHaveBeenCalled();

    const other = setup();
    other.tx.receivable.findFirst.mockResolvedValue({
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerName: 'Acme Ltd',
      customerId: 'cus-9',
    });
    await expect(other.service.link(linker, 'receivables', 'r1', 'cus-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a master outside the company, a viewer without the source permission, and an unknown source', async () => {
    const missing = setup();
    missing.tx.customer.findFirst.mockResolvedValue(null);
    await expect(missing.service.link(linker, 'receivables', 'r1', 'cus-x')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const { service } = setup();
    await expect(
      service.link(
        { ...linker, permissions: ['party_links.manage', 'customers.update'] },
        'receivables',
        'r1',
        'cus-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.link(linker, 'nope' as any, 'r1', 'cus-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('links every row of a name group in one transaction', async () => {
    const { service, tx } = setup();
    const result = await service.linkMany(linker, 'receivables', ['r1', 'r2', 'r2'], 'cus-1');
    expect(result.linked).toBe(2);
    expect(tx.receivable.update).toHaveBeenCalledTimes(2);
  });
});
