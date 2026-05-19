import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, companyId, divisionId, branchId, departmentId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (departmentId) where.departmentId = departmentId;
    if (divisionId || branchId) {
      where.department = {
        ...(divisionId ? { divisionId } : {}),
        ...(branchId ? { branchId } : {}),
        deletedAt: null,
      };
    }
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { positionCode: { contains: search, mode: 'insensitive' } },
        { department: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.position.findMany({
        where, skip, take: Number(limit), orderBy: { title: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          department: {
            select: {
              id: true,
              name: true,
              departmentCode: true,
              companyId: true,
              divisionId: true,
              branchId: true,
              division: { select: { id: true, name: true, code: true } },
              branch: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.position.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.position.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        company: { select: { id: true, name: true } },
        department: {
          select: {
            id: true,
            name: true,
            departmentCode: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            division: { select: { id: true, name: true, code: true } },
            branch: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!record) throw new NotFoundException('Position not found');
    return record;
  }

  async create(dto: CreatePositionDto, user: any) {
    await this.assertPositionHierarchy(dto.companyId, dto.departmentId, user);
    const manualCode = dto.positionCode?.trim();
    let positionCode = manualCode || await this.nextPositionCode(dto.companyId);
    let record;
    try {
      record = await this.prisma.position.create({
        data: {
          ...dto,
          positionCode,
          currency: dto.currency || 'TZS',
        },
      });
    } catch (error) {
      if (this.isPositionCodeConflict(error)) {
        if (manualCode) {
          throw new BadRequestException(`Position code ${manualCode} already exists for this company`);
        }
        positionCode = await this.nextPositionCode(dto.companyId);
        record = await this.prisma.position.create({
          data: {
            ...dto,
            positionCode,
            currency: dto.currency || 'TZS',
          },
        });
      } else {
        throw error;
      }
    }
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'Position', entityId: record.id, newValue: { ...dto, positionCode } as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdatePositionDto, user: any) {
    const existing = await this.findOne(id, user);
    const companyId = dto.companyId ?? existing.companyId;
    const departmentId = dto.departmentId ?? existing.departmentId;
    if (!departmentId) {
      throw new BadRequestException('A position must be linked to a department');
    }
    await this.assertPositionHierarchy(companyId, departmentId, user);
    const data = { ...dto };
    if (data.positionCode !== undefined) {
      const trimmed = data.positionCode.trim();
      if (!trimmed) throw new BadRequestException('Position code cannot be blank');
      data.positionCode = trimmed;
    }
    const record = await this.prisma.position.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'Position', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.position.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'Position', entityId: id, newValue: {} });
    return { message: 'Position deleted' };
  }

  async nextPositionCode(companyId: string): Promise<string> {
    if (!companyId) throw new BadRequestException('companyId is required');
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { code: true, employeeCodePrefix: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = (company.employeeCodePrefix ?? company.code.slice(0, 4)).toUpperCase();
    const codePrefix = `${prefix}-POS-`;
    const existing = await this.prisma.position.findMany({
      where: { companyId, positionCode: { startsWith: codePrefix } },
      select: { positionCode: true },
    });
    const usedCodes = new Set(existing.map((row) => row.positionCode));
    for (let next = 1; next <= existing.length + 1000; next += 1) {
      const candidate = `${codePrefix}${String(next).padStart(3, '0')}`;
      if (!usedCodes.has(candidate)) return candidate;
    }
    throw new BadRequestException('Unable to generate a free position code');
  }

  private async assertPositionHierarchy(companyId: string, departmentId: string, user: any) {
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        status: true,
        division: { select: { id: true, companyId: true, isActive: true, deletedAt: true } },
        branch: { select: { id: true, divisionId: true, isActive: true, deletedAt: true } },
      },
    });
    if (!department) throw new NotFoundException('Department not found');
    if (department.companyId !== companyId) {
      throw new BadRequestException('Position department must belong to the selected company');
    }
    if (department.status !== 'ACTIVE') {
      throw new BadRequestException('Position department must be active');
    }
    if (department.division && (department.division.companyId !== companyId || department.division.deletedAt || !department.division.isActive)) {
      throw new BadRequestException('Position department division is not active for the selected company');
    }
    if (department.branch && (department.branch.deletedAt || !department.branch.isActive)) {
      throw new BadRequestException('Position department branch/location is not active');
    }
  }

  private isPositionCodeConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
    return target.includes('companyId') && target.includes('positionCode');
  }
}
