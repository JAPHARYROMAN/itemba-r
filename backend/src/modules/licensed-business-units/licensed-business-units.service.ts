import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateLicensedBusinessUnitDto } from './dto/create-licensed-business-unit.dto';
import { UpdateLicensedBusinessUnitDto } from './dto/update-licensed-business-unit.dto';
import { AccessLevel, BusinessUnitStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class LicensedBusinessUnitsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateLicensedBusinessUnitDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.MANAGE);
    const existing = await this.prisma.licensedBusinessUnit.findFirst({
      where: { companyId: dto.companyId, businessUnitCode: dto.businessUnitCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Business unit code already exists for this company');
    const lbu = await this.prisma.licensedBusinessUnit.create({
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'LicensedBusinessUnit', entityId: lbu.id, newValue: dto as unknown as Record<string, unknown> });
    return lbu;
  }

  async findAll(user: AuthUser, companyId?: string, divisionId?: string, status?: BusinessUnitStatus, search?: string, page = 1, limit = 20) {
    if (companyId) await this.companyScope.assertCanAccessCompany(user, companyId);
    const accessibleCompanyIds = companyId ? null : await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.LicensedBusinessUnitWhereInput = {
      deletedAt: null,
      ...(accessibleCompanyIds && { companyId: { in: accessibleCompanyIds } }),
    };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (status) where.status = status;
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { tradingName: { contains: search, mode: 'insensitive' } },
      { businessUnitCode: { contains: search, mode: 'insensitive' } },
    ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.licensedBusinessUnit.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true } },
          manager: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.licensedBusinessUnit.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const lbu = await this.prisma.licensedBusinessUnit.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true } },
        manager: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!lbu) throw new NotFoundException('Licensed business unit not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, lbu.companyId, minimum);
    return lbu;
  }

  async update(id: string, dto: UpdateLicensedBusinessUnitDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.MANAGE);
    if (dto.companyId && dto.companyId !== existing.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.MANAGE);
    }
    const lbu = await this.prisma.licensedBusinessUnit.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'LicensedBusinessUnit', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return lbu;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.MANAGE);
    await this.prisma.licensedBusinessUnit.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'LicensedBusinessUnit', entityId: id, newValue: {} });
    return { message: 'Licensed business unit deleted' };
  }
}
