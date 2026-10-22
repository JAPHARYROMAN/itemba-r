import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CurrencyCode, Payable, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { assertLegacyPosWriteAllowed } from '../../common/services/pos-draft-policy';
import { sourceSettlement } from '../../common/utils/source-settlement';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService, partyOfLine } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CashBookService } from '../cash-book/cash-book.service';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { ReverseDocumentPaymentDto } from './dto/reverse-document-payment.dto';

export type DocumentPaymentKind = 'receivable' | 'payable';
type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;
type Target = {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  currency: CurrencyCode;
  number: string;
  partyId: string | null;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  outstandingAmount: Prisma.Decimal;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
};
const journalInclude = { lines: true } satisfies Prisma.JournalEntryInclude;
type Journal = Prisma.JournalEntryGetPayload<{ include: typeof journalInclude }>;
const movementInclude = {
  entries: { include: { account: { include: { erpCashAccount: true } } } },
  settledSupplierPayment: { select: { id: true } },
} satisfies Prisma.CashDeskMovementInclude;
type Movement = Prisma.CashDeskMovementGetPayload<{ include: typeof movementInclude }>;
type Proof = {
  amount: Prisma.Decimal;
  movement: Movement;
  cash: NonNullable<Movement['entries'][number]['account']['erpCashAccount']>;
};
export type DocumentPaymentHistoryRow = {
  id: string;
  kind: 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'LEGACY_JOURNAL';
  paymentNumber: string;
  paymentDate: Date;
  amount: Prisma.Decimal;
  allocatedAmount: Prisma.Decimal;
  currency: string;
  status: string;
  cashAccountId: string | null;
  cashAccountName: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
  reversedAt: Date | null;
  reversalReason: string | null;
  canReverse: boolean;
  canCorrect: boolean;
  reversalEndpoint: string | null;
  reversalUnavailableReason: string | null;
  allocations: { documentId: string; documentNumber: string; amount: Prisma.Decimal }[];
};

/** Reads canonical allocations; only reverses legacy settlements with complete cash provenance. */
@Injectable()
export class DocumentPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly cashBook: CashBookService,
    private readonly supplierPayments: SupplierPaymentsService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(kind: DocumentPaymentKind, id: string, user: AuthUser) {
    const target = await this.readTarget(this.prisma, kind, id);
    await this.authorize(target, user, AccessLevel.READ);
    const data: DocumentPaymentHistoryRow[] = [];
    if (kind === 'receivable') {
      const payments = await this.prisma.customerPayment.findMany({
        where: {
          companyId: target.companyId,
          deletedAt: null,
          allocations: { some: { receivableId: id } },
        },
        include: {
          allocations: { include: { receivable: true } },
          cashAccount: true,
          journalEntry: true,
          cashDeskMovement: true,
        },
      });
      for (const payment of payments) {
        const documents = payment.allocations.map((a) => ({
          ...a.receivable,
          number: a.receivable.receivableNumber,
        }));
        await this.authorizeAll([payment, ...documents], user, AccessLevel.READ);
        let reason = this.canonicalReason(
          payment,
          documents,
          payment.cashDeskMovement && !payment.cashDeskMovement.journalEntryId
            ? 'Reverse this receipt in Cash Desk so its source stays in step.'
            : null,
          'CustomerPayment',
        );
        reason ??= await this.manageReason(
          [payment, ...documents, ...(payment.cashAccount ? [payment.cashAccount] : [])],
          user,
          'customer-payments.manage',
        );
        data.push({
          ...this.paymentFields(payment),
          kind: 'CUSTOMER_PAYMENT',
          allocatedAmount: Prisma.Decimal.sum(
            ...payment.allocations.filter((a) => a.receivableId === id).map((a) => a.amount),
          ),
          canReverse: !reason,
          canCorrect:
            !reason &&
            user.permissions.includes('receivables.manage') &&
            payment.allocations.length === 1 &&
            payment.unappliedAmount.isZero() &&
            payment.appliedAmount.eq(payment.amount),
          reversalEndpoint: !reason ? `/customer-payments/${payment.id}/reverse` : null,
          reversalUnavailableReason: reason,
          allocations: payment.allocations.map((a) => ({
            documentId: a.receivableId,
            documentNumber: a.receivable.receivableNumber,
            amount: a.amount,
          })),
        });
      }
    } else {
      const payments = await this.prisma.supplierPayment.findMany({
        where: {
          companyId: target.companyId,
          deletedAt: null,
          OR: [
            { allocations: { some: { payableId: id } } },
            { purchaseAdvance: { applications: { some: { payableId: id } } } },
          ],
        },
        include: {
          allocations: { include: { payable: true } },
          cashAccount: true,
          journalEntry: true,
          purchaseAdvance: { include: { applications: { include: { payable: true } } } },
          deskPayment: true,
          cashDeskMovement: true,
          carriedMovement: true,
        },
      });
      for (const payment of payments) {
        const allAllocations = [
          ...payment.allocations,
          ...(payment.purchaseAdvance?.applications ?? []),
        ];
        const documents = allAllocations.map((a) => ({
          ...a.payable,
          number: a.payable.payableNumber,
        }));
        await this.authorizeAll([payment, ...documents], user, AccessLevel.READ);
        const owner =
          payment.sourceType === 'Expense'
            ? 'Reverse this payment in Expenses so its source stays in step.'
            : payment.sourceType === 'CashDesk' ||
                (payment.carriedMovement && !payment.carriedMovement.journalEntryId) ||
                (payment.cashDeskMovement && !payment.cashDeskMovement.journalEntryId)
              ? 'Reverse this payment in Cash Desk so its source stays in step.'
              : payment.deskPayment || payment.sourceType === 'InvoiceDeskInvoice'
                ? 'Reverse this payment in Invoice Desk so its source stays in step.'
                : payment.purchaseAdvance
                  ? 'Reverse this purchase advance through its originating purchase payment workflow.'
                  : null;
        let reason = this.canonicalReason(payment, documents, owner, 'SupplierPayment');
        reason ??= await this.manageReason(
          [payment, ...documents, ...(payment.cashAccount ? [payment.cashAccount] : [])],
          user,
          'supplier-payments.manage',
        );
        data.push({
          ...this.paymentFields(payment),
          kind: 'SUPPLIER_PAYMENT',
          allocatedAmount: allAllocations
            .filter((a) => a.payableId === id)
            .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)),
          canReverse: !reason,
          canCorrect:
            !reason &&
            user.permissions.includes('payables.manage') &&
            payment.allocations.length === 1 &&
            payment.unappliedAmount.isZero() &&
            payment.appliedAmount.eq(payment.amount),
          reversalEndpoint: !reason ? `/supplier-payments/${payment.id}/reverse` : null,
          reversalUnavailableReason: reason,
          allocations: allAllocations.map((a) => ({
            documentId: a.payableId,
            documentNumber: a.payable.payableNumber,
            amount: a.amount,
          })),
        });
      }
    }
    const referenceType = this.referenceType(kind);
    const journals = await this.prisma.journalEntry.findMany({
      where: {
        companyId: target.companyId,
        referenceType,
        referenceId: id,
        deletedAt: null,
        description: { startsWith: `${referenceType} settlement ` },
        status: { in: ['POSTED', 'REVERSED'] },
      },
      include: journalInclude,
    });
    for (const journal of journals) {
      if (await this.canonicalOwner(this.prisma, journal.id)) continue;
      let proof: Proof | null = null;
      let reason: string | null = null;
      try {
        proof = await this.proveLegacy(this.prisma, kind, target, journal);
      } catch (error) {
        reason = this.explanation(error);
      }
      if (proof)
        reason = await this.manageReason(
          [target, proof.cash, proof.movement.entries[0].account],
          user,
          `${kind}s.manage`,
        );
      data.push({
        id: journal.id,
        kind: 'LEGACY_JOURNAL',
        paymentNumber: journal.journalNumber,
        paymentDate: journal.transactionDate,
        amount: journal.totalDebit,
        allocatedAmount: journal.totalDebit,
        currency: target.currency,
        status: journal.status,
        cashAccountId: proof?.cash.id ?? null,
        cashAccountName: proof?.cash.accountName ?? null,
        method: null,
        reference: target.number,
        notes: journal.description,
        reversedAt: journal.reversedAt,
        reversalReason: journal.reversalReason,
        canReverse: !reason && !!proof,
        canCorrect: false,
        reversalEndpoint:
          !reason && proof ? `/${kind}s/${id}/payments/${journal.id}/reverse` : null,
        reversalUnavailableReason: reason,
        allocations: [
          { documentId: id, documentNumber: target.number, amount: journal.totalDebit },
        ],
      });
    }
    data.sort(
      (a, b) => b.paymentDate.getTime() - a.paymentDate.getTime() || a.id.localeCompare(b.id),
    );
    return { data };
  }

  async reverseLegacy(
    kind: DocumentPaymentKind,
    id: string,
    journalId: string,
    dto: ReverseDocumentPaymentDto,
    user: AuthUser,
  ) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500 || !/[\p{L}\p{N}]/u.test(reason))
      throw new BadRequestException('A meaningful reason between 3 and 500 characters is required');
    if (!user.permissions.includes(`${kind}s.manage`))
      throw new ForbiddenException('Document manage permission is required');
    return this.transaction(async (tx) => {
      const target = await this.lockTarget(tx, kind, id);
      await this.authorize(target, user, AccessLevel.MANAGE);
      await assertLegacyPosWriteAllowed(tx, user, target.companyId, target.branchId);
      await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${journalId} FOR UPDATE`;
      const journal = await tx.journalEntry.findFirst({
        where: { id: journalId, deletedAt: null },
        include: journalInclude,
      });
      if (!journal) throw new NotFoundException('Legacy payment journal not found');
      const firstProof = await this.proveLegacy(tx, kind, target, journal);
      await tx.$queryRaw`SELECT id FROM cash_desk_movements WHERE id = ${firstProof.movement.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${firstProof.cash.id} FOR UPDATE`;
      const proof = await this.proveLegacy(tx, kind, target, journal);
      await this.authorizeAll(
        [proof.cash, proof.movement.entries[0].account],
        user,
        AccessLevel.MANAGE,
      );
      const claimed = await tx.journalEntry.updateMany({
        where: {
          id: journalId,
          companyId: target.companyId,
          status: 'POSTED',
          deletedAt: null,
          reversedAt: null,
        },
        data: {
          status: 'REVERSED',
          reversedById: user.id,
          reversedAt: new Date(),
          reversalReason: reason,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('This payment has already been reversed');
      const now = new Date();
      const transactionDate = now < journal.transactionDate ? journal.transactionDate : now;
      const reversal = await this.postingEngine.postLines(
        {
          companyId: journal.companyId,
          divisionId: journal.divisionId,
          branchId: journal.branchId,
          journalNumber: `JE-LEGACY-PAY-REV-${journal.id}`,
          transactionDate,
          description: `Reverse ${journal.description}: ${reason}`,
          referenceType: `${this.referenceType(kind)}PaymentReversal`,
          referenceId: journal.id,
          moduleName: 'document-payments',
          userId: user.id,
          lines: journal.lines.map((line) => ({
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            description: line.description ?? undefined,
            ...partyOfLine(line),
          })),
        },
        tx,
      );
      await tx.journalEntry.update({
        where: { id: reversal.id },
        data: { reversalOfId: journal.id },
      });
      const paidAmount = target.paidAmount.minus(proof.amount);
      const outstandingAmount = target.outstandingAmount.plus(proof.amount);
      const status = paidAmount.gt(0) ? 'PARTIALLY_PAID' : 'OPEN';
      const updated =
        kind === 'receivable'
          ? await tx.receivable.update({
              where: { id },
              data: { paidAmount, outstandingAmount, status },
            })
          : await tx.payable.update({
              where: { id },
              data: { paidAmount, outstandingAmount, status },
            });
      const cache = await tx.cashAccount.updateMany({
        where: {
          id: proof.cash.id,
          companyId: target.companyId,
          currency: target.currency,
          isActive: true,
          deletedAt: null,
          ...(kind === 'receivable' ? { currentBalance: { gte: proof.amount } } : {}),
        },
        data: {
          currentBalance:
            kind === 'receivable' ? { decrement: proof.amount } : { increment: proof.amount },
        },
      });
      if (cache.count !== 1)
        throw new ConflictException(
          'The verified cash account is unavailable or has insufficient funds for this reversal',
        );
      const cashReversal = await this.cashBook.reverseInTransaction(
        tx,
        user,
        proof.movement.id,
        reason,
        reversal.id,
      );
      if (!cashReversal) throw new ConflictException('The cash-book payment was already reversed');
      if (kind === 'payable') {
        await this.supplierPayments.syncSupplierInvoices(tx, updated as Payable);
        await this.supplierPayments.syncPurchaseOrders(tx, updated as Payable);
      } else await this.syncSalesOrder(tx, target, updated);
      await refreshCachedPartyBalance(
        tx,
        kind === 'receivable' ? 'customer' : 'supplier',
        target.companyId,
        target.partyId,
      );
      await this.audit.logStrictInTransaction(tx, {
        action: 'LEGACY_DOCUMENT_PAYMENT_REVERSE',
        entityType: 'JournalEntry',
        entityId: journal.id,
        companyId: target.companyId,
        userId: user.id,
        oldValue: {
          status: journal.status,
          paidAmount: target.paidAmount.toFixed(2),
          outstandingAmount: target.outstandingAmount.toFixed(2),
        },
        newValue: {
          status: 'REVERSED',
          reason,
          documentId: id,
          documentKind: kind,
          amount: proof.amount.toFixed(2),
          paidAmount: paidAmount.toFixed(2),
          outstandingAmount: outstandingAmount.toFixed(2),
          reversalJournalEntryId: reversal.id,
          cashAccountId: proof.cash.id,
          cashMovementId: proof.movement.id,
          cashReversalId: cashReversal.id,
        },
      });
      return {
        id: journal.id,
        status: 'REVERSED',
        reversalJournalEntryId: reversal.id,
        document: updated,
      };
    });
  }

  private async proveLegacy(
    db: Db,
    kind: DocumentPaymentKind,
    target: Target,
    journal: Journal,
  ): Promise<Proof> {
    const fail = (message: string): never => {
      throw new ConflictException(message);
    };
    if (journal.status !== 'POSTED' || journal.reversedAt)
      fail('This legacy payment has already been reversed');
    if (['CANCELLED', 'WRITTEN_OFF'].includes(target.status))
      fail(`A ${target.status.toLowerCase()} document cannot have payments reversed here`);
    if (
      target.sourceType === 'Expense' ||
      target.sourceType === 'InvoiceDeskInvoice' ||
      target.sourceType === 'CashDesk'
    )
      fail('Reverse this payment in its originating source workflow');
    await this.assertSourceLinks(db, kind, target);
    if (
      journal.companyId !== target.companyId ||
      journal.divisionId !== target.divisionId ||
      journal.branchId !== target.branchId ||
      journal.referenceType !== this.referenceType(kind) ||
      journal.referenceId !== target.id ||
      !this.isExactSettlementDescription(kind, target, journal) ||
      journal.reversalOfId ||
      journal.deletedAt
    )
      fail('The journal is not an exact direct settlement of this document');
    if (await this.canonicalOwner(db, journal.id))
      fail('Use the canonical payment reversal for this journal');
    if (await db.journalEntry.count({ where: { reversalOfId: journal.id } }))
      fail('This journal already has a reversal');
    const control = await this.accountResolver.resolve(
      target.companyId,
      kind === 'receivable' ? 'AR_CONTROL' : 'AP_CONTROL',
      db as Tx,
    );
    const controlLine = journal.lines.find((line) => line.accountId === control.id);
    const cashLine = journal.lines.find((line) => line.accountId !== control.id);
    const amount = journal.totalDebit;
    if (
      journal.lines.length !== 2 ||
      !controlLine ||
      !cashLine ||
      amount.lte(0) ||
      !journal.totalCredit.eq(amount) ||
      amount.decimalPlaces() > 2
    )
      fail('Only an exact two-line cash and control settlement can be reversed here');
    if (!controlLine || !cashLine)
      throw new ConflictException('The settlement lines are unavailable');
    const debitLine = kind === 'receivable' ? cashLine : controlLine;
    const creditLine = kind === 'receivable' ? controlLine : cashLine;
    if (
      !debitLine.debit.eq(amount) ||
      !debitLine.credit.isZero() ||
      !creditLine.credit.eq(amount) ||
      !creditLine.debit.isZero() ||
      journal.lines.some((line) => line.companyId !== target.companyId)
    )
      fail('The journal does not contain the expected settlement direction and amount');
    if (
      target.paidAmount.lt(amount) ||
      target.outstandingAmount.lt(0) ||
      target.paidAmount.plus(target.outstandingAmount).gt(target.amount)
    )
      fail('The document balances cannot safely restore this payment delta');
    const movements = await db.cashDeskMovement.findMany({
      where: { journalEntryId: journal.id },
      include: movementInclude,
    });
    if (movements.length !== 1)
      fail('A unique cash-book link is required to identify the cash balance to restore');
    const movement = movements[0];
    const entry = movement.entries[0];
    if (
      movement.reversedAt ||
      movement.reversalOfId ||
      movement.kind !== (kind === 'receivable' ? 'CUSTOMER_RECEIPT' : 'SUPPLIER_PAYMENT') ||
      movement.requestId !== `${this.referenceType(kind)}:${target.id}:${journal.id}` ||
      movement.journalReferenceType !== this.referenceType(kind) ||
      movement.currency !== target.currency ||
      !movement.amount.eq(amount) ||
      movement.entries.length !== 1 ||
      !entry?.erpBalanceApplied ||
      !entry.amount.eq(kind === 'receivable' ? amount : amount.negated()) ||
      (kind === 'receivable'
        ? movement.receivableId !== target.id || !!movement.payableId
        : movement.payableId !== target.id || !!movement.receivableId)
    )
      fail('The cash-book entry does not prove this direct payment and its exact cash delta');
    if (
      movement.partyType !== 'NONE' ||
      movement.customerId ||
      movement.supplierId ||
      movement.customerPaymentId ||
      movement.supplierPaymentId ||
      movement.settledSupplierPayment ||
      movement.expenseId ||
      movement.refundId ||
      movement.invoicePaymentId ||
      movement.salesPaymentId ||
      movement.loanId ||
      movement.payrollRunId ||
      movement.payrollJournalEntryId ||
      movement.fuelReportPostingId
    )
      fail('This payment belongs to another source workflow; reverse it there');
    const cash = entry.account.erpCashAccount;
    if (
      !cash ||
      cash.id !== entry.account.erpCashAccountId ||
      cash.companyId !== target.companyId ||
      entry.account.companyId !== target.companyId ||
      cash.currency !== target.currency ||
      entry.account.currency !== target.currency ||
      cash.ledgerAccountId !== cashLine.accountId ||
      cash.deletedAt ||
      !cash.isActive ||
      !this.scopeMatches(entry.account, target) ||
      !this.scopeMatches(cash, target)
    )
      fail(
        'The cash-book account does not prove which active ERP cash balance matches the original journal',
      );
    if (!cash) throw new ConflictException('The ERP cash account is unavailable');
    return { amount, movement, cash };
  }

  private async canonicalOwner(db: Db, journalEntryId: string) {
    const [customer, supplier] = await Promise.all([
      db.customerPayment.findFirst({ where: { journalEntryId }, select: { id: true } }),
      db.supplierPayment.findFirst({ where: { journalEntryId }, select: { id: true } }),
    ]);
    return Boolean(customer || supplier);
  }

  private paymentFields(payment: {
    id: string;
    paymentNumber: string;
    paymentDate: Date;
    amount: Prisma.Decimal;
    currency: string;
    status: string;
    cashAccountId: string | null;
    cashAccount: { accountName: string } | null;
    method: string;
    reference: string | null;
    notes: string | null;
    reversedAt: Date | null;
    journalEntry?: { reversalReason?: string | null } | null;
  }) {
    return {
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      cashAccountId: payment.cashAccountId,
      cashAccountName: payment.cashAccount?.accountName ?? null,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      reversedAt: payment.reversedAt,
      reversalReason: payment.journalEntry?.reversalReason ?? null,
    };
  }

  private canonicalReason(
    payment: {
      id: string;
      companyId: string;
      currency: string;
      status: string;
      journalEntry: {
        status: string;
        referenceType: string | null;
        referenceId: string | null;
      } | null;
    },
    documents: { companyId: string; currency: string; status: string; deletedAt: Date | null }[],
    owner: string | null,
    expectedReferenceType: 'CustomerPayment' | 'SupplierPayment',
  ) {
    if (payment.status !== 'COMPLETED') return 'This payment has already been reversed';
    if (owner) return owner;
    if (!payment.journalEntry || payment.journalEntry.status !== 'POSTED')
      return 'The original posted payment journal is unavailable';
    if (
      payment.journalEntry.referenceType !== expectedReferenceType ||
      payment.journalEntry.referenceId !== payment.id
    )
      return 'The original journal belongs to another source; reverse this payment in its originating workflow';
    if (
      documents.some(
        (doc) =>
          doc.deletedAt ||
          ['CANCELLED', 'WRITTEN_OFF'].includes(doc.status) ||
          doc.companyId !== payment.companyId ||
          doc.currency !== payment.currency,
      )
    )
      return 'An allocated document is closed or no longer matches the payment';
    return null;
  }

  private async manageReason(
    rows: { companyId: string; divisionId: string | null; branchId: string | null }[],
    user: AuthUser,
    permission: string,
  ) {
    if (!user.permissions.includes(permission))
      return `Permission ${permission} is required to reverse this payment`;
    try {
      await this.authorizeAll(rows, user, AccessLevel.MANAGE);
      return null;
    } catch {
      return 'Manage access to the payment and all affected document and cash scopes is required';
    }
  }

  private async authorizeAll(
    rows: { companyId: string; divisionId: string | null; branchId: string | null }[],
    user: AuthUser,
    access: AccessLevel,
  ) {
    for (const row of rows) await this.authorize(row, user, access);
  }

  private async authorize(
    row: { companyId: string; divisionId: string | null; branchId: string | null },
    user: AuthUser,
    access: AccessLevel,
  ) {
    await this.companyScope.assertCanAccessCompany(user, row.companyId, access);
    await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, access);
  }

  private async readTarget(db: Db, kind: DocumentPaymentKind, id: string): Promise<Target> {
    if (kind === 'receivable') {
      const row = await db.receivable.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw new NotFoundException('Receivable not found');
      return { ...row, number: row.receivableNumber, partyId: row.customerId };
    }
    const row = await db.payable.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Payable not found');
    return { ...row, number: row.payableNumber, partyId: row.supplierId };
  }

  private async lockTarget(tx: Tx, kind: DocumentPaymentKind, id: string) {
    if (kind === 'payable') {
      if (!(await this.supplierPayments.lockPayable(tx, id)))
        throw new NotFoundException('Payable not found');
    } else {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE "receivableId" = ${id} OR id IN (SELECT "sourceId" FROM receivables WHERE id = ${id} AND "sourceType" = 'SalesOrder') ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
    }
    return this.readTarget(tx, kind, id);
  }

  private async syncSalesOrder(
    tx: Tx,
    target: Target,
    updated: {
      amount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
      status: string;
    },
  ) {
    const orders = await tx.salesOrder.findMany({
      where: {
        OR: [
          { receivableId: target.id },
          ...(target.sourceType === 'SalesOrder' && target.sourceId
            ? [{ id: target.sourceId }]
            : []),
        ],
      },
    });
    for (const order of orders) {
      const projection = sourceSettlement(order.totalAmount, updated);
      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          paidAmount: projection.paidAmount,
          outstandingAmount: projection.outstandingAmount,
          paymentStatus: projection.paymentStatus,
        },
      });
    }
  }

  /** Backlinks matter too: a stale source status must never be silently revived. */
  private async assertSourceLinks(db: Db, kind: DocumentPaymentKind, target: Target) {
    const compatible = (row: {
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      currency: string | null;
      deletedAt: Date | null;
      totalAmount: Prisma.Decimal;
    }) =>
      !row.deletedAt &&
      row.companyId === target.companyId &&
      (!row.currency || row.currency === target.currency) &&
      this.scopeMatches(row, target) &&
      target.amount.lte(row.totalAmount);
    if (kind === 'receivable') {
      const orders = await db.salesOrder.findMany({
        where: {
          OR: [
            { receivableId: target.id },
            ...(target.sourceType === 'SalesOrder' && target.sourceId
              ? [{ id: target.sourceId }]
              : []),
          ],
        },
      });
      if (
        orders.length > 1 ||
        (target.sourceType === 'SalesOrder' && !orders.some((row) => row.id === target.sourceId)) ||
        orders.some(
          (row) =>
            !compatible(row) ||
            ['CANCELLED', 'VOIDED', 'DRAFT'].includes(row.status) ||
            row.customerId !== target.partyId ||
            row.receivableId !== target.id,
        )
      )
        throw new ConflictException(
          'The receivable no longer matches one active source sales order',
        );
      return;
    }
    const orders = await db.purchaseOrder.findMany({
      where: {
        OR: [
          { payableId: target.id },
          ...(target.sourceType === 'PurchaseOrder' && target.sourceId
            ? [{ id: target.sourceId }]
            : []),
        ],
      },
    });
    const invoices = await db.supplierInvoice.findMany({
      where: {
        OR: [
          { payableId: target.id },
          ...(target.sourceType === 'SupplierInvoice' && target.sourceId
            ? [{ id: target.sourceId }]
            : []),
        ],
      },
    });
    if (
      orders.length > 1 ||
      (target.sourceType === 'PurchaseOrder' &&
        !orders.some((row) => row.id === target.sourceId)) ||
      orders.some(
        (row) =>
          !compatible(row) ||
          !['RECEIVED', 'PARTIALLY_RECEIVED'].includes(row.status) ||
          row.supplierId !== target.partyId ||
          row.payableId !== target.id,
      )
    )
      throw new ConflictException('The payable no longer matches one active source purchase order');
    if (
      invoices.length > 1 ||
      (target.sourceType === 'SupplierInvoice' &&
        !invoices.some((row) => row.id === target.sourceId)) ||
      invoices.some(
        (row) =>
          !compatible(row) ||
          !['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(row.status) ||
          row.supplierId !== target.partyId ||
          row.payableId !== target.id,
      )
    )
      throw new ConflictException(
        'The payable no longer matches one active source supplier invoice',
      );
    if (target.sourceType === 'GoodsReceivedNote') {
      const grn = target.sourceId
        ? await db.goodsReceivedNote.findFirst({
            where: {
              id: target.sourceId,
              companyId: target.companyId,
              supplierId: target.partyId ?? undefined,
              status: 'POSTED',
              deletedAt: null,
            },
          })
        : null;
      if (!grn || !this.scopeMatches(grn, target) || !target.partyId)
        throw new ConflictException('The payable no longer matches its posted goods received note');
    }
    if (
      target.sourceType &&
      ![
        'PurchaseOrder',
        'SupplierInvoice',
        'GoodsReceivedNote',
        'OpeningBalance',
        'AccountAdjustment',
      ].includes(target.sourceType)
    )
      throw new ConflictException(
        'This legacy payable has an unverified source; review its source workflow first',
      );
  }

  private scopeMatches(
    scope: { divisionId: string | null; branchId: string | null },
    target: Target,
  ) {
    return (
      (!scope.divisionId || scope.divisionId === target.divisionId) &&
      (!scope.branchId || scope.branchId === target.branchId)
    );
  }

  private referenceType(kind: DocumentPaymentKind) {
    return kind === 'receivable' ? 'Receivable' : 'Payable';
  }

  private isExactSettlementDescription(
    kind: DocumentPaymentKind,
    target: Target,
    journal: Journal,
  ) {
    const base = `${this.referenceType(kind)} settlement ${target.number}`;
    if (journal.description === base) return true;
    const suffix = journal.description.slice(base.length);
    const prefix = kind === 'receivable' ? 'AR' : 'AP';
    return (
      journal.description.startsWith(base) &&
      /^ \[request:[0-9a-f]{64}\]$/.test(suffix) &&
      new RegExp(
        `^${prefix}-PAY-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
      ).test(journal.journalNumber)
    );
  }
  private explanation(error: unknown) {
    return error instanceof ConflictException
      ? error.message
      : 'The legacy payment cash provenance could not be verified';
  }

  private async transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(run, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 20000,
        });
      } catch (error) {
        const { code, meta } = error as { code?: string; meta?: { code?: string } };
        if (attempt === 2 || !(code === 'P2034' || ['40001', '40P01'].includes(meta?.code ?? '')))
          throw error;
      }
    }
    throw new ConflictException('The payment changed concurrently; retry the reversal');
  }
}
