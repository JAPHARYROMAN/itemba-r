import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateBusinessLicenseDto } from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';
import { RenewBusinessLicenseDto } from './dto/renew-business-license.dto';
import { BusinessLicenseStatus, BusinessLicenseType } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class BusinessLicensesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateBusinessLicenseDto, userId: string) {
    const existing = await this.prisma.businessLicense.findFirst({
      where: { companyId: dto.companyId, licenseCode: dto.licenseCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('License code already exists for this company');
    const license = await this.prisma.businessLicense.create({
      data: {
        ...dto,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'BusinessLicense', entityId: license.id, newValue: dto as unknown as Record<string, unknown> });
    return license;
  }

  async findAll(companyId?: string, divisionId?: string, licensedBusinessUnitId?: string, status?: BusinessLicenseStatus, licenseType?: BusinessLicenseType, search?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
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
        licensedBusinessUnit: { select: { id: true, name: true, businessUnitCode: true } },
      },
    });
  }

  async update(id: string, dto: UpdateBusinessLicenseDto, userId: string) {
    await this.findOne(id);
    const license = await this.prisma.businessLicense.update({
      where: { id },
      data: {
        ...dto,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'BusinessLicense', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return license;
  }

  async renew(id: string, dto: RenewBusinessLicenseDto, userId: string) {
    const old = await this.findOne(id);
    const license = await this.prisma.businessLicense.update({
      where: { id },
      data: {
        expiryDate: new Date(dto.newExpiryDate),
        renewalDate: new Date(dto.newRenewalDate),
        status: BusinessLicenseStatus.ACTIVE,
      },
    });
    await this.audit.log({
      userId,
      action: 'RENEW',
      entityType: 'BusinessLicense',
      entityId: id,
      oldValue: { expiryDate: old.expiryDate, renewalDate: old.renewalDate, status: old.status } as unknown as Record<string, unknown>,
      newValue: { expiryDate: dto.newExpiryDate, renewalDate: dto.newRenewalDate, status: BusinessLicenseStatus.ACTIVE } as unknown as Record<string, unknown>,
    });
    return license;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.businessLicense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'BusinessLicense', entityId: id, newValue: {} });
    return { message: 'Business license deleted' };
  }
}
