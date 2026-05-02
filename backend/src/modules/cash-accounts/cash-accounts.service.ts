import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
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
    const { page = 1, limit = 20, companyId, accountType, isActive } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (accountType) where.accountType = accountType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.cashAccount.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
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
      orderBy: { accountName: 'asc' },
    });
  }

  async create(dto: CreateCashAccountDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const record = await this.prisma.cashAccount.create({ data: dto });
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

    const record = await this.prisma.cashAccount.update({ where: { id }, data });
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
}
