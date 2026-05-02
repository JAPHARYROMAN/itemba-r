import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class CustomerSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    const [items, total] = await Promise.all([
      this.prisma.customerSegment.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { memberships: true } }),
      this.prisma.customerSegment.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.customerSegment.findFirst({ where: { id, deletedAt: null }, include: { memberships: true } });
    if (!item) throw new NotFoundException('Customer segment not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.customerSegment.create({ data: { ...dto, createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'CustomerSegment', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.customerSegment.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CustomerSegment', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.customerSegment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'CustomerSegment', entityId: id, userId: user.id });
    return { success: true };
  }

  async addMember(segmentId: string, dto: any, user: any) {
    await this.findOne(segmentId);
    const membership = await this.prisma.customerSegmentMembership.upsert({
      where: { customerSegmentId_customerId: { customerSegmentId: segmentId, customerId: dto.customerId } },
      create: { customerSegmentId: segmentId, customerId: dto.customerId, assignedById: user.id },
      update: {},
    });
    await this.auditLogs.log({ action: 'ADD_MEMBER', entityType: 'CustomerSegment', entityId: segmentId, userId: user.id });
    return membership;
  }

  async removeMember(segmentId: string, customerId: string, user: any) {
    await this.findOne(segmentId);
    await this.prisma.customerSegmentMembership.deleteMany({ where: { customerSegmentId: segmentId, customerId } });
    await this.auditLogs.log({ action: 'REMOVE_MEMBER', entityType: 'CustomerSegment', entityId: segmentId, userId: user.id });
    return { success: true };
  }
}
