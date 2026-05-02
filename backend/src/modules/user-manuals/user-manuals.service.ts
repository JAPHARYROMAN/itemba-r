import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class UserManualsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.userManual.create({
      data: {
        manualCode: `UM-${Date.now()}`,
        title: dto.title,
        content: dto.content ?? '',
        manualType: dto.manualType,
        moduleName: dto.moduleName,
        roleName: dto.roleName,
        version: dto.version ?? '1.0',
        status: 'DRAFT',
        createdById: userId,
      },
    });
    await this.auditLogs.log({ action: 'USER_MANUAL_CREATED', entityType: 'UserManual', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any, user: AuthUser) {
    const { page = 1, pageSize = 20, status, manualType, moduleName, roleName } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };

    const canManage = user.permissions?.includes('documentation.manage');
    if (!canManage) where.status = 'PUBLISHED';

    if (status && canManage) where.status = status;
    if (manualType) where.manualType = manualType;
    if (moduleName) where.moduleName = moduleName;
    if (roleName) where.roleName = roleName;

    const [data, total] = await Promise.all([
      this.prisma.userManual.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.userManual.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.userManual.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('User manual not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.userManual.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.manualType !== undefined && { manualType: dto.manualType }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }),
        ...(dto.roleName !== undefined && { roleName: dto.roleName }),
        ...(dto.version !== undefined && { version: dto.version }),
      },
    });
    await this.auditLogs.log({ action: 'USER_MANUAL_UPDATED', entityType: 'UserManual', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async review(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.userManual.update({
      where: { id },
      data: { status: 'REVIEWED', reviewedById: userId, reviewedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'USER_MANUAL_REVIEWED', entityType: 'UserManual', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async publish(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.userManual.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedById: userId, publishedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'USER_MANUAL_PUBLISHED', entityType: 'UserManual', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.userManual.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `USER_MANUAL_${status}`, entityType: 'UserManual', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.userManual.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'USER_MANUAL_DELETED', entityType: 'UserManual', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
