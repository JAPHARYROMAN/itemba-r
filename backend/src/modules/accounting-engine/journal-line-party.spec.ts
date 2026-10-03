import { PostingEngineService, partyColumns, partyOf, partyOfLine } from './posting-engine.service';

/**
 * Party linkage, Phase 3 PR-1: the general ledger knows the party. A control line tagged
 * through `partyOf` is persisted with its party; every other line is NONE; an id is never
 * stored under the wrong type.
 */
describe('Journal lines know the party', () => {
  const fakePrisma: any = {
    $queryRaw: jest.fn(async () => []),
    journalEntry: {
      create: jest.fn(async (args: any) => ({
        id: 'je-1',
        journalNumber: args.data.journalNumber,
      })),
    },
    journalEntryLine: { createMany: jest.fn(async () => ({ count: 0 })) },
    chartOfAccount: { count: jest.fn(async (args: any) => args.where.id.in.length) },
  };
  fakePrisma.$transaction = async (fn: any) => fn(fakePrisma);
  const control = { assertPostingAllowed: jest.fn(async () => ({ id: 'period-1' })) } as any;
  const resolver = {
    resolve: async (_company: string, role: string) => ({
      id: role.toLowerCase(),
      accountCode: '1',
      accountName: role,
    }),
  } as any;
  let engine: PostingEngineService;
  beforeEach(() => {
    jest.clearAllMocks();
    engine = new PostingEngineService(fakePrisma, control, resolver);
  });

  it('tags a line only when there is an id and never stores an id under the wrong type', () => {
    expect(partyOf('supplier', 'sup-1')).toEqual({ partyType: 'SUPPLIER', supplierId: 'sup-1' });
    expect(partyOf('customer', 'cus-1')).toEqual({ partyType: 'CUSTOMER', customerId: 'cus-1' });
    expect(partyOf('customer', null)).toEqual({});
    expect(partyOf('supplier', undefined)).toEqual({});
    expect(partyColumns({})).toEqual({ partyType: 'NONE', supplierId: null, customerId: null });
    expect(partyColumns({ supplierId: 'sup-1' })).toEqual({
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      customerId: null,
    });
    expect(
      partyColumns({ partyType: 'CUSTOMER', supplierId: 'sup-1', customerId: 'cus-1' }),
    ).toEqual({
      partyType: 'CUSTOMER',
      supplierId: null,
      customerId: 'cus-1',
    });
  });

  it('postLines persists the party on the tagged control line and NONE on the others', async () => {
    await engine.postLines({
      companyId: 'co-1',
      transactionDate: new Date('2026-10-01'),
      description: 'Supplier payment',
      userId: 'u-1',
      referenceType: 'SupplierPayment',
      referenceId: 'sp-1',
      lines: [
        { accountId: 'ap', debit: 100, ...partyOf('supplier', 'sup-1') },
        { accountId: 'cash', credit: 100 },
      ],
    });
    const { data } = fakePrisma.journalEntryLine.createMany.mock.calls[0][0];
    expect(data).toEqual([
      expect.objectContaining({
        accountId: 'ap',
        partyType: 'SUPPLIER',
        supplierId: 'sup-1',
        customerId: null,
      }),
      expect.objectContaining({
        accountId: 'cash',
        partyType: 'NONE',
        supplierId: null,
        customerId: null,
      }),
    ]);
  });

  it('the built-in AP and AR handlers carry the party from the event payload', async () => {
    await engine.post({
      eventName: 'procurement.payment_made',
      companyId: 'co-1',
      transactionDate: new Date('2026-10-01'),
      description: 'Paid',
      userId: 'u-1',
      payload: { amount: 50, supplierId: 'sup-1' },
    });
    const paid = fakePrisma.journalEntryLine.createMany.mock.calls[0][0].data;
    expect(paid.find((l: any) => l.accountId === 'ap_control')).toMatchObject({
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
    });
    expect(paid.find((l: any) => l.accountId === 'cash_on_hand')).toMatchObject({
      partyType: 'NONE',
    });
    await engine.post({
      eventName: 'sales.confirmed',
      companyId: 'co-1',
      transactionDate: new Date('2026-10-01'),
      description: 'Sold',
      userId: 'u-1',
      payload: { amount: 80, customerId: 'cus-1' },
    });
    const sold = fakePrisma.journalEntryLine.createMany.mock.calls[1][0].data;
    expect(sold.find((l: any) => l.accountId === 'ar_control')).toMatchObject({
      partyType: 'CUSTOMER',
      customerId: 'cus-1',
    });
  });
  it('a reversal rebuilt from stored lines keeps the party of each line and nothing else', () => {
    expect(partyOfLine({ partyType: 'SUPPLIER', supplierId: 'sup-1', customerId: null })).toEqual({
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
    });
    expect(partyOfLine({ partyType: 'CUSTOMER', supplierId: null, customerId: 'cus-1' })).toEqual({
      partyType: 'CUSTOMER',
      customerId: 'cus-1',
    });
    expect(partyOfLine({ partyType: 'NONE', supplierId: null, customerId: null })).toEqual({});
    // A corrupt pair (type without its id) never becomes a tagged reversal.
    expect(partyOfLine({ partyType: 'SUPPLIER', supplierId: null, customerId: 'cus-1' })).toEqual(
      {},
    );
    expect(
      partyColumns({
        accountId: 'ap',
        debit: 0,
        credit: 1,
        ...partyOfLine({ partyType: 'SUPPLIER', supplierId: 'sup-1' }),
      } as any),
    ).toEqual({
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      customerId: null,
    });
  });
});
