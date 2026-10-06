import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { assertCashAccountScopeCompatible } from '../../common/services/cash-account-scope.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PostingEngineService, partyOf } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

type Tx = Prisma.TransactionClient;
type PurchaseScope = {
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  currency: string;
};

/** Funding selection and the narrowly validated repair of the old unfunded cash PO posting. */
@Injectable()
export class CashPurchasePaymentsService {
  constructor(
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly accounts: AccountResolverService,
    private readonly posting: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly audit: AuditLogsService,
  ) {}

  async fundingAccounts(tx: Tx, user: AuthUser, order: PurchaseScope) {
    if (
      !['supplier-payments.manage', 'cash_accounts.view'].every((p) => user.permissions.includes(p))
    )
      throw new ForbiddenException(
        'Supplier payment management and cash account view access are required for a cash purchase.',
      );
    await this.companies.assertCanAccessCompany(user, order.companyId, AccessLevel.WRITE);
    const rows = await tx.cashAccount.findMany({
      where: {
        companyId: order.companyId,
        currency: order.currency as never,
        deletedAt: null,
        isActive: true,
        accountType: { in: ['CASH_ON_HAND', 'PETTY_CASH'] },
        AND: [
          await this.org.recordWhereFor(user),
          { OR: [{ divisionId: null }, { divisionId: order.divisionId }] },
          { OR: [{ branchId: null }, { branchId: order.branchId }] },
        ],
        ledgerAccount: {
          companyId: order.companyId,
          isActive: true,
          deletedAt: null,
          accountType: 'ASSET',
        },
        deskAccount: {
          companyId: order.companyId,
          currency: order.currency,
          kind: 'CASH',
          divisionId: order.divisionId ?? undefined,
          branchId: order.branchId ?? undefined,
        },
      },
      include: { ledgerAccount: true, deskAccount: true },
      orderBy: { accountName: 'asc' },
    });
    return rows.filter(
      (r) =>
        (!r.ledgerAccount!.divisionId || r.ledgerAccount!.divisionId === order.divisionId) &&
        (!r.ledgerAccount!.branchId || r.ledgerAccount!.branchId === order.branchId),
    );
  }

  async fundingAccount(tx: Tx, user: AuthUser, order: PurchaseScope, id?: string) {
    const rows = await this.fundingAccounts(tx, user, order);
    const account = id ? rows.find((r) => r.id === id) : rows.length === 1 ? rows[0] : undefined;
    if (!account)
      throw new BadRequestException(
        rows.length
          ? 'Choose the paying cash account before receiving this cash purchase.'
          : 'Connect a cash account for this company and branch before receiving a cash purchase.',
      );
    assertCashAccountScopeCompatible(account, order);
    await this.org.assertCanAccessScope(
      user,
      account.divisionId,
      account.branchId,
      AccessLevel.WRITE,
    );
    return account;
  }

  /** Never infer a payment from the legacy PAID flag. Reclassify only the proven receipt journal. */
  async prepareLegacyPayable(
    tx: Tx,
    user: AuthUser,
    id: string,
    expected: PurchaseScope & { supplierId: string },
    date: Date,
  ) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: {
        id,
        deletedAt: null,
        companyId: expected.companyId,
        supplierId: expected.supplierId,
        currency: expected.currency as never,
        supplier: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        supplierInvoices: { where: { deletedAt: null, payableId: { not: null } } },
        supplierAdvances: { include: { supplierPayment: true } },
      },
    });
    if (!order || order.status !== 'RECEIVED' || order.purchaseType !== 'CASH_PURCHASE')
      throw new ConflictException(
        'Choose a received cash purchase whose payment has not been recorded.',
      );
    await this.companies.assertCanAccessCompany(user, order.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, order.divisionId, order.branchId, AccessLevel.WRITE);
    if (order.payableId) return order.payableId;
    if (!order.journalEntryId)
      throw new ConflictException(
        'This purchase has no posted receipt journal. Review its accounting before recording payment.',
      );
    if (
      order.supplierInvoices.length ||
      order.supplierAdvances.some((a) => a.supplierPayment.status === 'COMPLETED')
    )
      throw new ConflictException(
        'This purchase already has financial coverage. Review its existing payment or invoice.',
      );
    const recordedPayment = await tx.supplierPayment.findFirst({
      where: {
        companyId: order.companyId,
        status: 'COMPLETED',
        deletedAt: null,
        OR: [
          { sourceType: 'PurchaseOrder', sourceId: order.id },
          { journalEntryId: order.journalEntryId! },
        ],
      },
    });
    if (recordedPayment)
      throw new ConflictException(
        'A cash payment already covers this purchase. Review its payment history.',
      );
    const journal = order.journalEntryId
      ? await tx.journalEntry.findUnique({
          where: { id: order.journalEntryId },
          include: { lines: true },
        })
      : null;
    const amount = new Prisma.Decimal(order.totalAmount);
    const roles = await this.accounts.resolveMany(
      order.companyId,
      ['CASH_ON_HAND', 'AP_CONTROL', 'INVENTORY_ASSET'],
      tx,
    );
    if (
      !journal ||
      journal.status !== 'POSTED' ||
      journal.deletedAt ||
      journal.companyId !== order.companyId ||
      journal.divisionId !== order.divisionId ||
      journal.branchId !== order.branchId ||
      journal.referenceType !== 'PurchaseOrder' ||
      journal.referenceId !== order.id ||
      !journal.totalDebit.eq(amount) ||
      !journal.totalCredit.eq(amount) ||
      journal.lines.length !== 2 ||
      !journal.lines.some(
        (l) => l.accountId === roles.CASH_ON_HAND.id && l.credit.eq(amount) && l.debit.isZero(),
      ) ||
      !journal.lines.some(
        (l) => l.accountId === roles.INVENTORY_ASSET.id && l.debit.eq(amount) && l.credit.isZero(),
      )
    )
      throw new ConflictException(
        'This cash purchase needs accounting review before recording payment; its original posting does not match the legacy receipt.',
      );
    if (date < new Date((order.receivedAt ?? order.orderDate).toISOString().slice(0, 10)))
      throw new BadRequestException('Payment cannot precede receipt of this purchase.');
    const payable = await tx.payable.create({
      data: {
        payableNumber: await this.codes.next({
          entityType: 'Payable',
          companyId: order.companyId,
          tx,
        }),
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        supplierId: order.supplierId,
        supplierName: order.supplierName ?? 'Supplier',
        sourceType: 'PurchaseOrder',
        sourceId: order.id,
        amount,
        paidAmount: 0,
        outstandingAmount: amount,
        currency: order.currency,
        issueDate: order.receivedAt ?? order.orderDate,
        status: 'OPEN',
        notes: `Payment not recorded for cash purchase ${order.purchaseOrderNumber}`,
      },
    });
    const correction = await this.posting.postLines(
      {
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        transactionDate: date,
        description: `Unfunded cash purchase ${order.purchaseOrderNumber}: move to supplier payable`,
        referenceType: 'Payable',
        referenceId: payable.id,
        moduleName: 'purchase-orders',
        userId: user.id,
        lines: [
          {
            accountId: roles.CASH_ON_HAND.id,
            debit: Number(amount),
            credit: 0,
            description: 'Reverse unfunded cash credit',
          },
          {
            accountId: roles.AP_CONTROL.id,
            debit: 0,
            credit: Number(amount),
            ...partyOf('supplier', order.supplierId!),
          },
        ],
      },
      tx,
    );
    await tx.payable.update({ where: { id: payable.id }, data: { journalEntryId: correction.id } });
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        payableId: payable.id,
        journalEntryId: correction.id,
        paidAmount: 0,
        outstandingAmount: amount,
        paymentStatus: 'UNPAID',
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: 'CASH_PURCHASE_PAYMENT_REPAIR',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      companyId: order.companyId,
      userId: user.id,
      metadata: {
        originalReceiptJournalId: journal.id,
        correctionJournalId: correction.id,
        payableId: payable.id,
        amount: amount.toFixed(2),
        stockUnchanged: true,
        cashPaymentRecorded: false,
      },
    });
    return payable.id;
  }
}
