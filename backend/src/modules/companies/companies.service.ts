import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { UpsertCompanyProfileDto } from './dto/upsert-company-profile.dto';
import { AuditSeverity, Prisma } from '@prisma/client';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, PermissionCacheService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  async findAll(query: QueryCompanyDto, user: AuthUser) {
    const page = parseInt(query.page ?? '1');
    const limit = Math.min(parseInt(query.limit ?? '20'), 100);
    const skip = (page - 1) * limit;
    const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);

    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      ...(accessibleCompanyIds && { id: { in: accessibleCompanyIds } }),
      ...(query.status && { status: query.status }),
      ...(query.industryType && {
        industryType: { contains: query.industryType, mode: 'insensitive' },
      }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
          { industryType: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          group: {
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
              phone: true,
              email: true,
              website: true,
            },
          },
          profile: {
            select: {
              registeredName: true,
              tradingName: true,
              brelaRegNumber: true,
              tin: true,
              incorporationDate: true,
              status: true,
            },
          },
          _count: {
            select: {
              divisions: true,
              bankAccounts: true,
              loans: true,
              contracts: true,
              fixedAssets: true,
            },
          },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            phone: true,
            email: true,
            website: true,
          },
        },
        profile: true,
        divisions: {
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { branches: true } },
            branches: {
              where: { deletedAt: null },
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                code: true,
                type: true,
                location: true,
                address: true,
                phone: true,
                isActive: true,
              },
            },
          },
        },
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, title: true, mimeType: true, createdAt: true, ownerType: true },
        },
        _count: {
          select: {
            divisions: true,
            bankAccounts: true,
            loans: true,
            debts: true,
            contracts: true,
            fixedAssets: true,
          },
        },
      },
    });

    if (!company) throw new NotFoundException(`Company ${id} not found`);
    if (user) await this.companyScope.assertCanAccessCompany(user, company.id, minimum);
    return company;
  }

  async create(dto: CreateCompanyDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'create companies');
    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: dto });
      await tx.userCompanyAccess.upsert({
        where: { userId_companyId: { userId: user.id, companyId: created.id } },
        update: { accessLevel: AccessLevel.MANAGE, grantedById: user.id },
        create: {
          userId: user.id,
          companyId: created.id,
          accessLevel: AccessLevel.MANAGE,
          grantedById: user.id,
        },
      });
      return created;
    });
    await this.permissionCache.invalidate(user.id);
    await this.auditLogs.log({
      action: 'COMPANY_CREATED',
      entityType: 'Company',
      entityId: company.id,
      userId: user.id,
      companyId: company.id,
      severity: AuditSeverity.HIGH,
      newValue: { name: company.name, code: company.code, status: company.status } as any,
    });
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.MANAGE);
    const company = await this.prisma.company.update({ where: { id }, data: dto });
    await this.auditLogs.log({
      action: 'COMPANY_UPDATED',
      entityType: 'Company',
      entityId: id,
      userId: user.id,
      companyId: id,
      severity: AuditSeverity.HIGH,
      oldValue: {
        name: existing.name,
        code: existing.code,
        status: existing.status,
        industryType: existing.industryType,
      } as any,
      newValue: dto as any,
    });
    return company;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.MANAGE);
    const now = new Date();
    const [, , company] = await this.prisma.$transaction([
      this.prisma.branch.updateMany({
        where: { deletedAt: null, division: { companyId: id } },
        data: { deletedAt: now, isActive: false },
      }),
      this.prisma.division.updateMany({
        where: { companyId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      }),
      this.prisma.company.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.auditLogs.log({
      action: 'COMPANY_DELETED',
      entityType: 'Company',
      entityId: id,
      userId: user.id,
      companyId: id,
      severity: AuditSeverity.HIGH,
      oldValue: {
        name: existing.name,
        code: existing.code,
        status: existing.status,
      } as any,
    });
    return company;
  }

  // ── Legal Profile ──────────────────────────────────────────────────────────

  async getProfile(companyId: string, user: AuthUser) {
    await this.findOne(companyId, user);
    return this.prisma.companyProfile.findUnique({ where: { companyId } });
  }

  async upsertProfile(companyId: string, dto: UpsertCompanyProfileDto, user: AuthUser) {
    await this.findOne(companyId, user, AccessLevel.MANAGE);
    const data = {
      ...dto,
      incorporationDate: dto.incorporationDate ? new Date(dto.incorporationDate) : undefined,
      authorizedCapital: dto.authorizedCapital ? parseFloat(dto.authorizedCapital) : undefined,
    };
    return this.prisma.companyProfile.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }
}
