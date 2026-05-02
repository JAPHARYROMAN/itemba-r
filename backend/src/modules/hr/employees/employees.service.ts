import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const SENSITIVE_FIELDS = ['baseSalary', 'bankAccountNumber', 'bankName', 'bankBranch', 'tin', 'nssfNumber', 'nhifNumber'];

function hasSensitivePermission(user: any): boolean {
  const perms: string[] = user.permissions ?? [];
  return perms.includes('employees.sensitive.view') || perms.includes('payroll.sensitive.view');
}

function stripSensitive(employee: any, user: any): any {
  if (hasSensitivePermission(user)) return employee;
  const result = { ...employee };
  for (const f of SENSITIVE_FIELDS) delete result[f];
  return result;
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const {
      page = 1,
      limit = 20,
      search,
      companyId,
      branchId,
      departmentId,
      positionId,
      status,
      employmentStatus,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (branchId) where.branchId = branchId;
    if (departmentId) where.departmentId = departmentId;
    if (positionId) where.positionId = positionId;
    if (status) where.status = status;
    if (employmentStatus) where.employmentStatus = employmentStatus;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where, skip, take: Number(limit), orderBy: { fullName: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { data: data.map(e => stripSensitive(e, user)), total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        company: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee not found');
    return stripSensitive(record, user);
  }

  async create(dto: CreateEmployeeDto, user: any) {
    const employeeCode = dto.employeeCode?.trim()
      ? dto.employeeCode.trim()
      : await this.nextEmployeeCode(dto.companyId);
    const record = await this.prisma.employee.create({ data: { ...dto, employeeCode } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'Employee', entityId: record.id, newValue: { ...dto, employeeCode } as unknown as Record<string, unknown> });
    return stripSensitive(record, user);
  }

  /**
   * Generate the next employee code for a company: `{prefix}-EMP-{NNNN}`.
   * Prefix comes from `Company.employeeCodePrefix`, falling back to the
   * first 4 chars of `Company.code` (uppercased) when unset.
   *
   * Counts existing employees (including soft-deleted) so a deleted-then-
   * recreated employee doesn't reuse a code. There's a small race window if
   * two creates fire simultaneously — matches the codebase's existing
   * pattern (`nextJournalNumber`, `nextActionNumber`). Bumps with retry
   * could be added if collisions become a real problem.
   */
  async nextEmployeeCode(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true, employeeCodePrefix: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = (company.employeeCodePrefix ?? company.code.slice(0, 4)).toUpperCase();
    const count = await this.prisma.employee.count({ where: { companyId } });
    return `${prefix}-EMP-${String(count + 1).padStart(4, '0')}`;
  }

  async update(id: string, dto: UpdateEmployeeDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.employee.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Employee', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return stripSensitive(record, user);
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employee.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'Employee', entityId: id, newValue: {} });
    return { message: 'Employee deleted' };
  }
}
