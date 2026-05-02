import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import {
  AccountResolverService,
  AccountRole,
} from '../../common/services/account-resolver.service';

/**
 * Generic posting-rule engine.
 *
 * Domain modules raise an event by name (e.g. `'sales.confirmed'`,
 * `'sales.payment_received'`) along with a payload. A handler registered
 * under that event name returns a balanced set of journal lines, and the
 * engine handles the rest:
 *   - resolves accounts via {@link AccountResolverService} (no hardcoded codes)
 *   - validates `sum(debits) == sum(credits)`
 *   - enforces the period lock via {@link AccountingControlService}
 *   - opens a `$transaction`, creates the JournalEntry, persists lines
 *   - returns the persisted JournalEntry
 *
 * To add a new posting rule, register a {@link PostingHandler} at module init
 * (typically in onModuleInit on a domain module that owns the handler).
 *
 * The Prisma schema includes data-driven AccountingPostingRule rows; those
 * remain available as a future declarative path. This engine runs the
 * imperative (handler-based) path which is faster to write and unit-test.
 */
@Injectable()
export class PostingEngineService {
  private readonly logger = new Logger(PostingEngineService.name);
  private readonly handlers = new Map<string, PostingHandler<any>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingControl: AccountingControlService,
    private readonly accountResolver: AccountResolverService,
  ) {
    this.registerBuiltins();
  }

  /** Register a handler for an event. Replaces any existing registration. */
  register<T>(eventName: string, handler: PostingHandler<T>): void {
    if (this.handlers.has(eventName)) {
      this.logger.warn(`PostingEngine: replacing existing handler for "${eventName}"`);
    }
    this.handlers.set(eventName, handler as PostingHandler<any>);
  }

  hasHandler(eventName: string): boolean {
    return this.handlers.has(eventName);
  }

  /**
   * Run the registered handler for an event, post the resulting JE
   * atomically, and return it.
   */
  async post<T>(event: PostingEvent<T>): Promise<{ id: string; journalNumber: string }> {
    const handler = this.handlers.get(event.eventName);
    if (!handler) {
      throw new BadRequestException(`No posting handler registered for "${event.eventName}"`);
    }

    const period = await this.accountingControl.assertPostingAllowed({
      companyId: event.companyId,
      accountingPeriodId: event.accountingPeriodId,
      transactionDate: event.transactionDate,
      moduleName: event.moduleName ?? event.eventName,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const ctx: PostingContext = {
        tx,
        resolveAccount: (role) => this.accountResolver.resolve(event.companyId, role, tx),
      };

      const lines = await handler({ event, ctx });
      const totals = await this.validatePostingLines(tx, event.companyId, lines);

      const journalNumber = `JE-${event.eventName.toUpperCase().replace(/\W+/g, '_')}-${Date.now().toString(36).toUpperCase()}`;
      const je = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: event.companyId,
          accountingPeriodId: period.id,
          transactionDate: event.transactionDate,
          description: event.description,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          status: 'POSTED',
          createdById: event.userId,
          postedById: event.userId,
          postedAt: new Date(),
          referenceType: event.referenceType,
          referenceId: event.referenceId,
        },
      });

      await tx.journalEntryLine.createMany({
        data: lines.map((l) => ({
          journalEntryId: je.id,
          companyId: event.companyId,
          accountId: l.accountId,
          description: l.description ?? event.description,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
        })),
      });

      return { id: je.id, journalNumber };
    });

    return result;
  }

  /**
   * Post a balanced set of already-resolved account lines through the same
   * canonical JournalEntry creation path used by handler-based postings.
   * Domain modules should use this when the source workflow has already
   * resolved exact ledger accounts and is running inside its own transaction.
   */
  async postLines(
    input: DirectPostingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; journalNumber: string }> {
    const period = await this.accountingControl.assertPostingAllowed({
      companyId: input.companyId,
      accountingPeriodId: input.accountingPeriodId,
      transactionDate: input.transactionDate,
      moduleName: input.moduleName,
    });

    const run = async (db: Prisma.TransactionClient) => {
      const totals = await this.validatePostingLines(db, input.companyId, input.lines);
      const journalNumber =
        input.journalNumber ??
        `JE-${(input.moduleName ?? input.referenceType ?? 'POSTING').toUpperCase().replace(/\W+/g, '_')}-${Date.now().toString(36).toUpperCase()}`;
      const status = input.status ?? 'POSTED';
      const je = await db.journalEntry.create({
        data: {
          journalNumber,
          companyId: input.companyId,
          divisionId: input.divisionId,
          branchId: input.branchId,
          accountingPeriodId: period.id,
          transactionDate: input.transactionDate,
          description: input.description,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          status,
          createdById: input.userId,
          postedById: status === 'POSTED' ? input.userId : undefined,
          postedAt: status === 'POSTED' ? input.transactionDate : undefined,
        },
      });

      await db.journalEntryLine.createMany({
        data: input.lines.map((line) => ({
          journalEntryId: je.id,
          accountId: line.accountId,
          description: line.description ?? input.description,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          companyId: input.companyId,
          divisionId: line.divisionId ?? input.divisionId,
          branchId: line.branchId ?? input.branchId,
        })),
      });

      return { id: je.id, journalNumber };
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private async validatePostingLines(
    db: Prisma.TransactionClient,
    companyId: string,
    lines: PostingLine[],
  ): Promise<{ totalDebit: number; totalCredit: number }> {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('Posting must contain at least 2 journal lines');
    }

    let debitCents = 0;
    let creditCents = 0;
    const accountIds = new Set<string>();

    for (const line of lines) {
      const debit = this.toCents(line.debit, 'debit');
      const credit = this.toCents(line.credit, 'credit');
      if (debit > 0 && credit > 0) {
        throw new BadRequestException('Each posting line must have only debit or credit, not both');
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException('Each posting line must have a non-zero debit or credit');
      }
      accountIds.add(line.accountId);
      debitCents += debit;
      creditCents += credit;
    }

    if (debitCents !== creditCents) {
      throw new BadRequestException(
        `Posting is unbalanced: debits=${this.fromCents(debitCents)}, credits=${this.fromCents(creditCents)}`,
      );
    }

    const activeAccounts = await db.chartOfAccount.count({
      where: {
        id: { in: Array.from(accountIds) },
        companyId,
        isActive: true,
        deletedAt: null,
      },
    });
    if (activeAccounts !== accountIds.size) {
      throw new BadRequestException(
        'All posting accounts must be active accounts for the posting company',
      );
    }

    return {
      totalDebit: this.fromCents(debitCents),
      totalCredit: this.fromCents(creditCents),
    };
  }

  private toCents(value: Prisma.Decimal | number | undefined, side: 'debit' | 'credit'): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(`Posting ${side} amount must be a non-negative number`);
    }
    const cents = Math.round(numeric * 100);
    if (Math.abs(numeric * 100 - cents) > 1e-6) {
      throw new BadRequestException(`Posting ${side} amount cannot exceed 2 decimal places`);
    }
    return cents;
  }

  private fromCents(cents: number): number {
    return cents / 100;
  }

  // ─── Built-in handlers ────────────────────────────────────────────────────
  //
  // These cover the most common ledger movements. Domain modules can override
  // them or add new handlers via `register()`.

  private registerBuiltins(): void {
    // Sales confirmed: DR AR, CR Income
    this.register<{ amount: number; incomeAccountRole?: AccountRole }>(
      'sales.confirmed',
      async ({ event, ctx }) => {
        const ar = await ctx.resolveAccount('AR_CONTROL');
        // Income account isn't role-fixed (varies by product/service line).
        // The default falls back to a generic 'INCOME_SUMMARY' account that any
        // chart should have; callers are expected to override via their own
        // handler if revenue accounts must be split.
        const income = await ctx.resolveAccount(
          event.payload.incomeAccountRole ?? 'INCOME_SUMMARY',
        );
        return [
          { accountId: ar.id, debit: event.payload.amount, credit: 0, description: 'AR' },
          { accountId: income.id, debit: 0, credit: event.payload.amount, description: 'Income' },
        ];
      },
    );

    // Customer payment received: DR Cash, CR AR
    this.register<{ amount: number }>('sales.payment_received', async ({ event, ctx }) => {
      const cash = await ctx.resolveAccount('CASH_ON_HAND');
      const ar = await ctx.resolveAccount('AR_CONTROL');
      return [
        {
          accountId: cash.id,
          debit: event.payload.amount,
          credit: 0,
          description: 'Cash received',
        },
        { accountId: ar.id, debit: 0, credit: event.payload.amount, description: 'AR settled' },
      ];
    });

    // Supplier invoice received: DR Expense, CR AP. Caller supplies expense role.
    this.register<{ amount: number; expenseAccountRole: AccountRole }>(
      'procurement.invoice_received',
      async ({ event, ctx }) => {
        const expense = await ctx.resolveAccount(event.payload.expenseAccountRole);
        const ap = await ctx.resolveAccount('AP_CONTROL');
        return [
          { accountId: expense.id, debit: event.payload.amount, credit: 0, description: 'Expense' },
          { accountId: ap.id, debit: 0, credit: event.payload.amount, description: 'AP' },
        ];
      },
    );

    // Supplier paid: DR AP, CR Cash
    this.register<{ amount: number }>('procurement.payment_made', async ({ event, ctx }) => {
      const ap = await ctx.resolveAccount('AP_CONTROL');
      const cash = await ctx.resolveAccount('CASH_ON_HAND');
      return [
        { accountId: ap.id, debit: event.payload.amount, credit: 0, description: 'AP settled' },
        { accountId: cash.id, debit: 0, credit: event.payload.amount, description: 'Cash paid' },
      ];
    });
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PostingEvent<T> {
  eventName: string;
  companyId: string;
  /** Optional period for explicit period-lock validation. */
  accountingPeriodId?: string | null;
  transactionDate: Date;
  description: string;
  userId: string;
  /** Used in audit/lock module-name resolution; defaults to eventName. */
  moduleName?: string;
  /** Stored on the JournalEntry so the source of truth is traceable. */
  referenceType?: string;
  referenceId?: string;
  payload: T;
}

export interface PostingLine {
  accountId: string;
  debit?: Prisma.Decimal | number;
  credit?: Prisma.Decimal | number;
  description?: string;
  divisionId?: string | null;
  branchId?: string | null;
}

export interface DirectPostingInput {
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  accountingPeriodId?: string | null;
  transactionDate: Date;
  description: string;
  userId: string;
  moduleName?: string;
  referenceType?: string;
  referenceId?: string;
  journalNumber?: string;
  status?: 'DRAFT' | 'POSTED';
  lines: PostingLine[];
}

export interface PostingContext {
  tx: Prisma.TransactionClient;
  resolveAccount: (
    role: AccountRole,
  ) => Promise<{ id: string; accountCode: string; accountName: string }>;
}

export type PostingHandler<T> = (input: {
  event: PostingEvent<T>;
  ctx: PostingContext;
}) => Promise<PostingLine[]> | PostingLine[];
