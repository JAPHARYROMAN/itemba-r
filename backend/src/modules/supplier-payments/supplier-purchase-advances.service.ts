import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessLevel, CashDeskAccount, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { assertCashAccountScopeCompatible } from '../../common/services/cash-account-scope.helper';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import {
  PostingEngineService,
  partyOf,
  partyOfLine,
} from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CashMovementDto } from '../cash-desk/cash-desk.dto';
import { SupplierPaymentsService } from './supplier-payments.service';
import { toPaymentMethodGeneral } from './payment-method';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type Tx = Prisma.TransactionClient;

/** A cash payment first becomes an asset; settlement later moves that asset to AP. */
@Injectable()
export class SupplierPurchaseAdvancesService {
  constructor(
    private readonly posting: PostingEngineService,
    private readonly accounts: AccountResolverService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly payments: SupplierPaymentsService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  async pay(
    tx: Tx,
    user: AuthUser,
    drawer: CashDeskAccount,
    input: CashMovementDto,
    date: Date,
    amount: Prisma.Decimal,
  ) {
    if (!user.permissions.includes('purchases.view'))
      throw new ForbiddenException('Purchase view permission is required for an advance.');
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${input.purchaseOrderId!} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: {
        id: input.purchaseOrderId,
        companyId: drawer.companyId,
        supplierId: input.supplierId,
        currency: drawer.currency as never,
        deletedAt: null,
        supplier: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        supplierInvoices: {
          where: { deletedAt: null, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] } },
        },
      },
    });
    if (
      !order ||
      !order.supplierId ||
      order.status !== 'CONFIRMED' ||
      order.purchaseType === 'CASH_PURCHASE' ||
      order.payableId ||
      order.supplierInvoices.some((i) => i.payableId)
    )
      throw new ConflictException(
        'Choose a confirmed, unpaid purchase order with no posted invoice. Use its payable once invoiced.',
      );
    await this.org.assertCanAccessScope(user, order.divisionId, order.branchId, AccessLevel.WRITE);
    if (date < new Date(order.orderDate.toISOString().slice(0, 10)) || date < drawer.openingDate)
      throw new BadRequestException('Payment cannot precede the PO or cash account opening date.');
    if (amount.lte(0) || amount.gt(order.outstandingAmount))
      throw new BadRequestException('Advance exceeds the remaining purchase order balance.');
    await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${drawer.erpCashAccountId!} FOR UPDATE`;
    const cash = await tx.cashAccount.findFirst({
      where: {
        id: drawer.erpCashAccountId!,
        companyId: drawer.companyId,
        currency: order.currency,
        isActive: true,
        deletedAt: null,
      },
      include: { ledgerAccount: true },
    });
    if (
      !cash?.ledgerAccount ||
      cash.ledgerAccount.companyId !== drawer.companyId ||
      cash.ledgerAccount.accountType !== 'ASSET' ||
      !cash.ledgerAccount.isActive ||
      cash.ledgerAccount.deletedAt
    )
      throw new BadRequestException(
        'Connect an active cash account with an active asset ledger in this company.',
      );
    assertCashAccountScopeCompatible(cash, drawer);
    assertCashAccountScopeCompatible(cash, order);
    for (const scope of [drawer, order]) {
      if (
        (cash.ledgerAccount.divisionId && cash.ledgerAccount.divisionId !== scope.divisionId) ||
        (cash.ledgerAccount.branchId && cash.ledgerAccount.branchId !== scope.branchId)
      )
        throw new BadRequestException(
          'The mapped cash ledger belongs to a different division or branch.',
        );
    }
    await this.org.assertCanAccessScope(user, cash.divisionId, cash.branchId, AccessLevel.WRITE);
    if (cash.currentBalance.lt(amount))
      throw new BadRequestException('Insufficient funds in the linked ERP cash account.');
    const asset = await this.advanceAccount(tx, order.companyId);
    if (asset.id === cash.ledgerAccount.id)
      throw new BadRequestException(
        'Supplier advances and cash must use different ledger accounts.',
      );
    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber: await this.codes.next({
          entityType: 'SupplierPayment',
          companyId: order.companyId,
          tx,
        }),
        requestId: input.requestId,
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        supplierId: order.supplierId,
        amount,
        appliedAmount: 0,
        unappliedAmount: amount,
        paymentDate: date,
        currency: order.currency,
        method: toPaymentMethodGeneral(
          drawer.kind === 'CASH'
            ? 'Cash'
            : drawer.kind === 'BANK'
              ? 'Bank transfer'
              : 'Mobile money',
        ),
        sourceType: 'CashDesk',
        sourceId: input.requestId,
        cashAccountId: cash.id,
        reference: input.reference,
        notes: input.description,
        createdById: user.id,
        purchaseAdvance: { create: { purchaseOrderId: order.id, advanceAccountId: asset.id } },
      },
    });
    const journal = await this.posting.postLines(
      {
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        transactionDate: date,
        description: `Supplier advance ${payment.paymentNumber} · ${order.purchaseOrderNumber}`,
        referenceType: 'SupplierPayment',
        referenceId: payment.id,
        moduleName: 'supplier-payments',
        userId: user.id,
        lines: [
          {
            accountId: asset.id,
            ...partyOf('supplier', order.supplierId),
            debit: amount,
            credit: 0,
          },
          { accountId: cash.ledgerAccount.id, debit: 0, credit: amount },
        ],
      },
      tx,
    );
    const posted = await tx.supplierPayment.update({
      where: { id: payment.id },
      data: { journalEntryId: journal.id },
    });
    await tx.cashAccount.update({
      where: { id: cash.id },
      data: { currentBalance: { decrement: amount } },
    });
    await this.syncOrder(tx, order.id);
    await refreshCachedPartyBalance(tx, 'supplier', order.companyId, order.supplierId);
    await this.audit.logStrictInTransaction(tx, {
      action: 'SUPPLIER_PURCHASE_ADVANCE',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      companyId: order.companyId,
      userId: user.id,
      newValue: {
        purchaseOrderId: order.id,
        amount: amount.toFixed(2),
        journalEntryId: journal.id,
      },
    });
    return { payment: posted, payableId: undefined, invoiceId: undefined };
  }

  /** Caller owns the PO lock. Each unapplied cent is moved once; cash is never touched. */
  async apply(tx: Tx, user: AuthUser, orderId: string, payableId: string, postingDate: Date) {
    const advances = await tx.supplierPurchaseAdvance.findMany({
      where: {
        purchaseOrderId: orderId,
        supplierPayment: { status: 'COMPLETED', deletedAt: null, unappliedAmount: { gt: 0 } },
      },
      include: { supplierPayment: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!advances.length) return;
    await tx.$queryRaw`SELECT id FROM payables WHERE id = ${payableId} FOR UPDATE`;
    let payable = await tx.payable.findUniqueOrThrow({
      where: { id: payableId },
      include: { journalEntry: true },
    });
    for (const advance of advances) {
      const payment = advance.supplierPayment;
      if (
        payable.companyId !== payment.companyId ||
        payable.supplierId !== payment.supplierId ||
        payable.currency !== payment.currency ||
        payable.deletedAt ||
        !['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(payable.status) ||
        payable.journalEntry?.status !== 'POSTED'
      )
        throw new ConflictException(
          'The supplier advance and posted purchase must use the same company, supplier and currency.',
        );
      const amount = Prisma.Decimal.min(payment.unappliedAmount, payable.outstandingAmount);
      if (amount.lte(0)) break;
      if (postingDate < payment.paymentDate)
        throw new BadRequestException(
          'The receipt or invoice cannot apply a future-dated supplier advance.',
        );
      const ap = await this.accounts.resolve(payment.companyId, 'AP_CONTROL', tx);
      if (ap.id === advance.advanceAccountId)
        throw new BadRequestException(
          'Supplier advances and payables must use different ledger accounts.',
        );
      const journal = await this.posting.postLines(
        {
          companyId: payment.companyId,
          divisionId: payment.divisionId,
          branchId: payment.branchId,
          transactionDate: postingDate,
          description: `Apply supplier advance ${payment.paymentNumber}`,
          referenceType: 'SupplierPurchaseAdvance',
          referenceId: advance.id,
          moduleName: 'supplier-payments',
          userId: user.id,
          lines: [
            {
              accountId: ap.id,
              ...partyOf('supplier', payment.supplierId),
              debit: amount,
              credit: 0,
            },
            {
              accountId: advance.advanceAccountId,
              ...partyOf('supplier', payment.supplierId),
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );
      await tx.supplierPurchaseAdvanceApplication.create({
        data: { advanceId: advance.id, payableId, amount, journalEntryId: journal.id },
      });
      await tx.supplierPaymentAllocation.upsert({
        where: { supplierPaymentId_payableId: { supplierPaymentId: payment.id, payableId } },
        create: { supplierPaymentId: payment.id, payableId, companyId: payment.companyId, amount },
        update: { amount: { increment: amount } },
      });
      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: { appliedAmount: { increment: amount }, unappliedAmount: { decrement: amount } },
      });
      if (payment.cashDeskMovementId) {
        await tx.cashDeskMovement.updateMany({
          where: { id: payment.cashDeskMovementId, supplierPaymentId: payment.id, payableId: null },
          data: { payableId },
        });
      }
      payable = await tx.payable.update({
        where: { id: payableId },
        data: {
          paidAmount: { increment: amount },
          outstandingAmount: { decrement: amount },
          status: payable.outstandingAmount.eq(amount) ? 'PAID' : 'PARTIALLY_PAID',
        },
        include: { journalEntry: true },
      });
      await this.payments.syncSupplierInvoices(tx, payable);
      await this.audit.logStrictInTransaction(tx, {
        action: 'SUPPLIER_PURCHASE_ADVANCE_APPLY',
        entityType: 'SupplierPayment',
        entityId: payment.id,
        companyId: payment.companyId,
        userId: user.id,
        newValue: { payableId, amount: amount.toFixed(2), journalEntryId: journal.id },
      });
    }
    await this.syncOrder(tx, orderId);
    await refreshCachedPartyBalance(tx, 'supplier', payable.companyId, payable.supplierId);
  }

  /** Restore the advance asset first; the regular payment reversal restores AP and cash. */
  async reverseApplications(tx: Tx, user: AuthUser, paymentId: string, date: Date) {
    const advance = await tx.supplierPurchaseAdvance.findUnique({
      where: { supplierPaymentId: paymentId },
    });
    if (!advance) return;
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${advance.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM supplier_payments WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status !== 'COMPLETED' || date < payment.paymentDate)
      throw new ConflictException('Check the supplier advance status and reversal date.');
    const applications = await tx.supplierPurchaseAdvanceApplication.findMany({
      where: { advanceId: advance.id, reversalJournalEntryId: null },
      include: { journalEntry: { include: { lines: true } }, payable: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const application of applications) {
      if (['CANCELLED', 'WRITTEN_OFF'].includes(application.payable.status))
        throw new ConflictException('Resolve the payable before reversing its supplier advance.');
      const original = application.journalEntry;
      if (date < new Date(original.transactionDate.toISOString().slice(0, 10)))
        throw new BadRequestException('Advance reversal cannot precede its application.');
      const reversal = await this.posting.postLines(
        {
          companyId: original.companyId,
          divisionId: original.divisionId,
          branchId: original.branchId,
          transactionDate: date,
          description: `Reverse application of ${payment.paymentNumber}`,
          referenceType: 'SupplierPurchaseAdvance',
          referenceId: advance.id,
          moduleName: 'supplier-payments',
          userId: user.id,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            ...partyOfLine(l),
            debit: l.credit,
            credit: l.debit,
          })),
        },
        tx,
      );
      const claimed = await tx.journalEntry.updateMany({
        where: { id: original.id, status: 'POSTED' },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedById: user.id },
      });
      if (claimed.count !== 1)
        throw new ConflictException('The advance application has already changed.');
      await tx.supplierPurchaseAdvanceApplication.update({
        where: { id: application.id },
        data: { reversalJournalEntryId: reversal.id },
      });
    }
    // Preserve the original applied/unapplied split. The payment's REVERSED status
    // removes its credit from active balances without breaking amount = applied + unapplied.
  }

  async syncAfterReverse(tx: Tx, paymentId: string) {
    const advance = await tx.supplierPurchaseAdvance.findUnique({
      where: { supplierPaymentId: paymentId },
    });
    if (advance) await this.syncOrder(tx, advance.purchaseOrderId);
  }

  async assertCanCancel(tx: Tx, orderId: string) {
    if (
      await tx.supplierPurchaseAdvance.count({
        where: {
          purchaseOrderId: orderId,
          supplierPayment: { status: 'COMPLETED', deletedAt: null },
        },
      })
    )
      throw new BadRequestException(
        'Reverse the supplier advance in Cash Desk before cancelling this purchase order.',
      );
  }

  private async syncOrder(tx: Tx, orderId: string) {
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { payable: true },
    });
    const sum = await tx.supplierPayment.aggregate({
      where: {
        purchaseAdvance: { purchaseOrderId: orderId },
        status: 'COMPLETED',
        deletedAt: null,
      },
      _sum: { unappliedAmount: true },
    });
    const paid = Prisma.Decimal.min(
      order.totalAmount,
      new Prisma.Decimal(order.payable?.paidAmount ?? 0).plus(sum._sum.unappliedAmount ?? 0),
    );
    const outstanding = order.totalAmount.minus(paid);
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        paidAmount: paid,
        outstandingAmount: outstanding,
        paymentStatus: outstanding.isZero() ? 'PAID' : paid.gt(0) ? 'PARTIALLY_PAID' : 'UNPAID',
      },
    });
  }

  /** Dedicated company-wide current asset; never reuse an expense or cash account. */
  private async advanceAccount(tx: Tx, companyId: string) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`SupplierAdvanceAccount:${companyId}`}, 0))`;
    const configured = await tx.chartOfAccount.findFirst({
      where: {
        companyId,
        accountSubType: { equals: 'supplier_advances', mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
    });
    if (configured) {
      if (configured.accountType !== 'ASSET' || configured.divisionId || configured.branchId)
        throw new BadRequestException(
          'Configure a company-wide asset account for supplier advances.',
        );
      return configured;
    }
    const code = 'SUP-ADV';
    const occupied = await tx.chartOfAccount.findFirst({
      where: { companyId, OR: [{ accountCode: code }, { accountName: 'Supplier advances' }] },
    });
    if (occupied)
      throw new BadRequestException(
        'Set supplier_advances as the subtype on the company-wide supplier advances asset account.',
      );
    return tx.chartOfAccount.create({
      data: {
        companyId,
        accountCode: code,
        accountName: 'Supplier advances',
        accountType: 'ASSET',
        accountSubType: 'supplier_advances',
        isSystemAccount: true,
      },
    });
  }
}
