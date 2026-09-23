import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateApprovalDelegationDto,
  UpdateApprovalDelegationDto,
} from './dto/create-approval-delegation.dto';
import {
  applyCompanyScopeWhere,
  assertCanAccessCompanyFromUser,
  isGroupScopedUser,
} from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ApprovalDelegationsQueryDto } from '../../common/dto/resource-query.dto';

@Injectable()
export class ApprovalDelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: AuthUser, query: ApprovalDelegationsQueryDto) {
    const { page = 1, limit = 20, companyId, status, search } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const scope = applyCompanyScopeWhere({}, user, companyId);
    const where: Prisma.ApprovalDelegationWhereInput = {
      deletedAt: null,
      AND: [!companyId && isGroupScopedUser(user) ? { OR: [scope, { companyId: null }] } : scope],
    };
    if (status) where.status = status as Prisma.EnumDelegationStatusFilter['equals'];
    if (search?.trim()) {
      const text = { contains: search.trim(), mode: 'insensitive' as const };
      where.OR = [
        { entityType: text },
        { reason: text },
        { delegator: { fullName: text } },
        { delegator: { email: text } },
        { delegate: { fullName: text } },
        { delegate: { email: text } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.approvalDelegation.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          delegator: { select: { id: true, fullName: true, email: true } },
          delegate: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.approvalDelegation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.approvalDelegation.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        delegator: { select: { id: true, fullName: true, email: true } },
        delegate: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!record) throw new NotFoundException('Approval delegation not found');
    assertCanAccessCompanyFromUser(user, record.companyId);
    return record;
  }

  async create(dto: CreateApprovalDelegationDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    this.validateWindow(dto.startDate, dto.endDate);
    await this.validatePeople(dto.delegatorUserId, dto.delegateUserId, dto.companyId);
    const record = await this.prisma.approvalDelegation.create({
      data: {
        delegatorUserId: dto.delegatorUserId,
        delegateUserId: dto.delegateUserId,
        companyId: dto.companyId,
        entityType: dto.entityType?.trim() || null,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason,
        status: dto.status ?? 'ACTIVE',
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ApprovalDelegation',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateApprovalDelegationDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    const companyId = dto.companyId === undefined ? existing.companyId : dto.companyId;
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);
    this.validateWindow(dto.startDate ?? existing.startDate, dto.endDate ?? existing.endDate);
    if (
      dto.delegatorUserId !== undefined ||
      dto.delegateUserId !== undefined ||
      dto.companyId !== undefined
    ) {
      await this.validatePeople(
        dto.delegatorUserId ?? existing.delegatorUserId,
        dto.delegateUserId ?? existing.delegateUserId,
        companyId,
      );
    }
    const data: Prisma.ApprovalDelegationUncheckedUpdateInput = { ...dto };
    if (dto.entityType !== undefined) data.entityType = dto.entityType?.trim() || null;
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    const record = await this.prisma.approvalDelegation.update({ where: { id }, data });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalDelegation',
      entityId: id,
      newValue: dto as any,
    });
    return record;
  }

  async cancel(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    const record = await this.prisma.approvalDelegation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalDelegation',
      entityId: id,
      newValue: { status: 'CANCELLED' },
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    await this.prisma.approvalDelegation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'ApprovalDelegation',
      entityId: id,
      newValue: {},
    });
    return { message: 'Approval delegation deleted' };
  }

  private validateWindow(start: string | Date, end: string | Date) {
    const first = new Date(start).getTime(),
      last = new Date(end).getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first)
      throw new BadRequestException('The end must be on or after the start.');
  }

  private async validatePeople(
    delegatorUserId: string,
    delegateUserId: string,
    companyId?: string | null,
  ) {
    if (delegatorUserId === delegateUserId)
      throw new BadRequestException('Choose two different people for the delegation.');
    const people = await this.prisma.user.findMany({
      where: {
        id: { in: [delegatorUserId, delegateUserId] },
        deletedAt: null,
        ...(companyId
          ? {
              OR: [
                { companyId },
                { companyAccess: { some: { companyId } } },
                { userRoles: { some: { role: { scope: 'GROUP' } } } },
              ],
            }
          : {}),
      },
      select: { id: true },
    });
    if (people.length !== 2)
      throw new BadRequestException(
        'Both people must exist and have access to the selected company.',
      );
  }
}
