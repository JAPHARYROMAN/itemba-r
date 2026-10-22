import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, AccountAdjustment, CurrencyCode, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AccountResolverService,
  CONVENTIONAL_CODES,
} from '../../common/services/account-resolver.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { assertLegacyPosWriteAllowed } from '../../common/services/pos-draft-policy';
import { sourceSettlement } from '../../common/utils/source-settlement';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PostingEngineService,
  partyOf,
  partyOfLine,
} from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { CreateAccountAdjustmentDto } from './dto/create-account-adjustment.dto';
import { ReverseAccountAdjustmentDto } from './dto/reverse-account-adjustment.dto';

export type AccountAdjustmentKind = 'receivable' | 'payable';
type Tx = Prisma.TransactionClient;
type Target = {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  partyId: string | null;
  partyName: string;
  number: string;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  outstandingAmount: Prisma.Decimal;
  currency: CurrencyCode;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
};
const OPEN = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'];
const BLOCKED_ROLES = ['CASH_ON_HAND', 'BANK', 'AR_CONTROL', 'AP_CONTROL'] as const;
const BLOCKED_CODES = new Set(BLOCKED_ROLES.flatMap((role) => CONVENTIONAL_CODES[role]));
const accountInclude = {
  _count: { select: { childAccounts: { where: { deletedAt: null } } } },
  mappedCashAccount: { select: { id: true } },
} satisfies Prisma.ChartOfAccountInclude;
type OffsetAccount = Prisma.ChartOfAccountGetPayload<{ include: typeof accountInclude }>;

/** Noncash corrections never change a cash payment or the gross of an approved source. */
@Injectable()
export class AccountAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly supplierPayments: SupplierPaymentsService,
  ) {}

  async list(kind: AccountAdjustmentKind, id: string, user: AuthUser) {
    const target = await this.readTarget(this.prisma, kind, id);
    await this.authorize(target, user, AccessLevel.READ);
    const data = await this.prisma.accountAdjustment.findMany({
      where: { companyId: target.companyId, ...this.targetWhere(kind, id) },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    return { data };
  }

  async offsetAccounts(kind: AccountAdjustmentKind, id: string, user: AuthUser) {
    const target = await this.readTarget(this.prisma, kind, id);
    await this.authorize(target, user, AccessLevel.MANAGE);
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { companyId: target.companyId, isActive: true, deletedAt: null },
      include: accountInclude,
      orderBy: [{ accountCode: 'asc' }, { id: 'asc' }],
    });
    return {
      data: accounts
        .filter((account) => this.eligibleOffset(account, target))
        .map((account) => ({
          id: account.id,
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: account.accountType,
        })),
    };
  }

  async create(
    kind: AccountAdjustmentKind,
    id: string,
    dto: CreateAccountAdjustmentDto,
    user: AuthUser,
  ) {
    const amount = this.money(dto.amount);
    const reason = this.reason(dto.reason);
    const transactionDate = this.date(dto.transactionDate);
    if (!['INCREASE', 'DECREASE'].includes(dto.direction)) {
      throw new BadRequestException('Choose an increase or decrease adjustment');
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        dto.requestId,
      )
    ) {
      throw new BadRequestException('An adjustment request UUID is required');
    }
    const requestId = dto.requestId.toLowerCase();

    return this.transaction(async (tx) => {
      const target = await this.lockTarget(tx, kind, id);
      await this.authorize(target, user, AccessLevel.MANAGE);
      // A company-scoped key also serializes two requests aimed at different documents.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${target.companyId}:account-adjustment:${requestId}`}, 0))`;
      const prior = await tx.accountAdjustment.findUnique({
        where: { companyId_requestId: { companyId: target.companyId, requestId } },
      });
      if (prior) {
        if (
          prior.targetReceivableId !== (kind === 'receivable' ? id : null) ||
          prior.targetPayableId !== (kind === 'payable' ? id : null) ||
          prior.direction !== dto.direction ||
          !prior.amount.eq(amount) ||
          prior.offsetAccountId !== dto.offsetAccountId ||
          prior.reason !== reason ||
          prior.transactionDate.getTime() !== transactionDate.getTime()
        )
          throw new ConflictException('This request ID already belongs to a different adjustment');
        return prior;
      }
      await this.assertMutable(tx, kind, target, user);
      if (
        !OPEN.includes(target.status) &&
        !(dto.direction === 'INCREASE' && target.status === 'PAID')
      ) {
        throw new ConflictException(`Cannot adjust a ${target.status} ${kind}`);
      }
      if (dto.direction === 'DECREASE' && amount.gt(target.outstandingAmount)) {
        throw new BadRequestException('The decrease exceeds the document outstanding balance');
      }
      const offset = await this.requireOffset(tx, target, dto.offsetAccountId);
      const control = await this.accountResolver.resolve(
        target.companyId,
        kind === 'receivable' ? 'AR_CONTROL' : 'AP_CONTROL',
        tx,
      );
      if (control.id === offset.id || !this.accountScopeMatches(control, target)) {
        throw new BadRequestException(
          'The control and offset accounts must have distinct, matching accounting scope',
        );
      }
      const adjustment = await tx.accountAdjustment.create({
        data: {
          id: randomUUID(),
          companyId: target.companyId,
          requestId,
          divisionId: target.divisionId,
          branchId: target.branchId,
          customerId: kind === 'receivable' ? target.partyId : null,
          supplierId: kind === 'payable' ? target.partyId : null,
          ...this.targetWhere(kind, id),
          direction: dto.direction,
          amount,
          currency: target.currency,
          offsetAccountId: offset.id,
          transactionDate,
          reason,
          status: 'POSTED',
          createdById: user.id,
        },
      });
      let generatedReceivableId: string | undefined;
      let generatedPayableId: string | undefined;
      if (dto.direction === 'INCREASE') {
        const generated = await this.createIncreaseItem(tx, kind, target, adjustment);
        if (kind === 'receivable') generatedReceivableId = generated.id;
        else generatedPayableId = generated.id;
      } else {
        await this.changeOutstanding(tx, kind, target, target.outstandingAmount.minus(amount));
      }
      const controlDebit = (kind === 'receivable') === (dto.direction === 'INCREASE');
      const journal = await this.postingEngine.postLines(
        {
          companyId: target.companyId,
          divisionId: target.divisionId,
          branchId: target.branchId,
          journalNumber: await this.codes.next({
            companyId: target.companyId,
            entityType: 'JournalEntry',
            tx,
            when: transactionDate,
          }),
          transactionDate,
          description: `${kind === 'receivable' ? 'Receivable' : 'Payable'} ${dto.direction.toLowerCase()} adjustment ${target.number}: ${reason}`,
          referenceType: 'AccountAdjustment',
          referenceId: adjustment.id,
          moduleName: 'account-adjustments',
          userId: user.id,
          lines: [
            {
              accountId: control.id,
              ...partyOf(kind === 'receivable' ? 'customer' : 'supplier', target.partyId),
              debit: controlDebit ? amount : 0,
              credit: controlDebit ? 0 : amount,
            },
            {
              accountId: offset.id,
              debit: controlDebit ? 0 : amount,
              credit: controlDebit ? amount : 0,
            },
          ],
        },
        tx,
      );
      if (generatedReceivableId)
        await tx.receivable.update({
          where: { id: generatedReceivableId },
          data: { journalEntryId: journal.id },
        });
      if (generatedPayableId)
        await tx.payable.update({
          where: { id: generatedPayableId },
          data: { journalEntryId: journal.id },
        });
      const record = await tx.accountAdjustment.update({
        where: { id: adjustment.id },
        data: { generatedReceivableId, generatedPayableId, journalEntryId: journal.id },
      });
      await refreshCachedPartyBalance(
        tx,
        kind === 'receivable' ? 'customer' : 'supplier',
        target.companyId,
        target.partyId,
      );
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'ACCOUNT_ADJUSTMENT_POST',
        entityType: 'AccountAdjustment',
        entityId: record.id,
        companyId: target.companyId,
        userId: user.id,
        newValue: {
          kind,
          targetId: id,
          direction: dto.direction,
          amount: amount.toFixed(2),
          currency: target.currency,
          reason,
          journalEntryId: journal.id,
          generatedReceivableId,
          generatedPayableId,
        },
      });
      return record;
    });
  }

  async reverse(
    kind: AccountAdjustmentKind,
    id: string,
    adjustmentId: string,
    dto: ReverseAccountAdjustmentDto,
    user: AuthUser,
  ) {
    const reason = this.reason(dto.reason);
    const transactionDate = this.date(dto.transactionDate);
    return this.transaction(async (tx) => {
      const target = await this.lockTarget(tx, kind, id);
      await this.authorize(target, user, AccessLevel.MANAGE);
      await tx.$queryRaw`SELECT id FROM account_adjustments WHERE id = ${adjustmentId} AND "companyId" = ${target.companyId} FOR UPDATE`;
      const current = await tx.accountAdjustment.findFirst({
        where: { id: adjustmentId, companyId: target.companyId, ...this.targetWhere(kind, id) },
      });
      if (!current) throw new NotFoundException('Account adjustment not found on this document');
      if (
        current.status !== 'POSTED' ||
        !current.journalEntryId ||
        current.reversalJournalEntryId
      ) {
        throw new ConflictException('Only a posted adjustment can be reversed once');
      }
      this.assertStoredScope(kind, target, current);
      if (transactionDate < current.transactionDate)
        throw new BadRequestException('The reversal date cannot precede the adjustment date');
      await this.assertMutable(tx, kind, target, user);
      if (![...OPEN, 'PAID'].includes(target.status)) {
        throw new ConflictException(
          'Resolve the document cancellation or write-off before reversing its adjustment',
        );
      }
      await this.requireOffset(tx, target, current.offsetAccountId);
      if (current.direction === 'INCREASE') {
        const generatedId =
          kind === 'receivable' ? current.generatedReceivableId : current.generatedPayableId;
        if (!generatedId)
          throw new ConflictException('The increase has no generated accounting document');
        const generated = await this.lockTarget(tx, kind, generatedId);
        this.assertIncreaseItem(kind, target, generated, current);
        const activePayments =
          kind === 'receivable'
            ? await tx.paymentAllocation.count({
                where: {
                  receivableId: generated.id,
                  customerPayment: { status: 'COMPLETED', deletedAt: null },
                },
              })
            : await tx.supplierPaymentAllocation.count({
                where: {
                  payableId: generated.id,
                  supplierPayment: { status: 'COMPLETED', deletedAt: null },
                },
              });
        if (activePayments)
          throw new ConflictException(
            'Reverse payments against the increase item before reversing this adjustment',
          );
        if (kind === 'receivable')
          await tx.receivable.update({
            where: { id: generated.id },
            data: { status: 'CANCELLED', outstandingAmount: 0 },
          });
        else
          await tx.payable.update({
            where: { id: generated.id },
            data: { status: 'CANCELLED', outstandingAmount: 0 },
          });
      } else {
        const restored = target.outstandingAmount.plus(current.amount);
        if (restored.plus(target.paidAmount).gt(target.amount)) {
          throw new ConflictException(
            'The original noncash decrease is no longer available to reverse',
          );
        }
        await this.changeOutstanding(tx, kind, target, restored);
      }
      const original = await tx.journalEntry.findFirst({
        where: {
          id: current.journalEntryId,
          companyId: target.companyId,
          referenceType: 'AccountAdjustment',
          referenceId: current.id,
          status: 'POSTED',
          deletedAt: null,
        },
        include: { lines: true },
      });
      this.assertOriginalJournal(kind, target, current, original);
      const claim = await tx.journalEntry.updateMany({
        where: { id: current.journalEntryId, status: 'POSTED', deletedAt: null },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedById: user.id },
      });
      if (claim.count !== 1)
        throw new ConflictException('The adjustment journal was already changed; reversal aborted');
      const reversal = await this.postingEngine.postLines(
        {
          companyId: target.companyId,
          divisionId: target.divisionId,
          branchId: target.branchId,
          journalNumber: await this.codes.next({
            companyId: target.companyId,
            entityType: 'JournalEntry',
            tx,
            when: transactionDate,
          }),
          transactionDate,
          description: `Reversal of account adjustment ${current.id}: ${reason}`,
          referenceType: 'AccountAdjustment',
          referenceId: current.id,
          moduleName: 'account-adjustments',
          userId: user.id,
          lines: original!.lines.map((line) => ({
            accountId: line.accountId,
            ...partyOfLine(line),
            debit: line.credit,
            credit: line.debit,
            divisionId: line.divisionId ?? undefined,
            branchId: line.branchId ?? undefined,
            description: `Reversal: ${line.description ?? ''}`.trim(),
          })),
        },
        tx,
      );
      await tx.journalEntry.update({
        where: { id: reversal.id },
        data: { reversalOfId: current.journalEntryId },
      });
      const record = await tx.accountAdjustment.update({
        where: { id: current.id },
        data: {
          status: 'REVERSED',
          reversedById: user.id,
          reversedAt: new Date(),
          reversedTransactionDate: transactionDate,
          reversalReason: reason,
          reversalJournalEntryId: reversal.id,
        },
      });
      await refreshCachedPartyBalance(
        tx,
        kind === 'receivable' ? 'customer' : 'supplier',
        target.companyId,
        target.partyId,
      );
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'ACCOUNT_ADJUSTMENT_REVERSE',
        entityType: 'AccountAdjustment',
        entityId: current.id,
        companyId: target.companyId,
        userId: user.id,
        oldValue: { status: 'POSTED', journalEntryId: current.journalEntryId },
        newValue: { status: 'REVERSED', reason, reversalJournalEntryId: reversal.id },
      });
      return record;
    });
  }

  private async readTarget(
    db: PrismaService | Tx,
    kind: AccountAdjustmentKind,
    id: string,
  ): Promise<Target> {
    if (kind === 'receivable') {
      const row = await db.receivable.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw new NotFoundException('Receivable not found');
      return {
        ...row,
        partyId: row.customerId,
        partyName: row.customerName,
        number: row.receivableNumber,
      };
    }
    const row = await db.payable.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Payable not found');
    return {
      ...row,
      partyId: row.supplierId,
      partyName: row.supplierName,
      number: row.payableNumber,
    };
  }

  private async lockTarget(tx: Tx, kind: AccountAdjustmentKind, id: string) {
    if (kind === 'payable') {
      // Match receipt/invoice/payment lock order: purchase source before payable.
      if (!(await this.supplierPayments.lockPayable(tx, id)))
        throw new NotFoundException('Payable not found');
    } else {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE "receivableId" = ${id} OR id IN
        (SELECT "sourceId" FROM receivables WHERE id = ${id} AND "sourceType" = 'SalesOrder') ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
    }
    return this.readTarget(tx, kind, id);
  }

  private async authorize(target: Target, user: AuthUser, access: AccessLevel) {
    await this.companyScope.assertCanAccessCompany(user, target.companyId, access);
    await this.org.assertCanAccessScope(user, target.divisionId, target.branchId, access);
  }

  private async assertMutable(tx: Tx, kind: AccountAdjustmentKind, target: Target, user: AuthUser) {
    if (!target.partyId)
      throw new BadRequestException(
        'Link the document to a customer or supplier before adjusting it',
      );
    if (target.sourceType === 'Expense')
      throw new ConflictException(
        'Correct this payable in Expenses to keep its source balances together',
      );
    if (target.sourceType === 'AccountAdjustment')
      throw new ConflictException(
        'Reverse or correct the originating adjustment instead of adjusting its generated item',
      );
    if (
      target.amount.lte(0) ||
      target.paidAmount.lt(0) ||
      target.outstandingAmount.lt(0) ||
      target.paidAmount.plus(target.outstandingAmount).gt(target.amount)
    ) {
      throw new ConflictException(
        'The document has inconsistent accounting balances; review it before adjusting',
      );
    }
    if (
      !(await tx.company.findFirst({
        where: { id: target.companyId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      }))
    ) {
      throw new ConflictException('The company is inactive or unavailable');
    }
    if (
      target.divisionId &&
      !(await tx.division.findFirst({
        where: {
          id: target.divisionId,
          companyId: target.companyId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      }))
    ) {
      throw new ConflictException(
        'The document division is inactive or has different company scope',
      );
    }
    if (
      target.branchId &&
      !(await tx.branch.findFirst({
        where: {
          id: target.branchId,
          ...(target.divisionId ? { divisionId: target.divisionId } : {}),
          isActive: true,
          deletedAt: null,
          division: { companyId: target.companyId, isActive: true, deletedAt: null },
        },
        select: { id: true },
      }))
    ) {
      throw new ConflictException('The document branch is inactive or has different company scope');
    }
    const party =
      kind === 'receivable'
        ? await tx.customer.findFirst({
            where: {
              id: target.partyId,
              companyId: target.companyId,
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: { divisionId: true, branchId: true },
          })
        : await tx.supplier.findFirst({
            where: {
              id: target.partyId,
              companyId: target.companyId,
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: { divisionId: true, branchId: true },
          });
    if (!party || !this.accountScopeMatches(party, target))
      throw new ConflictException('The linked party is inactive or has different accounting scope');
    if (kind === 'receivable')
      await assertLegacyPosWriteAllowed(tx, user, target.companyId, target.branchId);
    await this.assertSourcesActive(tx, kind, target);
  }

  private async assertSourcesActive(tx: Tx, kind: AccountAdjustmentKind, target: Target) {
    if (kind === 'receivable') {
      const orders = await tx.salesOrder.findMany({
        where: {
          OR: [
            { receivableId: target.id },
            ...(target.sourceType === 'SalesOrder' && target.sourceId
              ? [{ id: target.sourceId }]
              : []),
          ],
        },
        select: {
          id: true,
          companyId: true,
          customerId: true,
          currency: true,
          divisionId: true,
          branchId: true,
          deletedAt: true,
          status: true,
          totalAmount: true,
          receivableId: true,
        },
      });
      if (
        (target.sourceType === 'SalesOrder' &&
          !orders.some((order) => order.id === target.sourceId)) ||
        orders.some(
          (order) =>
            order.deletedAt ||
            ['CANCELLED', 'VOIDED', 'DRAFT'].includes(order.status) ||
            order.companyId !== target.companyId ||
            order.customerId !== target.partyId ||
            order.currency !== target.currency ||
            order.receivableId !== target.id ||
            !this.accountScopeMatches(order, target) ||
            target.amount.gt(order.totalAmount),
        )
      ) {
        throw new ConflictException(
          'The receivable no longer matches its active source sales order',
        );
      }
      return;
    }
    const orders = await tx.purchaseOrder.findMany({
      where: {
        OR: [
          { payableId: target.id },
          ...(target.sourceType === 'PurchaseOrder' && target.sourceId
            ? [{ id: target.sourceId }]
            : []),
        ],
      },
      select: {
        id: true,
        companyId: true,
        supplierId: true,
        currency: true,
        divisionId: true,
        branchId: true,
        deletedAt: true,
        status: true,
        totalAmount: true,
        payableId: true,
      },
    });
    const invoices = await tx.supplierInvoice.findMany({
      where: {
        OR: [
          { payableId: target.id },
          ...(target.sourceType === 'SupplierInvoice' && target.sourceId
            ? [{ id: target.sourceId }]
            : []),
        ],
      },
      select: {
        id: true,
        companyId: true,
        supplierId: true,
        currency: true,
        divisionId: true,
        branchId: true,
        deletedAt: true,
        status: true,
        totalAmount: true,
        payableId: true,
      },
    });
    if (
      (target.sourceType === 'PurchaseOrder' &&
        !orders.some((order) => order.id === target.sourceId)) ||
      orders.some(
        (order) =>
          order.deletedAt ||
          !['RECEIVED', 'PARTIALLY_RECEIVED'].includes(order.status) ||
          order.companyId !== target.companyId ||
          order.supplierId !== target.partyId ||
          (order.currency && order.currency !== target.currency) ||
          order.payableId !== target.id ||
          !this.accountScopeMatches(order, target) ||
          target.amount.gt(order.totalAmount),
      )
    ) {
      throw new ConflictException('The payable no longer matches its active source purchase order');
    }
    if (
      (target.sourceType === 'SupplierInvoice' &&
        !invoices.some((invoice) => invoice.id === target.sourceId)) ||
      invoices.some(
        (invoice) =>
          invoice.deletedAt ||
          !['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status) ||
          invoice.companyId !== target.companyId ||
          invoice.supplierId !== target.partyId ||
          invoice.currency !== target.currency ||
          invoice.payableId !== target.id ||
          !this.accountScopeMatches(invoice, target) ||
          target.amount.gt(invoice.totalAmount),
      )
    ) {
      throw new ConflictException(
        'The payable no longer matches its active source supplier invoice',
      );
    }
    if (target.sourceType === 'GoodsReceivedNote') {
      const grn = target.sourceId
        ? await tx.goodsReceivedNote.findFirst({
            where: {
              id: target.sourceId,
              companyId: target.companyId,
              supplierId: target.partyId!,
              status: 'POSTED',
              deletedAt: null,
            },
            select: { divisionId: true, branchId: true },
          })
        : null;
      if (!grn || !this.accountScopeMatches(grn, target))
        throw new ConflictException('The payable no longer matches its posted goods received note');
    }
  }

  private accountScopeMatches(
    account: { divisionId: string | null; branchId: string | null },
    target: Target,
  ) {
    return (
      (!account.divisionId || account.divisionId === target.divisionId) &&
      (!account.branchId || account.branchId === target.branchId)
    );
  }

  private eligibleOffset(account: OffsetAccount, target: Target) {
    const subtype = (account.accountSubType ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
    return (
      account.companyId === target.companyId &&
      account.isActive &&
      !account.deletedAt &&
      this.accountScopeMatches(account, target) &&
      account._count.childAccounts === 0 &&
      !account.mappedCashAccount &&
      !BLOCKED_CODES.has(account.accountCode) &&
      !BLOCKED_ROLES.some((role) => subtype === role) &&
      !/(^|_)(CASH|BANK|CONTROL)(_|$)/.test(subtype) &&
      !['ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'RECEIVABLE', 'PAYABLE'].includes(subtype)
    );
  }

  private async requireOffset(tx: Tx, target: Target, id: string) {
    const account = await tx.chartOfAccount.findFirst({
      where: { id, companyId: target.companyId },
      include: accountInclude,
    });
    if (!account || !this.eligibleOffset(account, target)) {
      throw new BadRequestException(
        'Choose an active, postable noncash offset account outside receivables/payables control accounts in this document scope',
      );
    }
    return account;
  }

  private async createIncreaseItem(
    tx: Tx,
    kind: AccountAdjustmentKind,
    target: Target,
    adjustment: AccountAdjustment,
  ) {
    const data = {
      companyId: target.companyId,
      divisionId: target.divisionId,
      branchId: target.branchId,
      sourceType: 'AccountAdjustment',
      sourceId: adjustment.id,
      amount: adjustment.amount,
      paidAmount: new Prisma.Decimal(0),
      outstandingAmount: adjustment.amount,
      currency: target.currency,
      issueDate: adjustment.transactionDate,
      status: 'OPEN' as const,
      notes: `${adjustment.reason} (adjustment of ${target.number})`,
    };
    if (kind === 'receivable')
      return tx.receivable.create({
        data: {
          ...data,
          customerId: target.partyId,
          customerName: target.partyName,
          receivableNumber: await this.codes.next({
            companyId: target.companyId,
            entityType: 'Receivable',
            tx,
            when: adjustment.transactionDate,
          }),
        },
      });
    return tx.payable.create({
      data: {
        ...data,
        supplierId: target.partyId,
        supplierName: target.partyName,
        payableNumber: await this.codes.next({
          companyId: target.companyId,
          entityType: 'Payable',
          tx,
          when: adjustment.transactionDate,
        }),
      },
    });
  }

  private async changeOutstanding(
    tx: Tx,
    kind: AccountAdjustmentKind,
    target: Target,
    outstandingAmount: Prisma.Decimal,
  ) {
    const status = outstandingAmount.isZero()
      ? 'PAID'
      : target.paidAmount.gt(0)
        ? 'PARTIALLY_PAID'
        : 'OPEN';
    if (kind === 'payable') {
      const updated = await tx.payable.update({
        where: { id: target.id },
        data: { outstandingAmount, status },
      });
      await this.supplierPayments.syncSupplierInvoices(tx, updated);
      await this.supplierPayments.syncPurchaseOrders(tx, updated);
    } else {
      const updated = await tx.receivable.update({
        where: { id: target.id },
        data: { outstandingAmount, status },
      });
      if (updated.sourceType !== 'SalesOrder' || !updated.sourceId) return;
      const order = await tx.salesOrder.findFirst({
        where: {
          id: updated.sourceId,
          companyId: updated.companyId,
          customerId: updated.customerId,
          currency: updated.currency,
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'VOIDED', 'DRAFT'] },
        },
        select: {
          id: true,
          totalAmount: true,
          divisionId: true,
          branchId: true,
          receivableId: true,
        },
      });
      if (
        !order ||
        order.receivableId !== updated.id ||
        !this.accountScopeMatches(order, target) ||
        updated.amount.gt(order.totalAmount)
      ) {
        throw new ConflictException(
          'The receivable no longer matches its active source sales order',
        );
      }
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

  private assertStoredScope(kind: AccountAdjustmentKind, target: Target, row: AccountAdjustment) {
    if (
      row.companyId !== target.companyId ||
      row.currency !== target.currency ||
      row.divisionId !== target.divisionId ||
      row.branchId !== target.branchId ||
      (kind === 'receivable' ? row.customerId : row.supplierId) !== target.partyId
    ) {
      throw new ConflictException('The adjustment and document accounting scope no longer match');
    }
  }

  private assertIncreaseItem(
    kind: AccountAdjustmentKind,
    target: Target,
    generated: Target,
    row: AccountAdjustment,
  ) {
    this.assertStoredScope(kind, generated, row);
    if (
      generated.sourceType !== 'AccountAdjustment' ||
      generated.sourceId !== row.id ||
      generated.partyId !== target.partyId ||
      !OPEN.includes(generated.status) ||
      !generated.amount.eq(row.amount) ||
      !generated.paidAmount.isZero() ||
      !generated.outstandingAmount.eq(row.amount)
    ) {
      throw new ConflictException(
        'Reverse payments, write-offs, or other settlements of the increase item before reversing this adjustment',
      );
    }
  }

  private assertOriginalJournal(
    kind: AccountAdjustmentKind,
    target: Target,
    adjustment: AccountAdjustment,
    original: Prisma.JournalEntryGetPayload<{ include: { lines: true } }> | null,
  ) {
    const controlDebit = (kind === 'receivable') === (adjustment.direction === 'INCREASE');
    const control = original?.lines.find((line) => line.accountId !== adjustment.offsetAccountId);
    const offset = original?.lines.find((line) => line.accountId === adjustment.offsetAccountId);
    if (
      !original ||
      original.lines.length !== 2 ||
      original.divisionId !== target.divisionId ||
      original.branchId !== target.branchId ||
      !original.totalDebit.eq(adjustment.amount) ||
      !original.totalCredit.eq(adjustment.amount) ||
      !control ||
      !offset ||
      control.partyType !== (kind === 'receivable' ? 'CUSTOMER' : 'SUPPLIER') ||
      (kind === 'receivable' ? control.customerId : control.supplierId) !== target.partyId ||
      !control.debit.eq(controlDebit ? adjustment.amount : 0) ||
      !control.credit.eq(controlDebit ? 0 : adjustment.amount) ||
      !offset.debit.eq(controlDebit ? 0 : adjustment.amount) ||
      !offset.credit.eq(controlDebit ? adjustment.amount : 0)
    ) {
      throw new ConflictException(
        'The original adjustment journal is missing or has different accounting evidence',
      );
    }
  }

  private targetWhere(kind: AccountAdjustmentKind, id: string) {
    return kind === 'receivable' ? { targetReceivableId: id } : { targetPayableId: id };
  }

  private money(value: number) {
    if (!Number.isFinite(value))
      throw new BadRequestException('Adjustment amount must be a positive amount in cents');
    const amount = new Prisma.Decimal(value);
    if (amount.lte(0) || amount.decimalPlaces() > 2 || amount.mul(100).gt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException(
        'Adjustment amount must be positive, have at most two decimals, and fit the posting limit',
      );
    return amount;
  }

  private reason(value: string) {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length < 3 || reason.length > 1000 || !/[\p{L}\p{N}]/u.test(reason))
      throw new BadRequestException(
        'A meaningful reason between 3 and 1000 characters is required',
      );
    return reason;
  }

  private date(value: string) {
    const date = new Date(value);
    if (typeof value !== 'string' || !value.trim() || Number.isNaN(date.getTime()))
      throw new BadRequestException('A valid transaction date is required');
    return date;
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
        const code = (error as { code?: string }).code;
        const meta = (error as { meta?: { code?: string; target?: string | string[] } }).meta;
        const pgCode = meta?.code;
        // A waiter can have taken its SERIALIZABLE snapshot before an INCREASE
        // committed (the unchanged anchor row remains identical). Refresh that
        // snapshot after the request-key unique constraint wins, then replay it.
        const requestKeyRace =
          code === 'P2002' &&
          (Array.isArray(meta?.target)
            ? meta.target.includes('companyId') && meta.target.includes('requestId')
            : meta?.target === 'account_adjustments_companyId_requestId_key');
        if (!(requestKeyRace || code === 'P2034' || ['40001', '40P01'].includes(pgCode ?? ''))) {
          throw error;
        }
        if (attempt === 2) {
          throw new ConflictException('The account changed concurrently; retry the adjustment');
        }
      }
    }
    throw new ConflictException('The account changed concurrently; retry the adjustment');
  }
}
