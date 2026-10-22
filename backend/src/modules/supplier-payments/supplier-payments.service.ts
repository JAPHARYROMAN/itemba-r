import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessLevel,
  CashAccountType,
  CurrencyCode,
  PaymentMethodGeneral,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, assertCashAccountForScope } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import {
  AccountResolverService,
  AccountRole,
} from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  PostingEngineService,
  partyOf,
  partyOfLine,
} from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CashBookService } from '../cash-book/cash-book.service';
import { sourceSettlement } from '../../common/utils/source-settlement';
import { assertNoLegacyPaymentClaim } from '../../common/utils/document-payment-request';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import { remittancePdf } from './remittance-advice';
import { pagination } from '../../common/utils/pagination';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { QuerySupplierPaymentDto } from './dto/query-supplier-payment.dto';
import { ReverseSupplierPaymentDto } from './dto/reverse-supplier-payment.dto';
import { SupplierPaymentStatus } from './dto/supplier-payment-status.enum';

/** Payable statuses that still carry an outstanding balance a payment may reduce. */
const OPEN_PAYABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
/** Supplier invoice statuses whose paid / outstanding figures follow their payable. */
const SETTLING_INVOICE_STATUSES = ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const;

type Tx = Prisma.TransactionClient;

/** Locked snapshot of a payable row read FOR UPDATE inside the transaction. */
export interface LockedPayable {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  payableNumber: string;
  sourceType: string | null;
  outstandingAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  status: string;
  currency: string | null;
}

export interface SupplierPaymentAllocationInput {
  payableId: string;
  amount: Prisma.Decimal | number | string;
}

/** Everything a caller supplies to record one supplier payment inside its own transaction. */
export interface SupplierPaymentInput {
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  supplierId: string;
  amount: Prisma.Decimal | number | string;
  method?: PaymentMethodGeneral | null;
  paymentDate: Date;
  /** ERP cash / bank account the money leaves. Optional for legacy callers (role account only). */
  cashAccountId?: string | null;
  reference?: string | null;
  currency?: CurrencyCode | string | null;
  notes?: string | null;
  /** Client idempotency key; a repeat with the same key returns the original payment. */
  requestId?: string | null;
  /** Where the payment originated: Payable | Expense | InvoiceDeskInvoice | CashDesk. */
  source?: { type: string; id: string } | null;
  allocations: SupplierPaymentAllocationInput[];
  /** Expense-sourced payables are settled only through Expenses; expenses.pay sets this. */
  allowExpenseSource?: boolean;
}

/**
 * Record-only input: the documents are already settled and the journal (if any) already
 * posted by the caller. Used by Expenses (its own settlement journal) and by Invoice Desk
 * (desk payments are posted later in Accounting connections).
 */
export interface SupplierPaymentRecordInput extends Omit<
  SupplierPaymentInput,
  'allocations' | 'allowExpenseSource'
> {
  allocations?: SupplierPaymentAllocationInput[];
  journalEntryId?: string | null;
  cashDeskMovementId?: string | null;
}

/**
 * Supplier payments: the AP mirror of CustomerPaymentsService.
 *
 * Every supplier payment, whichever screen it starts from, becomes exactly one
 * SupplierPayment row with its allocations, so suppliers have a dated payment history
 * and statements can show payments on the day they happened.
 *
 *  - `createInTransaction` settles payables: locks and reduces each payable, keeps any
 *    approved supplier invoice behind the payable in step, posts DR AP control / CR cash
 *    (crediting the cash account's mapped ledger account when it has one), decrements the
 *    ERP cash balance and refreshes the supplier's cached balance.
 *  - `recordInTransaction` only records the payment row for a settlement the caller has
 *    already performed (expense payment, desk payment).
 *
 * The Cash Desk movement for ERP payments is written by the cash book (W4); until then
 * `cashDeskMovementId` is set only by callers that already own a movement.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly cashBook?: CashBookService,
    // Party linkage (Phase 3): the shared letterhead renderer for the remittance advice.
    private readonly documents?: GeneratedDocumentsService,
    private readonly org: OrganizationScopeService = new OrganizationScopeService(prisma),
  ) {}

  // ── queries ─────────────────────────────────────────────────────────────────

  async findAll(query: QuerySupplierPaymentDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      supplierId,
      cashAccountId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.SupplierPaymentWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (cashAccountId) where.cashAccountId = cashAccountId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) where.paymentDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.paymentDate.lte = dateRangeEnd(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where,
        include: this.includeScope(),
        orderBy: { paymentDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.supplierPayment.count({ where }),
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
    const record = await this.prisma.supplierPayment.findFirst({
      where: { id, deletedAt: null },
      include: this.includeScope(),
    });
    if (!record) throw new NotFoundException('Supplier payment not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  /** Party linkage (Phase 3 PR-6): the payment and its allocations as a remittance advice. */
  async remittance(id: string, user: AuthUser) {
    const payment = await this.findOne(id, user);
    if (!this.documents)
      throw new BadRequestException('PDF export is unavailable in this deployment.');
    const buffer = await this.documents.renderLetterheadPdf(
      { companyId: payment.companyId, branchId: payment.branchId },
      remittancePdf(payment),
      user,
    );
    return {
      buffer,
      filename: `remittance-${payment.paymentNumber}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  // ── create ──────────────────────────────────────────────────────────────────

  async create(dto: CreateSupplierPaymentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const { payment } = await this.prisma.$transaction((tx) =>
      this.createInTransaction(tx, user, {
        companyId: dto.companyId,
        divisionId: dto.divisionId ?? null,
        branchId: dto.branchId ?? null,
        supplierId: dto.supplierId,
        amount: dto.amount,
        method: dto.method ?? null,
        paymentDate: new Date(dto.paymentDate),
        cashAccountId: dto.cashAccountId,
        reference: dto.reference ?? null,
        currency: dto.currency ?? null,
        notes: dto.notes ?? null,
        requestId: dto.requestId ?? null,
        allocations: dto.allocations,
      }),
    );
    await this.auditLogs.log({
      action: 'SUPPLIER_PAYMENT_CREATE',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      userId: user.id,
      companyId: payment.companyId,
      newValue: payment as unknown as Record<string, unknown>,
    });
    return payment;
  }

  /** Read + row-lock a payable inside the transaction (mirrors payables.recordPayment). */
  async lockPayable(tx: Tx, id: string): Promise<LockedPayable | undefined> {
    await tx.$queryRaw`SELECT po.id FROM purchase_orders po
      WHERE po."payableId" = ${id} OR po.id IN
        (SELECT COALESCE(invoice."purchaseOrderId", grn."purchaseOrderId")
         FROM supplier_invoices invoice
         LEFT JOIN goods_received_notes grn ON grn.id = invoice."goodsReceivedNoteId"
         WHERE invoice."payableId" = ${id} OR invoice.id IN
           (SELECT "sourceId" FROM payables WHERE id = ${id} AND "sourceType" = 'SupplierInvoice'))
      ORDER BY po.id FOR UPDATE`;
    // Approval/void locks a standalone GRN before its invoice and payable.
    // Settlement later updates that invoice, so it must take the same source
    // lock first, including older invoice-origin liabilities linked via a GRN.
    await tx.$queryRaw`SELECT grn.id FROM goods_received_notes grn
      WHERE grn."purchaseOrderId" IS NULL AND
        (grn.id IN (SELECT "sourceId" FROM payables
                    WHERE id = ${id} AND "sourceType" = 'GoodsReceivedNote')
         OR grn.id IN (SELECT "goodsReceivedNoteId" FROM supplier_invoices
           WHERE "payableId" = ${id} OR id IN
             (SELECT "sourceId" FROM payables WHERE id = ${id} AND "sourceType" = 'SupplierInvoice')))
      ORDER BY grn.id FOR UPDATE`;
    const [locked] = await tx.$queryRaw<LockedPayable[]>`
      SELECT "id", "companyId", "divisionId", "branchId", "supplierId", "supplierName",
             "payableNumber", "sourceType", "outstandingAmount", "paidAmount", "status", "currency"
      FROM "payables"
      WHERE "id" = ${id} AND "deletedAt" IS NULL
      FOR UPDATE`;
    return locked;
  }

  /**
   * Settle one or more payables with one payment, inside the caller's transaction.
   * Returns the payment (with scope) and the updated payable rows.
   */
  async createInTransaction(
    tx: Tx,
    user: AuthUser,
    input: SupplierPaymentInput,
    opts: { cashDeskOwnsMovement?: boolean } = {},
  ) {
    input = { ...input, requestId: this.normaliseRequestId(input.requestId) };
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero');
    if (!input.allocations?.length)
      throw new BadRequestException('At least one allocation is required');

    const seen = new Set<string>();
    const allocations = input.allocations.map((a) => {
      const allocAmount = new Prisma.Decimal(a.amount).toDecimalPlaces(2);
      if (allocAmount.lte(0))
        throw new BadRequestException('Each allocation amount must be greater than zero');
      if (seen.has(a.payableId))
        throw new BadRequestException(`Payable ${a.payableId} appears in more than one allocation`);
      seen.add(a.payableId);
      return { payableId: a.payableId, amount: allocAmount };
    });
    const allocatedTotal = allocations.reduce(
      (sum, a) => sum.plus(a.amount),
      new Prisma.Decimal(0),
    );
    if (!allocatedTotal.eq(amount))
      throw new BadRequestException(
        `Allocated total (${allocatedTotal.toString()}) must equal the payment amount ` +
          `(${amount.toString()}). Supplier prepayments are not supported yet.`,
      );
    const ordered = [...allocations].sort((a, b) => (a.payableId < b.payableId ? -1 : 1));

    if (input.requestId) {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`SupplierPaymentRequest:${input.requestId}`}, 0))`;
      await assertNoLegacyPaymentClaim(tx, input.companyId, 'Payable', input.requestId);
    }
    const existing = await this.existingByRequest(tx, input.requestId);
    if (existing) {
      const sameAllocations =
        existing.allocations.length === allocations.length &&
        allocations.every((allocation) =>
          existing.allocations.some(
            (prior) =>
              prior.payableId === allocation.payableId &&
              new Prisma.Decimal(prior.amount).eq(allocation.amount),
          ),
        );
      if (
        existing.deletedAt ||
        existing.status !== 'COMPLETED' ||
        existing.companyId !== input.companyId ||
        existing.supplierId !== input.supplierId ||
        !new Prisma.Decimal(existing.amount).eq(amount) ||
        existing.currency !== (input.currency ?? 'TZS') ||
        existing.cashAccountId !== (input.cashAccountId ?? null) ||
        existing.paymentDate.getTime() !== input.paymentDate.getTime() ||
        existing.method !== (input.method ?? 'CASH') ||
        existing.reference !== (input.reference ?? null) ||
        existing.notes !== (input.notes ?? null) ||
        existing.sourceType !== (input.source?.type ?? 'Payable') ||
        existing.sourceId !== (input.source?.id ?? ordered[0].payableId) ||
        (input.divisionId != null && existing.divisionId !== input.divisionId) ||
        (input.branchId != null && existing.branchId !== input.branchId) ||
        !sameAllocations
      ) {
        throw new ConflictException(
          'This payment request was already used with different details or has been reversed. Start a new payment.',
        );
      }
      return { payment: existing, payables: [] as PayableSnapshot[] };
    }

    const supplier = await this.requireSupplier(tx, input.companyId, input.supplierId);
    const currency = (input.currency as CurrencyCode | null) ?? CurrencyCode.TZS;
    const cashAccount = input.cashAccountId
      ? await this.requireCashAccount(tx, input, currency)
      : null;
    const divisionId = input.divisionId ?? cashAccount?.divisionId ?? null;
    const branchId = input.branchId ?? cashAccount?.branchId ?? null;

    // Lock + validate + reduce each payable, ordered by id so concurrent multi-payable
    // payments cannot deadlock.
    const payables: PayableSnapshot[] = [];
    for (const alloc of ordered) {
      const locked = await this.lockPayable(tx, alloc.payableId);
      if (!locked) throw new NotFoundException(`Payable ${alloc.payableId} not found`);
      if (locked.companyId !== input.companyId)
        throw new BadRequestException(`Payable ${alloc.payableId} does not belong to this company`);
      if (!locked.supplierId)
        throw new BadRequestException(
          `Match payable ${locked.payableNumber} to its supplier before recording payment.`,
        );
      if (locked.supplierId !== input.supplierId)
        throw new BadRequestException(
          `Payable ${locked.payableNumber} belongs to a different supplier`,
        );
      if (locked.sourceType === 'Expense' && !input.allowExpenseSource)
        throw new BadRequestException(
          'This payable was raised from an expense and must be settled from the Expenses ' +
            'module (pay the expense). Paying it here would double-relieve AP and double-pay cash.',
        );
      if (!(OPEN_PAYABLE_STATUSES as readonly string[]).includes(locked.status))
        throw new BadRequestException(`Cannot record a payment against a ${locked.status} payable`);
      if (locked.currency && locked.currency !== currency)
        throw new BadRequestException(
          `Payable ${locked.payableNumber} is in ${locked.currency}; pay it in the same currency.`,
        );
      const outstanding = new Prisma.Decimal(locked.outstandingAmount);
      if (alloc.amount.gt(outstanding))
        throw new BadRequestException(
          `Payment amount (${alloc.amount.toString()}) exceeds outstanding amount (${outstanding.toString()})`,
        );
      const nextOutstanding = outstanding.minus(alloc.amount).toDecimalPlaces(2);
      const nextPaid = new Prisma.Decimal(locked.paidAmount).plus(alloc.amount).toDecimalPlaces(2);
      const updated = await tx.payable.update({
        where: { id: alloc.payableId },
        data: {
          outstandingAmount: nextOutstanding,
          paidAmount: nextPaid,
          status: nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
      await this.syncSupplierInvoices(tx, updated);
      await this.syncPurchaseOrders(tx, updated);
      payables.push(updated);
    }

    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber: await this.codes.next({
          entityType: 'SupplierPayment',
          companyId: input.companyId,
          tx,
        }),
        requestId: input.requestId ?? null,
        companyId: input.companyId,
        divisionId,
        branchId,
        supplierId: input.supplierId,
        amount,
        method: input.method ?? undefined,
        reference: input.reference ?? null,
        paymentDate: input.paymentDate,
        appliedAmount: allocatedTotal,
        unappliedAmount: 0,
        currency,
        status: SupplierPaymentStatus.COMPLETED,
        sourceType: input.source?.type ?? 'Payable',
        sourceId: input.source?.id ?? ordered[0].payableId,
        cashAccountId: input.cashAccountId ?? null,
        notes: input.notes ?? null,
        createdById: user.id,
        allocations: {
          create: allocations.map((a) => ({
            companyId: input.companyId,
            payableId: a.payableId,
            amount: a.amount,
          })),
        },
      },
    });

    // GL: DR AP control (applied) / CR cash or bank (full amount). The cash leg credits
    // the chosen account's mapped ledger account when it has one, else the role account.
    const [apAccount, cashLedgerAccountId] = await Promise.all([
      this.accountResolver.resolve(input.companyId, 'AP_CONTROL', tx),
      this.cashCreditAccountId(tx, input.companyId, cashAccount),
    ]);
    const journalEntry = await this.postingEngine.postLines(
      {
        companyId: input.companyId,
        divisionId,
        branchId,
        transactionDate: input.paymentDate,
        description: `Supplier payment ${payment.paymentNumber}`,
        referenceType: 'SupplierPayment',
        referenceId: payment.id,
        moduleName: 'supplier-payments',
        userId: user.id,
        lines: [
          {
            accountId: apAccount!.id,
            ...partyOf('supplier', supplier.id),
            description: `Accounts payable settlement: ${supplier.name}`,
            debit: allocatedTotal,
            credit: 0,
          },
          {
            accountId: cashLedgerAccountId,
            description: `Payment to supplier: ${supplier.name}`,
            debit: 0,
            credit: amount,
          },
        ],
      },
      tx,
    );

    const withJournal = await tx.supplierPayment.update({
      where: { id: payment.id },
      data: { journalEntryId: journalEntry.id },
      include: this.includeScope(),
    });

    // Keep the denormalised CashAccount.currentBalance in step with the CR cash leg.
    if (input.cashAccountId) {
      const deducted = await tx.cashAccount.updateMany({
        where: {
          id: input.cashAccountId,
          companyId: input.companyId,
          deletedAt: null,
          isActive: true,
          currentBalance: { gte: amount },
        },
        data: { currentBalance: { decrement: amount } },
      });
      if (deducted.count !== 1)
        throw new BadRequestException('Insufficient funds in the selected cash account.');
    }

    // Cash book (W4): the same payment is one Cash Desk movement carrying the supplier,
    // the payable it settled and the journal that already explains it.
    const movement =
      input.cashAccountId && !opts.cashDeskOwnsMovement
        ? await this.cashBook?.recordInTransaction(tx, user, {
            kind: 'SUPPLIER_PAYMENT',
            companyId: input.companyId,
            cashAccountId: input.cashAccountId,
            amount,
            currency,
            businessDate: input.paymentDate,
            description: `Supplier payment ${payment.paymentNumber} · ${supplier.name}`,
            reference: input.reference ?? payment.paymentNumber,
            requestId: `SupplierPayment:${payment.id}`,
            partyType: 'SUPPLIER',
            supplierId: input.supplierId,
            payableId: ordered.length === 1 ? ordered[0].payableId : null,
            supplierPaymentId: payment.id,
            journalEntryId: journalEntry.id,
            journalReferenceType: 'SupplierPayment',
          })
        : null;
    const final = movement
      ? await tx.supplierPayment.update({
          where: { id: payment.id },
          data: { cashDeskMovementId: movement.id },
          include: this.includeScope(),
        })
      : withJournal;

    await this.syncSupplierBalance(tx, input.companyId, input.supplierId);
    return { payment: final, payables };
  }

  /**
   * Record a payment whose documents the caller has already settled (expense payment,
   * desk payment). Writes only the payment row and its allocations; no payable update,
   * no journal, no cash movement.
   */
  async recordInTransaction(tx: Tx, user: AuthUser, input: SupplierPaymentRecordInput) {
    input = { ...input, requestId: this.normaliseRequestId(input.requestId) };
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero');
    const currency = (input.currency as CurrencyCode | null) ?? CurrencyCode.TZS;
    const seen = new Set<string>();
    const allocations = (input.allocations ?? []).map((a) => {
      const allocation = {
        payableId: a.payableId,
        amount: new Prisma.Decimal(a.amount).toDecimalPlaces(2),
      };
      if (allocation.amount.lte(0) || seen.has(a.payableId))
        throw new BadRequestException(
          'Payment allocations must be positive and refer to distinct payables',
        );
      seen.add(a.payableId);
      return allocation;
    });
    const applied = allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
    if (applied.gt(amount))
      throw new BadRequestException('Allocated total exceeds the payment amount');
    // A payment with no payable allocation is applied to its source document (desk invoice).
    const appliedAmount = allocations.length ? applied : amount;
    if (input.requestId) {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`SupplierPaymentRequest:${input.requestId}`}, 0))`;
      await assertNoLegacyPaymentClaim(tx, input.companyId, 'Payable', input.requestId);
    }
    const existing = await this.existingByRequest(tx, input.requestId);
    if (existing) {
      const sameAllocations =
        existing.allocations.length === allocations.length &&
        allocations.every((allocation) =>
          existing.allocations.some(
            (prior) =>
              prior.payableId === allocation.payableId &&
              new Prisma.Decimal(prior.amount).eq(allocation.amount),
          ),
        );
      if (
        existing.deletedAt ||
        existing.status !== 'COMPLETED' ||
        existing.companyId !== input.companyId ||
        existing.supplierId !== input.supplierId ||
        !new Prisma.Decimal(existing.amount).eq(amount) ||
        existing.currency !== currency ||
        existing.paymentDate.getTime() !== input.paymentDate.getTime() ||
        existing.method !== (input.method ?? 'CASH') ||
        existing.reference !== (input.reference ?? null) ||
        existing.notes !== (input.notes ?? null) ||
        existing.sourceType !== (input.source?.type ?? null) ||
        existing.sourceId !== (input.source?.id ?? null) ||
        existing.divisionId !== (input.divisionId ?? null) ||
        existing.branchId !== (input.branchId ?? null) ||
        existing.cashAccountId !== (input.cashAccountId ?? null) ||
        existing.cashDeskMovementId !== (input.cashDeskMovementId ?? null) ||
        existing.journalEntryId !== (input.journalEntryId ?? null) ||
        !sameAllocations
      )
        throw new ConflictException(
          'This payment request already belongs to a different source or payment. Start a new payment.',
        );
      return existing;
    }
    const supplier = await this.requireSupplier(tx, input.companyId, input.supplierId);

    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber: await this.codes.next({
          entityType: 'SupplierPayment',
          companyId: input.companyId,
          tx,
        }),
        requestId: input.requestId ?? null,
        companyId: input.companyId,
        divisionId: input.divisionId ?? null,
        branchId: input.branchId ?? null,
        supplierId: supplier.id,
        amount,
        method: input.method ?? undefined,
        reference: input.reference ?? null,
        paymentDate: input.paymentDate,
        appliedAmount,
        unappliedAmount: amount.minus(appliedAmount),
        currency,
        status: SupplierPaymentStatus.COMPLETED,
        sourceType: input.source?.type ?? null,
        sourceId: input.source?.id ?? null,
        cashAccountId: input.cashAccountId ?? null,
        cashDeskMovementId: input.cashDeskMovementId ?? null,
        journalEntryId: input.journalEntryId ?? null,
        notes: input.notes ?? null,
        createdById: user.id,
        allocations: allocations.length
          ? {
              create: allocations.map((a) => ({
                companyId: input.companyId,
                payableId: a.payableId,
                amount: a.amount,
              })),
            }
          : undefined,
      },
      include: this.includeScope(),
    });
    if (allocations.length) await this.syncSupplierBalance(tx, input.companyId, supplier.id);
    return payment;
  }

  // ── reverse ─────────────────────────────────────────────────────────────────

  async reverse(id: string, dto: ReverseSupplierPaymentDto, user: AuthUser) {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 3 || reason.length > 500 || !/[\p{L}\p{N}]/u.test(reason)) {
      throw new BadRequestException('Enter a reversal reason between 3 and 500 characters');
    }
    return this.prisma.$transaction(async (tx) => {
      const { record, reversal } = await this.reverseInTransaction(tx, user, id, reason, {
        publicReversal: true,
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'SUPPLIER_PAYMENT_REVERSE',
        entityType: 'SupplierPayment',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: { status: SupplierPaymentStatus.COMPLETED } as Record<string, unknown>,
        newValue: {
          status: SupplierPaymentStatus.REVERSED,
          reason,
          reversalJournalEntryId: reversal?.id ?? null,
        } as Record<string, unknown>,
      });
      return record;
    });
  }

  /**
   * Flip COMPLETED -> REVERSED, restore every allocated payable, mirror the journal
   * when one was posted here, and unwind the cash balance. Payments carried by a desk
   * payment or a Cash Desk movement must be reversed from that app (it calls back
   * with the matching flag) so cash and document balances move together.
   */
  async reverseInTransaction(
    tx: Tx,
    user: AuthUser,
    id: string,
    reason: string | null,
    opts: {
      fromDesk?: boolean;
      fromCashDesk?: boolean;
      cashDeskOwnsMovement?: boolean;
      businessDate?: Date;
      /** Only the canonical public endpoint sets this; owner apps keep their own transaction. */
      publicReversal?: boolean;
    },
  ) {
    const claim = await tx.supplierPayment.updateMany({
      where: { id, status: SupplierPaymentStatus.COMPLETED, deletedAt: null },
      data: {
        status: SupplierPaymentStatus.REVERSED,
        reversedById: user.id,
        reversedAt: new Date(),
      },
    });
    const current = await tx.supplierPayment.findFirst({
      where: { id, deletedAt: null },
      include: { allocations: true, deskPayment: { select: { id: true } } },
    });
    if (!current) throw new NotFoundException('Supplier payment not found');
    await this.companyScope.assertCanAccessCompany(user, current.companyId, AccessLevel.MANAGE);
    if (claim.count !== 1)
      throw new ConflictException(
        `Supplier payment cannot be reversed from status ${current.status}; only COMPLETED payments can be reversed`,
      );
    let authorizedCash: {
      divisionId: string | null;
      branchId: string | null;
      currency: CurrencyCode;
    } | null = null;
    if (opts.publicReversal) {
      if (current.sourceType === 'Expense') {
        throw new ConflictException(
          'Reverse this payment in Expenses so its expense and payable stay in step.',
        );
      }
      await this.org.assertCanAccessScope(
        user,
        current.divisionId,
        current.branchId,
        AccessLevel.MANAGE,
      );
      if (current.cashAccountId) {
        const cash = await tx.cashAccount.findFirst({
          where: { id: current.cashAccountId, companyId: current.companyId, deletedAt: null },
          select: { companyId: true, divisionId: true, branchId: true, currency: true },
        });
        if (!cash || cash.companyId !== current.companyId || cash.currency !== current.currency) {
          throw new ConflictException(
            'The payment cash account is unavailable or has different accounting scope',
          );
        }
        await this.org.assertCanAccessScope(
          user,
          cash.divisionId,
          cash.branchId,
          AccessLevel.MANAGE,
        );
        authorizedCash = cash;
      }
    }
    if (current.sourceType === 'CashDesk' && !opts.fromCashDesk)
      throw new ConflictException(
        'Reverse this purchase payment in Cash Desk so its cash balance is restored with the payable and journal.',
      );
    if (
      (current.deskPayment || current.sourceType === 'InvoiceDeskInvoice') &&
      !opts.fromDesk &&
      !opts.fromCashDesk
    )
      throw new ConflictException(
        'Reverse this payment in Invoice Desk (or Cash Desk when it was recorded there) to keep the invoice and cash balances together.',
      );
    // A movement written by the cash book (ERP payment) is reversed here with its journal;
    // a movement recorded in Cash Desk must be reversed from Cash Desk.
    const carried = current.cashDeskMovementId
      ? await tx.cashDeskMovement.findUnique({
          where: { id: current.cashDeskMovementId },
          select: { id: true, journalEntryId: true },
        })
      : null;
    if (carried && !carried.journalEntryId && !opts.fromCashDesk && !opts.fromDesk)
      throw new ConflictException(
        'Reverse this payment in Cash Desk so the cash movement is reversed with it.',
      );

    const ordered = [...current.allocations].sort((a, b) => (a.payableId < b.payableId ? -1 : 1));
    if (
      ordered
        .reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0))
        .gt(current.amount)
    ) {
      throw new ConflictException(
        'Payment allocations exceed the original payment amount; review the allocation history before reversal.',
      );
    }
    for (const alloc of ordered) {
      const locked = await this.lockPayable(tx, alloc.payableId);
      if (
        !locked ||
        locked.companyId !== current.companyId ||
        locked.supplierId !== current.supplierId ||
        locked.currency !== current.currency
      ) {
        throw new ConflictException(
          'An allocated payable is missing or has different scope. Review the payment before reversing it.',
        );
      }
      if (locked.status === 'WRITTEN_OFF' || locked.status === 'CANCELLED') {
        throw new ConflictException(
          'Reverse the write-off or source cancellation before reversing this allocated supplier payment.',
        );
      }
      if (opts.publicReversal) {
        if (locked.sourceType === 'Expense')
          throw new ConflictException(
            'Reverse this payment in Expenses so its expense and payable stay in step.',
          );
        await this.org.assertCanAccessScope(
          user,
          locked.divisionId,
          locked.branchId,
          AccessLevel.MANAGE,
        );
      }
      const allocAmount = new Prisma.Decimal(alloc.amount).toDecimalPlaces(2);
      if (
        !allocAmount.isFinite() ||
        allocAmount.lte(0) ||
        !new Prisma.Decimal(locked.paidAmount).isFinite() ||
        new Prisma.Decimal(locked.paidAmount).lt(allocAmount) ||
        !new Prisma.Decimal(locked.outstandingAmount).isFinite() ||
        new Prisma.Decimal(locked.outstandingAmount).lt(0)
      ) {
        throw new ConflictException(
          'An allocated payable has inconsistent settlement amounts; reversal was aborted.',
        );
      }
      const restoredOutstanding = new Prisma.Decimal(locked.outstandingAmount)
        .plus(allocAmount)
        .toDecimalPlaces(2);
      const restoredPaid = new Prisma.Decimal(locked.paidAmount)
        .minus(allocAmount)
        .toDecimalPlaces(2);
      const updated = await tx.payable.update({
        where: { id: alloc.payableId },
        data: {
          outstandingAmount: restoredOutstanding,
          paidAmount: restoredPaid,
          status: restoredPaid.isZero() ? 'OPEN' : 'PARTIALLY_PAID',
        },
      });
      await this.syncSupplierInvoices(tx, updated);
      await this.syncPurchaseOrders(tx, updated);
    }

    const reversalJe = await this.reversePaymentJournal(
      tx,
      current,
      user.id,
      opts.businessDate,
      reason,
      opts.publicReversal,
    );
    if (!reversalJe && (current.journalEntryId || opts.publicReversal))
      throw new ConflictException(
        'Supplier payment reversal could not be posted; reversal aborted to avoid an unbalanced ledger',
      );
    if (reversalJe && current.cashAccountId) {
      const cashRestored = await tx.cashAccount.updateMany({
        where: {
          id: current.cashAccountId,
          companyId: current.companyId,
          deletedAt: null,
          ...(authorizedCash
            ? {
                divisionId: authorizedCash.divisionId,
                branchId: authorizedCash.branchId,
                currency: authorizedCash.currency,
              }
            : {}),
        },
        data: { currentBalance: { increment: new Prisma.Decimal(current.amount) } },
      });
      if ((opts.cashDeskOwnsMovement || opts.publicReversal) && cashRestored.count !== 1)
        throw new ConflictException(
          'The linked ERP cash account is unavailable; purchase reversal was aborted.',
        );
    }
    if (carried?.journalEntryId && !opts.cashDeskOwnsMovement)
      await this.cashBook?.reverseInTransaction(
        tx,
        user,
        carried.id,
        reason,
        reversalJe?.id ?? null,
      );

    const updated = await tx.supplierPayment.update({
      where: { id: current.id },
      data: {
        reversalJournalEntryId: reversalJe?.id ?? null,
      },
      include: this.includeScope(),
    });
    await this.syncSupplierBalance(tx, current.companyId, current.supplierId);
    return { before: current, record: updated, reversal: reversalJe };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async existingByRequest(tx: Tx, requestId: string | null | undefined) {
    if (!requestId) return null;
    if (this.isUuidRequestId(requestId)) {
      const matches = await tx.supplierPayment.findMany({
        where: { requestId: { equals: requestId, mode: 'insensitive' } },
        include: this.includeScope(),
        take: 2,
      });
      if (matches.length > 1)
        throw new ConflictException(
          'This payment request has conflicting historical records. Reconcile them before retrying.',
        );
      return matches[0] ?? null;
    }
    return tx.supplierPayment.findUnique({
      where: { requestId },
      include: this.includeScope(),
    });
  }

  private isUuidRequestId(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private normaliseRequestId(value: string | null | undefined) {
    return value && this.isUuidRequestId(value) ? value.toLowerCase() : value;
  }

  private async requireSupplier(tx: Tx, companyId: string, supplierId: string) {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { id: true, name: true, divisionId: true, branchId: true },
    });
    if (!supplier)
      throw new BadRequestException('Supplier does not belong to this company or is inactive');
    return supplier;
  }

  private async requireCashAccount(tx: Tx, input: SupplierPaymentInput, currency: string) {
    const account = await assertCashAccountForScope(tx, {
      cashAccountId: input.cashAccountId!,
      companyId: input.companyId,
      divisionId: input.divisionId ?? null,
      branchId: input.branchId ?? null,
    });
    if (account.currency && account.currency !== currency)
      throw new BadRequestException(
        `Cash account currency (${account.currency}) does not match the payable currency ` +
          `(${currency}). Choose a ${currency} cash/bank account.`,
      );
    return account;
  }

  /** Mapped ledger account of the chosen cash account, else the role account. */
  private async cashCreditAccountId(
    tx: Tx,
    companyId: string,
    cashAccount: { id: string; accountType: CashAccountType | null } | null,
  ): Promise<string> {
    if (cashAccount) {
      const mapped = await tx.cashAccount.findFirst({
        where: { id: cashAccount.id },
        select: { ledgerAccountId: true },
      });
      if (mapped?.ledgerAccountId) return mapped.ledgerAccountId;
    }
    const role: AccountRole =
      cashAccount?.accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
    const account = await this.accountResolver.resolve(companyId, role, tx);
    return account!.id;
  }

  /**
   * Keep approved supplier invoices behind a payable in step with it. Before Phase 1
   * nothing wrote SupplierInvoice.paidAmount after a payment, so invoice outstanding
   * figures went stale the moment the payable was paid.
   */
  async syncSupplierInvoices(
    tx: Tx,
    payable: {
      id: string;
      companyId: string;
      paidAmount: Prisma.Decimal;
      outstandingAmount?: Prisma.Decimal;
      amount?: Prisma.Decimal;
      status?: string;
      currency?: string | null;
      supplierId?: string | null;
    },
  ) {
    const invoices = await tx.supplierInvoice.findMany({
      where: {
        payableId: payable.id,
        deletedAt: null,
        status: { in: [...SETTLING_INVOICE_STATUSES] },
      },
      select: { id: true, totalAmount: true, companyId: true, supplierId: true, currency: true },
    });
    for (const invoice of invoices) {
      const total = new Prisma.Decimal(invoice.totalAmount);
      if (
        (invoice.companyId !== undefined && invoice.companyId !== payable.companyId) ||
        (payable.supplierId !== undefined &&
          invoice.supplierId !== undefined &&
          invoice.supplierId !== payable.supplierId) ||
        (payable.currency && invoice.currency && invoice.currency !== payable.currency) ||
        (payable.amount && new Prisma.Decimal(payable.amount).gt(total.toDecimalPlaces(2)))
      ) {
        throw new BadRequestException(
          'A linked supplier invoice has different accounting coverage. Review its linkage before settling this payable.',
        );
      }
      const projection = sourceSettlement(total, {
        ...payable,
        outstandingAmount: payable.outstandingAmount ?? total.minus(payable.paidAmount),
      });
      const paid = projection.paidAmount;
      const outstanding = projection.outstandingAmount;
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: paid,
          outstandingAmount: outstanding,
          status: paid.gte(total) ? 'PAID' : paid.gt(0) ? 'PARTIALLY_PAID' : 'APPROVED',
        },
      });
    }
  }

  /** Received purchase orders display the same settlement as their canonical payable. */
  async syncPurchaseOrders(
    tx: Tx,
    payable: {
      id: string;
      companyId: string;
      paidAmount: Prisma.Decimal;
      currency: string | null;
      outstandingAmount?: Prisma.Decimal;
      amount?: Prisma.Decimal;
      status?: string;
      supplierId?: string | null;
    },
  ) {
    const orders = await tx.purchaseOrder.findMany({
      where: {
        payableId: payable.id,
        deletedAt: null,
        status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
      },
      select: { id: true, totalAmount: true, companyId: true, supplierId: true, currency: true },
    });
    for (const order of orders) {
      const total = new Prisma.Decimal(order.totalAmount);
      if (
        (order.companyId !== undefined && order.companyId !== payable.companyId) ||
        (payable.supplierId !== undefined &&
          order.supplierId !== undefined &&
          order.supplierId !== payable.supplierId) ||
        (order.currency && payable.currency && order.currency !== payable.currency) ||
        (payable.amount && new Prisma.Decimal(payable.amount).gt(total.toDecimalPlaces(2)))
      ) {
        throw new BadRequestException(
          'A linked purchase order has different accounting coverage. Review its linkage before settling this payable.',
        );
      }
      const projection = sourceSettlement(total, {
        ...payable,
        outstandingAmount: payable.outstandingAmount ?? total.minus(payable.paidAmount),
      });
      const paid = projection.paidAmount;
      const outstanding = projection.outstandingAmount;
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          paidAmount: paid,
          outstandingAmount: outstanding,
          paymentStatus: projection.paymentStatus,
        },
      });
    }
  }

  /**
   * Refresh Supplier.currentBalance from open payables in the company's base currency
   * (same rule as payables.service; the single resolver replaces both in W5).
   */
  private async syncSupplierBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    supplierId?: string | null,
  ) {
    // Party linkage (W5): one rule for the cached balance, shared by every module.
    await refreshCachedPartyBalance(tx, 'supplier', companyId, supplierId);
  }

  private async reversePaymentJournal(
    tx: Tx,
    payment: {
      id: string;
      companyId: string;
      paymentNumber: string;
      journalEntryId: string | null;
    },
    userId: string,
    businessDate?: Date,
    reason?: string | null,
    requirePaymentOwnership = false,
  ): Promise<{ id: string; journalNumber: string } | null> {
    const original = payment.journalEntryId
      ? await tx.journalEntry.findFirst({
          where: {
            id: payment.journalEntryId,
            companyId: payment.companyId,
            status: 'POSTED',
            deletedAt: null,
            ...(requirePaymentOwnership
              ? { referenceType: 'SupplierPayment', referenceId: payment.id }
              : {}),
          },
          include: { lines: true },
        })
      : null;
    if (
      !original ||
      original.status !== 'POSTED' ||
      original.deletedAt ||
      original.lines.length === 0 ||
      (requirePaymentOwnership &&
        (original.referenceType !== 'SupplierPayment' || original.referenceId !== payment.id))
    )
      return null;
    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: 'POSTED', deletedAt: null },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedById: userId,
        reversalReason: reason ?? null,
      },
    });
    if (claim.count !== 1) return null;
    return this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: businessDate ?? new Date(),
        description: `Reversal of supplier payment ${payment.paymentNumber}`,
        referenceType: 'SupplierPayment',
        referenceId: payment.id,
        moduleName: 'supplier-payments',
        userId,
        lines: original.lines.map((line) => ({
          accountId: line.accountId,
          ...partyOfLine(line),
          debit: new Prisma.Decimal(line.credit ?? 0).toDecimalPlaces(2),
          credit: new Prisma.Decimal(line.debit ?? 0).toDecimalPlaces(2),
          description: `Reversal: ${line.description ?? ''}`.trim(),
          divisionId: line.divisionId ?? undefined,
          branchId: line.branchId ?? undefined,
        })),
      },
      tx,
    );
  }

  private includeScope() {
    return {
      purchaseAdvance: {
        select: {
          purchaseOrder: {
            select: {
              id: true,
              purchaseOrderNumber: true,
              internalInvoiceNumber: true,
              supplierInvoiceNumber: true,
            },
          },
        },
      },
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      supplier: {
        select: { id: true, supplierCode: true, name: true, currentBalance: true },
      },
      cashAccount: { select: { id: true, accountName: true, accountType: true } },
      allocations: {
        select: {
          id: true,
          payableId: true,
          amount: true,
          payable: {
            select: {
              id: true,
              payableNumber: true,
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
}

type PayableSnapshot = Prisma.PayableGetPayload<Record<string, never>>;
