import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { UpsertCompanyProfileDto } from './dto/upsert-company-profile.dto';
import { Prisma } from '@prisma/client';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
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
          group: { select: { id: true, name: true, code: true } },
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
        group: { select: { id: true, name: true, code: true } },
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
    return this.prisma.company.create({ data: dto });
  }

  async update(id: string, dto: UpdateCompanyDto, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.MANAGE);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.MANAGE);
    return this.prisma.company.update({ where: { id }, data: { deletedAt: new Date() } });
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
