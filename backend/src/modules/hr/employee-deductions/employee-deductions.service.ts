import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeDeductionDto } from './dto/create-employee-deduction.dto';
import { UpdateEmployeeDeductionDto } from './dto/update-employee-deduction.dto';

@Injectable()
export class EmployeeDeductionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, deductionTypeId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (employeeId) where.employeeId = employeeId;
    if (deductionTypeId) where.deductionTypeId = deductionTypeId;
    const [data, total] = await Promise.all([
      this.prisma.employeeDeduction.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          deductionType: { select: { id: true, name: true, code: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employeeDeduction.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employeeDeduction.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        deductionType: { select: { id: true, name: true, code: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee deduction not found');
    return record;
  }

  async create(dto: CreateEmployeeDeductionDto, user: any) {
    const record = await this.prisma.employeeDeduction.create({
      data: {
        ...dto,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'EmployeeDeduction', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateEmployeeDeductionDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.employeeDeduction.update({
      where: { id },
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'EmployeeDeduction', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employeeDeduction.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'EmployeeDeduction', entityId: id, newValue: {} });
    return { message: 'Employee deduction deleted' };
  }
}
