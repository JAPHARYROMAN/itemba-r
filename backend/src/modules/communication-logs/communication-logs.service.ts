import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateCommunicationLogDto } from './dto/create-communication-log.dto';
import { UpdateCommunicationLogDto } from './dto/update-communication-log.dto';

@Injectable()
export class CommunicationLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, entityType, entityId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [data, total] = await Promise.all([
      this.prisma.communicationLog.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.communicationLog.count({ where }),
    ]);
    // Standard pagination envelope: the rest of the codebase (customers,
    // price-lists, etc.) and the CRM frontend read `data`, not `items`.
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.communicationLog.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Communication log not found');
    return item;
  }

  async create(dto: CreateCommunicationLogDto, user: any) {
    // `communicationNumber` is a required, globally-unique column with no DB
    // default. Generate it server-side via the shared code generator (like
    // credit-notes/customer-payments) so the insert satisfies the constraint.
    const communicationNumber = await this.codes.next({
      entityType: 'CommunicationLog',
      companyId: dto.companyId,
    });
    const item = await this.prisma.communicationLog.create({
      data: {
        communicationNumber,
        companyId: dto.companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        communicationType: dto.communicationType,
        ...(dto.direction !== undefined ? { direction: dto.direction } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        summary: dto.summary,
        ...(dto.communicationDate !== undefined
          ? { communicationDate: new Date(dto.communicationDate) }
          : {}),
        ...(dto.followUpRequired !== undefined ? { followUpRequired: dto.followUpRequired } : {}),
        ...(dto.followUpDate !== undefined
          ? { followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null }
          : {}),
        ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
        status: 'OPEN',
        createdById: user.id,
      },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'CommunicationLog', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: UpdateCommunicationLogDto, user: any) {
    const existing = await this.findOne(id);
    const data: Prisma.CommunicationLogUpdateInput = {};
    if (dto.communicationType !== undefined) data.communicationType = dto.communicationType;
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.communicationDate !== undefined) data.communicationDate = new Date(dto.communicationDate);
    if (dto.followUpRequired !== undefined) data.followUpRequired = dto.followUpRequired;
    if (dto.followUpDate !== undefined) data.followUpDate = dto.followUpDate ? new Date(dto.followUpDate) : null;
    if (dto.assignedToId !== undefined) {
      data.assignedTo = dto.assignedToId ? { connect: { id: dto.assignedToId } } : { disconnect: true };
    }
    if (dto.status !== undefined) data.status = dto.status;
    const updated = await this.prisma.communicationLog.update({ where: { id }, data });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CommunicationLog', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async close(id: string, user: any) {
    await this.findOne(id);
    const updated = await this.prisma.communicationLog.update({ where: { id }, data: { status: 'CLOSED' as any } });
    await this.auditLogs.log({ action: 'CLOSE', entityType: 'CommunicationLog', entityId: id, userId: user.id });
    return updated;
  }
}
