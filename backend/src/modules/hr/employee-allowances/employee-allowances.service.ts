import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeAllowanceDto } from './dto/create-employee-allowance.dto';
import { UpdateEmployeeAllowanceDto } from './dto/update-employee-allowance.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class EmployeeAllowancesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, allowanceTypeId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (employeeId) where.employeeId = employeeId;
    if (allowanceTypeId) where.allowanceTypeId = allowanceTypeId;
    const [data, total] = await Promise.all([
      this.prisma.employeeAllowance.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          allowanceType: { select: { id: true, name: true, code: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employeeAllowance.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employeeAllowance.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        allowanceType: { select: { id: true, name: true, code: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee allowance not found');
    return record;
  }

  async create(dto: CreateEmployeeAllowanceDto, user: any) {
    const record = await this.prisma.employeeAllowance.create({
      data: {
        ...dto,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'EmployeeAllowance', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateEmployeeAllowanceDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.employeeAllowance.update({
      where: { id },
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'EmployeeAllowance', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employeeAllowance.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'EmployeeAllowance', entityId: id, newValue: {} });
    return { message: 'Employee allowance deleted' };
  }
}
