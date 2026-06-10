import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { QueryReceivableDto } from './dto/query-receivable.dto';
import { RecordReceivablePaymentDto } from './dto/record-receivable-payment.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { pagination } from '../../common/utils/pagination';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

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
  ) {}

  async findAll(query: QueryReceivableDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      customerId,
      dateFrom,
      dateTo,
    } = query;
    const paging = pagination({ page, limit });

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

    const [data, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: this.includeScope(),
        orderBy: { issueDate: 'desc' },
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.receivable.count({ where }),
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
    const record = await this.prisma.receivable.findFirst({
      where: { id, deletedAt: null },
      include: this.includeScope(),
    });
    if (!record) throw new NotFoundException('Receivable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
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
          customerId: dto.customerId,
          customerName: dto.customerName,
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

      return tx.receivable.update({
        where: { id: created.id },
        data: { journalEntryId: journalEntry.id },
      });
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
    const userId = user.id;
    const scope = await this.resolveReceivableScope({
      companyId: existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      customerId:
        dto.customerId !== undefined ? dto.customerId || null : existing.customerId || null,
    });
    const record = await this.prisma.receivable.update({
      where: { id },
      data: {
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        ...(dto.customerName && { customerName: dto.customerName }),
        ...(dto.customerId !== undefined && { customerId: dto.customerId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
      },
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

    // ITMB-036: make the read-modify-write atomic by locking the receivable row
    // FOR UPDATE inside the transaction, then running the checks and Decimal
    // arithmetic on the locked row before updating and syncing the sales order.
    const { existing, record, newOutstanding, newPaid, newStatus } = await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          Array<{
            id: string;
            companyId: string;
            outstandingAmount: Prisma.Decimal;
            paidAmount: Prisma.Decimal;
            status: string;
          }>
        >`SELECT "id", "companyId", "outstandingAmount", "paidAmount", "status"
          FROM "receivables"
          WHERE "id" = ${id} AND "deletedAt" IS NULL
          FOR UPDATE`;

        if (!locked) throw new NotFoundException('Receivable not found');
        await this.companyScope.assertCanAccessCompany(user, locked.companyId, AccessLevel.WRITE);

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
          where: { id },
          data: {
            outstandingAmount: nextOutstanding,
            paidAmount: nextPaid,
            status: nextStatus,
          },
        });

        await this.syncSalesOrderPaymentFromReceivable(tx, updated);

        return {
          existing: locked,
          record: updated,
          newOutstanding: nextOutstanding,
          newPaid: nextPaid,
          newStatus: nextStatus,
        };
      },
    );

    await this.auditLogs.log({
      action: 'RECEIVABLE_PAYMENT',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { outstandingAmount: existing.outstandingAmount, status: existing.status } as any,
      newValue: {
        outstandingAmount: newOutstanding,
        paidAmount: newPaid,
        status: newStatus,
      } as any,
    });

    return record;
  }

  async writeOff(id: string, dto: WriteOffReceivableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const record = await this.prisma.receivable.update({
      where: { id },
      data: { status: 'WRITTEN_OFF', notes: dto.reason },
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_WRITE_OFF',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'WRITTEN_OFF', reason: dto.reason } as any,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.receivable.update({ where: { id }, data: { deletedAt: new Date() } });

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

  private includeScope() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
    };
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
        select: { companyId: true, divisionId: true, branchId: true },
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

    return { divisionId, branchId };
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
