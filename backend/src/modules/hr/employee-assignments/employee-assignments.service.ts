import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeAssignmentDto } from './dto/create-employee-assignment.dto';
import { UpdateEmployeeAssignmentDto } from './dto/update-employee-assignment.dto';

@Injectable()
export class EmployeeAssignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (employeeId) where.employeeId = employeeId;
    const [data, total] = await Promise.all([
      this.prisma.employeeAssignment.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employeeAssignment.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employeeAssignment.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        department: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee assignment not found');
    return record;
  }

  async create(dto: CreateEmployeeAssignmentDto, user: any) {
    const record = await this.prisma.employeeAssignment.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'EmployeeAssignment', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateEmployeeAssignmentDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.employeeAssignment.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'EmployeeAssignment', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employeeAssignment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'EmployeeAssignment', entityId: id, newValue: {} });
    return { message: 'Employee assignment deleted' };
  }
}
