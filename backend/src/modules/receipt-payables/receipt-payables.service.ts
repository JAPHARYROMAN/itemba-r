import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CurrencyCode, Prisma, PurchaseType } from '@prisma/client';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { SupplierPurchaseAdvancesService } from '../supplier-payments/supplier-purchase-advances.service';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { AuthUser } from '../../common/decorators/current-user.decorator';

type ReceiptInput = {
  companyId: string;
  transactionDate: Date;
  userId: string;
  user?: AuthUser;
  tx: Prisma.TransactionClient;
  /** Only an audited repair applying documented settlements in this SAME transaction. */
  reconcileHistoricalSettlement?: boolean;
};

type ReceiptSource = {
  sourceType: 'PurchaseOrder' | 'GoodsReceivedNote';
  sourceId: string;
  label: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  supplierId: string | null;
  supplierName: string;
  currency: CurrencyCode;
  amount: Prisma.Decimal;
  inventoryAmount: Prisma.Decimal;
  expenseAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  payableId: string | null;
  journalEntryId: string | null;
  grnIds: string[];
};

export type ReceiptPayableResult = {
  payableId: string;
  journalEntryId: string;
  postedAmount: string;
};

/**
 * Receipt accounting is shared by Operations, GRNs and the audited repair.
 * One locked PO owns one cumulative receipt payable. Subsequent partial GRNs
 * post only the increase, and a supplier invoice reuses this obligation.
 */
@Injectable()
export class ReceiptPayablesService {
  constructor(
    private readonly codes: EntityCodeGeneratorService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly auditLogs: AuditLogsService,
    private readonly advances?: SupplierPurchaseAdvancesService,
  ) {}

  async ensureForPurchaseOrder(
    input: ReceiptInput & { purchaseOrderId: string },
  ): Promise<ReceiptPayableResult | null> {
    const { tx } = input;
    await tx.$queryRaw`SELECT "id" FROM "purchase_orders"
      WHERE "id" = ${input.purchaseOrderId} AND "companyId" = ${input.companyId}
      AND "deletedAt" IS NULL FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, companyId: input.companyId, deletedAt: null },
      include: { lines: true, supplier: { select: { name: true } } },
    });
    if (!order) throw new BadRequestException('Receipt purchase order not found');
    // STOCK_PURCHASE has always been initialized as unpaid by the PO writer.
    // It is an inventory classification, not an exemption from supplier credit.
    if (
      ![PurchaseType.CREDIT_PURCHASE, PurchaseType.STOCK_PURCHASE].includes(
        order.purchaseType as any,
      )
    ) {
      return null;
    }
    if (!['RECEIVED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      throw new ConflictException('A payable can only be posted for received purchases');
    }
    const grns = await tx.goodsReceivedNote.findMany({
      where: {
        purchaseOrderId: order.id,
        companyId: order.companyId,
        deletedAt: null,
        status: 'POSTED',
      },
      include: { lines: true },
    });
    let amount = new Prisma.Decimal(order.totalAmount);
    let values = order.lines.map((line) => ({
      productId: line.productId,
      amount: new Prisma.Decimal(line.lineTotal),
    }));
    if (grns.length) {
      // Value accepted quantities at the agreed gross PO price, prorating line
      // discounts and tax. Aggregate before cent rounding to avoid partial-receipt drift.
      const prices = new Map<string, { quantity: Prisma.Decimal; total: Prisma.Decimal }>();
      for (const line of order.lines) {
        const key = `${line.productId}:${line.unitId}`;
        const old = prices.get(key);
        prices.set(key, {
          quantity: (old?.quantity ?? new Prisma.Decimal(0)).plus(line.quantity),
          total: (old?.total ?? new Prisma.Decimal(0)).plus(line.lineTotal),
        });
      }
      amount = new Prisma.Decimal(0);
      values = [];
      for (const grn of grns) {
        for (const line of grn.lines) {
          if (line.acceptedQuantity.lte(0)) continue;
          const price = prices.get(`${line.productId}:${line.unitId}`);
          if (line.unitCost != null && line.unitCost.lt(0)) {
            throw new ConflictException('Receipt unit cost cannot be negative');
          }
          if (
            line.unitCost != null &&
            price &&
            price.quantity.gt(0) &&
            !line.unitCost.toDecimalPlaces(4).eq(price.total.div(price.quantity).toDecimalPlaces(4))
          ) {
            throw new ConflictException(
              'GRN cost differs from the approved purchase order; review the purchase value before posting this receipt',
            );
          }
          if (!price && line.unitCost != null && line.unitCost.gt(0)) {
            throw new ConflictException(
              'Costed goods outside the approved purchase order require a purchase value review before receipt',
            );
          }
          let receivedValue: Prisma.Decimal;
          if (line.unitCost != null && line.unitCost.gte(0)) {
            // Posting persists the same authoritative landed cost used by the
            // stock movement. Explicit GRN costs win; legacy missing costs use
            // the agreed gross PO price below.
            receivedValue = line.acceptedQuantity.mul(line.unitCost);
          } else if (price && price.quantity.gt(0)) {
            receivedValue = price.total.mul(line.acceptedQuantity).div(price.quantity);
          } else {
            throw new ConflictException('Received goods have no reliable purchase value');
          }
          amount = amount.plus(receivedValue);
          values.push({ productId: line.productId, amount: receivedValue });
        }
      }
    } else if (order.status === 'PARTIALLY_RECEIVED') {
      throw new ConflictException('Partial purchase receipt has no posted GRN quantities');
    }
    // A documented PO advance is already cash paid. It must clear against this
    // receipt's AP in the same transaction, never become a second cash payment.
    let verifiedAdvance = false;
    if (
      input.user &&
      this.advances &&
      order.supplierId &&
      order.paidAmount.gt(0) &&
      !order.payableId
    ) {
      const available = await tx.supplierPayment.aggregate({
        where: {
          companyId: order.companyId,
          supplierId: order.supplierId,
          currency: order.currency,
          deletedAt: null,
          status: 'COMPLETED',
          purchaseAdvance: { purchaseOrderId: order.id },
        },
        _sum: { unappliedAmount: true },
      });
      verifiedAdvance = new Prisma.Decimal(available._sum?.unappliedAmount ?? 0).gte(
        order.paidAmount,
      );
    }
    const result = await this.ensure(
      {
        ...input,
        reconcileHistoricalSettlement: input.reconcileHistoricalSettlement || verifiedAdvance,
      },
      {
        sourceType: 'PurchaseOrder',
        sourceId: order.id,
        label: order.purchaseOrderNumber,
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        supplierId: order.supplierId,
        supplierName: order.supplier?.name || order.supplierName || 'Unknown supplier',
        currency: order.currency,
        amount: amount.toDecimalPlaces(2),
        ...(await this.allocateValue(tx, order.companyId, values, amount.toDecimalPlaces(2))),
        paidAmount: order.paidAmount,
        payableId: order.payableId,
        journalEntryId: order.journalEntryId,
        grnIds: grns.map((g) => g.id),
      },
    );
    if (result && input.user && this.advances) {
      await this.advances.apply(tx, input.user, order.id, result.payableId, input.transactionDate);
    }
    return result;
  }

  async ensureForGrn(
    input: ReceiptInput & { goodsReceivedNoteId: string },
  ): Promise<ReceiptPayableResult | null> {
    const { tx } = input;
    // PO is the common lock for PO receiving, GRNs and supplier invoice approval.
    const snapshot = await tx.goodsReceivedNote.findFirst({
      where: { id: input.goodsReceivedNoteId, companyId: input.companyId, deletedAt: null },
      select: { purchaseOrderId: true },
    });
    if (!snapshot) throw new BadRequestException('Receipt GRN not found');
    if (snapshot.purchaseOrderId) {
      return this.ensureForPurchaseOrder({ ...input, purchaseOrderId: snapshot.purchaseOrderId });
    }
    await tx.$queryRaw`SELECT "id" FROM "goods_received_notes"
      WHERE "id" = ${input.goodsReceivedNoteId} AND "companyId" = ${input.companyId}
      AND "deletedAt" IS NULL FOR UPDATE`;
    const grn = await tx.goodsReceivedNote.findFirst({
      where: { id: input.goodsReceivedNoteId, companyId: input.companyId, deletedAt: null },
      include: { lines: true, supplierInvoices: true },
    });
    if (!grn || grn.status !== 'POSTED')
      throw new ConflictException('Only posted GRNs create payables');
    // Standalone supplier GRNs have no cash-settlement mode or currency field;
    // use their invoice currency when present, otherwise the existing TZS default.
    const currencies = new Set(
      grn.supplierInvoices
        .filter((i) => !i.deletedAt && i.status !== 'CANCELLED')
        .map((i) => i.currency),
    );
    if (currencies.size > 1)
      throw new ConflictException('GRN invoices have conflicting currencies');
    const currency = [...currencies][0] ?? 'TZS';
    if (!Object.values(CurrencyCode).includes(currency as CurrencyCode))
      throw new ConflictException('Unsupported receipt currency');
    let amount = new Prisma.Decimal(0);
    const values: Array<{ productId: string; amount: Prisma.Decimal }> = [];
    for (const line of grn.lines) {
      if (line.acceptedQuantity.lte(0)) continue;
      if (line.unitCost == null || line.unitCost.lt(0))
        throw new ConflictException('Received goods have no reliable purchase value');
      const receivedValue = line.acceptedQuantity.mul(line.unitCost);
      amount = amount.plus(receivedValue);
      values.push({ productId: line.productId, amount: receivedValue });
    }
    const supplier = await tx.supplier.findFirst({
      where: { id: grn.supplierId, companyId: grn.companyId },
      select: { name: true },
    });
    if (!supplier) throw new ConflictException('Receipt supplier does not belong to this company');
    return this.ensure(input, {
      sourceType: 'GoodsReceivedNote',
      sourceId: grn.id,
      label: grn.grnNumber,
      companyId: grn.companyId,
      divisionId: grn.divisionId,
      branchId: grn.branchId,
      supplierId: grn.supplierId,
      supplierName: supplier.name,
      currency: currency as CurrencyCode,
      amount: amount.toDecimalPlaces(2),
      ...(await this.allocateValue(tx, grn.companyId, values, amount.toDecimalPlaces(2))),
      paidAmount: new Prisma.Decimal(0),
      payableId: null,
      journalEntryId: null,
      grnIds: [grn.id],
    });
  }

  private async allocateValue(
    tx: Prisma.TransactionClient,
    companyId: string,
    values: Array<{ productId: string; amount: Prisma.Decimal }>,
    total: Prisma.Decimal,
  ) {
    const productIds = [
      ...new Set(values.filter((value) => value.amount.gt(0)).map((value) => value.productId)),
    ];
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds }, companyId, deletedAt: null },
          select: { id: true, productType: true, trackInventory: true },
        })
      : [];
    if (products.length !== productIds.length)
      throw new ConflictException('Receipt contains a product outside its company');
    const stockIds = new Set(
      products
        .filter(
          (product) =>
            product.trackInventory !== false &&
            !['SERVICE', 'NON_STOCK_ITEM'].includes(
              String(product.productType ?? '').toUpperCase(),
            ),
        )
        .map((product) => product.id),
    );
    const inventoryAmount = values
      .filter((value) => stockIds.has(value.productId))
      .reduce((sum, value) => sum.plus(value.amount), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    // Assign the final cent once so mixed stock/expense receipts always balance.
    const expenseAmount = total.minus(inventoryAmount).toDecimalPlaces(2);
    if (inventoryAmount.lt(0) || expenseAmount.lt(0))
      throw new ConflictException('Receipt costs do not reconcile to the purchase total');
    return { inventoryAmount, expenseAmount };
  }

  private async ensure(
    input: ReceiptInput,
    source: ReceiptSource,
  ): Promise<ReceiptPayableResult | null> {
    const { tx } = input;
    if (source.amount.lt(0)) throw new BadRequestException('Receipt value cannot be negative');
    if (source.amount.isZero()) return null;
    const invoices = await tx.supplierInvoice.findMany({
      where: {
        companyId: source.companyId,
        OR: [
          ...(source.sourceType === 'PurchaseOrder' ? [{ purchaseOrderId: source.sourceId }] : []),
          { goodsReceivedNoteId: { in: source.grnIds } },
        ],
      },
    });
    const invoiceIds = invoices.map((i) => i.id);
    const linkedIds = [source.payableId, ...invoices.map((i) => i.payableId)].filter(
      (id): id is string => Boolean(id),
    );
    let candidates = await tx.payable.findMany({
      where: {
        OR: [
          { id: { in: linkedIds } },
          { companyId: source.companyId, sourceType: source.sourceType, sourceId: source.sourceId },
          {
            companyId: source.companyId,
            sourceType: 'GoodsReceivedNote',
            sourceId: { in: source.grnIds },
          },
          {
            companyId: source.companyId,
            sourceType: 'SupplierInvoice',
            sourceId: { in: invoiceIds },
          },
          {
            companyId: source.companyId,
            supplierId: source.supplierId,
            currency: source.currency,
            amount: source.amount,
            sourceId: null,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
        ],
      },
    });
    if (candidates.length) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payables"
        WHERE "id" IN (${Prisma.join(candidates.map((p) => p.id))}) ORDER BY "id" FOR UPDATE`);
      candidates = await tx.payable.findMany({
        where: { id: { in: candidates.map((p) => p.id) } },
      });
    }
    const journals = await tx.journalEntry.findMany({
      where: {
        companyId: source.companyId,
        status: 'POSTED',
        deletedAt: null,
        OR: [
          {
            id: {
              in: [source.journalEntryId, ...candidates.map((p) => p.journalEntryId)].filter(
                (id): id is string => Boolean(id),
              ),
            },
          },
          { referenceType: 'Payable', referenceId: { in: candidates.map((p) => p.id) } },
          { referenceType: source.sourceType, referenceId: source.sourceId },
          { referenceType: 'GoodsReceivedNote', referenceId: { in: source.grnIds } },
          { referenceType: 'SupplierInvoice', referenceId: { in: invoiceIds } },
        ],
      },
      include: { lines: true },
    });
    const debitTargets = [
      { role: 'INVENTORY_ASSET' as const, amount: source.inventoryAmount, label: 'Inventory' },
      { role: 'GENERAL_EXPENSE' as const, amount: source.expenseAmount, label: 'Purchase expense' },
    ].filter((item) => item.amount.gt(0));
    const accounts = await this.accountResolver.resolveMany(
      source.companyId,
      ['AP_CONTROL', ...debitTargets.map((item) => item.role)],
      tx,
    );
    const apCredit = (journal: (typeof journals)[number]) =>
      journal.lines.reduce(
        (sum, line) =>
          line.accountId === accounts.AP_CONTROL.id ? sum.plus(line.credit).minus(line.debit) : sum,
        new Prisma.Decimal(0),
      );
    const active = candidates.filter((p) => !p.deletedAt && p.status !== 'CANCELLED');
    if (active.length > 1)
      throw new ConflictException(
        `Multiple liabilities already cover ${source.label}; reconcile before receiving`,
      );
    for (const candidate of candidates) {
      if (
        candidate.companyId !== source.companyId ||
        candidate.supplierId !== source.supplierId ||
        candidate.currency !== source.currency
      ) {
        throw new ConflictException('Receipt payable company, supplier or currency does not match');
      }
      if (!candidate.sourceId && !linkedIds.includes(candidate.id)) {
        throw new ConflictException(
          'An unlinked payable may already cover this receipt; review its source before posting',
        );
      }
      const belongs =
        (!candidate.sourceType && linkedIds.includes(candidate.id)) ||
        (candidate.sourceType === source.sourceType && candidate.sourceId === source.sourceId) ||
        (candidate.sourceType === 'GoodsReceivedNote' &&
          source.grnIds.includes(candidate.sourceId ?? '')) ||
        (candidate.sourceType === 'SupplierInvoice' &&
          invoiceIds.includes(candidate.sourceId ?? ''));
      if (!belongs) throw new ConflictException('Linked payable belongs to a different purchase');
      if (
        (candidate.deletedAt || candidate.status === 'CANCELLED') &&
        journals.some(
          (j) =>
            (j.id === candidate.journalEntryId ||
              (j.referenceType === 'Payable' && j.referenceId === candidate.id)) &&
            !apCredit(j).isZero(),
        )
      ) {
        throw new ConflictException(
          'Inactive receipt payable still has posted accounting; reconcile it first',
        );
      }
    }
    if (source.payableId && !candidates.some((p) => p.id === source.payableId)) {
      throw new ConflictException('Receipt references a missing payable; reconcile it first');
    }
    let payable = active[0];
    const ownJournals = payable
      ? journals.filter(
          (j) =>
            j.id === payable.journalEntryId ||
            (j.referenceType === 'Payable' && j.referenceId === payable.id) ||
            (j.referenceType === 'SupplierInvoice' &&
              invoices.some((i) => i.id === j.referenceId && i.payableId === payable.id)),
        )
      : [];
    if (
      journals.some(
        (j) => !ownJournals.includes(j) && j.lines.some((l) => Number(l.debit) || Number(l.credit)),
      )
    ) {
      throw new ConflictException(
        `Existing accounting for ${source.label} is not linked to its payable; reconcile before posting`,
      );
    }
    // Legacy direct payments also use referenceType Payable. Their AP debits
    // settle the debt and must never reduce its gross receipt coverage here.
    const coverage = ownJournals
      .reduce((sum, j) => (apCredit(j).gt(0) ? sum.plus(apCredit(j)) : sum), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    if (coverage.lt(0)) throw new ConflictException('Receipt has negative AP coverage');
    if (payable) {
      await tx.$queryRaw`SELECT "id" FROM "payables" WHERE "id" = ${payable.id} FOR UPDATE`;
      // Payment writes lock the same row. Re-read settlement after waiting.
      const current = await tx.payable.findUnique({ where: { id: payable.id } });
      if (!current || current.deletedAt || current.status === 'CANCELLED')
        throw new ConflictException('Receipt payable changed; retry');
      payable = current;
      if (
        payable.journalEntryId &&
        !ownJournals.some((j) => j.id === payable.journalEntryId && apCredit(j).gt(0))
      ) {
        throw new ConflictException('Receipt payable has no valid posted backing journal');
      }
      if (!coverage.isZero() && !coverage.equals(payable.amount)) {
        throw new ConflictException(
          'Existing payable and its posted liability disagree; reconcile before receiving',
        );
      }
      const backing = ownJournals.find((j) => j.id === payable.journalEntryId);
      if (backing?.referenceType === 'Payable' && backing.referenceId !== payable.id) {
        throw new ConflictException('Receipt payable backing journal belongs to another liability');
      }
      if (backing && backing.referenceType !== 'Payable') {
        // The invoice has already booked this liability. Receiving it is not a
        // second accounting event; never add its full value a second time.
        if (coverage.lt(source.amount))
          throw new ConflictException(
            'Invoice liability does not cover the received value; review invoice variance',
          );
        return this.link(input, source, payable.id, backing.id, '0.00');
      }
      if (coverage.gt(source.amount))
        throw new ConflictException(
          'Posted receipt liability exceeds received value; review before posting',
        );
      if (coverage.equals(source.amount)) {
        if (!payable.journalEntryId)
          throw new ConflictException('Posted receipt payable has no backing journal link');
        const allocationMatches = debitTargets.every((target) => {
          const posted = ownJournals
            .filter((entry) => apCredit(entry).gt(0))
            .flatMap((entry) => entry.lines)
            .filter((line) => line.accountId === accounts[target.role].id)
            .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Prisma.Decimal(0));
          return posted.toDecimalPlaces(2).eq(target.amount);
        });
        if (!allocationMatches) {
          throw new ConflictException(
            'Receipt cost allocation changed without additional debt; review the rounding adjustment before posting',
          );
        }
        return this.link(input, source, payable.id, payable.journalEntryId, '0.00');
      }
      if (
        coverage.isZero() &&
        (!new Prisma.Decimal(payable.paidAmount).isZero() ||
          !new Prisma.Decimal(payable.outstandingAmount).equals(payable.amount))
      ) {
        throw new ConflictException(
          'Settled payable has no posted receipt liability; reconcile settlement first',
        );
      }
      if (payable.status === 'WRITTEN_OFF')
        throw new ConflictException('Written-off receipt requires review before adding goods');
    } else {
      if (new Prisma.Decimal(source.paidAmount).gt(0) && !input.reconcileHistoricalSettlement) {
        throw new ConflictException(
          'Purchase has recorded settlement without a payable; reconcile the existing payment first',
        );
      }
      payable = await tx.payable.create({
        data: {
          payableNumber: await this.codes.next({
            entityType: 'Payable',
            companyId: source.companyId,
            tx,
          }),
          companyId: source.companyId,
          divisionId: source.divisionId,
          branchId: source.branchId,
          supplierId: source.supplierId,
          supplierName: source.supplierName,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          amount: source.amount,
          paidAmount: 0,
          outstandingAmount: source.amount,
          currency: source.currency,
          issueDate: input.transactionDate,
          status: 'OPEN',
          notes: `Receipt payable for ${source.label}`,
        },
      });
    }
    const delta = source.amount.minus(coverage).toDecimalPlaces(2);
    const debitLines = debitTargets
      .map((target) => {
        const accountId = accounts[target.role].id;
        const posted = ownJournals
          .filter((entry) => apCredit(entry).gt(0))
          .flatMap((entry) => entry.lines)
          .filter((line) => line.accountId === accountId)
          .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Prisma.Decimal(0));
        const debit = target.amount.minus(posted).toDecimalPlaces(2);
        if (debit.lt(0))
          throw new ConflictException(
            'Receipt cost allocation differs from posted accounting; review before posting',
          );
        return {
          accountId,
          debit,
          credit: 0,
          description: `${target.label} received: ${source.label}`,
        };
      })
      .filter((line) => line.debit.gt(0));
    if (!debitLines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).eq(delta)) {
      throw new ConflictException('Receipt cost allocation does not reconcile to its payable');
    }
    const journal = await this.postingEngine.postLines(
      {
        companyId: source.companyId,
        divisionId: source.divisionId,
        branchId: source.branchId,
        transactionDate: input.transactionDate,
        journalNumber: `JE-RCPT-${payable.id}-${source.amount.toFixed(2).replace('.', '')}`,
        description: `Supplier-credit receipt ${source.label}`,
        referenceType: 'Payable',
        referenceId: payable.id,
        moduleName:
          source.sourceType === 'PurchaseOrder' ? 'purchase-orders' : 'goods-received-notes',
        userId: input.userId,
        lines: [
          ...debitLines,
          {
            accountId: accounts.AP_CONTROL.id,
            ...(source.supplierId
              ? { partyType: 'SUPPLIER' as const, supplierId: source.supplierId }
              : {}),
            debit: 0,
            credit: delta,
            description: `Accounts payable: ${source.supplierName}`,
          },
        ],
      },
      tx,
    );
    const outstanding = coverage.isZero()
      ? source.amount
      : new Prisma.Decimal(payable.outstandingAmount).plus(delta);
    const journalEntryId = payable.journalEntryId ?? journal.id;
    await tx.payable.update({
      where: { id: payable.id },
      data: {
        amount: source.amount,
        outstandingAmount: outstanding,
        journalEntryId,
        status: new Prisma.Decimal(payable.paidAmount).gt(0) ? 'PARTIALLY_PAID' : 'OPEN',
      },
    });
    await this.link(input, source, payable.id, journalEntryId, delta.toFixed(2));
    await this.syncSupplierBalance(tx, source.companyId, source.supplierId);
    await this.auditLogs.logStrictInTransaction(tx, {
      action: 'RECEIPT_PAYABLE_POST',
      entityType: source.sourceType,
      entityId: source.sourceId,
      companyId: source.companyId,
      userId: input.userId,
      newValue: {
        payableId: payable.id,
        journalEntryId: journal.id,
        postedAmount: delta.toFixed(2),
        receivedValue: source.amount.toFixed(2),
      },
    });
    return { payableId: payable.id, journalEntryId, postedAmount: delta.toFixed(2) };
  }

  private async link(
    input: ReceiptInput,
    source: ReceiptSource,
    payableId: string,
    journalEntryId: string,
    postedAmount: string,
  ): Promise<ReceiptPayableResult> {
    if (source.sourceType === 'PurchaseOrder') {
      await input.tx.purchaseOrder.update({
        where: { id: source.sourceId },
        data: { payableId, journalEntryId },
      });
    }
    return { payableId, journalEntryId, postedAmount };
  }

  private async syncSupplierBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    supplierId: string | null,
  ) {
    await refreshCachedPartyBalance(tx, 'supplier', companyId, supplierId);
  }
}
