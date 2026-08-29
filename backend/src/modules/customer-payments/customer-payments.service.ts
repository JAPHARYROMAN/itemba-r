import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CashAccountType, CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, assertCashAccountForScope } from '../../common/services';
import {
  AccountResolverService,
  AccountRole,
} from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { pagination } from '../../common/utils/pagination';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { QueryCustomerPaymentDto } from './dto/query-customer-payment.dto';
import { ReverseCustomerPaymentDto } from './dto/reverse-customer-payment.dto';
import { CustomerPaymentStatus } from './dto/customer-payment-status.enum';

/**
 * Receivable statuses that still carry an outstanding balance and therefore
 * (a) count toward a customer's `currentBalance`, and (b) can be reduced by a
 * payment allocation. PAID receivables are settled; WRITTEN_OFF / CANCELLED are
 * closed and must NOT have their outstanding restored on reversal.
 */
const OPEN_RECEIVABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** Locked snapshot of a receivable row read FOR UPDATE inside the transaction. */
interface LockedReceivable {
  id: string;
  companyId: string;
  customerId: string | null;
  outstandingAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
}

@Injectable()
export class CustomerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  // ── queries ─────────────────────────────────────────────────────────────────

  async findAll(query: QueryCustomerPaymentDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      customerId,
      cashAccountId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.CustomerPaymentWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (cashAccountId) where.cashAccountId = cashAccountId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) where.paymentDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.paymentDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.customerPayment.findMany({
        where,
        include: this.includeScope(),
        orderBy: { paymentDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.customerPayment.count({ where }),
    ]);

    return {
      data,
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.customerPayment.findFirst({
      where: { id, deletedAt: null },
      include: this.includeScope(),
    });
    if (!record) throw new NotFoundException('Customer payment not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  // ── create (records payment + allocations atomically) ───────────────────────

  async create(dto: CreateCustomerPaymentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;

    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero');

    if (!dto.allocations || dto.allocations.length === 0) {
      throw new BadRequestException('At least one allocation is required');
    }

    // Normalise allocation amounts to Decimal up-front and reject non-positive
    // or duplicate-receivable allocations (a receivable can only be locked +
    // decremented once per payment).
    const seen = new Set<string>();
    const allocations = dto.allocations.map((a) => {
      const allocAmount = new Prisma.Decimal(a.amount).toDecimalPlaces(2);
      if (allocAmount.lte(0)) {
        throw new BadRequestException('Each allocation amount must be greater than zero');
      }
      if (seen.has(a.receivableId)) {
        throw new BadRequestException(
          `Receivable ${a.receivableId} appears in more than one allocation`,
        );
      }
      seen.add(a.receivableId);
      return { receivableId: a.receivableId, amount: allocAmount };
    });

    const allocatedTotal = allocations.reduce(
      (sum, a) => sum.plus(a.amount),
      new Prisma.Decimal(0),
    );
    if (allocatedTotal.gt(amount)) {
      throw new BadRequestException(
        `Allocated total (${allocatedTotal.toString()}) exceeds payment amount (${amount.toString()})`,
      );
    }
    const unapplied = amount.minus(allocatedTotal).toDecimalPlaces(2);

    // Validate customer belongs to the company (scope defaults for division/branch).
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
      select: { companyId: true, divisionId: true, branchId: true, name: true },
    });
    if (!customer || customer.companyId !== dto.companyId) {
      throw new BadRequestException('Customer does not belong to this company');
    }

    // Cash/bank account belongs to the company (and to the payment's
    // division/branch when the dto names one); type drives the GL debit role.
    const cashAccount = await this.resolveCashAccount(
      this.prisma,
      dto.companyId,
      dto.cashAccountId,
      {
        divisionId: dto.divisionId ?? null,
        branchId: dto.branchId ?? null,
      },
    );

    // Guard against mixing currencies on the cash ledger: we increment the cash
    // account's running balance by the payment amount below, so the receipt
    // currency MUST match the cash account currency (mirrors sales-orders).
    const paymentCurrency = dto.currency ?? CurrencyCode.TZS;
    if (cashAccount.currency && cashAccount.currency !== paymentCurrency) {
      throw new BadRequestException(
        `Receipt account currency (${cashAccount.currency}) does not match the payment currency ` +
          `(${paymentCurrency}). Choose a ${paymentCurrency} cash/bank account.`,
      );
    }

    const paymentDate = new Date(dto.paymentDate);
    const divisionId = dto.divisionId ?? cashAccount.divisionId ?? customer.divisionId ?? null;
    const branchId = dto.branchId ?? cashAccount.branchId ?? customer.branchId ?? null;

    const record = await this.prisma.$transaction(async (tx) => {
      // Lock + validate + decrement each target receivable. Locking ordered by
      // id keeps concurrent multi-receivable payments from deadlocking.
      const orderedAllocations = [...allocations].sort((a, b) =>
        a.receivableId < b.receivableId ? -1 : a.receivableId > b.receivableId ? 1 : 0,
      );

      const touchedCustomerIds = new Set<string>();
      for (const alloc of orderedAllocations) {
        const locked = await this.lockReceivable(tx, alloc.receivableId);
        if (!locked) throw new NotFoundException(`Receivable ${alloc.receivableId} not found`);

        // Company + customer scope on EVERY allocated receivable.
        if (locked.companyId !== dto.companyId) {
          throw new BadRequestException(
            `Receivable ${alloc.receivableId} does not belong to this company`,
          );
        }
        if (locked.customerId !== dto.customerId) {
          throw new BadRequestException(
            `Receivable ${alloc.receivableId} does not belong to customer ${dto.customerId}`,
          );
        }
        if (!(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(locked.status)) {
          throw new BadRequestException(
            `Receivable ${alloc.receivableId} is ${locked.status} and cannot receive a payment`,
          );
        }

        const outstanding = new Prisma.Decimal(locked.outstandingAmount);
        if (alloc.amount.gt(outstanding)) {
          throw new BadRequestException(
            `Allocation (${alloc.amount.toString()}) exceeds outstanding amount ` +
              `(${outstanding.toString()}) on receivable ${alloc.receivableId}`,
          );
        }

        const nextOutstanding = outstanding.minus(alloc.amount).toDecimalPlaces(2);
        const nextPaid = new Prisma.Decimal(locked.paidAmount)
          .plus(alloc.amount)
          .toDecimalPlaces(2);
        const nextStatus = nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';

        const updated = await tx.receivable.update({
          where: { id: alloc.receivableId },
          data: {
            outstandingAmount: nextOutstanding,
            paidAmount: nextPaid,
            status: nextStatus,
          },
        });
        await this.syncSalesOrderPaymentFromReceivable(tx, updated);
        if (updated.customerId) touchedCustomerIds.add(updated.customerId);
      }

      const created = await tx.customerPayment.create({
        data: {
          paymentNumber: await this.codes.next({
            entityType: 'CustomerPayment',
            companyId: dto.companyId,
            tx,
          }),
          companyId: dto.companyId,
          divisionId,
          branchId,
          customerId: dto.customerId,
          amount,
          method: dto.method ?? undefined,
          reference: dto.reference ?? null,
          paymentDate,
          appliedAmount: allocatedTotal,
          unappliedAmount: unapplied,
          currency: dto.currency ?? CurrencyCode.TZS,
          status: CustomerPaymentStatus.COMPLETED,
          cashAccountId: dto.cashAccountId,
          notes: dto.notes ?? null,
          createdById: userId,
          allocations: {
            create: allocations.map((a) => ({
              companyId: dto.companyId,
              receivableId: a.receivableId,
              amount: a.amount,
            })),
          },
        },
      });

      // ── GL: DR Cash|Bank (full amount) / CR AR (applied) / CR Advances (unapplied)
      const lines = await this.buildPaymentLines(tx, {
        companyId: dto.companyId,
        cashAccountType: cashAccount.accountType,
        cashAccountName: cashAccount.accountName,
        customerLabel: customer.name ?? dto.customerId,
        fullAmount: amount,
        appliedAmount: allocatedTotal,
        unappliedAmount: unapplied,
      });

      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: dto.companyId,
          divisionId,
          branchId,
          transactionDate: paymentDate,
          description: `Customer payment ${created.paymentNumber}`,
          referenceType: 'CustomerPayment',
          referenceId: created.id,
          moduleName: 'customer-payments',
          userId,
          lines,
        },
        tx,
      );

      const withJournal = await tx.customerPayment.update({
        where: { id: created.id },
        data: { journalEntryId: journalEntry.id },
        include: this.includeScope(),
      });

      // Keep the denormalised CashAccount.currentBalance (a subledger cache of
      // the GL cash position, read by finance/dashboards) consistent with the
      // DR Cash/Bank leg we just posted. Increment by the FULL receipt amount in
      // the SAME transaction — mirrors sales-orders (increment on cash receipt)
      // and is unwound on reverse below. Scoped by companyId to be safe.
      await tx.cashAccount.updateMany({
        where: { id: dto.cashAccountId, companyId: dto.companyId, deletedAt: null },
        data: { currentBalance: { increment: amount } },
      });

      // Sync balances for every customer whose receivables changed (all == this
      // payment's customer, but sync defensively per touched customer).
      for (const cid of touchedCustomerIds) {
        await this.syncCustomerBalance(tx, dto.companyId, cid);
      }

      return withJournal;
    });

    await this.auditLogs.log({
      action: 'CUSTOMER_PAYMENT_CREATE',
      entityType: 'CustomerPayment',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  // ── reverse (COMPLETED -> REVERSED) ─────────────────────────────────────────

  async reverse(id: string, dto: ReverseCustomerPaymentDto, user: AuthUser) {
    const userId = user.id;

    const { before, record, reversal } = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: flip COMPLETED -> REVERSED guarded on the current status so
      // two concurrent reversals race here and exactly one wins (the loser sees
      // count 0). This is the guard against reversing twice.
      const claim = await tx.customerPayment.updateMany({
        where: { id, status: CustomerPaymentStatus.COMPLETED, deletedAt: null },
        data: {
          status: CustomerPaymentStatus.REVERSED,
          reversedById: userId,
          reversedAt: new Date(),
        },
      });

      const current = await tx.customerPayment.findFirst({
        where: { id, deletedAt: null },
        include: { allocations: true },
      });
      if (!current) throw new NotFoundException('Customer payment not found');
      await this.companyScope.assertCanAccessCompany(user, current.companyId, AccessLevel.MANAGE);

      if (claim.count !== 1) {
        throw new ConflictException(
          `Customer payment cannot be reversed from status ${current.status}; ` +
            `only COMPLETED payments can be reversed`,
        );
      }

      // Restore each allocated receivable's outstanding balance. Lock FOR UPDATE
      // and guard against CANCELLED / WRITTEN_OFF receivables (their outstanding
      // must NOT be resurrected).
      const touchedCustomerIds = new Set<string>();
      const ordered = [...current.allocations].sort((a, b) =>
        a.receivableId < b.receivableId ? -1 : a.receivableId > b.receivableId ? 1 : 0,
      );
      for (const alloc of ordered) {
        const locked = await this.lockReceivable(tx, alloc.receivableId);
        if (!locked || locked.companyId !== current.companyId) {
          // Receivable deleted or moved companies — skip restoring it but keep
          // reversing the rest + the JE (the funds movement still unwinds).
          continue;
        }
        if (locked.status === 'WRITTEN_OFF' || locked.status === 'CANCELLED') {
          // Closed receivable: do not resurrect its balance.
          continue;
        }

        const allocAmount = new Prisma.Decimal(alloc.amount).toDecimalPlaces(2);
        const restoredOutstanding = new Prisma.Decimal(locked.outstandingAmount)
          .plus(allocAmount)
          .toDecimalPlaces(2);
        const restoredPaid = Prisma.Decimal.max(
          new Prisma.Decimal(locked.paidAmount).minus(allocAmount),
          new Prisma.Decimal(0),
        ).toDecimalPlaces(2);
        const restoredStatus = restoredPaid.isZero() ? 'OPEN' : 'PARTIALLY_PAID';

        const updated = await tx.receivable.update({
          where: { id: alloc.receivableId },
          data: {
            outstandingAmount: restoredOutstanding,
            paidAmount: restoredPaid,
            status: restoredStatus,
          },
        });
        await this.syncSalesOrderPaymentFromReceivable(tx, updated);
        if (updated.customerId) touchedCustomerIds.add(updated.customerId);
      }

      // Post the mirror JE (swap debit/credit on every original line). Claims the
      // original JE as REVERSED first so a concurrent reverse posts at most once.
      const reversalJe = await this.reversePaymentJournal(tx, current, userId);

      // [GL guard — LOW missing swing] This payment was created with a
      // journalEntryId, so a mirror reversal MUST post. A null result means the
      // offsetting GL swing did not happen (JE missing/deleted, already REVERSED,
      // or a lost claim race). We have ALREADY restored the receivables above and
      // flipped the payment to REVERSED, so proceeding would leave the original
      // Dr Cash / Cr AR live with no counter-entry — an unbalanced ledger against
      // the customer subledger. Throw to roll back the whole reversal. A payment
      // that never posted a JE (journalEntryId null) can legitimately return null
      // and proceed. Mirrors credit-notes.service void().
      if (!reversalJe && current.journalEntryId) {
        throw new ConflictException(
          'Customer payment reversal could not be posted; reversal aborted to avoid an unbalanced ledger',
        );
      }

      // Unwind the CashAccount.currentBalance increment applied at create time,
      // in lock-step with the CR Cash/Bank mirror JE. Only decrement when the
      // reversal JE actually posted (reversalJe truthy): a payment that never
      // posted a cash leg (journalEntryId null, reversalJe null) also never
      // incremented the balance, so there is nothing to unwind. Scoped by
      // companyId; matches the create-time increment above.
      if (reversalJe && current.cashAccountId) {
        await tx.cashAccount.updateMany({
          where: {
            id: current.cashAccountId,
            companyId: current.companyId,
            deletedAt: null,
          },
          data: { currentBalance: { decrement: new Prisma.Decimal(current.amount) } },
        });
      }

      const updated = await tx.customerPayment.update({
        where: { id: current.id },
        data: {
          reversalJournalEntryId: reversalJe?.id ?? null,
          ...(dto.reason ? { notes: dto.reason } : {}),
        },
        include: this.includeScope(),
      });

      // Always resync the payment's customer (covers the case where all
      // receivables were closed and none were touched above).
      touchedCustomerIds.add(current.customerId);
      for (const cid of touchedCustomerIds) {
        await this.syncCustomerBalance(tx, current.companyId, cid);
      }

      return { before: current, record: updated, reversal: reversalJe };
    });

    await this.auditLogs.log({
      action: 'CUSTOMER_PAYMENT_REVERSE',
      entityType: 'CustomerPayment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: before.status } as Record<string, unknown>,
      newValue: {
        status: CustomerPaymentStatus.REVERSED,
        reason: dto.reason ?? null,
        reversalJournalEntryId: reversal?.id ?? null,
      } as Record<string, unknown>,
    });

    return record;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /**
   * Build the balanced payment posting:
   *   DR Cash|Bank        full amount
   *   CR AR control       applied (sum of allocations)  [omitted if zero]
   *   CR Customer advance unapplied remainder           [omitted if zero]
   *
   * The advance liability is resolved by accountSubType/code (see
   * {@link resolveCustomerAdvanceAccountId}); when a company has not configured
   * one the unapplied remainder is credited to AR control instead and the line
   * description notes it.
   */
  private async buildPaymentLines(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      cashAccountType: CashAccountType | null;
      cashAccountName: string;
      customerLabel: string;
      fullAmount: Prisma.Decimal;
      appliedAmount: Prisma.Decimal;
      unappliedAmount: Prisma.Decimal;
    },
  ) {
    const cashRole = this.cashAccountRole(input.cashAccountType);
    const [cashAcct, arAcct] = await Promise.all([
      this.accountResolver.resolve(input.companyId, cashRole, tx),
      this.accountResolver.resolve(input.companyId, 'AR_CONTROL', tx),
    ]);

    const lines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string;
    }> = [
      {
        accountId: cashAcct.id,
        debit: input.fullAmount,
        credit: new Prisma.Decimal(0),
        description: `Payment received into ${input.cashAccountName}`,
      },
    ];

    if (input.appliedAmount.gt(0)) {
      lines.push({
        accountId: arAcct.id,
        debit: new Prisma.Decimal(0),
        credit: input.appliedAmount,
        description: `Settle receivables: ${input.customerLabel}`,
      });
    }

    if (input.unappliedAmount.gt(0)) {
      const advanceAccountId = await this.resolveCustomerAdvanceAccountId(tx, input.companyId);
      // [GL guard — self-cancelling line] A mis-seeded chart can resolve the
      // customer-advance liability to the SAME account we are DEBITing for the
      // cash/bank receipt. Posting the unapplied remainder there would emit
      // Dr Cash / Cr Cash — a self-cancelling no-op that still balances but
      // silently loses the customer's credit-on-account liability. Fail closed
      // instead of posting a meaningless line. (Collision with AR control is a
      // legitimate signal that no dedicated advance account exists — fall back
      // to parking the remainder in AR below rather than throwing.)
      if (advanceAccountId && advanceAccountId === cashAcct.id) {
        throw new ConflictException(
          `Customer-advance account resolves to the same account as the cash/bank ` +
            `receipt account (${cashAcct.id}); refusing to post a self-cancelling ` +
            `overpayment line. Fix the chart of accounts mapping.`,
        );
      }
      if (advanceAccountId && advanceAccountId !== arAcct.id) {
        lines.push({
          accountId: advanceAccountId,
          debit: new Prisma.Decimal(0),
          credit: input.unappliedAmount,
          description: `Customer advance / credit on account: ${input.customerLabel}`,
        });
      } else {
        // No dedicated advance liability configured — park the remainder in AR
        // control (creates a credit balance on the customer's AR). Noted so it
        // is traceable and can be reclassified once an advance account exists.
        lines.push({
          accountId: arAcct.id,
          debit: new Prisma.Decimal(0),
          credit: input.unappliedAmount,
          description:
            `Customer overpayment held in AR (no customer-advance account configured): ` +
            `${input.customerLabel}`,
        });
      }
    }

    return lines;
  }

  /**
   * Resolve a customer-advance / unearned-revenue / prepayment liability account
   * for the company. The typed {@link AccountRole} union has no such role, so we
   * probe the chart directly by conventional accountSubType keys and Tanzanian
   * SME codes. Returns null when none is configured (caller falls back to AR).
   */
  private async resolveCustomerAdvanceAccountId(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string | null> {
    const subTypeKeys = [
      'customer_advances',
      'customer_advance',
      'customer_deposits',
      'customer_deposit',
      'advances_from_customers',
      'unearned_revenue',
      'deferred_revenue',
      'prepayments_received',
    ];
    const codes = ['2150', '2160', '2250', '2600', '2610'];

    const account = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        OR: [
          { accountSubType: { in: subTypeKeys, mode: 'insensitive' } },
          { accountCode: { in: codes } },
        ],
      },
      select: { id: true },
    });
    return account?.id ?? null;
  }

  /**
   * Post a balanced reversing entry that exactly unwinds the payment's original
   * posting (swap debit/credit on every line). Claims the original JE as
   * REVERSED first so a concurrent reverse posts the mirror at most once.
   * Returns null (no-op) when no traceable posted journal exists.
   */
  private async reversePaymentJournal(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      companyId: string;
      paymentNumber: string;
      journalEntryId: string | null;
    },
    userId: string,
  ): Promise<{ id: string; journalNumber: string } | null> {
    const original = payment.journalEntryId
      ? await tx.journalEntry.findFirst({
          where: { id: payment.journalEntryId, companyId: payment.companyId, deletedAt: null },
          include: { lines: true },
        })
      : await tx.journalEntry.findFirst({
          where: {
            companyId: payment.companyId,
            referenceType: 'CustomerPayment',
            referenceId: payment.id,
            deletedAt: null,
          },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        });

    if (!original || original.lines.length === 0) return null;

    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId },
    });
    if (claim.count !== 1) return null;

    const reversedLines = original.lines.map((line) => ({
      accountId: line.accountId,
      debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
      credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    return this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: new Date(),
        description: `Reversal of customer payment ${payment.paymentNumber}`,
        referenceType: 'CustomerPayment',
        referenceId: payment.id,
        moduleName: 'customer-payments',
        userId,
        lines: reversedLines,
      },
      tx,
    );
  }

  /** Read + row-lock a receivable inside the transaction (mirrors receivables.recordPayment). */
  private async lockReceivable(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedReceivable | undefined> {
    const [locked] = await tx.$queryRaw<LockedReceivable[]>`
      SELECT "id", "companyId", "customerId", "outstandingAmount", "paidAmount",
             "status", "sourceType", "sourceId"
      FROM "receivables"
      WHERE "id" = ${id} AND "deletedAt" IS NULL
      FOR UPDATE`;
    return locked;
  }

  /**
   * Cash/bank account belongs to the company, is active, and — when the
   * payment carries an explicit division/branch context — is not scoped to a
   * DIFFERENT division/branch (shared guard, mirroring the sales-orders
   * receipt-account wording). Its currentBalance feeds the branch daily close,
   * so receiving one branch's cash on another branch's account manufactures a
   * phantom surplus there. Lenient on missing scope: unscoped (NULL-branch)
   * legacy accounts and payments without a branch context behave exactly as
   * before.
   */
  private async resolveCashAccount(
    db: PrismaService | Prisma.TransactionClient,
    companyId: string,
    cashAccountId: string,
    expectedScope: { divisionId?: string | null; branchId?: string | null } = {},
  ) {
    return assertCashAccountForScope(db, {
      cashAccountId,
      companyId,
      divisionId: expectedScope.divisionId ?? null,
      branchId: expectedScope.branchId ?? null,
    });
  }

  private cashAccountRole(accountType?: CashAccountType | null): AccountRole {
    return accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
  }

  private includeScope() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      customer: {
        select: {
          id: true,
          customerCode: true,
          name: true,
          currentBalance: true,
        },
      },
      cashAccount: { select: { id: true, accountName: true, accountType: true } },
      allocations: {
        select: {
          id: true,
          receivableId: true,
          amount: true,
          receivable: {
            select: {
              id: true,
              receivableNumber: true,
              amount: true,
              paidAmount: true,
              outstandingAmount: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  /**
   * Recompute a customer's outstanding balance from their still-open
   * receivables (mirrors receivables.service.syncCustomerBalance).
   */
  private async syncCustomerBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId?: string | null,
  ) {
    if (!customerId) return;
    const summary = await tx.receivable.aggregate({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: OPEN_RECEIVABLE_STATUSES as unknown as string[] } as any,
      },
      _sum: { outstandingAmount: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }

  /**
   * Keep a source SalesOrder's paid/outstanding/paymentStatus in sync with its
   * backing receivable (mirrors receivables.service.syncSalesOrderPaymentFromReceivable).
   */
  private async syncSalesOrderPaymentFromReceivable(
    tx: Prisma.TransactionClient,
    receivable: {
      id: string;
      sourceType: string | null;
      sourceId: string | null;
      paidAmount: Prisma.Decimal | number | string;
      outstandingAmount: Prisma.Decimal | number | string;
    },
  ) {
    if (receivable.sourceType !== 'SalesOrder' || !receivable.sourceId) return;

    const paidAmount = new Prisma.Decimal(receivable.paidAmount ?? 0).toDecimalPlaces(2);
    const outstandingAmount = new Prisma.Decimal(receivable.outstandingAmount ?? 0).toDecimalPlaces(
      2,
    );
    const paymentStatus = outstandingAmount.isZero()
      ? 'PAID'
      : paidAmount.gt(0)
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

    await tx.salesOrder.updateMany({
      where: { id: receivable.sourceId, deletedAt: null },
      data: {
        receivableId: receivable.id,
        paidAmount,
        outstandingAmount,
        paymentStatus: paymentStatus as any,
      },
    });
  }
}
