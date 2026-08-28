import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity, BankAccount, CashAccountType } from '@prisma/client';
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
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      groupId,
      accountType,
      currency,
      isActive,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
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
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
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
    const record = await this.findScopedRecord(id, user);
    if (user) {
      await this.auditLogs.log({
        action: 'SENSITIVE_VIEW',
        entityType: 'BankAccount',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        severity: AuditSeverity.HIGH,
        metadata: {
          accountNumber: record.accountNumber?.slice(-4),
          bankName: record.bankName,
        } as any,
      });
    }
    return record;
  }

  private async findScopedRecord(id: string, user?: AuthUser) {
    const record = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!record) throw new NotFoundException('Bank account not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
    }
    return record;
  }

  async create(dto: CreateBankAccountDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'create bank accounts');
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    const scope = await this.assertHierarchyScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
    });
    const record = await this.prisma.bankAccount.create({
      data: {
        ...dto,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        createdById: user.id,
        openedDate: dto.openedDate ? new Date(dto.openedDate) : undefined,
      },
    });
    await this.syncReceiptCashAccount(record);
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'BankAccount',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      severity: AuditSeverity.HIGH,
      newValue: {
        bankName: record.bankName,
        accountType: record.accountType,
        companyId: record.companyId,
      } as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateBankAccountDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'update bank accounts');
    const existing = await this.findScopedRecord(id, user);
    if (dto.companyId !== undefined) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    }
    const scope = await this.assertHierarchyScope({
      companyId: dto.companyId !== undefined ? dto.companyId : existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
    });
    const record = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...dto,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        openedDate: dto.openedDate ? new Date(dto.openedDate) : undefined,
      },
    });
    await this.syncReceiptCashAccount(record);
    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'BankAccount',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      severity: AuditSeverity.HIGH,
      oldValue: existing as any,
      newValue: dto as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'delete bank accounts');
    await this.findScopedRecord(id, user);
    const record = await this.prisma.bankAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.archiveReceiptCashAccount(record.id);
    await this.auditLogs.log({
      action: 'DELETE',
      entityType: 'BankAccount',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  async getSummary(user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view bank account summaries');
    const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
    const scopedWhere =
      accessibleCompanyIds.length > 0
        ? { OR: [{ companyId: { in: accessibleCompanyIds } }, { companyId: null }] }
        : { companyId: null };
    const where = { deletedAt: null, ...scopedWhere };
    const [total, active, byCompanyRaw, byCurrencyRaw, byTypeRaw] = await Promise.all([
      this.prisma.bankAccount.count({ where }),
      this.prisma.bankAccount.count({ where: { ...where, isActive: true } }),
      this.prisma.bankAccount.groupBy({
        by: ['companyId'],
        where,
        _count: { id: true },
      }),
      this.prisma.bankAccount.groupBy({
        by: ['currency'],
        where,
        _count: { id: true },
      }),
      this.prisma.bankAccount.groupBy({
        by: ['accountType'],
        where,
        _count: { id: true },
      }),
    ]);

    // Enrich company names
    const companyIds = byCompanyRaw.map((r) => r.companyId).filter(Boolean) as string[];

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
      companyName: r.companyId ? (companyMap[r.companyId]?.name ?? 'Unknown') : 'Group Level',
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

  private async syncReceiptCashAccount(bankAccount: BankAccount) {
    if (!bankAccount.companyId || bankAccount.deletedAt) {
      await this.archiveReceiptCashAccount(bankAccount.id);
      return;
    }

    const lastFour = bankAccount.accountNumber?.slice(-4);
    const accountName = `${bankAccount.bankName} - ${bankAccount.accountName}${
      lastFour ? ` (${lastFour})` : ''
    }`;

    const existing = await this.prisma.cashAccount.findFirst({
      where: { linkedBankAccountId: bankAccount.id, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.cashAccount.update({
        where: { id: existing.id },
        data: {
          companyId: bankAccount.companyId,
          divisionId: bankAccount.divisionId,
          branchId: bankAccount.branchId,
          accountName,
          accountType: CashAccountType.BANK,
          currency: bankAccount.currency,
          isActive: bankAccount.isActive,
        },
      });
      return;
    }

    await this.prisma.cashAccount.create({
      data: {
        companyId: bankAccount.companyId,
        divisionId: bankAccount.divisionId,
        branchId: bankAccount.branchId,
        linkedBankAccountId: bankAccount.id,
        accountName,
        accountType: CashAccountType.BANK,
        currency: bankAccount.currency,
        openingBalance: 0,
        currentBalance: 0,
        isActive: bankAccount.isActive,
        notes: 'Auto-created from bank account for sales receipts and payments.',
      },
    });
  }

  private async archiveReceiptCashAccount(bankAccountId: string) {
    await this.prisma.cashAccount.updateMany({
      where: { linkedBankAccountId: bankAccountId, deletedAt: null },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  private async assertHierarchyScope(input: {
    companyId?: string | null;
    divisionId?: string | null;
    branchId?: string | null;
  }) {
    let divisionId = input.divisionId || null;
    const branchId = input.branchId || null;

    if (!input.companyId) {
      if (divisionId || branchId) {
        throw new BadRequestException(
          'Company is required when assigning division or branch scope',
        );
      }
      return { divisionId: null, branchId: null };
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== input.companyId) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (!divisionId) divisionId = branch.divisionId;
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== input.companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    return { divisionId, branchId };
  }
}
