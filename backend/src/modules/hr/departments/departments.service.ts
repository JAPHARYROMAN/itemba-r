import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where, skip, take: Number(limit), orderBy: { name: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.department.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.department.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Department not found');
    return record;
  }

  async create(dto: CreateDepartmentDto, user: any) {
    const departmentCode = dto.departmentCode?.trim()
      ? dto.departmentCode.trim()
      : await this.nextDepartmentCode(dto.companyId);
    const record = await this.prisma.department.create({ data: { ...dto, departmentCode } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'Department', entityId: record.id, newValue: { ...dto, departmentCode } as unknown as Record<string, unknown> });
    return record;
  }

  /**
   * Generate the next department code for a company: `{prefix}-DEPT-{NNN}`.
   * Same approach as `EmployeesService.nextEmployeeCode` — prefix from
   * `Company.employeeCodePrefix` (or first 4 chars of `code`), counter from
   * existing department count + 1, padded to 3 digits.
   *
   * Operators can override with a meaningful abbreviation (e.g. MWAN-OPS) by
   * passing `departmentCode` explicitly; the override wins.
   */
  async nextDepartmentCode(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true, employeeCodePrefix: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = (company.employeeCodePrefix ?? company.code.slice(0, 4)).toUpperCase();
    const count = await this.prisma.department.count({ where: { companyId } });
    return `${prefix}-DEPT-${String(count + 1).padStart(3, '0')}`;
  }

  async update(id: string, dto: UpdateDepartmentDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.department.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Department', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'Department', entityId: id, newValue: {} });
    return { message: 'Department deleted' };
  }
}
