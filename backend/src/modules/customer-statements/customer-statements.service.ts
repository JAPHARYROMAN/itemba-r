import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class CustomerStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, customerId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (customerId) where.customerId = customerId;
    const [items, total] = await Promise.all([
      this.prisma.customerStatementRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.customerStatementRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.customerStatementRun.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Customer statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async generate(dto: any, user: AuthUser) {
    const { companyId, customerId, periodStart, periodEnd } = dto;
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);

    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer does not belong to the selected company');
      }
    }

    const receivableWhere: any = { companyId };
    if (customerId) receivableWhere.customerId = customerId;
    if (periodStart) receivableWhere.issueDate = { gte: new Date(periodStart) };
    if (periodEnd) receivableWhere.issueDate = { ...(receivableWhere.issueDate ?? {}), lte: new Date(periodEnd) };

    const receivables = await this.prisma.receivable.findMany({ where: receivableWhere });

    let totalDebits = 0;
    let totalCredits = 0;
    for (const r of receivables) {
      totalDebits += Number(r.amount ?? 0);
      totalCredits += Number(r.paidAmount ?? 0);
    }
    const closingBalance = totalDebits - totalCredits;

    const run = await this.prisma.customerStatementRun.create({
      data: {
        statementRunNumber: `CSTAT-${Date.now()}`,
        companyId,
        customerId: customerId ?? 'ALL',
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        totalDebits,
        totalCredits,
        closingBalance,
        generatedById: user.id,
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({ action: 'GENERATE', entityType: 'CustomerStatementRun', entityId: run.id, userId: user.id, companyId });
    return run;
  }
}
