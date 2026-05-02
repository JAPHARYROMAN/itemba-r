import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class ContactPersonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { companyId, entityType, entityId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [items, total] = await Promise.all([
      this.prisma.contactPerson.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.contactPerson.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.contactPerson.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Contact person not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.contactPerson.create({ data: { ...dto, createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ContactPerson', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.contactPerson.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'ContactPerson', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.contactPerson.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'ContactPerson', entityId: id, userId: user.id });
    return { success: true };
  }
}
