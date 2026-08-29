import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { AccessLevel, AuditSeverity, CashAccount, Prisma } from '@prisma/client';
import {
  AccountingControlService,
  AccountResolverService,
  CompanyScopeService,
  assertCashAccountScopeCompatible,
} from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService, PostingLine } from '../accounting-engine/posting-engine.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PayExpenseDto } from './dto/pay-expense.dto';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
    private readonly taxAutoApply: TaxAutoApplyService,
  ) {}

  private async resolveCashLedgerAccountId(
    tx: Prisma.TransactionClient,
    companyId: string,
    cashAccount: CashAccount,
  ) {
    const preferredCode = cashAccount.accountType === 'BANK' ? '1010' : '1000';
    const fallbackName = cashAccount.accountType === 'BANK' ? 'Bank' : 'Cash';

    const account = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        accountType: 'ASSET',
        isActive: true,
        deletedAt: null,
        OR: [
          { accountCode: preferredCode },
          { accountName: cashAccount.accountName },
          { accountName: { contains: fallbackName, mode: 'insensitive' } },
        ],
      },
      orderBy: { accountCode: 'asc' },
    });

    if (!account) {
      throw new BadRequestException(
        `No active ${fallbackName.toLowerCase()} ledger account found for cash account ${cashAccount.accountName}`,
      );
    }

    return account.id;
  }

  /** Whole cents (integer) from a decimal/number money value. */
  private toCents(value: Prisma.Decimal | number): number {
    return Math.round(Number(value) * 100);
  }

  /** Money value from whole cents. */
  private fromCents(cents: number): number {
    return cents / 100;
  }

  /**
   * Resolve the accounts for the approval accrual JE. Expense account is the
   * category's linkedAccountId when set, otherwise the GENERAL_EXPENSE role.
   *
   * Input-VAT recovery (Tanzanian VAT): when the expense is flagged taxable
   * and carries a positive taxAmount (recoverable input VAT INCLUDED in the
   * gross amount), the accrual splits it out:
   *   DR Expense (net of tax) + DR TAX_VAT_RECEIVABLE (tax) / CR AP (gross).
   * Otherwise (legacy rows with NULL taxAmount, untaxed, or assessed-exempt
   * taxAmount 0) the posting is byte-identical to the historical shape:
   *   DR Expense (gross) / CR AP (gross).
   *
   * TAX_VAT_RECEIVABLE is resolved ONLY when there is tax to split, so charts
   * without a 1400/1410 (or tax_vat_receivable-subtyped) account keep working
   * for untaxed expenses; a taxable approval on such a chart fails loudly with
   * the resolver's role-naming message.
   */
  private async resolveAccrualPosting(
    tx: Prisma.TransactionClient,
    expense: {
      companyId: string;
      amount: Prisma.Decimal;
      isTaxable?: boolean | null;
      taxAmount?: Prisma.Decimal | number | null;
      expenseCategory?: { linkedAccountId?: string | null } | null;
    } & Record<string, any>,
  ): Promise<{
    expenseAccountId: string;
    apAccountId: string;
    taxAccountId: string | null;
    grossCents: number;
    netCents: number;
    taxCents: number;
  }> {
    const grossCents = this.toCents(expense.amount);
    if (grossCents <= 0) {
      throw new BadRequestException('Expense amount must be greater than zero to accrue');
    }

    // Recoverable input VAT included in the gross. NULL taxAmount (legacy /
    // never-assessed) and non-taxable rows split nothing.
    const taxCents =
      expense.isTaxable && expense.taxAmount != null ? this.toCents(expense.taxAmount) : 0;
    if (taxCents < 0) {
      throw new BadRequestException('Expense tax amount cannot be negative');
    }
    if (taxCents >= grossCents) {
      throw new BadRequestException(
        'Expense tax amount must be less than the gross expense amount (tax is included in the amount)',
      );
    }
    const netCents = grossCents - taxCents;

    // Expense account: category link first, GENERAL_EXPENSE fallback.
    const expenseAccountId =
      expense.expenseCategory?.linkedAccountId ??
      (await this.accountResolver.resolve(expense.companyId, 'GENERAL_EXPENSE', tx)).id;

    const apAccount = await this.accountResolver.resolve(expense.companyId, 'AP_CONTROL', tx);

    // Resolve the input-VAT receivable ONLY when there is tax to split — the
    // resolver throws hard when the chart lacks the account, and untaxed
    // expenses must never be blocked by that.
    const taxAccountId =
      taxCents > 0
        ? (await this.accountResolver.resolve(expense.companyId, 'TAX_VAT_RECEIVABLE', tx)).id
        : null;

    return {
      expenseAccountId,
      apAccountId: apAccount.id,
      taxAccountId,
      grossCents,
      netCents,
      taxCents,
    };
  }

  async findAll(query: QueryExpenseDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      expenseCategoryId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (expenseCategoryId) where.expenseCategoryId = expenseCategoryId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.expenseDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          expenseCategory: { select: { id: true, name: true } },
          cashAccount: { select: { id: true, accountName: true } },
        },
        orderBy: { expenseDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        expenseCategory: true,
        cashAccount: {
          select: {
            id: true,
            accountName: true,
            accountType: true,
            currency: true,
            currentBalance: true,
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        paidBy: { select: { id: true, fullName: true, email: true } },
        journalEntry: {
          select: {
            id: true,
            journalNumber: true,
            transactionDate: true,
            description: true,
            status: true,
            totalDebit: true,
            totalCredit: true,
            postedAt: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Expense not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    const [division, branch] = await Promise.all([
      record.divisionId
        ? this.prisma.division.findFirst({
            where: { id: record.divisionId, companyId: record.companyId, deletedAt: null },
            select: { id: true, name: true, code: true },
          })
        : null,
      record.branchId
        ? this.prisma.branch.findFirst({
            where: {
              id: record.branchId,
              deletedAt: null,
              division: { companyId: record.companyId },
            },
            select: { id: true, name: true, code: true },
          })
        : null,
    ]);

    return { ...record, division, branch };
  }

  /**
   * Cross-field tax sanity for create/update payloads: the recoverable input
   * VAT is INCLUDED in the gross amount, so it must be strictly smaller.
   * Best-effort at write time (both values known); approve() re-validates from
   * the locked row, which stays the authoritative guard against racing edits.
   */
  private assertTaxWithinAmount(amount: number, taxAmount: number) {
    if (this.toCents(taxAmount) >= this.toCents(amount)) {
      throw new BadRequestException(
        'Expense tax amount must be less than the gross expense amount (tax is included in the amount)',
      );
    }
  }

  async create(dto: CreateExpenseDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.taxAmount != null) {
      this.assertTaxWithinAmount(dto.amount, dto.taxAmount);
    }
    const userId = user.id;
    const expenseNumber = await this.codes.next({
      entityType: 'Expense',
      companyId: dto.companyId,
    });
    const record = await this.prisma.expense.create({
      data: {
        expenseNumber,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        expenseCategoryId: dto.expenseCategoryId,
        cashAccountId: dto.cashAccountId,
        vendorName: dto.vendorName,
        amount: dto.amount,
        currency: dto.currency,
        expenseDate: new Date(dto.expenseDate),
        description: dto.description,
        paymentMethod: dto.paymentMethod,
        // Input VAT: taxAmount stays NULL (never assessed) when omitted.
        isTaxable: dto.isTaxable ?? false,
        taxAmount: dto.taxAmount,
        status: 'DRAFT',
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_CREATE',
      entityType: 'Expense',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
      throw new BadRequestException(
        'Expense can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }
    if (dto.taxAmount != null) {
      // Best-effort pairing against the incoming amount (or the current row
      // when the amount is not part of this edit). approve() re-validates the
      // pair from the FOR UPDATE locked row, which closes the racing-edit gap.
      this.assertTaxWithinAmount(dto.amount ?? Number(existing.amount), dto.taxAmount);
    }

    // Atomic status guard: an amount edit must never land AFTER a concurrent
    // approve() has accrued the expense (the accrual + payable would then be
    // booked at a different amount than pay() later settles). The guarded
    // updateMany blocks on approve()'s in-transaction row lock and re-evaluates
    // the WHERE against the committed row, so a racing edit fails cleanly
    // instead of mutating an APPROVED expense.
    const guarded = await this.prisma.expense.updateMany({
      where: { id, status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null },
      data: {
        ...(dto.vendorName !== undefined && { vendorName: dto.vendorName }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.expenseDate && { expenseDate: new Date(dto.expenseDate) }),
        ...(dto.description && { description: dto.description }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
        ...(dto.isTaxable !== undefined && { isTaxable: dto.isTaxable }),
        ...(dto.taxAmount !== undefined && { taxAmount: dto.taxAmount }),
        ...(dto.expenseCategoryId && { expenseCategoryId: dto.expenseCategoryId }),
        ...(dto.cashAccountId !== undefined && { cashAccountId: dto.cashAccountId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
      },
    });
    if (guarded.count === 0) {
      throw new BadRequestException(
        'Expense can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }
    const record = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Expense not found');

    await this.auditLogs.log({
      action: 'EXPENSE_UPDATE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT expenses can be submitted');
    }

    const record = await this.prisma.expense.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.auditLogs.log({
      action: 'EXPENSE_SUBMIT',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'PENDING_APPROVAL' } as any,
    });

    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL expenses can be approved');
    }
    // A missing category.linkedAccountId does not block approval: the accrual
    // resolves the expense account via the GENERAL_EXPENSE role fallback
    // (resolveAccrualPosting). Only a chart missing BOTH the link and the
    // GENERAL_EXPENSE role throws — descriptively, from the resolver.

    // Recognise the cost + obligation at approval (accrual accounting): post a
    // balanced JE DR Expense / CR AP at the EXPENSE date, and open a payable so
    // the obligation is visible in AP from approval — independent of when cash
    // actually leaves. Posted atomically & idempotently.
    const accrualDate = new Date(existing.expenseDate);
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      transactionDate: accrualDate,
      moduleName: 'expenses',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim (first statement of the transaction): exactly one
      // concurrent approver wins this compare-and-set — Postgres re-evaluates
      // the WHERE against the latest committed row after any lock wait, so the
      // loser sees count === 0 and never reaches postLines. This also closes
      // the approve()/reject() clobber: a stale reject can no longer overwrite
      // an approval (reject() uses the same guarded CAS).
      const claimed = await tx.expense.updateMany({
        where: { id, companyId: existing.companyId, status: 'PENDING_APPROVAL', deletedAt: null },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        const current = await tx.expense.findFirst({
          where: { id, companyId: existing.companyId, deletedAt: null },
          select: { status: true, journalEntryId: true },
        });
        if (current?.status === 'APPROVED' && current.journalEntryId) {
          // A prior/concurrent approval already claimed and accrued this
          // expense (JE + payable committed atomically with the status flip):
          // idempotent no-op, do not post a second accrual.
          return (await tx.expense.findFirst({
            where: { id, companyId: existing.companyId, deletedAt: null },
          }))!;
        }
        throw new BadRequestException('Expense is no longer PENDING_APPROVAL');
      }

      // Locked re-read: the CAS above holds the row lock, so this reads the
      // COMMITTED amount AND tax fields (an update() that changed them either
      // committed before our claim — and is read here — or is blocked until we
      // commit and then fails its own status guard). The accrual and the
      // payable must book the values actually being approved, never the stale
      // pre-transaction snapshot: reading tax from `existing` while amount
      // comes from the lock could split a tax that no longer matches the gross.
      const [locked] = await tx.$queryRaw<
        Array<{
          amount: Prisma.Decimal;
          journalEntryId: string | null;
          isTaxable: boolean;
          taxAmount: Prisma.Decimal | null;
        }>
      >`SELECT "amount", "journalEntryId", "isTaxable", "taxAmount"
        FROM "expenses"
        WHERE "id" = ${id} AND "companyId" = ${existing.companyId} AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (!locked) throw new NotFoundException('Expense not found');

      let journalEntryId = locked.journalEntryId;

      if (!journalEntryId) {
        const { expenseAccountId, apAccountId, taxAccountId, grossCents, netCents, taxCents } =
          await this.resolveAccrualPosting(tx, {
            ...existing,
            amount: locked.amount,
            isTaxable: locked.isTaxable,
            taxAmount: locked.taxAmount,
          });

        // DR Expense for the amount NET of recoverable input VAT (equal to the
        // gross when there is no tax to split — the legacy two-leg shape), plus
        // DR TAX_VAT_RECEIVABLE for the input VAT when present; CR AP at gross.
        // The payable below stays at GROSS either way — pay() settles the full
        // obligation and needs no knowledge of the split.
        const lines: PostingLine[] = [
          {
            accountId: expenseAccountId,
            description: `Expense: ${existing.description}`,
            debit: this.fromCents(netCents),
            credit: 0,
          },
          ...(taxCents > 0 && taxAccountId
            ? [
                {
                  accountId: taxAccountId,
                  description: `Input VAT on expense ${existing.expenseNumber}`,
                  debit: this.fromCents(taxCents),
                  credit: 0,
                },
              ]
            : []),
          {
            accountId: apAccountId,
            description: `Accrued payable for expense ${existing.expenseNumber}`,
            debit: 0,
            credit: this.fromCents(grossCents),
          },
        ];

        const jeNumber = await this.codes.next({
          entityType: 'ExpenseJournal',
          companyId: existing.companyId,
          tx,
        });
        const je = await this.postingEngine.postLines(
          {
            journalNumber: jeNumber,
            companyId: existing.companyId,
            divisionId: existing.divisionId,
            branchId: existing.branchId,
            transactionDate: accrualDate,
            description: `Accrual of expense ${existing.expenseNumber}`,
            referenceType: 'Expense',
            referenceId: existing.id,
            moduleName: 'expenses',
            userId,
            lines,
          },
          tx,
        );
        journalEntryId = je.id;

        // Open the payable subledger row so the obligation shows in AP.
        // Linked back to the expense via sourceType/sourceId (no schema change);
        // supplierId is null for free-text expense vendors.
        const existingPayable = await tx.payable.findFirst({
          where: {
            companyId: existing.companyId,
            sourceType: 'Expense',
            sourceId: existing.id,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!existingPayable) {
          const gross = new Prisma.Decimal(this.fromCents(grossCents)).toDecimalPlaces(2);
          await tx.payable.create({
            data: {
              payableNumber: await this.codes.next({
                entityType: 'Payable',
                companyId: existing.companyId,
                tx,
              }),
              companyId: existing.companyId,
              divisionId: existing.divisionId,
              branchId: existing.branchId,
              supplierName: existing.vendorName?.trim() || 'Expense vendor',
              sourceType: 'Expense',
              sourceId: existing.id,
              amount: gross,
              paidAmount: 0,
              outstandingAmount: gross,
              currency: existing.currency,
              issueDate: accrualDate,
              status: 'OPEN',
              journalEntryId,
              notes: `Expense ${existing.expenseNumber}`,
            },
          });
        }

        // ── Tax auto-apply (input VAT) ─────────────────────────────────────
        // Mirror the recoverable input VAT into the TaxTransaction compliance
        // ledger so VAT returns can net input against output — same pattern as
        // the purchase-order confirm path. Soft-fails: errors are logged and do
        // NOT roll back a legitimate approval. Env-flag gated inside the
        // service (TAX_AUTO_APPLY), idempotent per expense.
        try {
          const taxResult = await this.taxAutoApply.applyForExpense(id, userId, tx);
          if (taxResult.error) {
            this.logger.warn(`Tax auto-apply for expense ${id}: ${taxResult.error}`);
          }
        } catch (err) {
          this.logger.warn(
            `Tax auto-apply threw for expense ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Status/approver were already written by the atomic claim above; link
      // the accrual JE in the same transaction so the claim + posting + payable
      // + link commit (or roll back) as one unit.
      return tx.expense.update({
        where: { id },
        data: { journalEntryId },
      });
    });

    await this.auditLogs.log({
      action: 'EXPENSE_APPROVE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: result.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'APPROVED', journalEntryId: result.journalEntryId } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async reject(id: string, dto: RejectExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL expenses can be rejected');
    }

    // Atomic claim (mirror of approve()): a stale reject must not clobber a
    // concurrent approval that already posted the accrual — that would leave a
    // REJECTED expense with a posted accrual and an unsettleable OPEN payable.
    // The guarded compare-and-set re-evaluates the status against the committed
    // row, so only a genuinely PENDING_APPROVAL expense can be rejected.
    const claimed = await this.prisma.expense.updateMany({
      where: { id, companyId: existing.companyId, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'REJECTED', rejectedReason: dto.reason },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('Expense is no longer PENDING_APPROVAL');
    }
    const record = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Expense not found');

    await this.auditLogs.log({
      action: 'EXPENSE_REJECT',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED', reason: dto.reason } as any,
    });

    return record;
  }

  async paymentOptions(id: string, user: AuthUser) {
    const expense = await this.findOne(id, user, AccessLevel.WRITE);
    if (expense.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED expenses can be paid');
    }

    return this.prisma.cashAccount.findMany({
      where: {
        companyId: expense.companyId,
        currency: expense.currency,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        accountName: true,
        accountType: true,
        currency: true,
        currentBalance: true,
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ accountType: 'asc' }, { accountName: 'asc' }],
    });
  }

  async pay(id: string, dto: PayExpenseDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    // Idempotency: a second pay() on an already-PAID expense is a safe no-op —
    // it must NOT post a second settlement journal or decrement cash again.
    // Return the settled record unchanged. This, together with the expense being
    // the SINGLE settlement path for its linked payable (the payable is marked
    // PAID in the same transaction, and payables.recordPayment/writeOff reject
    // Expense-sourced payables), guarantees the expense can only ever be
    // relieved once, from either surface.
    if (existing.status === 'PAID') {
      return existing;
    }
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED expenses can be paid');
    }
    const cashAccountId = dto.cashAccountId?.trim() || existing.cashAccountId;
    if (!cashAccountId) {
      throw new BadRequestException('Cash account is required before an expense can be paid');
    }

    const paymentDate = new Date();
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.companyId,
      transactionDate: paymentDate,
      moduleName: 'expenses',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent pay() calls on the EXPENSE row itself (covers both
      // the payable-linked and the legacy no-payable path). The loser of a
      // double-click blocks on this row lock until the winner commits, then
      // re-checks the COMMITTED status under the lock and no-ops instead of
      // double-posting DR AP / CR Cash and double-decrementing cash.
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"
        FROM "expenses"
        WHERE "id" = ${id} AND "companyId" = ${existing.companyId} AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (!locked) throw new NotFoundException('Expense not found');
      if (locked.status === 'PAID') {
        // A concurrent pay() already settled it — idempotent no-op.
        return existing;
      }
      if (locked.status !== 'APPROVED') {
        throw new BadRequestException('Only APPROVED expenses can be paid');
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: {
          id: cashAccountId,
          companyId: existing.companyId,
          currency: existing.currency,
          deletedAt: null,
          isActive: true,
        },
      });

      if (!cashAccount) {
        throw new BadRequestException(
          `Select an active ${existing.currency} cash or bank account for this expense company`,
        );
      }

      // Branch custody guard (shared with sales-orders/customer-payments):
      // when the expense is scoped to a division/branch, the paying account
      // must not be scoped to a DIFFERENT one — paying one branch's expense
      // out of another branch's drawer corrupts both branches' daily-close
      // balances. Lenient: unscoped (NULL-branch) accounts and unscoped
      // expenses keep the historical behaviour; BANK accounts may serve the
      // whole company.
      assertCashAccountScopeCompatible(cashAccount, {
        divisionId: existing.divisionId,
        branchId: existing.branchId,
      });

      const cashLedgerAccountId = await this.resolveCashLedgerAccountId(
        tx,
        existing.companyId,
        cashAccount,
      );

      // Was the cost accrued at approval? If so (the current flow), the expense
      // was already recognised (DR Expense / CR AP) — settlement only moves the
      // liability to cash: DR AP / CR Cash|Bank. Do NOT re-debit the expense.
      const payable = await tx.payable.findFirst({
        where: {
          companyId: existing.companyId,
          sourceType: 'Expense',
          sourceId: existing.id,
          deletedAt: null,
        },
      });

      // Defensive idempotency: if the linked payable is already settled, the
      // expense was already paid via this single path — do not post a second
      // DR AP / CR Cash or decrement cash again. (The FOR UPDATE status claim
      // at the top of this transaction is what excludes the concurrent-pay
      // race; this is defense in depth against subledger drift.)
      if (payable && payable.status === 'PAID') {
        return existing;
      }

      const jeNumber = await this.codes.next({
        entityType: 'ExpenseJournal',
        companyId: existing.companyId,
        tx,
      });

      let debitLine: PostingLine;
      if (payable) {
        const apAccount = await this.accountResolver.resolve(existing.companyId, 'AP_CONTROL', tx);
        debitLine = {
          accountId: apAccount.id,
          description: `Settle accrued payable for expense ${existing.expenseNumber}`,
          debit: Number(existing.amount),
          credit: 0,
        };
      } else {
        // Legacy / un-accrued APPROVED expense (created before accrual-on-approve):
        // fall back to the original single-JE cash-basis posting so the cost is
        // still recognised and no expense is lost. Requires a linked account.
        //
        // Explicit input-VAT guard: a taxable expense must be settled through
        // its accrued payable (where the VAT was split to TAX_VAT_RECEIVABLE at
        // approval). This branch would silently absorb the recoverable input
        // VAT into the expense account with no recoverable-VAT record. It
        // should be unreachable for taxable rows (they are always accrued at
        // approval), so fail loudly rather than lose the VAT.
        if (existing.isTaxable && Number(existing.taxAmount ?? 0) > 0) {
          throw new BadRequestException(
            'Taxable expense has no accrued payable to settle; approve it (which splits the recoverable input VAT) before payment',
          );
        }
        if (!existing.expenseCategory?.linkedAccountId) {
          throw new BadRequestException(
            'Expense category must be linked to a ledger account before payment',
          );
        }
        debitLine = {
          accountId: existing.expenseCategory.linkedAccountId,
          description: `Expense: ${existing.description}`,
          debit: Number(existing.amount),
          credit: 0,
        };
      }

      const je = await this.postingEngine.postLines(
        {
          journalNumber: jeNumber,
          companyId: existing.companyId,
          divisionId: existing.divisionId,
          branchId: existing.branchId,
          transactionDate: paymentDate,
          description: `Payment of expense ${existing.expenseNumber}`,
          referenceType: 'Expense',
          referenceId: existing.id,
          moduleName: 'expenses',
          userId,
          lines: [
            debitLine,
            {
              accountId: cashLedgerAccountId,
              description: `Cash payment from ${cashAccount.accountName}`,
              debit: 0,
              credit: Number(existing.amount),
            },
          ],
        },
        tx,
      );

      await tx.cashAccount.update({
        where: { id: cashAccount.id },
        data: {
          currentBalance: {
            decrement: existing.amount,
          },
        },
      });

      // Close out the payable subledger row so AP no longer shows the obligation.
      if (payable) {
        await tx.payable.update({
          where: { id: payable.id },
          data: {
            paidAmount: payable.amount,
            outstandingAmount: 0,
            status: 'PAID',
          },
        });
      }

      return tx.expense.update({
        where: { id },
        data: {
          status: 'PAID',
          paidById: userId,
          paidAt: new Date(),
          // Preserve the accrual JE link when it exists; otherwise record the
          // cash JE (legacy path) so the expense stays traceable.
          ...(payable ? {} : { journalEntryId: je.id }),
          cashAccountId: cashAccount.id,
          ...(dto.paymentMethod?.trim() && { paymentMethod: dto.paymentMethod.trim() }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'EXPENSE_PAY',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: result.companyId,
      oldValue: { status: 'APPROVED' } as any,
      newValue: {
        status: 'PAID',
        cashAccountId,
        paymentMethod: dto.paymentMethod?.trim() || existing.paymentMethod,
      } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT expenses can be deleted');
    }

    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'EXPENSE_DELETE',
      entityType: 'Expense',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
