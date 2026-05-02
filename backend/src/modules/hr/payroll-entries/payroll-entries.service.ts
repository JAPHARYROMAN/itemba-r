import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { UpdatePayrollEntryDto } from './dto/update-payroll-entry.dto';

@Injectable()
export class PayrollEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, payrollRunId, employeeId, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (payrollRunId) where.payrollRunId = payrollRunId;
    if (employeeId) where.employeeId = employeeId;
    const [data, total] = await Promise.all([
      this.prisma.payrollEntry.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          payrollRun: { select: { id: true, payrollRunNumber: true, status: true } },
          company: { select: { id: true, name: true } },
          allowances: { include: { allowanceType: { select: { id: true, name: true } } } },
          deductions: { include: { deductionType: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.payrollEntry.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.payrollEntry.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        payrollRun: { select: { id: true, payrollRunNumber: true, status: true } },
        company: { select: { id: true, name: true } },
        allowances: { include: { allowanceType: { select: { id: true, name: true } } } },
        deductions: { include: { deductionType: { select: { id: true, name: true } } } },
      },
    });
    if (!record) throw new NotFoundException('Payroll entry not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async update(id: string, dto: UpdatePayrollEntryDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.payrollEntry.update({ where: { id }, data: dto as any });
    await this.audit.log({
      userId: user.id,
      action: 'PAYROLL_ENTRY_UPDATE',
      entityType: 'PayrollEntry',
      entityId: id,
      companyId: existing.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }
}
