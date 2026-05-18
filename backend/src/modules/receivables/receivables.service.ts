import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { QueryReceivableDto } from './dto/query-receivable.dto';
import { RecordReceivablePaymentDto } from './dto/record-receivable-payment.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';

function generateReceivableNumber(): string {
  return `AR-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
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
    const skip = (page - 1) * limit;

    // Phase 1: hierarchy-scoped where clause covers company + optional division + branch.
    // The scopedWhereFor helper enforces user access at every level it filters on.
    const scopeWhere = await this.companyScope.scopedWhereFor(user, {
      companyId,
      divisionId,
      branchId,
    });

    const where: Prisma.ReceivableWhereInput = { ...scopeWhere, deletedAt: null };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.receivable.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.receivable.findFirst({
      where: { id, deletedAt: null },
      include: { company: { select: { id: true, name: true, code: true } } },
    });
    if (!record) throw new NotFoundException('Receivable not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  async create(dto: CreateReceivableDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.divisionId) {
      this.companyScope.assertCanAccessDivision(user, dto.divisionId, AccessLevel.WRITE);
    }
    if (dto.branchId) {
      this.companyScope.assertCanAccessBranch(user, dto.branchId, AccessLevel.WRITE);
    }
    const userId = user.id;
    const amount = new Prisma.Decimal(dto.amount);

    // Phase 2 — wrap manual receivable creation + AR control posting in one transaction.
    // Skipped when the receivable is a downstream artefact of a SalesOrder/Trip/Project
    // (those already post their own JE). The `sourceType` field signals upstream origin.
    const shouldPost = !dto.sourceType && amount.gt(0);
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.receivable.create({
        data: {
          receivableNumber: generateReceivableNumber(),
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          customerName: dto.customerName,
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
        const [arAccount, revenueAccount] = await Promise.all([
          this.accountResolver.resolve(dto.companyId, 'AR_CONTROL', tx),
          this.accountResolver.resolve(dto.companyId, 'GENERAL_REVENUE', tx),
        ]);

        const journalEntry = await this.postingEngine.postLines(
          {
            companyId: dto.companyId,
            divisionId: dto.divisionId ?? undefined,
            branchId: dto.branchId ?? undefined,
            transactionDate: new Date(dto.issueDate),
            description: `Manual receivable — ${created.receivableNumber} (${dto.customerName})`,
            referenceType: 'Receivable',
            referenceId: created.id,
            moduleName: 'receivables',
            userId,
            lines: [
              { accountId: arAccount.id, debit: amount, description: `AR — ${dto.customerName}` },
              { accountId: revenueAccount.id, credit: amount, description: dto.notes ?? 'Manual receivable' },
            ],
          },
          tx,
        );

        await tx.receivable.update({
          where: { id: created.id },
          data: { journalEntryId: journalEntry.id },
        });
        return { ...created, journalEntryId: journalEntry.id };
      }

      return created;
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
    const record = await this.prisma.receivable.update({
      where: { id },
      data: {
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
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const outstanding = Number(existing.outstandingAmount);

    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds outstanding amount (${outstanding})`,
      );
    }

    const newOutstanding = Math.round((outstanding - dto.amount) * 100) / 100;
    const newPaid = Math.round((Number(existing.paidAmount) + dto.amount) * 100) / 100;
    const newStatus = newOutstanding === 0 ? 'PAID' : 'PARTIALLY_PAID';

    const record = await this.prisma.receivable.update({
      where: { id },
      data: {
        outstandingAmount: newOutstanding,
        paidAmount: newPaid,
        status: newStatus,
      },
    });

    await this.auditLogs.log({
      action: 'RECEIVABLE_PAYMENT',
      entityType: 'Receivable',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { outstandingAmount: outstanding, status: existing.status } as any,
      newValue: { outstandingAmount: newOutstanding, paidAmount: newPaid, status: newStatus } as any,
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
}
