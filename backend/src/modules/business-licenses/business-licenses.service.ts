import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateBusinessLicenseDto } from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';
import { RenewBusinessLicenseDto } from './dto/renew-business-license.dto';
import { AccessLevel, BusinessLicenseStatus, BusinessLicenseType } from '@prisma/client';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class BusinessLicensesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateBusinessLicenseDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.MANAGE);
    const scope = await this.resolveLicenseScope(dto.companyId, {
      divisionId: dto.divisionId,
      branchId: dto.branchId,
      licensedBusinessUnitId: dto.licensedBusinessUnitId,
    });
    const existing = await this.prisma.businessLicense.findFirst({
      where: { companyId: dto.companyId, licenseCode: dto.licenseCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('License code already exists for this company');
    const license = await this.prisma.businessLicense.create({
      data: {
        ...dto,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        licensedBusinessUnitId: scope.licensedBusinessUnitId,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'BusinessLicense', entityId: license.id, newValue: dto as unknown as Record<string, unknown> });
    return license;
  }

  async findAll(companyId?: string, divisionId?: string, branchId?: string, licensedBusinessUnitId?: string, status?: BusinessLicenseStatus, licenseType?: BusinessLicenseType, search?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (licensedBusinessUnitId) where.licensedBusinessUnitId = licensedBusinessUnitId;
    if (status) where.status = status;
    if (licenseType) where.licenseType = licenseType;
    if (search) where.OR = [
      { licenseCode: { contains: search, mode: 'insensitive' } },
      { licenseNumber: { contains: search, mode: 'insensitive' } },
      { issuingAuthority: { contains: search, mode: 'insensitive' } },
    ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.businessLicense.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          licensedBusinessUnit: { select: { id: true, name: true, businessUnitCode: true } },
        },
      }),
      this.prisma.businessLicense.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const license = await this.prisma.businessLicense.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        licensedBusinessUnit: { select: { id: true, name: true, businessUnitCode: true } },
      },
    });
    if (!license) throw new NotFoundException('Business license not found');
    return license;
  }

  async findExpiring(companyId?: string, daysAhead = 30, user?: any) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    const where: any = {
      deletedAt: null,
      status: { not: BusinessLicenseStatus.CANCELLED },
      expiryDate: { lte: cutoff, gte: new Date() },
    };
    applyCompanyScopeWhere(where, user, companyId);
    return this.prisma.businessLicense.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      include: {
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        licensedBusinessUnit: { select: { id: true, name: true, businessUnitCode: true } },
      },
    });
  }

  async update(id: string, dto: UpdateBusinessLicenseDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Business license companyId is immutable after creation');
    }
    const scope = await this.resolveLicenseScope(existing.companyId, {
      divisionId: dto.divisionId ?? existing.divisionId ?? undefined,
      branchId: dto.branchId ?? existing.branchId ?? undefined,
      licensedBusinessUnitId: dto.licensedBusinessUnitId ?? existing.licensedBusinessUnitId ?? undefined,
    });
    const license = await this.prisma.businessLicense.update({
      where: { id },
      data: {
        ...dto,
        companyId: existing.companyId,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        licensedBusinessUnitId: scope.licensedBusinessUnitId,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'BusinessLicense', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return license;
  }

  async renew(id: string, dto: RenewBusinessLicenseDto, user: AuthUser) {
    const old = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, old.companyId, AccessLevel.MANAGE);
    const license = await this.prisma.businessLicense.update({
      where: { id },
      data: {
        expiryDate: new Date(dto.newExpiryDate),
        renewalDate: new Date(dto.newRenewalDate),
        status: BusinessLicenseStatus.ACTIVE,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'RENEW',
      entityType: 'BusinessLicense',
      entityId: id,
      oldValue: { expiryDate: old.expiryDate, renewalDate: old.renewalDate, status: old.status } as unknown as Record<string, unknown>,
      newValue: { expiryDate: dto.newExpiryDate, renewalDate: dto.newRenewalDate, status: BusinessLicenseStatus.ACTIVE } as unknown as Record<string, unknown>,
    });
    return license;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    await this.prisma.businessLicense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'BusinessLicense', entityId: id, newValue: {} });
    return { message: 'Business license deleted' };
  }

  private async resolveLicenseScope(
    companyId: string,
    refs: { divisionId?: string; branchId?: string; licensedBusinessUnitId?: string },
  ) {
    let divisionId = refs.divisionId;
    let branchId = refs.branchId;
    let licensedBusinessUnitId = refs.licensedBusinessUnitId;

    if (licensedBusinessUnitId) {
      const unit = await this.prisma.licensedBusinessUnit.findFirst({
        where: { id: licensedBusinessUnitId, companyId, deletedAt: null },
        select: { id: true, divisionId: true, branchId: true },
      });
      if (!unit) throw new BadRequestException('Licensed business unit must belong to this company');
      divisionId = divisionId ?? unit.divisionId ?? undefined;
      branchId = branchId ?? unit.branchId ?? undefined;
    }

    if (!branchId) {
      throw new BadRequestException('Business license must be assigned to a branch/location');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true, divisionId: true, division: { select: { companyId: true } } },
    });
    if (!branch || branch.division.companyId !== companyId) {
      throw new BadRequestException('Business license branch must belong to this company');
    }
    if (divisionId && divisionId !== branch.divisionId) {
      throw new BadRequestException('Business license branch must belong to the selected division');
    }
    divisionId = branch.divisionId;

    if (licensedBusinessUnitId) {
      const unit = await this.prisma.licensedBusinessUnit.findFirst({
        where: { id: licensedBusinessUnitId, deletedAt: null },
        select: { branchId: true },
      });
      if (unit?.branchId && unit.branchId !== branchId) {
        throw new BadRequestException('Business license branch must match the licensed business unit branch');
      }
    }

    return { divisionId, branchId, licensedBusinessUnitId };
  }
}
