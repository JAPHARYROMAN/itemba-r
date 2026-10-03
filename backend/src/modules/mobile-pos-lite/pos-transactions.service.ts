import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AccessLevel } from '@prisma/client';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethodGeneral, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerPaymentsService } from '../customer-payments/customer-payments.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { RefundsService } from '../refunds/refunds.service';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { PosCollectionDto, PosReturnDto } from './dto/mobile-pos-transaction.dto';
import { readPosTenders } from '../sales-orders/pos-tenders';

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
type Context = Awaited<ReturnType<MobilePosLiteService['transactionContext']>>;
const permissions = (user: AuthUser, required: string[]) => {
  if (!required.every((p) => user.permissions.includes(p)))
    throw new ForbiddenException('You do not have permission for this transaction');
};
@Injectable()
export class PosTransactionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly pos: MobilePosLiteService,
    private readonly payments: CustomerPaymentsService,
    private readonly credits: CreditNotesService,
    private readonly refunds: RefundsService,
    private readonly documents: GeneratedDocumentsService,
    private readonly organisation: OrganizationScopeService,
  ) {}

  private scope(t: Context, id: string, user: AuthUser) {
    return {
      id,
      companyId: t.companyId,
      divisionId: t.divisionId,
      branchId: t.branchId,
      mobilePosTerminalId: t.id,
      createdById: user.id,
      deletedAt: null,
    };
  }
  private async sale(
    db: Prisma.TransactionClient | PrismaService,
    t: Context,
    id: string,
    user: AuthUser,
  ) {
    await this.organisation.assertCanAccessScope(user, t.divisionId, t.branchId, AccessLevel.WRITE);
    const sale = await db.salesOrder.findFirst({
      where: this.scope(t, id, user),
      include: {
        lines: { include: { product: { select: { name: true, trackInventory: true } } } },
        receivable: true,
      },
    });
    if (!sale) throw new NotFoundException('Sale not available on this till');
    if (!['CONFIRMED', 'PAID', 'PARTIALLY_PAID'].includes(sale.status))
      throw new ConflictException('This sale is not eligible for payment or return');
    return sale;
  }
  private account(t: Context, method: string, reference?: string) {
    const p = t.paymentMethods.find(
      (p) => p.isEnabled && p.paymentMethod === method && p.cashAccount.isActive,
    );
    if (!p) throw new ForbiddenException('Payment method is not enabled on this till');
    if (method !== 'CASH' && !reference?.trim())
      throw new BadRequestException('A non-cash transaction requires a reference');
    return p.cashAccountId;
  }
  async detail(code: string | undefined, secret: string | undefined, id: string, user: AuthUser) {
    const t = await this.pos.transactionContext(code, secret, user);
    const sale = await this.sale(this.db, t, id, user);
    const notes = await this.db.creditNote.findMany({
      where: { salesOrderId: id, companyId: t.companyId, deletedAt: null, status: { not: 'VOID' } },
      include: {
        lines: true,
        refunds: {
          where: { deletedAt: null, status: { not: 'VOID' } },
          select: { refundNumber: true, amount: true, status: true },
        },
      },
    });
    const collections = sale.receivableId
      ? await this.db.customerPayment.findMany({
          where: {
            companyId: t.companyId,
            divisionId: t.divisionId,
            branchId: t.branchId,
            deletedAt: null,
            status: 'COMPLETED',
            allocations: { some: { receivableId: sale.receivableId } },
          },
          select: {
            paymentNumber: true,
            method: true,
            reference: true,
            paymentDate: true,
            allocations: { where: { receivableId: sale.receivableId }, select: { amount: true } },
          },
        })
      : [];
    const actions = await this.db.posTransactionAction.findMany({
      where: {
        companyId: t.companyId,
        divisionId: t.divisionId,
        branchId: t.branchId,
        terminalId: t.id,
        userId: user.id,
        saleId: id,
      },
      select: { requestId: true, kind: true, result: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      actions: actions.map((a) => ({ requestId: a.requestId, kind: a.kind, result: a.result })),
      id,
      number: sale.salesOrderNumber,
      total: Number(sale.totalAmount),
      outstanding: Number(sale.receivable?.outstandingAmount ?? sale.outstandingAmount),
      tenders:
        readPosTenders(sale.posTenders)?.map(({ method, amount, reference }) => ({
          method,
          amount,
          reference,
        })) ??
        (sale.paymentMethod === 'CREDIT'
          ? []
          : [
              {
                method: sale.paymentMethod,
                amount: Number(sale.totalAmount),
                reference: sale.paymentReference,
              },
            ]),
      collections: collections.map((p) => ({
        number: p.paymentNumber,
        method: p.method,
        reference: p.reference,
        date: p.paymentDate,
        amount: p.allocations.reduce((n, a) => n + Number(a.amount), 0),
      })),
      returns: notes.map((n) => ({
        number: n.creditNoteNumber,
        total: Number(n.totalAmount),
        debtReduced: Number(n.appliedAmount),
        status: n.status,
        refunds: n.refunds.map((r) => ({
          number: r.refundNumber,
          amount: Number(r.amount),
          status: r.status,
        })),
      })),
      lines: sale.lines.map((l) => ({
        id: l.id,
        name: l.product.name,
        quantity: Number(l.quantity),
        returnable: Math.max(
          0,
          Number(l.quantity) -
            notes
              .flatMap((n) => n.lines)
              .filter((v) => v.productId === l.productId)
              .reduce((n, v) => n + Number(v.quantity), 0),
        ),
        unitPrice: Number(l.lineTotal) / Number(l.quantity),
        stock: l.product.trackInventory,
      })),
      canCollect: user.permissions.includes('customer-payments.manage'),
      canReturn: user.permissions.includes('receivables.manage'),
      canRefund: user.permissions.includes('refunds.manage'),
    };
  }
  async outcome(
    code: string | undefined,
    secret: string | undefined,
    requestId: string,
    user: AuthUser,
  ) {
    const t = await this.pos.transactionContext(code, secret, user);
    await this.organisation.assertCanAccessScope(user, t.divisionId, t.branchId, AccessLevel.WRITE);
    const action = await this.db.posTransactionAction.findFirst({
      where: {
        companyId: t.companyId,
        divisionId: t.divisionId,
        branchId: t.branchId,
        terminalId: t.id,
        userId: user.id,
        requestId,
      },
    });
    return action ? { state: 'confirmed', result: action.result } : { state: 'not_found' };
  }

  async receipt(
    code: string | undefined,
    secret: string | undefined,
    requestId: string,
    user: AuthUser,
  ) {
    const t = await this.pos.transactionContext(code, secret, user);
    await this.organisation.assertCanAccessScope(user, t.divisionId, t.branchId, AccessLevel.WRITE);
    const action = await this.db.posTransactionAction.findFirst({
      where: {
        companyId: t.companyId,
        divisionId: t.divisionId,
        branchId: t.branchId,
        terminalId: t.id,
        userId: user.id,
        requestId,
      },
    });
    if (!action) throw new NotFoundException('Transaction receipt not found');
    const sale = await this.sale(this.db, t, action.saleId, user);
    const result = action.result as Prisma.JsonObject;
    const label = action.kind === 'RETURN' ? 'MAREJESHO / RETURN' : 'MALIPO / COLLECTION';
    const buffer = await this.documents.renderLetterheadPdf(
      { companyId: t.companyId, branchId: t.branchId },
      {
        title: label,
        reference: String(result.number),
        subtitle: sale.salesOrderNumber,
        generatedAt: new Date(),
        meta: [],
        sections: [
          {
            title: 'Muamala / Transaction',
            items: [
              { label: 'Mauzo / Original sale', value: sale.salesOrderNumber },
              { label: 'Mteja / Customer', value: sale.customerName ?? 'Walk-in customer' },
              {
                label: 'Njia / Method',
                value: String(
                  (action.payload as Prisma.JsonObject).method ??
                    (action.payload as Prisma.JsonObject).refundMethod ??
                    '—',
                ),
              },
              {
                label: 'Kumbukumbu / Reference',
                value: String((action.payload as Prisma.JsonObject).reference || '—'),
              },
              {
                label: 'Tarehe / Date',
                value: action.createdAt.toLocaleString('en-GB', {
                  timeZone: 'Africa/Dar_es_Salaam',
                }),
              },
              ...(action.kind === 'RETURN'
                ? [
                    {
                      label: 'Sababu / Reason',
                      value: String((action.payload as Prisma.JsonObject).reason),
                    },
                    { label: 'Deni / Debt reduced', value: String(result.debtReduced) },
                    { label: 'Fedha / Refund', value: String(result.refundAmount) },
                    {
                      label: 'Hati ya fedha / Refund document',
                      value: String(result.refundNumber ?? '—'),
                    },
                  ]
                : []),
            ],
            totals: [{ label: sale.currency, value: String(result.amount), emphasis: true }],
          },
        ],
      },
      user,
    );
    return { buffer, fileName: `POS-${String(result.number).replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf` };
  }

  private async action(
    t: Context,
    id: string,
    kind: string,
    payload: PosCollectionDto | PosReturnDto,
    user: AuthUser,
    run: (
      tx: Prisma.TransactionClient,
      sale: Awaited<ReturnType<PosTransactionsService['sale']>>,
    ) => Promise<Prisma.InputJsonObject>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        // Shared sale lock serialises collections, returns and eligibility checks.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pos:sale'), hashtext(${id}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pos:action'), hashtext(${t.companyId + ':' + payload.requestId}))`;
        const sale = await this.sale(tx, t, id, user);
        const old = await tx.posTransactionAction.findFirst({
          where: { companyId: t.companyId, requestId: payload.requestId },
        });
        const serial = stable(payload);
        if (old) {
          if (
            old.terminalId !== t.id ||
            old.userId !== user.id ||
            old.saleId !== id ||
            old.kind !== kind ||
            stable(old.payload) !== serial
          )
            throw new ConflictException('This request identity belongs to a different transaction');
          return old.result;
        }
        const result = await run(tx, sale);
        await tx.posTransactionAction.create({
          data: {
            companyId: t.companyId,
            divisionId: t.divisionId,
            branchId: t.branchId,
            terminalId: t.id,
            userId: user.id,
            saleId: id,
            requestId: payload.requestId,
            kind,
            payload: payload as unknown as Prisma.InputJsonObject,
            result,
          },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async collect(
    code: string | undefined,
    secret: string | undefined,
    id: string,
    dto: PosCollectionDto,
    user: AuthUser,
  ) {
    permissions(user, ['customer-payments.manage']);
    const t = await this.pos.transactionContext(code, secret, user);
    const accountId = this.account(t, dto.method, dto.reference);
    return this.action(t, id, 'COLLECTION', dto, user, async (tx, sale) => {
      if (!sale.customerId || !sale.receivableId)
        throw new BadRequestException('This sale has no customer debt to collect');
      const payment = await this.payments.create(
        {
          companyId: t.companyId,
          divisionId: t.divisionId,
          branchId: t.branchId,
          customerId: sale.customerId,
          cashAccountId: accountId,
          amount: dto.amount,
          currency: sale.currency,
          method: dto.method as PaymentMethodGeneral,
          reference: dto.reference,
          paymentDate: new Date().toISOString(),
          allocations: [{ receivableId: sale.receivableId, amount: dto.amount }],
        },
        user,
        tx,
      );
      return {
        kind: 'COLLECTION',
        number: payment.paymentNumber,
        id: payment.id,
        amount: dto.amount,
      };
    });
  }
  async returnSale(
    code: string | undefined,
    secret: string | undefined,
    id: string,
    dto: PosReturnDto,
    user: AuthUser,
  ) {
    permissions(user, ['receivables.manage']);
    const t = await this.pos.transactionContext(code, secret, user);
    return this.action(t, id, 'RETURN', dto, user, async (tx, sale) => {
      if (new Set(dto.lines.map((l) => l.lineId)).size !== dto.lines.length)
        throw new BadRequestException('Choose each sale line once');
      const previous = await tx.creditNote.findMany({
        where: {
          companyId: t.companyId,
          salesOrderId: id,
          status: { not: 'VOID' },
          deletedAt: null,
        },
        include: { lines: true },
      });
      const netAmounts: Prisma.Decimal[] = [];
      const lines = dto.lines.map((v) => {
        const l = sale.lines.find((l) => l.id === v.lineId);
        if (!l) throw new BadRequestException('Return line does not belong to this sale');
        const used = previous
          .flatMap((n) => n.lines)
          .filter((p) => p.productId === l.productId)
          .reduce((n, p) => n.plus(p.quantity), new Prisma.Decimal(0));
        if (used.plus(v.quantity).gt(l.quantity))
          throw new BadRequestException('Return quantity exceeds the remaining sold quantity');
        const net = new Prisma.Decimal(l.lineTotal).minus(l.taxAmount);
        const priorLines = previous
          .flatMap((n) => n.lines)
          .filter((p) => p.productId === l.productId);
        const priorNet = priorLines.reduce(
          (n, p) => n.plus(new Prisma.Decimal(p.lineTotal).minus(p.taxAmount)),
          new Prisma.Decimal(0),
        );
        const priorTax = priorLines.reduce((n, p) => n.plus(p.taxAmount), new Prisma.Decimal(0));
        const cumulative = used.plus(v.quantity);
        const creditedNet = net.mul(cumulative).div(l.quantity).toDecimalPlaces(2).minus(priorNet);
        const creditedTax = new Prisma.Decimal(l.taxAmount)
          .mul(cumulative)
          .div(l.quantity)
          .toDecimalPlaces(2)
          .minus(priorTax);
        if (creditedNet.lt(0) || creditedTax.lt(0))
          throw new ConflictException(
            'Existing credit adjustments require an office review before this return',
          );
        netAmounts.push(creditedNet);
        return {
          productId: l.productId,
          unitId: l.unitId,
          description: `${l.product.name} (${v.disposition})`,
          quantity: v.quantity,
          unitPrice: net.div(l.quantity).toDecimalPlaces(2).toNumber(),
          taxAmount: creditedTax.toNumber(),
          returnedQuantity:
            v.disposition === 'RESTOCK' && l.product.trackInventory ? v.quantity : 0,
          ...(l.unitCostAtSale && Number(l.unitCostAtSale) > 0
            ? { restockUnitCost: Number(l.unitCostAtSale) }
            : {}),
        };
      });
      const credit = await this.credits.create(
        {
          companyId: t.companyId,
          divisionId: t.divisionId,
          branchId: t.branchId,
          customerId: sale.customerId ?? undefined,
          customerName: sale.customerName ?? 'Walk-in customer',
          salesOrderId: id,
          currency: sale.currency,
          issueDate: new Date().toISOString(),
          reason: dto.reason,
          lines,
        },
        user,
        tx,
        { netAmounts },
      );
      const pastTotal = previous.reduce((n, p) => n.plus(p.totalAmount), new Prisma.Decimal(0));
      if (pastTotal.plus(credit.totalAmount).gt(sale.totalAmount))
        throw new BadRequestException('Total returns exceed the original sale');
      const issued = await this.credits.issue(credit.id, user, tx);
      const cashRefund = new Prisma.Decimal(issued.totalAmount)
        .minus(issued.appliedAmount)
        .toDecimalPlaces(2);
      let refund: { id: string; refundNumber: string } | null = null;
      if (cashRefund.gt(0)) {
        permissions(user, ['refunds.manage']);
        if (!dto.refundMethod) throw new BadRequestException('Select how to pay the refund');
        const accountId = this.account(t, dto.refundMethod, dto.reference);
        await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${accountId} FOR UPDATE`;
        const available = await tx.cashAccount.findUnique({ where: { id: accountId } });
        if (
          !available ||
          available.currency !== sale.currency ||
          new Prisma.Decimal(available.currentBalance).lt(cashRefund)
        )
          throw new BadRequestException('The refund account has insufficient available funds');
        const draft = await this.refunds.create(
          {
            companyId: t.companyId,
            divisionId: t.divisionId,
            branchId: t.branchId,
            customerId: sale.customerId ?? undefined,
            creditNoteId: credit.id,
            cashAccountId: accountId,
            amount: cashRefund.toNumber(),
            currency: sale.currency,
            refundDate: new Date().toISOString(),
            reason: dto.reason,
            notes: dto.reference,
          },
          user,
          tx,
        );
        refund = await this.refunds.pay(draft.id, {}, user, tx);
      }
      return {
        kind: 'RETURN',
        id: issued.id,
        number: issued.creditNoteNumber,
        amount: Number(issued.totalAmount),
        debtReduced: Number(issued.appliedAmount),
        refundAmount: cashRefund.toNumber(),
        refundNumber: refund?.refundNumber ?? null,
      };
    });
  }
}
