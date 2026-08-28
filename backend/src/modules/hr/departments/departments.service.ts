import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, companyId, divisionId, branchId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { name: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
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
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Department not found');
    return record;
  }

  async create(dto: CreateDepartmentDto, user: any) {
    await this.assertDepartmentHierarchy(dto.companyId, dto.divisionId, dto.branchId, user);
    const manualCode = dto.departmentCode?.trim();
    let departmentCode = manualCode || (await this.nextDepartmentCode(dto.companyId));
    let record;
    try {
      record = await this.prisma.department.create({ data: { ...dto, departmentCode } });
    } catch (error) {
      if (this.isDepartmentCodeConflict(error)) {
        if (manualCode) {
          throw new BadRequestException(
            `Department code ${manualCode} already exists for this company`,
          );
        }
        departmentCode = await this.nextDepartmentCode(dto.companyId);
        record = await this.prisma.department.create({ data: { ...dto, departmentCode } });
      } else {
        throw error;
      }
    }
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'Department',
      entityId: record.id,
      newValue: { ...dto, departmentCode } as unknown as Record<string, unknown>,
    });
    return record;
  }

  /**
   * Generate the next department code for a company: `{prefix}-DEPT-{NNN}`.
   * Checks existing codes directly so soft-deleted records, imports, and
   * previous failed previews cannot cause duplicate auto-generated codes.
   */
  async previewNextDepartmentCode(companyId: string, user: AuthUser): Promise<string> {
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.READ);
    return this.nextDepartmentCode(companyId);
  }

  async nextDepartmentCode(companyId: string): Promise<string> {
    if (!companyId) throw new BadRequestException('companyId is required');
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true, employeeCodePrefix: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = (company.employeeCodePrefix ?? company.code.slice(0, 4)).toUpperCase();
    const codePrefix = `${prefix}-DEPT-`;
    const existing = await this.prisma.department.findMany({
      where: { companyId, departmentCode: { startsWith: codePrefix } },
      select: { departmentCode: true },
    });
    const usedCodes = new Set(existing.map((row) => row.departmentCode));
    for (let next = 1; next <= existing.length + 1000; next += 1) {
      const candidate = `${codePrefix}${String(next).padStart(3, '0')}`;
      if (!usedCodes.has(candidate)) return candidate;
    }
    throw new BadRequestException('Unable to generate a free department code');
  }

  async update(id: string, dto: UpdateDepartmentDto, user: any) {
    const existing = await this.findOne(id, user);
    await this.assertDepartmentHierarchy(
      dto.companyId ?? existing.companyId,
      dto.divisionId ?? existing.divisionId ?? undefined,
      dto.branchId ?? existing.branchId ?? undefined,
      user,
    );
    const record = await this.prisma.department.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Department',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'Department',
      entityId: id,
      newValue: {},
    });
    return { message: 'Department deleted' };
  }

  private async assertDepartmentHierarchy(
    companyId: string,
    divisionId: string | undefined,
    branchId: string | undefined,
    user: any,
  ) {
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true, isActive: true },
      });
      if (!division) throw new NotFoundException('Division not found');
      if (division.companyId !== companyId) {
        throw new BadRequestException('Department division must belong to the selected company');
      }
      if (!division.isActive) throw new BadRequestException('Department division must be active');
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: {
          divisionId: true,
          isActive: true,
          division: { select: { companyId: true, isActive: true, deletedAt: true } },
        },
      });
      if (!branch) throw new NotFoundException('Branch/location not found');
      if (branch.division.companyId !== companyId) {
        throw new BadRequestException(
          'Department branch/location must belong to the selected company',
        );
      }
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException(
          'Department branch/location must belong to the selected division',
        );
      }
      if (!branch.isActive || !branch.division.isActive || branch.division.deletedAt) {
        throw new BadRequestException('Department branch/location must be active');
      }
    }
  }

  private isDepartmentCodeConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
    return target.includes('companyId') && target.includes('departmentCode');
  }
}
