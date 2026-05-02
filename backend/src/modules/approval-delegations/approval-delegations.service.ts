import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalDelegationDto } from './dto/create-approval-delegation.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ApprovalDelegationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.approvalDelegation.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          delegator: { select: { id: true, fullName: true, email: true } },
          delegate: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.approvalDelegation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.approvalDelegation.findFirst({
      where: { id, deletedAt: null },
      include: {
        delegator: { select: { id: true, fullName: true, email: true } },
        delegate: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!record) throw new NotFoundException('Approval delegation not found');
    return record;
  }

  async create(dto: CreateApprovalDelegationDto, user: any) {
    const record = await this.prisma.approvalDelegation.create({
      data: {
        delegatorUserId: dto.delegatorUserId,
        delegateUserId: dto.delegateUserId,
        companyId: dto.companyId,
        entityType: dto.entityType,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason,
        status: dto.status ?? 'ACTIVE',
        createdById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ApprovalDelegation', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateApprovalDelegationDto>, user: any) {
    await this.findOne(id, user);
    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    const record = await this.prisma.approvalDelegation.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalDelegation', entityId: id, newValue: dto as any });
    return record;
  }

  async cancel(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalDelegation.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalDelegation', entityId: id, newValue: { status: 'CANCELLED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.approvalDelegation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ApprovalDelegation', entityId: id, newValue: {} });
    return { message: 'Approval delegation deleted' };
  }
}
