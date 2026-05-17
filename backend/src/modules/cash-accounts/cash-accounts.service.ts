import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, CashAccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateCashAccountDto } from './dto/create-cash-account.dto';
import { UpdateCashAccountDto } from './dto/update-cash-account.dto';
import { QueryCashAccountDto } from './dto/query-cash-account.dto';

@Injectable()
export class CashAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryCashAccountDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, divisionId, branchId, accountType, isActive } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (accountType) where.accountType = accountType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.cashAccount.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          linkedBank: { select: { id: true, bankName: true, accountName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.cashAccount.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.cashAccount.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        linkedBank: { select: { id: true, bankName: true, accountName: true } },
      },
    });
    if (!record) throw new NotFoundException('Cash account not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async findByCompany(companyId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    return this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null },
      include: {
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { accountName: 'asc' },
    });
  }

  async create(dto: CreateCashAccountDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertCashAccountScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      accountType: dto.accountType ?? CashAccountType.CASH_ON_HAND,
      linkedBankAccountId: dto.linkedBankAccountId || null,
    });
    const record = await this.prisma.cashAccount.create({
      data: {
        ...dto,
        divisionId: dto.divisionId || null,
        branchId: dto.branchId || null,
        linkedBankAccountId: dto.linkedBankAccountId || null,
      },
    });
    await this.auditLogs.log({
      action: 'CASH_ACCOUNT_CREATE',
      entityType: 'CashAccount',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateCashAccountDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const { companyId, ...data } = dto;
    if (companyId !== undefined && companyId !== existing.companyId) {
      throw new BadRequestException('Cash account company cannot be changed');
    }
    await this.assertCashAccountScope({
      companyId: existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      accountType: dto.accountType ?? existing.accountType,
      linkedBankAccountId:
        dto.linkedBankAccountId !== undefined
          ? dto.linkedBankAccountId || null
          : existing.linkedBankAccountId || null,
    });

    const record = await this.prisma.cashAccount.update({
      where: { id },
      data: {
        ...data,
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId || null }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId || null }),
        ...(dto.linkedBankAccountId !== undefined && {
          linkedBankAccountId: dto.linkedBankAccountId || null,
        }),
      },
    });
    await this.auditLogs.log({
      action: 'CASH_ACCOUNT_UPDATE',
      entityType: 'CashAccount',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.cashAccount.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'CASH_ACCOUNT_DELETE',
      entityType: 'CashAccount',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }

  private async assertCashAccountScope(input: {
    companyId: string;
    divisionId?: string | null;
    branchId?: string | null;
    accountType?: CashAccountType | null;
    linkedBankAccountId?: string | null;
  }) {
    if (input.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: input.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== input.companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (input.branchId) {
      if (!input.divisionId) {
        throw new BadRequestException('Division is required when branch/location is selected');
      }
      const branch = await this.prisma.branch.findFirst({
        where: { id: input.branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== input.companyId) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (input.divisionId && branch.divisionId !== input.divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    const accountType = input.accountType ?? CashAccountType.CASH_ON_HAND;
    if (accountType !== CashAccountType.BANK && (!input.divisionId || !input.branchId)) {
      throw new BadRequestException(
        'Division and branch/location are required for branch-audited cash accounts',
      );
    }

    if (input.linkedBankAccountId) {
      if (accountType !== CashAccountType.BANK) {
        throw new BadRequestException('Only bank cash accounts can link a bank account');
      }

      const bankAccount = await this.prisma.bankAccount.findFirst({
        where: { id: input.linkedBankAccountId, deletedAt: null },
        select: { companyId: true },
      });
      if (!bankAccount || bankAccount.companyId !== input.companyId) {
        throw new BadRequestException('Linked bank account does not belong to this company');
      }
    }
  }
}
