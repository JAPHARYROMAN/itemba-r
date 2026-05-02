import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class SupplierStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, supplierId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    const [items, total] = await Promise.all([
      this.prisma.supplierStatementRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.supplierStatementRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierStatementRun.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Supplier statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async generate(dto: any, user: AuthUser) {
    const { companyId, supplierId, periodStart, periodEnd } = dto;
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);

    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier does not belong to the selected company');
      }
    }

    const payableWhere: any = { companyId };
    if (supplierId) payableWhere.supplierId = supplierId;
    if (periodStart) payableWhere.issueDate = { gte: new Date(periodStart) };
    if (periodEnd) payableWhere.issueDate = { ...(payableWhere.issueDate ?? {}), lte: new Date(periodEnd) };

    const payables = await this.prisma.payable.findMany({ where: payableWhere });

    let totalDebits = 0;
    let totalCredits = 0;
    for (const p of payables) {
      totalDebits += Number(p.amount ?? 0);
      totalCredits += Number(p.paidAmount ?? 0);
    }
    const closingBalance = totalDebits - totalCredits;

    const run = await this.prisma.supplierStatementRun.create({
      data: {
        statementRunNumber: `SSTAT-${Date.now()}`,
        companyId,
        supplierId: supplierId ?? 'ALL',
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        totalDebits,
        totalCredits,
        closingBalance,
        generatedById: user.id,
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({ action: 'GENERATE', entityType: 'SupplierStatementRun', entityId: run.id, userId: user.id, companyId });
    return run;
  }
}
