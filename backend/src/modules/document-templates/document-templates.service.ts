import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, templateType, isActive, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (templateType) where.templateType = templateType;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
    const [items, total] = await Promise.all([
      this.prisma.documentTemplate.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.documentTemplate.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.documentTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Document template not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: any) {
    const { companyId, ...rest } = dto;
    await this.companyScope.assertCanAccessCompany(user, companyId ?? null, AccessLevel.WRITE);
    const item = await this.prisma.documentTemplate.create({ data: { ...rest, status: 'ACTIVE' as any, createdById: user.id, ...(companyId ? { companyId } : {}) } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'DocumentTemplate', entityId: item.id, userId: user.id, companyId: item.companyId ?? undefined });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId ?? null, AccessLevel.WRITE);
    }
    const updated = await this.prisma.documentTemplate.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'DocumentTemplate', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.documentTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'DocumentTemplate', entityId: id, userId: user.id });
    return { success: true };
  }

  async setActive(id: string, isActive: boolean, user: any) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
    const updated = await this.prisma.documentTemplate.update({ where: { id }, data: { status: newStatus as any } });
    await this.auditLogs.log({ action: isActive ? 'ACTIVATE' : 'DEACTIVATE', entityType: 'DocumentTemplate', entityId: id, userId: user.id });
    return updated;
  }
}
