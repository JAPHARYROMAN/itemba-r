import { BadRequestException } from '@nestjs/common';
import { PostingEngineService, PostingHandler } from './posting-engine.service';

describe('PostingEngineService', () => {
  let engine: PostingEngineService;

  // The engine touches Prisma + AccountingControlService + AccountResolverService
  // when running `post()`. For these tests we only need to exercise the
  // registry + balance-validation logic; $transaction is implemented as a
  // pass-through so the engine's `tx` shares the same fake client.
  const fakePrisma: any = {
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
  const fakeAccountingControl = {
    assertPostingAllowed: jest.fn(async () => ({ id: 'period-1' })),
  } as any;
  const fakeAccountResolver = {
    resolve: async () => ({ id: 'acc-1', accountCode: '1010', accountName: 'Cash' }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new PostingEngineService(fakePrisma, fakeAccountingControl, fakeAccountResolver);
  });

  describe('handler registry', () => {
    it('comes preloaded with built-in handlers', () => {
      expect(engine.hasHandler('sales.confirmed')).toBe(true);
      expect(engine.hasHandler('sales.payment_received')).toBe(true);
      expect(engine.hasHandler('procurement.invoice_received')).toBe(true);
      expect(engine.hasHandler('procurement.payment_made')).toBe(true);
    });

    it('returns false for unregistered events', () => {
      expect(engine.hasHandler('nope.never_registered')).toBe(false);
    });

    it('register() adds a new handler', () => {
      const handler: PostingHandler<{ amount: number }> = async () => [];
      engine.register('custom.thing', handler);
      expect(engine.hasHandler('custom.thing')).toBe(true);
    });

    it('register() replaces existing handlers', () => {
      const first: PostingHandler<any> = async () => [{ accountId: 'a', debit: 1, credit: 0 }];
      const second: PostingHandler<any> = async () => [{ accountId: 'b', debit: 2, credit: 0 }];
      engine.register('shared', first);
      engine.register('shared', second);
      // Cannot easily inspect internal map without exposing it; the assertion
      // here is that registration succeeds without error and is tracked.
      expect(engine.hasHandler('shared')).toBe(true);
    });
  });

  describe('post()', () => {
    const validEvent = {
      eventName: 'custom.test',
      companyId: 'co-1',
      transactionDate: new Date('2026-04-29'),
      description: 'Test event',
      userId: 'u-1',
      payload: {},
    };

    it('throws when no handler is registered', async () => {
      await expect(engine.post(validEvent)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unbalanced lines', async () => {
      engine.register('custom.test', async () => [
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 50 },
      ]);
      await expect(engine.post(validEvent)).rejects.toThrow(/unbalanced/);
    });

    it('rejects lines that use accounts outside the posting company', async () => {
      fakePrisma.chartOfAccount.count.mockResolvedValueOnce(1);
      engine.register('custom.test', async () => [
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
      ]);

      await expect(engine.post(validEvent)).rejects.toThrow(
        'All posting accounts must be active accounts for the posting company',
      );
    });

    it('rejects sub-cent posting amounts before creating a journal entry', async () => {
      engine.register('custom.test', async () => [
        { accountId: 'a', debit: 100.001, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100.001 },
      ]);

      await expect(engine.post(validEvent)).rejects.toThrow(
        'Posting debit amount cannot exceed 2 decimal places',
      );
      expect(fakePrisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('stores the resolved accounting period on handler-based postings', async () => {
      engine.register('custom.test', async () => [
        { accountId: 'a', debit: 50, credit: 0 },
        { accountId: 'b', debit: 0, credit: 50 },
      ]);

      await engine.post(validEvent);

      expect(fakePrisma.journalEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountingPeriodId: 'period-1' }),
        }),
      );
    });

    it('accepts balanced lines when debits equal credits exactly to cents', async () => {
      engine.register('custom.test', async () => [
        { accountId: 'a', debit: 100.01, credit: 0 },
        { accountId: 'b', debit: 0, credit: 100 },
        { accountId: 'c', debit: 0, credit: 0.01 },
      ]);
      const result = await engine.post(validEvent);
      expect(result.id).toBe('je-1');
      expect(result.journalNumber).toMatch(/^JE-CUSTOM_TEST-/);
    });

    it('accepts balanced lines from built-in sales.confirmed handler', async () => {
      const result = await engine.post({
        ...validEvent,
        eventName: 'sales.confirmed',
        payload: { amount: 1000 },
      });
      expect(result.id).toBe('je-1');
    });
  });

  describe('postLines()', () => {
    it('rejects unbalanced pre-resolved lines before creating a journal entry', async () => {
      await expect(
        engine.postLines({
          companyId: 'co-1',
          transactionDate: new Date('2026-04-29'),
          description: 'Direct posting',
          userId: 'u-1',
          lines: [
            { accountId: 'expense', debit: 100, credit: 0 },
            { accountId: 'cash', debit: 0, credit: 90 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fakePrisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('creates a posted journal entry and lines for balanced pre-resolved lines', async () => {
      const result = await engine.postLines(
        {
          journalNumber: 'JE-DIRECT-1',
          companyId: 'co-1',
          divisionId: 'div-1',
          branchId: 'branch-1',
          transactionDate: new Date('2026-04-29'),
          description: 'Direct posting',
          referenceType: 'Expense',
          referenceId: 'exp-1',
          moduleName: 'expenses',
          userId: 'u-1',
          lines: [
            { accountId: 'expense', debit: 100, credit: 0 },
            { accountId: 'cash', debit: 0, credit: 100 },
          ],
        },
        fakePrisma,
      );

      expect(result).toEqual({ id: 'je-1', journalNumber: 'JE-DIRECT-1' });
      expect(fakeAccountingControl.assertPostingAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'co-1', moduleName: 'expenses' }),
      );
      expect(fakePrisma.journalEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            journalNumber: 'JE-DIRECT-1',
            status: 'POSTED',
            postedById: 'u-1',
            referenceType: 'Expense',
            referenceId: 'exp-1',
          }),
        }),
      );
      expect(fakePrisma.journalEntryLine.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ accountId: 'expense', debit: 100, companyId: 'co-1' }),
            expect.objectContaining({ accountId: 'cash', credit: 100, companyId: 'co-1' }),
          ]),
        }),
      );
    });

    // #30: the period-lock check must run inside the caller-supplied transaction,
    // gating the JournalEntry insert. When the lock check rejects, nothing is
    // written, and the check must happen before any create on the tx client.
    it('validates the period lock inside the caller transaction before inserting', async () => {
      const callOrder: string[] = [];
      const tx: any = {
        journalEntry: {
          create: jest.fn(async (args: any) => {
            callOrder.push('create');
            return { id: 'je-tx', journalNumber: args.data.journalNumber };
          }),
        },
        journalEntryLine: { createMany: jest.fn(async () => ({ count: 0 })) },
        chartOfAccount: { count: jest.fn(async (args: any) => args.where.id.in.length) },
      };
      fakeAccountingControl.assertPostingAllowed.mockImplementationOnce(async () => {
        callOrder.push('assertPostingAllowed');
        return { id: 'period-1' };
      });

      await engine.postLines(
        {
          companyId: 'co-1',
          transactionDate: new Date('2026-04-29'),
          description: 'Direct posting',
          moduleName: 'expenses',
          userId: 'u-1',
          lines: [
            { accountId: 'expense', debit: 100, credit: 0 },
            { accountId: 'cash', debit: 0, credit: 100 },
          ],
        },
        tx,
      );

      // The lock validation ran, and ran before the JE insert on the same tx.
      expect(callOrder).toEqual(['assertPostingAllowed', 'create']);
      expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);
    });

    it('does not insert a journal entry when the period lock check rejects', async () => {
      const tx: any = {
        journalEntry: { create: jest.fn() },
        journalEntryLine: { createMany: jest.fn() },
        chartOfAccount: { count: jest.fn(async (args: any) => args.where.id.in.length) },
      };
      fakeAccountingControl.assertPostingAllowed.mockRejectedValueOnce(
        new BadRequestException('Accounting period is locked'),
      );

      await expect(
        engine.postLines(
          {
            companyId: 'co-1',
            transactionDate: new Date('2026-04-29'),
            description: 'Direct posting',
            userId: 'u-1',
            lines: [
              { accountId: 'expense', debit: 100, credit: 0 },
              { accountId: 'cash', debit: 0, credit: 100 },
            ],
          },
          tx,
        ),
      ).rejects.toThrow('Accounting period is locked');
      expect(tx.journalEntry.create).not.toHaveBeenCalled();
    });
  });
});
