import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { GenerateCustomerStatementDto } from './dto/generate-customer-statement.dto';
import { QueryCustomerStatementDto } from './dto/query-customer-statement.dto';

@Injectable()
export class CustomerStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryCustomerStatementDto, user: AuthUser) {
    const { companyId, customerId, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.CustomerStatementRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (customerId) where.customerId = customerId;
    const [data, total] = await Promise.all([
      this.prisma.customerStatementRun.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          generatedBy: { select: { id: true, fullName: true, email: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customerStatementRun.count({ where }),
    ]);
    return {
      data,
      items: data,
      total,
      page: Number(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.customerStatementRun.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Customer statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async generate(dto: GenerateCustomerStatementDto, user: AuthUser) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart > periodEnd) {
      throw new BadRequestException('Statement start date cannot be after end date');
    }

    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer does not belong to the selected company');
      }
    }

    const receivableWhere: Prisma.ReceivableWhereInput = {
      companyId: dto.companyId,
      deletedAt: null,
      issueDate: { gte: periodStart, lte: periodEnd },
    };
    if (dto.customerId) receivableWhere.customerId = dto.customerId;

    const summary = await this.prisma.receivable.aggregate({
      where: receivableWhere,
      _sum: { amount: true, paidAmount: true },
    });
    const totalDebits = summary._sum.amount ?? new Prisma.Decimal(0);
    const totalCredits = summary._sum.paidAmount ?? new Prisma.Decimal(0);
    const closingBalance = totalDebits.minus(totalCredits);

    const run = await this.prisma.customerStatementRun.create({
      data: {
        statementRunNumber: `CSTAT-${Date.now()}`,
        companyId: dto.companyId,
        customerId: dto.customerId ?? 'ALL',
        periodStart,
        periodEnd,
        totalDebits,
        totalCredits,
        closingBalance,
        generatedById: user.id,
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({
      action: 'GENERATE',
      entityType: 'CustomerStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: run as any,
    });
    return run;
  }
}
