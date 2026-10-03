import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecordsService } from './records.service';

/**
 * Party linkage, Phase 2 PR-6: one NoteBook statement across every record of a party,
 * in one currency, reading only records the reader may already see and keeping the
 * single-record debit / credit rules. Identity only: no amount is changed.
 */
const d = (v: string) => new Prisma.Decimal(v);
function setup() {
  const records = [
    {
      id: 'r1',
      kind: 'DEBTOR',
      title: 'Fuel on credit',
      reference: 'NB-1',
      currency: 'TZS',
      amount: d('100.00'),
      settledAmount: d('30.00'),
      recordDate: new Date('2026-09-01'),
      dueDate: null,
      statementStartsOn: null,
      postings: [
        {
          id: 'p1',
          date: new Date('2026-09-01'),
          sequence: 1,
          delta: d('100.00'),
          kind: 'DEBT',
          description: 'Debt recorded',
          reference: 'NB-1',
        },
        {
          id: 'p3',
          date: new Date('2026-09-10'),
          sequence: 1,
          delta: d('-30.00'),
          kind: 'PAYMENT',
          description: 'Payment',
          reference: null,
        },
      ],
    },
    {
      id: 'r2',
      kind: 'DEBTOR',
      title: 'Lunch tab',
      reference: null,
      currency: 'TZS',
      amount: d('25.00'),
      settledAmount: d('0.00'),
      recordDate: new Date('2026-09-05'),
      dueDate: null,
      statementStartsOn: new Date('2026-09-05'),
      postings: [
        {
          id: 'p2',
          date: new Date('2026-09-05'),
          sequence: 1,
          delta: d('25.00'),
          kind: 'DEBT',
          description: 'Debt recorded',
          reference: null,
        },
      ],
    },
    {
      id: 'r3',
      kind: 'DEBTOR',
      title: 'USD advance',
      reference: null,
      currency: 'USD',
      amount: d('10.00'),
      settledAmount: d('0.00'),
      recordDate: new Date('2026-09-06'),
      dueDate: null,
      statementStartsOn: null,
      postings: [
        {
          id: 'p4',
          date: new Date('2026-09-06'),
          sequence: 1,
          delta: d('10.00'),
          kind: 'DEBT',
          description: 'Debt recorded',
          reference: null,
        },
      ],
    },
  ];
  const db: any = {
    customer: {
      findFirst: jest.fn(async () => ({
        id: 'cus-1',
        name: 'Westsides',
        phone: '+255 700 000 001',
        companyId: 'c1',
        company: { name: 'Mwanjalisi' },
      })),
    },
    supplier: { findFirst: jest.fn(async () => null) },
    recordEntry: { findMany: jest.fn(async () => records) },
  };
  db.$transaction = jest.fn(async (work: any) => work(db));
  const companies: any = {
    assertCanAccessCompany: jest.fn(),
    companyWhereFor: jest.fn(async () => ({ companyId: { in: ['c1'] } })),
  };
  const org: any = { recordWhereFor: jest.fn(async () => ({})) };
  const documents: any = { renderLetterheadPdf: jest.fn(async () => Buffer.from('pdf')) };
  const service = new RecordsService(db, companies, org, {} as any, documents);
  return { db, companies, documents, service, user: { id: 'u', permissions: [] } as any };
}

describe('NoteBook party statement', () => {
  it('combines every record of the party in one currency, in posting order, with record titles', async () => {
    const { service, user, db, companies } = setup();
    const s = await service.partyStatement(user, { customerId: 'cus-1', to: '2026-09-30' } as any);
    expect(companies.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1');
    const { where } = db.recordEntry.findMany.mock.calls[0][0];
    expect(where.AND[1]).toEqual({ kind: 'DEBTOR', voidedAt: null, customerId: 'cus-1' });
    expect(where.AND[0].OR[0]).toEqual({ companyId: null, ownerId: 'u' });
    expect(s.currencies).toEqual(['TZS', 'USD']);
    expect(s.record).toMatchObject({
      kind: 'DEBTOR',
      title: '2 NoteBook debtor records',
      counterparty: 'Westsides',
      contact: '+255 700 000 001',
      currency: 'TZS',
      companyId: 'c1',
    });
    expect(s.rows.map((r) => [r.date, r.description, r.debit, r.credit, r.balance])).toEqual([
      ['2026-09-01', 'Fuel on credit · Debt recorded', '100.00', '0.00', '100.00'],
      ['2026-09-05', 'Lunch tab · Debt recorded', '25.00', '0.00', '125.00'],
      ['2026-09-10', 'Fuel on credit · Payment', '0.00', '30.00', '95.00'],
    ]);
    expect(s.closingBalance).toBe('95.00');
    expect(s.startsOn).toBe('2026-09-05');
    expect(s.records.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('switches currency on request and refuses two parties or none', async () => {
    const { service, user } = setup();
    const usd = await service.partyStatement(user, { customerId: 'cus-1', currency: 'USD' } as any);
    expect(usd.record.title).toBe('1 NoteBook debtor record');
    expect(usd.closingBalance).toBe('10.00');
    await expect(service.partyStatement(user, {} as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.partyStatement(user, { customerId: 'cus-1', supplierId: 'sup-1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads creditor records for a supplier and refuses a missing party', async () => {
    const { service, user, db } = setup();
    await expect(
      service.partyStatement(user, { supplierId: 'sup-1' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    db.supplier.findFirst.mockResolvedValue({
      id: 'sup-1',
      name: 'Mwanjalisi Station',
      phone: null,
      companyId: 'c1',
      company: { name: 'Mwanjalisi' },
    });
    db.recordEntry.findMany.mockResolvedValue([]);
    const s = await service.partyStatement(user, { supplierId: 'sup-1' } as any);
    expect(db.recordEntry.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      kind: 'CREDITOR',
      voidedAt: null,
      supplierId: 'sup-1',
    });
    expect(s.record.title).toBe('0 NoteBook creditor records');
    expect(s.balanceSide).toBe('Cr');
  });

  it('exports as CSV with the independent-of-the-ledger basis, or as a letterhead PDF', async () => {
    const { service, user, documents } = setup();
    const csv = await service.exportPartyStatement(user, {
      customerId: 'cus-1',
      format: 'csv',
      to: '2026-09-30',
    } as any);
    expect(csv.mimeType).toContain('text/csv');
    expect(csv.filename).toBe('notebook-customer-statement-cus-1-2026-09-30.csv');
    expect(csv.buffer.toString('utf8')).toContain('independent of the ERP general ledger');
    expect(csv.buffer.toString('utf8')).toContain('"Westsides"');
    const pdf = await service.exportPartyStatement(user, { customerId: 'cus-1' } as any);
    expect(pdf.mimeType).toBe('application/pdf');
    expect(documents.renderLetterheadPdf).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c1', counterparty: 'Westsides' }),
      expect.objectContaining({ title: 'Debtor statement' }),
      user,
    );
  });
});
