import { Prisma } from '@prisma/client';
import {
  loadSettlementJournals,
  recoverSettlementHistory,
  SettlementJournal,
  SettlementDocument,
  summarizeDatedMovements,
} from './settlement-history';

const D = (value: number) => new Prisma.Decimal(value);
const document = {
  id: 'r1',
  reference: 'REC-1',
  amount: D(100),
  paidAmount: D(40),
  journalEntryId: 'invoice',
};
const journal = (overrides: Partial<SettlementJournal> = {}): SettlementJournal => ({
  id: 'legacy',
  journalNumber: 'JE-LEGACY',
  transactionDate: new Date('2026-02-10'),
  description: 'Receivable settlement REC-1',
  referenceId: 'r1',
  reversalOfId: null,
  status: 'POSTED',
  lines: [
    { debit: D(0), credit: D(40), account: { accountSubType: 'ar_control', accountCode: '1100' } },
  ],
  ...overrides,
});
const recover = (
  documents: SettlementDocument[] = [document],
  journals = [journal()],
  modernJournalIds: string[] = [],
  completedAllocations: Array<{ documentId: string; amount: Prisma.Decimal }> = [],
) =>
  recoverSettlementHistory({
    kind: 'customer',
    documents,
    journals,
    modernJournalIds,
    completedAllocations,
  });

describe('dated settlement evidence', () => {
  const mixedDocument = {
    ...document,
    paidAmount: D(60),
    sourceType: 'SalesOrder',
    sourceId: 'sale',
  };
  const mixedJournal = () =>
    journal({
      id: 'invoice',
      referenceType: 'SalesOrder',
      referenceId: 'sale',
      description: 'Sales order SO-1',
      lines: [
        {
          debit: D(40),
          credit: D(0),
          account: { accountSubType: 'ar_control', accountCode: '1100' },
        },
        {
          debit: D(20),
          credit: D(0),
          account: { accountSubType: 'cash_on_hand', accountCode: '1000' },
        },
        { debit: D(40), credit: D(0), account: { accountSubType: 'bank', accountCode: '1020' } },
        {
          debit: D(0),
          credit: D(100),
          account: { accountSubType: 'sales_revenue', accountCode: '4000' },
        },
        {
          debit: D(30),
          credit: D(0),
          account: { accountSubType: 'cost_of_goods_sold', accountCode: '5000' },
        },
        {
          debit: D(0),
          credit: D(30),
          account: { accountSubType: 'inventory_asset', accountCode: '1200' },
        },
      ],
    });

  it('recovers only proved initial cash and bank tenders in a linked sale creation journal', () => {
    const result = recover([mixedDocument], [mixedJournal()]);
    expect(result.history.status).toBe('COMPLETE');
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].credit.toFixed(2)).toBe('60.00');
    expect(result.movements[0]).toMatchObject({
      sourceId: 'invoice',
      date: new Date('2026-02-10'),
    });
    expect(result.movements[0].description).toContain('Initial sale receipt');
    const totals = summarizeDatedMovements(
      [{ date: new Date('2026-02-10'), debit: D(100), credit: D(0) }, ...result.movements],
      new Date('2026-02-01'),
      new Date('2026-02-28'),
    );
    expect(totals.closingBalance.toFixed(2)).toBe('40.00');
  });

  it('does not invent initial receipts when the cash/AR split is ambiguous or source linkage differs', () => {
    const wrongSplit = mixedJournal();
    wrongSplit.lines[1].debit = D(10);
    const ambiguous = recover([mixedDocument], [wrongSplit]);
    expect(ambiguous.movements).toHaveLength(0);
    expect(ambiguous.history.status).toBe('INCOMPLETE');
    const differentSource = recover(
      [mixedDocument],
      [mixedJournal()].map((j) => ({ ...j, referenceId: 'other-sale' })),
    );
    expect(differentSource.movements).toHaveLength(0);
    expect(differentSource.history.status).toBe('INCOMPLETE');
  });

  it('deduplicates initial receipts already represented by a modern payment header', () => {
    const result = recover(
      [mixedDocument],
      [mixedJournal()],
      ['invoice'],
      [{ documentId: 'r1', amount: D(60) }],
    );
    expect(result.movements).toHaveLength(0);
    expect(result.history.status).toBe('COMPLETE');
  });

  it('also accepts a linked sale paid in full when its creation journal has zero AR', () => {
    const creation = mixedJournal();
    creation.lines[0].debit = D(0);
    creation.lines[1].debit = D(60);
    const result = recover([{ ...mixedDocument, paidAmount: D(100) }], [creation]);
    expect(result.history.status).toBe('COMPLETE');
    expect(result.movements[0].credit.toFixed(2)).toBe('100.00');
  });
  it('recovers the existing journal date and reference without manufacturing a payment', () => {
    const result = recover();
    expect(result.history).toMatchObject({
      status: 'COMPLETE',
      recoveredLegacySettlements: 1,
      unresolvedAmount: '0.00',
    });
    expect(result.movements[0]).toMatchObject({
      type: 'ADJUSTMENT',
      sourceId: 'legacy',
      reference: 'JE-LEGACY',
      date: new Date('2026-02-10'),
    });
    expect(result.movements[0].credit.toFixed(2)).toBe('40.00');
    expect(result.movements[0].description).toContain('Historical settlement');
  });

  it('keeps a February settlement out of January and in the February credit total', () => {
    const movements = [
      { date: new Date('2026-01-10'), debit: D(100), credit: D(0) },
      ...recover().movements,
    ];
    const january = summarizeDatedMovements(
      movements,
      new Date('2026-01-01'),
      new Date('2026-01-31T23:59:59.999Z'),
    );
    const february = summarizeDatedMovements(
      movements,
      new Date('2026-02-01'),
      new Date('2026-02-28T23:59:59.999Z'),
    );
    expect(january.closingBalance.toFixed(2)).toBe('100.00');
    expect(february.openingBalance.toFixed(2)).toBe('100.00');
    expect(february.totalCredits.toFixed(2)).toBe('40.00');
    expect(february.closingBalance.toFixed(2)).toBe('60.00');
  });

  it('does not count a modern payment journal a second time', () => {
    const result = recover(
      [document],
      [journal()],
      ['legacy'],
      [{ documentId: 'r1', amount: D(40) }],
    );
    expect(result.movements).toHaveLength(0);
    expect(result.history.status).toBe('COMPLETE');
    expect(result.history.recoveredLegacySettlements).toBe(0);
  });

  it('reports unexplained cumulative paid amounts with no fabricated line or date', () => {
    const result = recover([document], []);
    expect(result.movements).toHaveLength(0);
    expect(result.history).toMatchObject({
      status: 'INCOMPLETE',
      unresolvedAmount: '40.00',
      gaps: [expect.objectContaining({ documentId: 'r1', amount: '40.00' })],
    });
  });

  it('keeps reversed payment history and applies its mirror on the actual reversal date', () => {
    const reversal = journal({
      id: 'mirror',
      journalNumber: 'JE-MIRROR',
      description: 'Reversal',
      reversalOfId: 'legacy',
      transactionDate: new Date('2026-03-02'),
      lines: [
        {
          debit: D(40),
          credit: D(0),
          account: { accountSubType: 'ar_control', accountCode: '1100' },
        },
      ],
    });
    const result = recover(
      [{ ...document, paidAmount: D(0) }],
      [journal({ status: 'REVERSED', reversedBy_: [reversal] })],
    );
    expect(result.history.status).toBe('COMPLETE');
    expect(
      result.movements.map((m) => [
        m.date.toISOString().slice(0, 10),
        m.debit.toFixed(2),
        m.credit.toFixed(2),
      ]),
    ).toEqual([
      ['2026-02-10', '0.00', '40.00'],
      ['2026-03-02', '40.00', '0.00'],
    ]);
  });

  it('does not classify a write-off as cash paid and preserves the pre-write-off debt', () => {
    const result = recover(
      [{ ...document, status: 'WRITTEN_OFF', outstandingAmount: D(0) }],
      [
        journal(),
        journal({
          id: 'writeoff',
          journalNumber: 'JE-WRITEOFF',
          description: 'Receivable write-off REC-1',
          transactionDate: new Date('2026-03-10'),
          lines: [
            {
              debit: D(0),
              credit: D(60),
              account: { accountSubType: 'ar_control', accountCode: '1100' },
            },
          ],
        }),
      ],
    );
    expect(result.history).toMatchObject({ status: 'COMPLETE', recoveredLegacySettlements: 1 });
    expect(result.movements[1].description).toContain('Write-off');
    const totals = summarizeDatedMovements(
      [{ date: new Date('2026-01-10'), debit: D(100), credit: D(0) }, ...result.movements],
      new Date('2026-02-01'),
      new Date('2026-02-28'),
    );
    expect(totals.closingBalance.toFixed(2)).toBe('60.00');
  });

  it('uses only the cancellation mirror, leaving invoice creation to the statement', () => {
    const reversal = journal({
      id: 'cancel',
      description: 'Reversal of sales order',
      journalNumber: 'JE-CANCEL',
      transactionDate: new Date('2026-03-01'),
      reversalOfId: 'invoice',
      lines: [
        {
          debit: D(0),
          credit: D(100),
          account: { accountSubType: 'ar_control', accountCode: '1100' },
        },
      ],
    });
    const result = recover(
      [{ ...document, paidAmount: D(0), status: 'CANCELLED' }],
      [
        journal({
          id: 'invoice',
          description: 'Sales order SO-1',
          status: 'REVERSED',
          reversedBy_: [reversal],
          lines: [
            {
              debit: D(100),
              credit: D(0),
              account: { accountSubType: 'ar_control', accountCode: '1100' },
            },
          ],
        }),
      ],
    );
    expect(result.history.status).toBe('COMPLETE');
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].sourceId).toBe('cancel');
    expect(result.movements[0].credit.toFixed(2)).toBe('100.00');
  });

  it('requires explicit dated write-off and reversal evidence', () => {
    expect(
      recover([{ ...document, paidAmount: D(0), status: 'WRITTEN_OFF' }], []).history.gaps[0]
        .reason,
    ).toContain('write-off journal');
    expect(
      recover([{ ...document, paidAmount: D(0), status: 'CANCELLED' }], []).history.gaps[0].reason,
    ).toContain('accounting reversal');
  });

  it('rejects missing control-account evidence and ignores unrelated document IDs', () => {
    expect(recover([document], [journal({ lines: [] })]).history.status).toBe('INCOMPLETE');
    expect(
      recover([document], [journal({ referenceId: 'foreign-document' })]).movements,
    ).toHaveLength(0);
  });

  it('scopes journal reads to the company and exact document links, including posted mirrors', async () => {
    const db: any = { journalEntry: { findMany: jest.fn().mockResolvedValue([]) } };
    await loadSettlementJournals(db, 'supplier', 'company-1', [document]);
    expect(db.journalEntry.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        companyId: 'company-1',
        deletedAt: null,
        status: { in: ['POSTED', 'REVERSED'] },
        OR: [
          { referenceType: 'Payable', referenceId: { in: ['r1'] } },
          { id: { in: ['invoice'] } },
        ],
      },
      select: { reversedBy_: { where: { companyId: 'company-1', status: 'POSTED' } } },
    });
  });
});
