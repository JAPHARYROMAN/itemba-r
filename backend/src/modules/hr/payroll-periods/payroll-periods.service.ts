import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-period.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class PayrollPeriodsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.payrollPeriod.findMany({
        where, skip, take: Number(limit), orderBy: { startDate: 'desc' },
        include: { company: { select: { id: true, name: true } } },
      }),
      this.prisma.payrollPeriod.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.payrollPeriod.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException('Payroll period not found');
    return record;
  }

  async create(dto: CreatePayrollPeriodDto, user: any) {
    const record = await this.prisma.payrollPeriod.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'PayrollPeriod', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdatePayrollPeriodDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.payrollPeriod.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.payrollPeriod.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'PayrollPeriod', entityId: id, newValue: {} });
    return { message: 'Payroll period deleted' };
  }
}
