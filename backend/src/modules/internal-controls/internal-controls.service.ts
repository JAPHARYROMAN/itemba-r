import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateInternalControlDto } from './dto/create-internal-control.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class InternalControlsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, controlType, isActive, enforcementLevel } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (controlType) where.controlType = controlType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (enforcementLevel) where.enforcementLevel = enforcementLevel;
    const [data, total] = await Promise.all([
      this.prisma.internalControlRule.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.internalControlRule.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.internalControlRule.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Internal control rule not found');
    return record;
  }

  async create(dto: CreateInternalControlDto, user: any) {
    const controlCode = `CTRL-${Date.now()}`;
    const record = await this.prisma.internalControlRule.create({
      data: {
        controlCode,
        name: dto.name,
        description: dto.description,
        controlType: dto.controlType,
        enforcementLevel: dto.enforcementLevel ?? 'WARNING',
        companyId: dto.companyId,
        isActive: dto.isActive ?? true,
        entityType: dto.entityType,
        condition: dto.condition as any,
        createdById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'InternalControlRule', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateInternalControlDto>, user: any) {
    await this.findOne(id, user);
    const data: any = { ...dto };
    if (dto.condition !== undefined) data.condition = dto.condition;
    const record = await this.prisma.internalControlRule.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: dto as any });
    return record;
  }

  async activate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.internalControlRule.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: { isActive: true } });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.internalControlRule.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: { isActive: false } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.internalControlRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'InternalControlRule', entityId: id, newValue: {} });
    return { message: 'Internal control rule deleted' };
  }
}
