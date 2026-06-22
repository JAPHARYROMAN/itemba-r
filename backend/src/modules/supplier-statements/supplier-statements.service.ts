import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { GenerateSupplierStatementDto } from './dto/generate-supplier-statement.dto';
import { QuerySupplierStatementDto } from './dto/query-supplier-statement.dto';

@Injectable()
export class SupplierStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySupplierStatementDto, user: AuthUser) {
    const { companyId, supplierId, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.SupplierStatementRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    const [data, total] = await Promise.all([
      this.prisma.supplierStatementRun.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          generatedBy: { select: { id: true, fullName: true, email: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplierStatementRun.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: take, totalPages: Math.ceil(total / take) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierStatementRun.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Supplier statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async generate(dto: GenerateSupplierStatementDto, user: AuthUser) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart > periodEnd) {
      throw new BadRequestException('Statement start date cannot be after end date');
    }

    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier does not belong to the selected company');
      }
    }

    const payableWhere: Prisma.PayableWhereInput = {
      companyId: dto.companyId,
      deletedAt: null,
      issueDate: { gte: periodStart, lte: periodEnd },
    };
    if (dto.supplierId) payableWhere.supplierId = dto.supplierId;

    const summary = await this.prisma.payable.aggregate({
      where: payableWhere,
      _sum: { amount: true, paidAmount: true },
    });

    const totalDebits = summary._sum.amount ?? new Prisma.Decimal(0);
    const totalCredits = summary._sum.paidAmount ?? new Prisma.Decimal(0);
    const closingBalance = totalDebits.minus(totalCredits);

    const run = await this.prisma.supplierStatementRun.create({
      data: {
        statementRunNumber: `SSTAT-${Date.now()}`,
        companyId: dto.companyId,
        supplierId: dto.supplierId ?? 'ALL',
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
      action: 'SUPPLIER_STATEMENT_GENERATE',
      entityType: 'SupplierStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: run as any,
    });
    return run;
  }
}
