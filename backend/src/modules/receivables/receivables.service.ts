import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
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

function generateReceivableNumber(): string {
  return `AR-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
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
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: this.includeScope(),
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
          receivableNumber: generateReceivableNumber(),
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
}
