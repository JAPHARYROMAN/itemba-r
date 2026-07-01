import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateInternalControlDto } from './dto/create-internal-control.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class InternalControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
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

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.internalControlRule.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Internal control rule not found');
    // Company-scope the by-id read so mutations built on findOne cannot reach
    // another company's rule (a null companyId is a group-level rule and
    // assertCanAccessCompany requires a group-scoped user for it).
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateInternalControlDto, user: AuthUser) {
    // Never trust a client-supplied companyId for authorization: validate it
    // against the caller's access (WRITE) before planting a rule under it.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
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

  async update(id: string, dto: Partial<CreateInternalControlDto>, user: AuthUser) {
    // WRITE access required; also proves the rule belongs to a company the
    // caller can reach before we mutate it.
    await this.findOne(id, user, AccessLevel.WRITE);
    // Whitelist mutable fields only — never spread the raw dto into the update,
    // and treat companyId as immutable (no cross-company reassignment).
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.controlType !== undefined) data.controlType = dto.controlType;
    if (dto.enforcementLevel !== undefined) data.enforcementLevel = dto.enforcementLevel;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.entityType !== undefined) data.entityType = dto.entityType;
    if (dto.condition !== undefined) data.condition = dto.condition as any;
    const record = await this.prisma.internalControlRule.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: data });
    return record;
  }

  async activate(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.internalControlRule.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: { isActive: true } });
    return record;
  }

  async deactivate(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.internalControlRule.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'InternalControlRule', entityId: id, newValue: { isActive: false } });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.MANAGE);
    await this.prisma.internalControlRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'InternalControlRule', entityId: id, newValue: {} });
    return { message: 'Internal control rule deleted' };
  }
}
