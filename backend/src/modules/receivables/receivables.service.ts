import { accountPage, consolidateAccounts } from '../../common/utils/consolidate-accounts';
import { assertLegacyPosWriteAllowed } from '../../common/services/pos-draft-policy';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CashAccountType, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import type { AccountRole } from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService, partyOf } from '../accounting-engine/posting-engine.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { QueryReceivableDto } from './dto/query-receivable.dto';
import { RecordReceivablePaymentDto } from './dto/record-receivable-payment.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';
import { LinkReceivableCustomerDto } from './dto/link-receivable-customer.dto';
import { CustomerPaymentsService } from '../customer-payments/customer-payments.service';
import { CashBookService } from '../cash-book/cash-book.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { pagination } from '../../common/utils/pagination';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { assertCashAccountForScope } from '../../common/services/cash-account-scope.helper';

type ReceivableSalesOrderSnapshot = {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
  amount: Prisma.Decimal | number | string;
  paidAmount: Prisma.Decimal | number | string;
  outstandingAmount: Prisma.Decimal | number | string;
};

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly org: OrganizationScopeService,
    private readonly customerPayments: CustomerPaymentsService,
    private readonly cashBook?: CashBookService,
  ) {}

  async findAll(query: QueryReceivableDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where = await this.buildReceivableWhere(query, user);

    const [data, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: this.includeListScope(),
        orderBy: { issueDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.receivable.count({ where }),
    ]);

    return {
      data: data.map((receivable) => this.withDisplayCustomerName(receivable)),
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findAccounts(query: QueryReceivableDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where = await this.buildReceivableWhere(query, user);

    const records = await this.prisma.receivable.findMany({
      where,
      include: this.includeListScope(),
      orderBy: [{ companyId: 'asc' }, { customerName: 'asc' }, { issueDate: 'desc' }],
    });

    const accounts = consolidateAccounts(
      records.map((raw) => {
        const record = this.withDisplayCustomerName(raw);
        return {
          record,
          id: record.id,
          companyId: record.companyId,
          company: record.company,
          partyId: record.customerId,
          partyName: record.customer?.name || record.customerName,
          partyCode: record.customer?.customerCode,
          currency: record.currency || 'TZS',
          amount: record.amount,
          paidAmount: record.paidAmount,
          outstandingAmount: record.outstandingAmount,
          issueDate: record.issueDate,
          dueDate: record.dueDate,
          inactive: record.status === 'CANCELLED',
        };
      }),
    ).map((account) => ({
      ...account,
      customerId: account.partyId,
      customerName: account.partyName,
      customerCode: account.partyCode,
    }));
    return accountPage(accounts, { page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.receivable.findFirst({
      where: { id, deletedAt: null },
      include: this.includeDetailScope(),
    });
    if (!record) throw new NotFoundException('Receivable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    const customer = record.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: record.customerId, deletedAt: null },
          select: {
            id: true,
            customerCode: true,
            name: true,
            legalName: true,
            customerType: true,
            tin: true,
            vrn: true,
            phone: true,
            email: true,
            address: true,
            contactPerson: true,
            creditLimit: true,
            currentBalance: true,
            paymentTerms: true,
            status: true,
          },
        })
      : null;
    return this.withDisplayCustomerName({ ...record, customer });
  }

  async create(dto: CreateReceivableDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const scope = await this.resolveReceivableScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      customerId: dto.customerId || null,
    });
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (amount.lte(0)) throw new BadRequestException('Receivable amount must be greater than zero');

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.receivable.create({
        data: {
          receivableNumber: await this.codes.next({
            entityType: 'Receivable',
            companyId: dto.companyId,
            tx,
          }),
          companyId: dto.companyId,
          divisionId: scope.divisionId,
          branchId: scope.branchId,
          customerId: dto.customerId || null,
          customerName: scope.customerName ?? dto.customerName,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          amount,
          paidAmount: 0,
          outstandingAmount: amount,
          currency: dto.currency,
          issueDate: new Date(dto.issueDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: 'OPEN',
          notes: dto.notes,
        },
      });

      const [arAccount, incomeAccount] = await Promise.all([
        this.accountResolver.resolve(created.companyId, 'AR_CONTROL', tx),
        this.accountResolver.resolve(created.companyId, 'INCOME_SUMMARY', tx),
      ]);
      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: created.companyId,
          divisionId: created.divisionId,
          branchId: created.branchId,
          transactionDate: created.issueDate,
          description: `Manual receivable ${created.receivableNumber}`,
          referenceType: 'Receivable',
          referenceId: created.id,
          moduleName: 'receivables',
          userId,
          lines: [
            {
              accountId: arAccount.id,
              ...partyOf('customer', created.customerId),
              description: `Accounts receivable: ${created.customerName}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: incomeAccount.id,
              description: `Contra income for receivable ${created.receivableNumber}`,
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );

      const updated = await tx.receivable.update({
        where: { id: created.id },
        data: { journalEntryId: journalEntry.id },
      });
      await this.syncCustomerBalance(tx, updated.companyId, updated.customerId);
      return updated;
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_CREATE',
      entityType: 'Receivable',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateReceivableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    // Party linkage (Phase 3): once the ledger knows the party, the party is not re-pointed
    // without re-posting. Void and re-create the document to change it.
    if (
      dto.customerId !== undefined &&
      (dto.customerId || null) !== (existing.customerId || null) &&
      (existing.journalEntryId || new Prisma.Decimal(existing.paidAmount ?? 0).gt(0))
    )
      throw new BadRequestException(
        'This receivable is posted or partly paid; its customer cannot be changed. Void and re-create it to re-point the party.',
      );
    const userId = user.id;
    const scope = await this.resolveReceivableScope({
      companyId: existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      customerId:
        dto.customerId !== undefined ? dto.customerId || null : existing.customerId || null,
    });
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.receivable.update({
        where: { id },
        data: {
          divisionId: scope.divisionId,
          branchId: scope.branchId,
          customerName: scope.customerName ?? dto.customerName ?? existing.customerName,
          ...(dto.customerId !== undefined && { customerId: dto.customerId || null }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
          ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
        },
      });
      // Notes/date/scope-only edits do not affect customer exposure. Avoid
      // rewriting the same denormalized balance (and updatedAt) when the
      // customer is unchanged; reassignment refreshes old and new exactly once.
      if (existing.customerId !== updated.customerId) {
        await this.syncCustomerBalance(tx, existing.companyId, existing.customerId);
        await this.syncCustomerBalance(tx, updated.companyId, updated.customerId);
      }
      return updated;
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_UPDATE',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async recordPayment(id: string, dto: RecordReceivablePaymentDto, user: AuthUser) {
    const userId = user.id;
    const paymentAmount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    if (paymentAmount.lte(0))
      throw new BadRequestException('Payment amount must be greater than zero');

    // Party linkage (W3): every collection is one CustomerPayment row with an allocation,
    // so it shows on the customer's statement. The payment service locks the receivable,
    // reduces it, posts DR cash / CR AR control and keeps CashAccount.currentBalance and
    // the customer's cached balance in step, all in this transaction.
    const { existing, record } = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{
          id: string;
          companyId: string;
          divisionId: string | null;
          branchId: string | null;
          customerId: string | null;
          customerName: string | null;
          receivableNumber: string;
          outstandingAmount: Prisma.Decimal;
          paidAmount: Prisma.Decimal;
          status: string;
          currency: string;
        }>
      >`SELECT "id", "companyId", "divisionId", "branchId", "customerId", "customerName", "receivableNumber", "outstandingAmount", "paidAmount", "status", "currency"
        FROM "receivables"
        WHERE "id" = ${id} AND "deletedAt" IS NULL
        FOR UPDATE`;

      if (!locked) throw new NotFoundException('Receivable not found');
      await assertLegacyPosWriteAllowed(tx, user, locked.companyId, locked.branchId);
      await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);
      await this.org.assertCanAccessScope(
        user,
        locked.divisionId,
        locked.branchId,
        AccessLevel.WRITE,
      );
      if (!['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(locked.status)) {
        throw new BadRequestException(
          `Cannot record a payment against a ${locked.status} receivable`,
        );
      }
      if (!locked.customerId) {
        // No shared customer to attach a payment to (free-text customerName only): settle
        // directly, exactly as before, with the journal referenced to the receivable. The
        // Unmatched parties queue (W7) surfaces these for matching; once matched (see
        // linkCustomer), collections take the CustomerPayment path below and show on the
        // customer's statement.
        const updated = await this.settleUnlinkedReceivable(tx, locked, dto, paymentAmount, userId);
        return { existing: locked, record: updated };
      }

      const { receivables } = await this.customerPayments.createInTransaction(tx, user, {
        companyId: locked.companyId,
        divisionId: locked.divisionId,
        branchId: locked.branchId,
        customerId: locked.customerId,
        amount: paymentAmount,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        cashAccountId: dto.cashAccountId ?? null,
        currency: locked.currency,
        notes: dto.notes ?? null,
        allocations: [{ receivableId: locked.id, amount: paymentAmount }],
      });
      const updated =
        receivables[0] ??
        (await tx.receivable.findFirstOrThrow({ where: { id, deletedAt: null } }));
      return { existing: locked, record: updated };
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_PAYMENT',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { outstandingAmount: existing.outstandingAmount, status: existing.status } as any,
      newValue: {
        outstandingAmount: record.outstandingAmount,
        paidAmount: record.paidAmount,
        status: record.status,
      } as any,
    });

    return record;
  }

  /**
   * Legacy direct settlement for a receivable with no linked customer: reduce the
   * receivable, post DR cash (role account) / CR AR control referenced to the receivable,
   * increment the chosen CashAccount and keep the source sales order in step.
   */
  private async settleUnlinkedReceivable(
    tx: Prisma.TransactionClient,
    locked: {
      id: string;
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      customerId: string | null;
      customerName: string | null;
      receivableNumber: string;
      outstandingAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      currency: string;
    },
    dto: RecordReceivablePaymentDto,
    paymentAmount: Prisma.Decimal,
    userId: string,
  ) {
    if (dto.cashAccountId) {
      const account = await assertCashAccountForScope(tx, {
        cashAccountId: dto.cashAccountId,
        companyId: locked.companyId,
        divisionId: locked.divisionId,
        branchId: locked.branchId,
      });
      if (account.currency !== locked.currency)
        throw new BadRequestException(
          'Receipt account currency must match the receivable currency.',
        );
    }
    const outstanding = new Prisma.Decimal(locked.outstandingAmount);
    if (paymentAmount.gt(outstanding)) {
      throw new BadRequestException(
        `Payment amount (${paymentAmount.toString()}) exceeds outstanding amount (${outstanding.toString()})`,
      );
    }
    const nextOutstanding = outstanding.minus(paymentAmount);
    const nextPaid = new Prisma.Decimal(locked.paidAmount).plus(paymentAmount);
    const nextStatus = nextOutstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';
    const updated = await tx.receivable.update({
      where: { id: locked.id },
      data: { outstandingAmount: nextOutstanding, paidAmount: nextPaid, status: nextStatus },
    });
    const cashRole = await this.resolvePaymentCashRole(tx, locked.companyId, dto.cashAccountId);
    const [cashAccount, arAccount] = await Promise.all([
      this.accountResolver.resolve(locked.companyId, cashRole, tx),
      this.accountResolver.resolve(locked.companyId, 'AR_CONTROL', tx),
    ]);
    const settlementDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    const journal = await this.postingEngine.postLines(
      {
        companyId: locked.companyId,
        divisionId: locked.divisionId,
        branchId: locked.branchId,
        transactionDate: settlementDate,
        description: `Receivable settlement ${locked.receivableNumber}`,
        referenceType: 'Receivable',
        referenceId: locked.id,
        moduleName: 'receivables',
        userId,
        lines: [
          {
            accountId: cashAccount.id,
            description: `Payment received: ${locked.customerName ?? 'customer'}`,
            debit: paymentAmount,
            credit: 0,
          },
          {
            accountId: arAccount.id,
            ...partyOf('customer', locked.customerId),
            description: `Accounts receivable settlement: ${locked.customerName ?? 'customer'}`,
            debit: 0,
            credit: paymentAmount,
          },
        ],
      },
      tx,
    );
    if (dto.cashAccountId) {
      await tx.cashAccount.updateMany({
        where: { id: dto.cashAccountId, companyId: locked.companyId, deletedAt: null },
        data: { currentBalance: { increment: paymentAmount } },
      });
      // Cash book (W4): no shared customer yet, but the cash still arrived.
      await this.cashBook?.recordInTransaction(tx, { id: userId } as AuthUser, {
        kind: 'CUSTOMER_RECEIPT',
        companyId: locked.companyId,
        cashAccountId: dto.cashAccountId,
        amount: paymentAmount,
        currency: locked.currency,
        businessDate: settlementDate,
        description: `Receivable settlement ${locked.receivableNumber} · ${locked.customerName ?? 'customer'}`,
        reference: locked.receivableNumber,
        requestId: `Receivable:${locked.id}:${journal.id}`,
        partyType: 'NONE',
        receivableId: locked.id,
        journalEntryId: journal.id,
        journalReferenceType: 'Receivable',
      });
    }
    await this.syncSalesOrderPaymentFromReceivable(tx, updated);
    await this.syncCustomerBalance(tx, updated.companyId, updated.customerId);
    return updated;
  }

  /**
   * Match an unlinked receivable (free-text customerName only) to a shared customer.
   * Names are never proof of identity: the caller chooses the customer. The name stays
   * as a display snapshot; amounts, status and journals are untouched. Idempotent for
   * the same customer; a different customer on an already linked receivable conflicts.
   */
  async linkCustomer(id: string, dto: LinkReceivableCustomerDto, user: AuthUser) {
    const { before, record } = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{
          id: string;
          companyId: string;
          divisionId: string | null;
          branchId: string | null;
          customerId: string | null;
          customerName: string;
        }>
      >`SELECT "id", "companyId", "divisionId", "branchId", "customerId", "customerName"
        FROM "receivables"
        WHERE "id" = ${id} AND "deletedAt" IS NULL
        FOR UPDATE`;
      if (!locked) throw new NotFoundException('Receivable not found');
      await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);
      await this.org.assertCanAccessScope(
        user,
        locked.divisionId,
        locked.branchId,
        AccessLevel.WRITE,
      );
      if (locked.customerId === dto.customerId) return { before: locked, record: null };
      if (locked.customerId)
        throw new ConflictException('This receivable is already linked to a customer.');
      const customer = await tx.customer.findFirst({
        where: {
          id: dto.customerId,
          companyId: locked.companyId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException('Choose an active customer in this company.');
      const updated = await tx.receivable.update({
        where: { id },
        data: { customerId: customer.id },
      });
      await this.syncCustomerBalance(tx, updated.companyId, updated.customerId);
      return { before: locked, record: updated };
    });
    if (!record) return this.findOne(id);
    await this.auditLogs.log({
      action: 'RECEIVABLE_LINK_CUSTOMER',
      entityType: 'Receivable',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { customerId: before.customerId, customerName: before.customerName } as any,
      newValue: { customerId: record.customerId, requestId: dto.requestId ?? null } as any,
    });
    return record;
  }

  async writeOff(id: string, dto: WriteOffReceivableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const record = await this.prisma.$transaction(async (tx) => {
      // Re-read under a row lock so a concurrent recordPayment / second writeOff
      // cannot race us. We read the live status + outstandingAmount so the
      // bad-debt derecognition relieves exactly what is still open.
      const [locked] = await tx.$queryRaw<
        Array<{
          id: string;
          companyId: string;
          divisionId: string | null;
          branchId: string | null;
          customerId: string | null;
          customerName: string | null;
          receivableNumber: string;
          outstandingAmount: Prisma.Decimal;
          status: string;
        }>
      >`SELECT "id", "companyId", "divisionId", "branchId", "customerId", "customerName", "receivableNumber", "outstandingAmount", "status"
        FROM "receivables"
        WHERE "id" = ${id} AND "deletedAt" IS NULL
        FOR UPDATE`;

      if (!locked) throw new NotFoundException('Receivable not found');

      // A receivable already settled (PAID), already written off, or cancelled
      // must not be written off again — a second derecognition would double
      // relieve AR_CONTROL and double-count the bad-debt expense.
      if (!['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(locked.status)) {
        throw new BadRequestException(`Cannot write off a ${locked.status} receivable`);
      }

      const outstanding = new Prisma.Decimal(locked.outstandingAmount).toDecimalPlaces(2);

      // GL: recognise the uncollectible debt so AR_CONTROL and the subledger move
      // together (the creation entry debited AR_CONTROL; we must credit it back).
      //   DR Bad debt expense  (P&L loss recognised)
      //   CR AR control        (asset/subledger down)
      // A receivable with nothing outstanding needs no GL movement. Only the
      // still-open remainder is derecognised, so any amount already collected via
      // recordPayment (already credited to AR at settlement) is left untouched.
      if (outstanding.gt(0)) {
        const [badDebtAccount, arAccount] = await Promise.all([
          this.resolveBadDebtExpenseAccount(tx, locked.companyId),
          this.accountResolver.resolve(locked.companyId, 'AR_CONTROL', tx),
        ]);
        await this.postingEngine.postLines(
          {
            companyId: locked.companyId,
            divisionId: locked.divisionId,
            branchId: locked.branchId,
            transactionDate: new Date(),
            description: `Receivable write-off ${locked.receivableNumber}`,
            referenceType: 'Receivable',
            referenceId: locked.id,
            moduleName: 'receivables',
            userId,
            lines: [
              {
                accountId: badDebtAccount.id,
                description: `Bad debt written off: ${locked.customerName ?? 'customer'}`,
                debit: outstanding,
                credit: 0,
              },
              {
                accountId: arAccount.id,
                ...partyOf('customer', locked.customerId),
                description: `Derecognise receivable ${locked.receivableNumber}`,
                debit: 0,
                credit: outstanding,
              },
            ],
          },
          tx,
        );
      }

      const updated = await tx.receivable.update({
        where: { id },
        data: {
          status: 'WRITTEN_OFF',
          // Zero the outstanding so the amount can no longer be paid (closes the
          // recordPayment resurrection hole) and so the subledger aggregate drops
          // in step with the GL credit above.
          outstandingAmount: 0,
          notes: dto.reason,
        },
      });
      await this.syncCustomerBalance(tx, updated.companyId, updated.customerId);

      // The bad-debt journal, AR subledger transition, customer projection,
      // and audit fact are one financial operation. Fail the transaction when
      // the immutable audit row cannot be appended.
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'RECEIVABLE_WRITE_OFF',
        entityType: 'Receivable',
        entityId: id,
        userId,
        companyId: updated.companyId,
        oldValue: { status: locked.status } as any,
        newValue: { status: 'WRITTEN_OFF', reason: dto.reason } as any,
      });

      return updated;
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.receivable.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.syncCustomerBalance(tx, existing.companyId, existing.customerId);
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_DELETE',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private async buildReceivableWhere(query: QueryReceivableDto, user: AuthUser) {
    const { companyId, divisionId, branchId, status, customerId, dateFrom, dateTo } = query;
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.ReceivableWhereInput = { deletedAt: null };

    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.issueDate.lte = dateRangeEnd(dateTo);
    }

    const search = query.search?.trim();
    if (search)
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { receivableNumber: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        },
      ];
    return where;
  }

  private includeListScope() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      customer: {
        select: {
          id: true,
          customerCode: true,
          name: true,
          legalName: true,
          customerType: true,
          tin: true,
          vrn: true,
          phone: true,
          email: true,
          address: true,
          contactPerson: true,
          creditLimit: true,
          currentBalance: true,
          paymentTerms: true,
          status: true,
        },
      },
      salesOrders: {
        where: { deletedAt: null },
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          dueDate: true,
          salesType: true,
          status: true,
          paymentStatus: true,
          customerName: true,
          customer: { select: { id: true, name: true } },
          subtotal: true,
          taxAmount: true,
          discountAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
        orderBy: { orderDate: 'desc' as const },
        take: 1,
      },
    };
  }

  private includeDetailScope() {
    return {
      ...this.includeListScope(),
      journalEntry: {
        select: {
          id: true,
          journalNumber: true,
          transactionDate: true,
          description: true,
          referenceType: true,
          referenceId: true,
          status: true,
          totalDebit: true,
          totalCredit: true,
          postedAt: true,
          lines: {
            select: {
              id: true,
              description: true,
              debit: true,
              credit: true,
              account: {
                select: {
                  id: true,
                  accountCode: true,
                  accountName: true,
                  accountType: true,
                  accountSubType: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
      salesOrders: {
        where: { deletedAt: null },
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          dueDate: true,
          salesType: true,
          status: true,
          paymentStatus: true,
          customerName: true,
          customer: { select: { id: true, name: true } },
          subtotal: true,
          taxAmount: true,
          discountAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          lines: {
            select: {
              id: true,
              description: true,
              quantity: true,
              unitPrice: true,
              discountAmount: true,
              taxAmount: true,
              lineTotal: true,
              product: {
                select: {
                  id: true,
                  productCode: true,
                  sku: true,
                  name: true,
                },
              },
              unit: {
                select: {
                  id: true,
                  name: true,
                  symbol: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
        orderBy: { orderDate: 'desc' as const },
        take: 10,
      },
      fuelCreditSales: {
        where: { deletedAt: null },
        select: {
          id: true,
          creditSaleNumber: true,
          saleDate: true,
          status: true,
          litres: true,
          pricePerLitre: true,
          totalAmount: true,
          vehicleNumber: true,
          driverName: true,
          product: { select: { id: true, productCode: true, name: true, sku: true } },
        },
        orderBy: { saleDate: 'desc' as const },
        take: 10,
      },
      projectBillings: {
        where: { deletedAt: null },
        select: {
          id: true,
          billingNumber: true,
          billingDate: true,
          description: true,
          amount: true,
          currency: true,
          status: true,
        },
        orderBy: { billingDate: 'desc' as const },
        take: 10,
      },
      trips: {
        where: { deletedAt: null },
        select: {
          id: true,
          tripNumber: true,
          tripDate: true,
          origin: true,
          destination: true,
          revenueAmount: true,
          currency: true,
          status: true,
        },
        orderBy: { tripDate: 'desc' as const },
        take: 10,
      },
    };
  }

  private withDisplayCustomerName<
    T extends {
      customerName: string;
      customer?: { name?: string | null } | null;
      salesOrders?: Array<{
        customerName?: string | null;
        customer?: { name?: string | null } | null;
      }>;
    },
  >(receivable: T): T {
    const sourceOrder = receivable.salesOrders?.[0];
    const customerName =
      receivable.customer?.name?.trim() ||
      sourceOrder?.customer?.name?.trim() ||
      sourceOrder?.customerName?.trim() ||
      receivable.customerName ||
      'Walk-in Customer';
    return { ...receivable, customerName };
  }

  private async resolveReceivableScope(input: {
    companyId: string;
    divisionId?: string | null;
    branchId?: string | null;
    customerId?: string | null;
  }) {
    let divisionId = input.divisionId || null;
    let branchId = input.branchId || null;

    if (input.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true, name: true },
      });
      if (!customer || customer.companyId !== input.companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
      if (!divisionId && customer.divisionId) divisionId = customer.divisionId;
      if (!branchId && customer.branchId) branchId = customer.branchId;
      if (divisionId && customer.divisionId && customer.divisionId !== divisionId) {
        throw new BadRequestException('Customer does not belong to the selected division');
      }
      if (branchId && customer.branchId && customer.branchId !== branchId) {
        throw new BadRequestException('Customer does not belong to the selected branch/location');
      }
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== input.companyId) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (!divisionId) divisionId = branch.divisionId;
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== input.companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    const customerName = input.customerId
      ? (
          await this.prisma.customer.findFirst({
            where: { id: input.customerId, deletedAt: null },
            select: { name: true },
          })
        )?.name
      : undefined;

    return { divisionId, branchId, customerName };
  }

  /**
   * Pick the GL cash/bank role for a settlement. When a cashAccountId is
   * supplied it must belong to the company and be active; its accountType then
   * selects BANK vs CASH_ON_HAND (mirroring customer-payments.cashAccountRole).
   * Legacy callers that omit it fall back to CASH_ON_HAND so the entry still
   * balances.
   */
  private async resolvePaymentCashRole(
    tx: Prisma.TransactionClient,
    companyId: string,
    cashAccountId?: string | null,
  ): Promise<AccountRole> {
    if (!cashAccountId) return 'CASH_ON_HAND';
    const cashAccount = await tx.cashAccount.findFirst({
      where: { id: cashAccountId, deletedAt: null, isActive: true },
      select: { companyId: true, accountType: true },
    });
    if (!cashAccount || cashAccount.companyId !== companyId) {
      throw new BadRequestException('Cash account does not belong to this company');
    }
    return cashAccount.accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
  }

  /**
   * Resolve the bad-debt / doubtful-debt expense account for a write-off.
   *
   * The typed {@link AccountRole} union has no dedicated BAD_DEBT role yet, so we
   * probe the chart directly by conventional accountSubType keys and Tanzanian
   * SME expense codes (the same defensive pattern customer-payments uses for the
   * customer-advance liability). If none is configured we fall back to the typed
   * GENERAL_EXPENSE role — a real, resolvable expense account — so the loss is
   * still recognised in the P&L rather than posted to a wrong/zero account.
   *
   * SEEDING NOTE: to book write-offs to a dedicated line, seed a chart account
   * with accountSubType="bad_debt_expense" (or code 6800/5800) per company.
   */
  private async resolveBadDebtExpenseAccount(tx: Prisma.TransactionClient, companyId: string) {
    const subTypeKeys = [
      'bad_debt_expense',
      'bad_debt',
      'bad_debts',
      'doubtful_debts',
      'doubtful_debt_expense',
      'provision_for_doubtful_debts',
      'write_off_expense',
    ];
    const codes = ['6800', '6810', '5800', '5810'];

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
    });
    if (account) return account;

    // Fall back to a general operating-expense account (typed, always seeded).
    return this.accountResolver.resolve(companyId, 'GENERAL_EXPENSE', tx);
  }

  private async syncCustomerBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId?: string | null,
  ) {
    // Party linkage (W5): one rule for the cached balance, shared by every module.
    await refreshCachedPartyBalance(tx, 'customer', companyId, customerId);
  }

  private async syncSalesOrderPaymentFromReceivable(
    tx: Prisma.TransactionClient,
    receivable: ReceivableSalesOrderSnapshot,
  ) {
    if (receivable.sourceType !== 'SalesOrder' || !receivable.sourceId) return;

    const paidAmount = new Prisma.Decimal(receivable.paidAmount ?? 0).toDecimalPlaces(2);
    const outstandingAmount = new Prisma.Decimal(receivable.outstandingAmount ?? 0).toDecimalPlaces(
      2,
    );
    const paymentStatus = outstandingAmount.isZero()
      ? PaymentStatus.PAID
      : paidAmount.gt(0)
        ? PaymentStatus.PARTIALLY_PAID
        : PaymentStatus.UNPAID;

    await tx.salesOrder.updateMany({
      where: { id: receivable.sourceId, deletedAt: null },
      data: {
        receivableId: receivable.id,
        paidAmount,
        outstandingAmount,
        paymentStatus,
      },
    });
  }
}
