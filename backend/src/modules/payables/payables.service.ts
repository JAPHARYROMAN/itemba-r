import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { QueryPayableDto } from './dto/query-payable.dto';
import { RecordPayablePaymentDto } from './dto/record-payable-payment.dto';
import { WriteOffPayableDto } from './dto/write-off-payable.dto';

function generatePayableNumber(): string {
  return `AP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class PayablesService {
  private readonly logger = new Logger(PayablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async findAll(query: QueryPayableDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      supplierId,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    // Phase 1: hierarchy-scoped where clause covers company + optional division + branch.
    const scopeWhere = await this.companyScope.scopedWhereFor(user, {
      companyId,
      divisionId,
      branchId,
    });

    const where: Prisma.PayableWhereInput = { ...scopeWhere, deletedAt: null };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.payable.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payable.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.payable.findFirst({
      where: { id, deletedAt: null },
      include: { company: { select: { id: true, name: true, code: true } } },
    });
    if (!record) throw new NotFoundException('Payable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  async create(dto: CreatePayableDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.divisionId) {
      this.companyScope.assertCanAccessDivision(user, dto.divisionId, AccessLevel.WRITE);
    }
    if (dto.branchId) {
      this.companyScope.assertCanAccessBranch(user, dto.branchId, AccessLevel.WRITE);
    }
    const userId = user.id;
    const amount = new Prisma.Decimal(dto.amount);

    // Phase 2 — wrap manual payable creation + AP control posting in one transaction.
    // Skipped when the payable is downstream of a SupplierInvoice or PurchaseOrder
    // (those post their own JE). The `sourceType` field signals upstream origin.
    const shouldPost = !dto.sourceType && amount.gt(0);
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payable.create({
        data: {
          payableNumber: generatePayableNumber(),
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          amount: dto.amount,
          paidAmount: 0,
          outstandingAmount: dto.amount,
          currency: dto.currency,
          issueDate: new Date(dto.issueDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: 'OPEN',
          notes: dto.notes,
        },
      });

      if (shouldPost) {
        const [expenseAccount, apAccount] = await Promise.all([
          this.accountResolver.resolve(dto.companyId, 'GENERAL_EXPENSE', tx),
          this.accountResolver.resolve(dto.companyId, 'AP_CONTROL', tx),
        ]);

        const journalEntry = await this.postingEngine.postLines(
          {
            companyId: dto.companyId,
            divisionId: dto.divisionId ?? undefined,
            branchId: dto.branchId ?? undefined,
            transactionDate: new Date(dto.issueDate),
            description: `Manual payable — ${created.payableNumber} (${dto.supplierName})`,
            referenceType: 'Payable',
            referenceId: created.id,
            moduleName: 'payables',
            userId,
            lines: [
              { accountId: expenseAccount.id, debit: amount, description: dto.notes ?? 'Manual payable' },
              { accountId: apAccount.id, credit: amount, description: `AP — ${dto.supplierName}` },
            ],
          },
          tx,
        );

        await tx.payable.update({
          where: { id: created.id },
          data: { journalEntryId: journalEntry.id },
        });
        return { ...created, journalEntryId: journalEntry.id };
      }

      return created;
    });

    await this.auditLogs.log({
      action: 'PAYABLE_CREATE',
      entityType: 'Payable',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdatePayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const record = await this.prisma.payable.update({
      where: { id },
      data: {
        ...(dto.supplierName && { supplierName: dto.supplierName }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
      },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_UPDATE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async recordPayment(id: string, dto: RecordPayablePaymentDto, user: AuthUser) {
    const userId = user.id;
    const paymentAmount = new Prisma.Decimal(dto.amount);
    if (paymentAmount.lte(0))
      throw new BadRequestException('Payment amount must be greater than zero');

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
          FROM "payables"
          WHERE "id" = ${id} AND "deletedAt" IS NULL
          FOR UPDATE`;

        if (!locked) throw new NotFoundException('Payable not found');
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

        const updated = await tx.payable.update({
          where: { id },
          data: {
            outstandingAmount: nextOutstanding,
            paidAmount: nextPaid,
            status: nextStatus,
          },
        });

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
      action: 'PAYABLE_PAYMENT',
      entityType: 'Payable',
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

  async writeOff(id: string, dto: WriteOffPayableDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const record = await this.prisma.payable.update({
      where: { id },
      data: { status: 'WRITTEN_OFF', notes: dto.reason },
    });

    await this.auditLogs.log({
      action: 'PAYABLE_WRITE_OFF',
      entityType: 'Payable',
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
    await this.prisma.payable.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'PAYABLE_DELETE',
      entityType: 'Payable',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
