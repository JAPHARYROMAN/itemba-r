import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CashDeskAccount, CurrencyCode, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertCashAccountScopeCompatible } from '../../common/services/cash-account-scope.helper';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SupplierPurchaseAdvancesService } from '../supplier-payments/supplier-purchase-advances.service';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { CashPurchasePaymentsService } from '../supplier-payments/cash-purchase-payments.service';
import { toPaymentMethodGeneral } from '../supplier-payments/payment-method';
import { CashMovementDto, CashPurchaseQuery } from './cash-desk.dto';

const invoiceStatuses = ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const;
const orderStatuses = ['RECEIVED', 'PARTIALLY_RECEIVED'] as const;
const openStatuses = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
/** A purchase settlement must have an actual posted purchase behind its payable. */
const purchaseBacking: Prisma.PayableWhereInput = {
  sourceType: { in: ['SupplierInvoice', 'PurchaseOrder'] },
  journalEntry: { status: 'POSTED', deletedAt: null },
  OR: [
    { supplierInvoices: { some: { deletedAt: null, status: { in: [...invoiceStatuses] } } } },
    { purchaseOrders: { some: { deletedAt: null, status: { in: [...orderStatuses] } } } },
  ],
};
const openPurchaseBalance: Prisma.PayableWhereInput = {
  ...purchaseBacking,
  deletedAt: null,
  status: { in: [...openStatuses] },
  outstandingAmount: { gt: 0 },
};
export const purchaseRelations = {
  supplier: { select: { id: true, name: true } },
  supplierInvoices: {
    where: { deletedAt: null, status: { in: [...invoiceStatuses] } },
    select: {
      id: true,
      supplierInvoiceNumber: true,
      invoiceDate: true,
      companyId: true,
      supplierId: true,
      currency: true,
      purchaseOrderId: true,
      goodsReceivedNoteId: true,
      purchaseOrder: {
        select: {
          id: true,
          purchaseOrderNumber: true,
          internalInvoiceNumber: true,
          supplierInvoiceNumber: true,
        },
      },
      goodsReceivedNote: { select: { id: true, grnNumber: true } },
    },
  },
  purchaseOrders: {
    where: { deletedAt: null, status: { in: [...orderStatuses] } },
    select: {
      id: true,
      purchaseOrderNumber: true,
      internalInvoiceNumber: true,
      supplierInvoiceNumber: true,
      orderDate: true,
      companyId: true,
      supplierId: true,
      currency: true,
    },
  },
} satisfies Prisma.PayableInclude;

@Injectable()
export class CashPurchasesService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly payments: SupplierPaymentsService,
    private readonly advances?: SupplierPurchaseAdvancesService,
    private readonly cashPurchases?: CashPurchasePaymentsService,
  ) {}

  permission(user: AuthUser) {
    if (
      !['payables.view', 'supplier-payments.view', 'supplier-payments.manage'].every((p) =>
        user.permissions.includes(p),
      )
    )
      throw new ForbiddenException(
        'Supplier payment view and management permissions are required.',
      );
  }

  async options(user: AuthUser, q: CashPurchaseQuery) {
    if (!!q.id !== !!q.source) throw new BadRequestException('Select both purchase source and id.');
    const account = await this.db.cashDeskAccount.findFirst({
      where: {
        AND: [
          { id: q.accountId },
          await this.companies.companyWhereFor(user),
          await this.org.recordWhereFor(user),
        ],
      },
    });
    if (!account) throw new NotFoundException('Cash account not found.');
    const scope = await this.org.recordWhereFor(user);
    const search = q.search?.trim();
    const orderReference: Prisma.PurchaseOrderWhereInput | undefined = search
      ? {
          deletedAt: null,
          OR: [
            { purchaseOrderNumber: { contains: search, mode: 'insensitive' as const } },
            { internalInvoiceNumber: { contains: search, mode: 'insensitive' as const } },
            { supplierInvoiceNumber: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;
    const payableWhere: Prisma.PayableWhereInput = {
      AND: [
        purchaseBacking,
        scope,
        {
          companyId: account.companyId,
          currency: account.currency as CurrencyCode,
          deletedAt: null,
          supplierId: q.supplierId ?? { not: null },
          supplier: { deletedAt: null, status: 'ACTIVE' },
          ...(q.id
            ? { id: q.source === 'PAYABLE' ? q.id : '__other_source__' }
            : {
                status: { in: [...openStatuses] },
                outstandingAmount: { gt: 0 },
              }),
        },
        ...(search
          ? [
              {
                OR: [
                  { payableNumber: { contains: search, mode: 'insensitive' as const } },
                  { supplier: { name: { contains: search, mode: 'insensitive' as const } } },
                  {
                    supplierInvoices: {
                      some: {
                        deletedAt: null,
                        status: { in: [...invoiceStatuses] },
                        OR: [
                          {
                            supplierInvoiceNumber: {
                              contains: search,
                              mode: 'insensitive' as const,
                            },
                          },
                          { purchaseOrder: orderReference },
                        ],
                      },
                    },
                  },
                  {
                    purchaseOrders: {
                      some: {
                        ...orderReference,
                        status: { in: [...orderStatuses] },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const canAdvance = user.permissions.includes('purchases.view');
    const advanceWhere: Prisma.PurchaseOrderWhereInput = {
      AND: [
        scope,
        {
          companyId: account.companyId,
          currency: account.currency as CurrencyCode,
          supplierId: q.supplierId ?? { not: null },
          supplier: { deletedAt: null, status: 'ACTIVE' },
          deletedAt: null,
          OR: [
            { status: 'CONFIRMED', outstandingAmount: { gt: 0 } },
            { status: 'CONFIRMED', purchaseType: 'CASH_PURCHASE', totalAmount: { gt: 0 } },
            {
              status: 'RECEIVED',
              purchaseType: 'CASH_PURCHASE',
              journalEntryId: { not: null },
              supplierAdvances: { none: { supplierPayment: { status: 'COMPLETED' } } },
            },
          ],
          payableId: null,
          NOT: {
            supplierInvoices: {
              some: {
                deletedAt: null,
                status: { in: [...invoiceStatuses] },
                payableId: { not: null },
              },
            },
          },
          ...(q.id ? { id: q.source === 'PURCHASE_ORDER' ? q.id : '__other_source__' } : {}),
        },
        ...(orderReference ? [orderReference] : []),
      ],
    };
    const deskWhere: Prisma.InvoiceDeskInvoiceWhereInput = {
      AND: [
        scope,
        {
          companyId: account.companyId,
          currency: account.currency,
          canonicalInvoiceId: null,
          supplier: {
            canonicalSupplierId: q.supplierId ?? { not: null },
            canonicalSupplier: { deletedAt: null, status: 'ACTIVE' },
          },
          ...(q.id
            ? { id: q.source === 'INVOICE_DESK' ? q.id : '__other_source__' }
            : {
                voidedAt: null,
                paidAmount: { lt: this.db.invoiceDeskInvoice.fields.totalAmount },
              }),
        },
        ...(search
          ? [
              {
                OR: [
                  { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
                  {
                    supplier: {
                      canonicalSupplier: {
                        name: { contains: search, mode: 'insensitive' as const },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const canCanonical = [
      'payables.view',
      'supplier-payments.view',
      'supplier-payments.manage',
    ].every((p) => user.permissions.includes(p));
    const canDesk = ['invoice_desk.view', 'invoice_desk.payments'].every((p) =>
      user.permissions.includes(p),
    );
    if (!canCanonical && !canDesk)
      throw new ForbiddenException('Purchase payment access is required.');
    const page = q.page || 1,
      pageSize = q.pageSize || 20,
      skip = (page - 1) * pageSize;
    return this.db.$transaction(
      async (tx) => {
        const [payableTotal, deskTotal, advanceTotal] = await Promise.all([
          canCanonical ? tx.payable.count({ where: payableWhere }) : 0,
          canDesk ? tx.invoiceDeskInvoice.count({ where: deskWhere }) : 0,
          canCanonical && canAdvance ? tx.purchaseOrder.count({ where: advanceWhere }) : 0,
        ]);
        // Stable source ordering keeps every query bounded to one page, even on high pages.
        const payables =
          canCanonical && skip < payableTotal
            ? await tx.payable.findMany({
                where: payableWhere,
                include: purchaseRelations,
                orderBy: [{ issueDate: 'desc' }, { id: 'asc' }],
                skip,
                take: pageSize,
              })
            : [];
        const desks =
          canDesk && payables.length < pageSize
            ? await tx.invoiceDeskInvoice.findMany({
                where: deskWhere,
                include: {
                  supplier: {
                    include: { canonicalSupplier: { select: { id: true, name: true } } },
                  },
                },
                orderBy: [{ invoiceDate: 'desc' }, { id: 'asc' }],
                skip: Math.max(0, skip - payableTotal),
                take: pageSize - payables.length,
              })
            : [];
        const advanceOrders =
          canCanonical &&
          canAdvance &&
          skip < payableTotal + deskTotal + advanceTotal &&
          payables.length + desks.length < pageSize
            ? await tx.purchaseOrder.findMany({
                where: advanceWhere,
                include: {
                  supplier: { select: { name: true } },
                  supplierAdvances: {
                    where: { supplierPayment: { status: 'COMPLETED', deletedAt: null } },
                    include: { supplierPayment: { select: { amount: true } } },
                  },
                },
                orderBy: [{ orderDate: 'desc' }, { id: 'asc' }],
                skip: Math.max(0, skip - payableTotal - deskTotal),
                take: pageSize - payables.length - desks.length,
              })
            : [];
        const rows = [
          ...advanceOrders.map((o) => {
            const outstanding =
              o.purchaseType === 'CASH_PURCHASE'
                ? o.totalAmount.minus(
                    (o.supplierAdvances ?? []).reduce(
                      (sum, a) => sum.plus(a.supplierPayment.amount),
                      new Prisma.Decimal(0),
                    ),
                  )
                : o.outstandingAmount;
            return {
              source: 'PURCHASE_ORDER' as const,
              id: o.id,
              number: o.supplierInvoiceNumber ?? o.internalInvoiceNumber ?? o.purchaseOrderNumber,
              supplierId: o.supplierId,
              supplierName: o.supplier!.name,
              currency: o.currency,
              purpose: o.status === 'RECEIVED' ? 'CASH_PURCHASE_SETTLEMENT' : 'SUPPLIER_ADVANCE',
              outstanding: outstanding.toFixed(2),
              businessDate: (o.status === 'RECEIVED' ? (o.receivedAt ?? o.orderDate) : o.orderDate)
                .toISOString()
                .slice(0, 10),
              status: o.status,
              canPay: outstanding.gt(0),
              purchaseOrderId: o.id,
              purchaseOrderNumber: o.purchaseOrderNumber,
              internalInvoiceNumber: o.internalInvoiceNumber,
              supplierInvoiceNumber: o.supplierInvoiceNumber,
            };
          }),
          ...payables.map((p) => {
            const invoice = p.supplierInvoices[0],
              order = invoice?.purchaseOrder ?? p.purchaseOrders[0];
            return {
              source: 'PAYABLE' as const,
              id: p.id,
              number:
                invoice?.supplierInvoiceNumber ??
                order?.supplierInvoiceNumber ??
                order?.internalInvoiceNumber ??
                order?.purchaseOrderNumber ??
                p.payableNumber,
              supplierId: p.supplierId!,
              supplierName: p.supplier!.name,
              currency: p.currency,
              outstanding: p.outstandingAmount.toFixed(2),
              businessDate: (invoice?.invoiceDate ?? p.issueDate).toISOString().slice(0, 10),
              status: p.status,
              canPay:
                (openStatuses as readonly string[]).includes(p.status) && p.outstandingAmount.gt(0),
              payableNumber: p.payableNumber,
              purchaseInvoiceId: invoice?.id,
              purchaseInvoiceNumber: invoice?.supplierInvoiceNumber,
              purchaseOrderId: order?.id,
              purchaseOrderNumber: order?.purchaseOrderNumber,
              internalInvoiceNumber: order?.internalInvoiceNumber,
              supplierInvoiceNumber: order?.supplierInvoiceNumber,
              goodsReceivedNoteId: invoice?.goodsReceivedNoteId,
              goodsReceivedNoteNumber: invoice?.goodsReceivedNote?.grnNumber,
            };
          }),
          ...desks.map((p) => ({
            source: 'INVOICE_DESK' as const,
            id: p.id,
            number: p.invoiceNumber,
            supplierId: p.supplier.canonicalSupplierId!,
            supplierName: p.supplier.canonicalSupplier!.name,
            currency: p.currency,
            outstanding: p.totalAmount.minus(p.paidAmount).toFixed(2),
            version: p.version,
            businessDate: p.invoiceDate.toISOString().slice(0, 10),
            status: p.voidedAt ? 'VOIDED' : p.paidAmount.gte(p.totalAmount) ? 'PAID' : 'OPEN',
            canPay: !p.voidedAt && p.paidAmount.lt(p.totalAmount),
          })),
        ];
        // A found order may still be awaiting receipt or already settled. Show
        // its identity/status without treating an unposted order as a payable.
        const orderMatches =
          search && canCanonical && user.permissions.includes('purchases.view') && !q.id
            ? await tx.purchaseOrder.findMany({
                where: {
                  AND: [
                    scope,
                    orderReference!,
                    {
                      companyId: account.companyId,
                      currency: account.currency as CurrencyCode,
                      supplierId: q.supplierId ?? { not: null },
                      supplier: { deletedAt: null, status: 'ACTIVE' },
                      NOT: [
                        { payable: openPurchaseBalance },
                        {
                          supplierInvoices: {
                            some: {
                              deletedAt: null,
                              status: { in: [...invoiceStatuses] },
                              payable: openPurchaseBalance,
                            },
                          },
                        },
                      ],
                      ...(rows.some((row) => 'purchaseOrderId' in row && row.purchaseOrderId)
                        ? {
                            id: {
                              notIn: rows.flatMap((row) =>
                                'purchaseOrderId' in row && row.purchaseOrderId
                                  ? [row.purchaseOrderId]
                                  : [],
                              ),
                            },
                          }
                        : {}),
                    },
                  ],
                },
                select: {
                  id: true,
                  purchaseOrderNumber: true,
                  internalInvoiceNumber: true,
                  supplierInvoiceNumber: true,
                  status: true,
                  paymentStatus: true,
                  purchaseType: true,
                },
                orderBy: [{ orderDate: 'desc' }, { id: 'asc' }],
                take: 5,
              })
            : [];
        return {
          rows,
          orderMatches,
          total: payableTotal + deskTotal + advanceTotal,
          page,
          pageSize,
          totalPages: Math.ceil((payableTotal + deskTotal + advanceTotal) / pageSize),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Payable → ERP cash → desk account is the shared lock order; caller writes desk last. */
  async settle(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    account: CashDeskAccount,
    d: CashMovementDto,
    date: Date,
    amount: Prisma.Decimal,
  ) {
    this.permission(user);
    if (!account.erpCashAccountId)
      throw new BadRequestException(
        'Connect this Cash Desk account to an ERP cash account before paying a purchase.',
      );
    if (await tx.supplierPayment.findUnique({ where: { requestId: d.requestId } }))
      throw new ConflictException(
        'This request reference already belongs to another supplier payment.',
      );
    let payableId = d.payableId;
    if (d.purchaseOrderId) {
      if (!user.permissions.includes('purchases.view'))
        throw new ForbiddenException('Purchase view permission is required.');
      const order = await tx.purchaseOrder.findFirst({
        where: {
          id: d.purchaseOrderId,
          deletedAt: null,
          companyId: account.companyId,
          supplierId: d.supplierId,
        },
      });
      if (order?.status === 'RECEIVED' && order.purchaseType === 'CASH_PURCHASE') {
        if (!this.cashPurchases || !d.supplierId)
          throw new BadRequestException('Cash purchase payments are unavailable.');
        payableId = await this.cashPurchases.prepareLegacyPayable(
          tx,
          user,
          order.id,
          { ...account, supplierId: d.supplierId },
          date,
        );
      } else {
        if (!this.advances) throw new BadRequestException('Supplier advances are unavailable.');
        return this.advances.pay(tx, user, account, d, date, amount);
      }
    }
    const locked = await this.payments.lockPayable(tx, payableId!);
    if (!locked) throw new NotFoundException('Purchase payable not found.');
    const payable = await tx.payable.findFirst({
      where: {
        AND: [
          purchaseBacking,
          {
            id: locked.id,
            deletedAt: null,
            companyId: account.companyId,
            currency: account.currency as CurrencyCode,
            supplierId: d.supplierId,
            supplier: { deletedAt: null, status: 'ACTIVE' },
          },
        ],
      },
      include: purchaseRelations,
    });
    if (!payable || !d.supplierId || locked.supplierId !== d.supplierId)
      throw new BadRequestException(
        'Choose an existing posted purchase for this supplier, company and currency.',
      );
    await this.org.assertCanAccessScope(
      user,
      payable.divisionId,
      payable.branchId,
      AccessLevel.WRITE,
    );
    const invoice = payable.supplierInvoices[0];
    if (
      date < new Date(payable.issueDate.toISOString().slice(0, 10)) ||
      payable.supplierInvoices.some(
        (i) => date < new Date(i.invoiceDate.toISOString().slice(0, 10)),
      ) ||
      date < account.openingDate
    )
      throw new BadRequestException(
        'Payment cannot precede the purchase, invoice or cash account opening date.',
      );
    if (!payable.supplierInvoices.length && !payable.purchaseOrders.length)
      throw new BadRequestException(
        'Choose an existing received purchase or approved supplier invoice.',
      );
    for (const source of [...payable.supplierInvoices, ...payable.purchaseOrders])
      if (
        source.companyId !== account.companyId ||
        source.supplierId !== d.supplierId ||
        source.currency !== account.currency
      )
        throw new BadRequestException(
          'The linked purchase has a different supplier, company or currency.',
        );
    await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${account.erpCashAccountId} FOR UPDATE`;
    const cash = await tx.cashAccount.findFirst({
      where: {
        id: account.erpCashAccountId,
        companyId: account.companyId,
        isActive: true,
        deletedAt: null,
        currency: account.currency as CurrencyCode,
      },
      include: { ledgerAccount: true },
    });
    if (
      !cash?.ledgerAccount ||
      !cash.ledgerAccount.isActive ||
      cash.ledgerAccount.deletedAt ||
      cash.ledgerAccount.companyId !== account.companyId ||
      cash.ledgerAccount.accountType !== 'ASSET'
    )
      throw new BadRequestException(
        'Connect an active cash account with an active ledger account in this company.',
      );
    assertCashAccountScopeCompatible(cash, account);
    assertCashAccountScopeCompatible(cash, payable);
    if (
      (cash.ledgerAccount.divisionId &&
        (cash.ledgerAccount.divisionId !== account.divisionId ||
          (payable.divisionId && cash.ledgerAccount.divisionId !== payable.divisionId))) ||
      (cash.ledgerAccount.branchId &&
        (cash.ledgerAccount.branchId !== account.branchId ||
          (payable.branchId && cash.ledgerAccount.branchId !== payable.branchId)))
    )
      throw new BadRequestException(
        'The mapped cash ledger belongs to a different division or branch.',
      );
    await this.org.assertCanAccessScope(user, cash.divisionId, cash.branchId, AccessLevel.WRITE);
    if (cash.currentBalance.lt(amount))
      throw new BadRequestException('Insufficient funds in the linked ERP cash account.');
    const result = await this.payments.createInTransaction(
      tx,
      user,
      {
        companyId: account.companyId,
        divisionId: payable.divisionId,
        branchId: payable.branchId,
        supplierId: d.supplierId,
        amount,
        paymentDate: date,
        cashAccountId: cash.id,
        currency: account.currency,
        method: toPaymentMethodGeneral(
          account.kind === 'CASH'
            ? 'Cash'
            : account.kind === 'BANK'
              ? 'Bank transfer'
              : 'Mobile money',
        ),
        requestId: d.requestId,
        reference: d.reference,
        notes: d.description,
        source: { type: 'CashDesk', id: d.requestId },
        allocations: [{ payableId: payable.id, amount }],
      },
      { cashDeskOwnsMovement: true },
    );
    if (result.payment.sourceType !== 'CashDesk' || result.payment.sourceId !== d.requestId)
      throw new ConflictException(
        'This request reference already belongs to another supplier payment.',
      );
    return { payment: result.payment, payableId: payable.id, invoiceId: invoice?.id };
  }

  async reverse(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    movementId: string,
    paymentId: string,
    reason: string,
    date: Date,
  ) {
    this.permission(user);
    const payment = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
    if (
      !payment ||
      payment.sourceType !== 'CashDesk' ||
      payment.sourceId !== movementId ||
      payment.cashDeskMovementId !== movementId
    )
      throw new ConflictException('This purchase payment is not owned by this Cash Desk movement.');
    await this.org.assertCanAccessScope(
      user,
      payment.divisionId,
      payment.branchId,
      AccessLevel.WRITE,
    );
    await this.advances?.reverseApplications(tx, user, payment.id, date);
    const result = await this.payments.reverseInTransaction(tx, user, payment.id, reason, {
      fromCashDesk: true,
      cashDeskOwnsMovement: true,
      businessDate: date,
    });
    await this.advances?.syncAfterReverse(tx, payment.id);
    return result.reversal;
  }
}
