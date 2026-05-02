import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryBankAccountDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view bank accounts');
    const { page = 1, limit = 20, companyId, groupId, accountType, currency, isActive, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (groupId) where.groupId = groupId;
    if (accountType) where.accountType = accountType;
    if (currency) where.currency = currency;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { bankName: { contains: search, mode: 'insensitive' } },
        { accountName: { contains: search, mode: 'insensitive' } },
        { accountNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.bankAccount.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bankAccount.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view bank accounts');
    const record = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!record) throw new NotFoundException('Bank account not found');
    if (user) {
      await this.auditLogs.log({
        action: 'SENSITIVE_VIEW',
        entityType: 'BankAccount',
        entityId: id,
        userId: user.id,
        severity: AuditSeverity.HIGH,
        metadata: { accountNumber: record.accountNumber?.slice(-4), bankName: record.bankName } as any,
      });
    }
    return record;
  }

  async create(dto: CreateBankAccountDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'create bank accounts');
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    const record = await this.prisma.bankAccount.create({
      data: {
        ...dto,
        createdById: user.id,
        openedDate: dto.openedDate ? new Date(dto.openedDate) : undefined,
      },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'BankAccount',
      entityId: record.id,
      userId: user.id,
      severity: AuditSeverity.HIGH,
      newValue: { bankName: record.bankName, accountType: record.accountType, companyId: record.companyId } as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateBankAccountDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'update bank accounts');
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId);
    if (dto.companyId !== undefined) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    }
    const record = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...dto,
        openedDate: dto.openedDate ? new Date(dto.openedDate) : undefined,
      },
    });
    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'BankAccount',
      entityId: id,
      userId: user.id,
      severity: AuditSeverity.HIGH,
      oldValue: existing as any,
      newValue: dto as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'delete bank accounts');
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId);
    const record = await this.prisma.bankAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'DELETE',
      entityType: 'BankAccount',
      entityId: id,
      userId: user.id,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  async getSummary(user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view bank account summaries');
    const [total, active, byCompanyRaw, byCurrencyRaw, byTypeRaw] = await Promise.all([
      this.prisma.bankAccount.count({ where: { deletedAt: null } }),
      this.prisma.bankAccount.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.bankAccount.groupBy({
        by: ['companyId'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.bankAccount.groupBy({
        by: ['currency'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.bankAccount.groupBy({
        by: ['accountType'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
    ]);

    // Enrich company names
    const companyIds = byCompanyRaw
      .map((r) => r.companyId)
      .filter(Boolean) as string[];

    const companies =
      companyIds.length > 0
        ? await this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, name: true, code: true },
          })
        : [];

    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));

    const byCompany = byCompanyRaw.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyId
        ? (companyMap[r.companyId]?.name ?? 'Unknown')
        : 'Group Level',
      count: r._count.id,
    }));

    return {
      total,
      active,
      inactive: total - active,
      byCompany,
      byCurrency: byCurrencyRaw.map((r) => ({ currency: r.currency, count: r._count.id })),
      byAccountType: byTypeRaw.map((r) => ({ accountType: r.accountType, count: r._count.id })),
    };
  }
}
