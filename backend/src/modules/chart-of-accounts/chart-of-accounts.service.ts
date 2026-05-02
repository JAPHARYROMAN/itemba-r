import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { QueryChartOfAccountDto } from './dto/query-chart-of-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryChartOfAccountDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, accountType, isActive, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ChartOfAccountWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        where.companyId = { in: accessibleCompanyIds };
      }
    }
    if (accountType) where.accountType = accountType;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { accountCode: { contains: search, mode: 'insensitive' } },
        { accountName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { accountCode: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.chartOfAccount.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.chartOfAccount.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        parentAccount: { select: { id: true, accountCode: true, accountName: true } },
        childAccounts: {
          where: { deletedAt: null },
          select: { id: true, accountCode: true, accountName: true },
        },
      },
    });
    if (!record) throw new NotFoundException('Chart of account not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async findByCompany(companyId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    return this.prisma.chartOfAccount.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { accountCode: 'asc' },
    });
  }

  async create(dto: CreateChartOfAccountDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertParentAccountBelongsToCompany(dto.parentAccountId, dto.companyId);

    try {
      const record = await this.prisma.chartOfAccount.create({ data: dto });
      await this.auditLogs.log({
        action: 'CHART_ACCOUNT_CREATE',
        entityType: 'ChartOfAccount',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'An account with this code or name already exists for this company',
        );
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateChartOfAccountDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const targetCompanyId = dto.companyId ?? existing.companyId;
    if (targetCompanyId !== existing.companyId) {
      await this.companyScope.assertCanAccessCompany(user, targetCompanyId, AccessLevel.WRITE);
    }
    await this.assertParentAccountBelongsToCompany(dto.parentAccountId, targetCompanyId);

    try {
      const record = await this.prisma.chartOfAccount.update({ where: { id }, data: dto });
      await this.auditLogs.log({
        action: 'CHART_ACCOUNT_UPDATE',
        entityType: 'ChartOfAccount',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
      });
      return record;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'An account with this code or name already exists for this company',
        );
      }
      throw e;
    }
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.chartOfAccount.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'CHART_ACCOUNT_DELETE',
      entityType: 'ChartOfAccount',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }

  private async assertParentAccountBelongsToCompany(
    parentAccountId: string | undefined,
    companyId: string,
  ) {
    if (!parentAccountId) return;

    const parent = await this.prisma.chartOfAccount.findFirst({
      where: { id: parentAccountId, deletedAt: null },
      select: { companyId: true },
    });
    if (!parent || parent.companyId !== companyId) {
      throw new BadRequestException('Parent account must belong to the same company');
    }
  }
}
