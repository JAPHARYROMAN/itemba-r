import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { QueryContractDto } from './dto/query-contract.dto';
import { ChangeContractStatusDto } from './dto/change-contract-status.dto';
import { AccessLevel, ContractOwnershipLevel, ContractStatus, Prisma } from '@prisma/client';

const CONTRACT_INCLUDE = {
  company: { select: { id: true, name: true, code: true } },
  group: { select: { id: true, name: true, code: true } },
  documents: { where: { deletedAt: null }, select: { id: true, title: true, fileName: true, mimeType: true, createdAt: true } },
} as const;

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async findAll(query: QueryContractDto, user: AuthUser) {
    const {
      page = 1, limit = 20, companyId, groupId, owningLevel,
      status, contractType, riskLevel, expiringBefore, search,
    } = query;
    const skip = (page - 1) * limit;

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.ContractWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (groupId) where.groupId = groupId;
    if (owningLevel) where.owningLevel = owningLevel;
    if (status) where.status = status;
    if (contractType) where.contractType = contractType;
    if (riskLevel) where.riskLevel = riskLevel;
    if (expiringBefore) where.endDate = { lte: new Date(expiringBefore) };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { contractNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          group: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  async findOne(id: string, user?: AuthUser, ipAddress?: string) {
    const record = await this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: CONTRACT_INCLUDE,
    });
    if (!record) throw new NotFoundException('Contract not found');

    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
      await this.auditLogs.log({
        action: 'SENSITIVE_ACCESS',
        entityType: 'Contract',
        entityId: id,
        userId: user.id,
        companyId: record.companyId ?? undefined,
        ipAddress,
        metadata: { title: record.title, contractType: record.contractType, isSensitive: record.isSensitive },
      });
    }

    return record;
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(dto: CreateContractDto, user: AuthUser, ipAddress?: string) {
    const { value, startDate, endDate, renewalDate, renewalNoticeDate, owningLevel, ...rest } = dto;

    if (owningLevel === ContractOwnershipLevel.COMPANY && !rest.companyId) {
      throw new BadRequestException('companyId is required when owningLevel is COMPANY');
    }
    if (owningLevel === ContractOwnershipLevel.GROUP && !rest.groupId) {
      throw new BadRequestException('groupId is required when owningLevel is GROUP');
    }
    await this.companyScope.assertCanAccessCompany(user, rest.companyId, AccessLevel.WRITE);
    const userId = user.id;

    const record = await this.prisma.contract.create({
      data: {
        ...rest,
        owningLevel,
        value: value ? parseFloat(value) : undefined,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : undefined,
        renewalDate: renewalDate ? new Date(renewalDate) : undefined,
        renewalNoticeDate: renewalNoticeDate ? new Date(renewalNoticeDate) : undefined,
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'Contract',
      entityId: record.id,
      userId,
      companyId: record.companyId ?? undefined,
      ipAddress,
      metadata: { title: record.title, contractType: record.contractType, owningLevel },
    });

    return record;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateContractDto, user: AuthUser, ipAddress?: string) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const { value, startDate, endDate, renewalDate, renewalNoticeDate, ...rest } = dto;

    const record = await this.prisma.contract.update({
      where: { id },
      data: {
        ...rest,
        ...(value !== undefined && { value: parseFloat(value) }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(renewalDate && { renewalDate: new Date(renewalDate) }),
        ...(renewalNoticeDate && { renewalNoticeDate: new Date(renewalNoticeDate) }),
      },
    });

    await this.auditLogs.log({
      action: 'UPDATE',
      entityType: 'Contract',
      entityId: id,
      userId,
      companyId: record.companyId ?? undefined,
      ipAddress,
      metadata: { changes: Object.keys(dto) },
    });

    return record;
  }

  // ─── Change status ─────────────────────────────────────────────────────────

  async changeStatus(id: string, dto: ChangeContractStatusDto, user: AuthUser, ipAddress?: string) {
    const contract = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, contract.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const previous = contract.status;

    const record = await this.prisma.contract.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.notes && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'STATUS_CHANGE',
      entityType: 'Contract',
      entityId: id,
      userId,
      companyId: record.companyId ?? undefined,
      ipAddress,
      metadata: { previous, next: dto.status, notes: dto.notes },
    });

    return record;
  }

  // ─── Soft delete ───────────────────────────────────────────────────────────

  async remove(id: string, user: AuthUser, ipAddress?: string) {
    const contract = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, contract.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'DELETE',
      entityType: 'Contract',
      entityId: id,
      userId,
      companyId: contract.companyId ?? undefined,
      ipAddress,
      metadata: { title: contract.title },
    });

    return { success: true };
  }

  // ─── Expiring soon ─────────────────────────────────────────────────────────

  async getExpiring(user: AuthUser, days = 60) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);

    const data = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: ContractStatus.ACTIVE,
        endDate: { gte: new Date(), lte: cutoff },
        ...(accessibleIds === null ? {} : { companyId: { in: accessibleIds } }),
      },
      include: {
        company: { select: { id: true, name: true, code: true } },
        group: { select: { id: true, name: true, code: true } },
      },
      orderBy: { endDate: 'asc' },
    });

    return data;
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  async getSummary(user: AuthUser, companyId?: string) {
    const base: Prisma.ContractWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      base.companyId = companyId;
    } else {
      const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleIds !== null) base.companyId = { in: accessibleIds };
    }

    const now = new Date();
    const in60Days = new Date();
    in60Days.setDate(now.getDate() + 60);

    const [
      total,
      active,
      draft,
      pendingApproval,
      expired,
      expiringSoon,
      highRisk,
      byType,
      byCompany,
    ] = await Promise.all([
      this.prisma.contract.count({ where: base }),
      this.prisma.contract.count({ where: { ...base, status: ContractStatus.ACTIVE } }),
      this.prisma.contract.count({ where: { ...base, status: ContractStatus.DRAFT } }),
      this.prisma.contract.count({ where: { ...base, status: ContractStatus.PENDING_APPROVAL } }),
      this.prisma.contract.count({ where: { ...base, status: ContractStatus.EXPIRED } }),
      this.prisma.contract.count({
        where: { ...base, status: ContractStatus.ACTIVE, endDate: { gte: now, lte: in60Days } },
      }),
      this.prisma.contract.count({ where: { ...base, riskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
      this.prisma.contract.groupBy({ by: ['contractType'], where: base, _count: { id: true } }),
      companyId
        ? null
        : this.prisma.contract.groupBy({ by: ['companyId'], where: base, _count: { id: true } }),
    ]);

    const totalValueResult = await this.prisma.contract.aggregate({
      where: { ...base, status: ContractStatus.ACTIVE },
      _sum: { value: true },
    });

    return {
      total,
      active,
      draft,
      pendingApproval,
      expired,
      expiringSoon,
      highRisk,
      totalActiveValue: totalValueResult._sum.value ?? 0,
      byType: byType.map((r) => ({ contractType: r.contractType, count: r._count.id })),
      byCompany: byCompany?.map((r) => ({ companyId: r.companyId, count: r._count.id })) ?? [],
    };
  }

  // ─── Audit trail ───────────────────────────────────────────────────────────

  async getAuditHistory(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Contract', entityId: id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
