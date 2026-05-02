import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditSeverity, OfflineSyncBatchStatus, OfflineSyncDirection, OfflineSyncRecordStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSyncBatchDto } from './dto/create-sync-batch.dto';
import { QuerySyncBatchDto } from './dto/query-sync-batch.dto';
import { QuerySyncConflictDto } from './dto/query-sync-conflict.dto';
import { UpsertCheckpointDto } from './dto/upsert-checkpoint.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';
import { OfflineSyncControlService } from './offline-sync-control.service';

@Injectable()
export class OfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly offlineSyncControl: OfflineSyncControlService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAllBatches(query: QuerySyncBatchDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, userId, deviceId } = query;
    const skip = (page - 1) * limit;
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.OfflineSyncBatchWhereInput = {};
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (userId) where.userId = userId;
    if (deviceId) where.deviceId = deviceId;

    const [data, total] = await Promise.all([
      this.prisma.offlineSyncBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.offlineSyncBatch.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneBatch(id: string, user: AuthUser) {
    const batch = await this.prisma.offlineSyncBatch.findFirst({
      where: { id },
      include: { records: true },
    });
    if (!batch) throw new NotFoundException('Sync batch not found');
    await this.companyScope.assertCanAccessCompany(user, batch.companyId);
    return batch;
  }

  async createBatch(dto: CreateSyncBatchDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    const userId = user.id;
    const existing = await this.prisma.offlineSyncBatch.findFirst({
      where: { clientBatchId: dto.clientBatchId },
    });
    if (existing) throw new BadRequestException(`Batch with clientBatchId "${dto.clientBatchId}" already exists`);

    const batchNumber = `SYNC-${Date.now().toString(36).toUpperCase()}`;

    const batch = await this.prisma.offlineSyncBatch.create({
      data: {
        batchNumber,
        clientBatchId: dto.clientBatchId,
        userId,
        deviceId: dto.deviceId,
        companyId: dto.companyId,
        syncDirection: dto.syncDirection ?? OfflineSyncDirection.UPLOAD,
        status: OfflineSyncBatchStatus.RECEIVED,
        recordCount: dto.records.length,
        records: {
          create: dto.records.map((r) => ({
            clientRecordId: r.clientRecordId,
            entityType: r.entityType,
            operation: r.operation,
            payload: r.payload as any,
            clientUpdatedAt: r.clientUpdatedAt ? new Date(r.clientUpdatedAt) : undefined,
            status: OfflineSyncRecordStatus.PENDING,
          })),
        },
      },
      include: { records: { select: { id: true, clientRecordId: true, entityType: true, operation: true, status: true } } },
    });

    await this.auditLogs.log({
      action: 'SYNC_BATCH_CREATED',
      entityType: 'OfflineSyncBatch',
      entityId: batch.id,
      userId,
      companyId: dto.companyId,
      severity: AuditSeverity.LOW,
    });

    return batch;
  }

  async findCheckpoints(userId: string, deviceId?: string) {
    const where: any = { userId };
    if (deviceId) where.deviceId = deviceId;
    return this.prisma.syncCheckpoint.findMany({ where });
  }

  async upsertCheckpoint(dto: UpsertCheckpointDto, userId: string) {
    // Prisma compound unique with nullable field — find-then-upsert pattern
    const existing = await this.prisma.syncCheckpoint.findFirst({
      where: { userId, deviceId: dto.deviceId ?? null, entityType: dto.entityType },
    });

    if (existing) {
      return this.prisma.syncCheckpoint.update({
        where: { id: existing.id },
        data: {
          lastSyncAt: new Date(dto.lastSyncAt),
          lastServerCursor: dto.lastServerCursor,
          metadata: dto.metadata as any,
        },
      });
    }

    return this.prisma.syncCheckpoint.create({
      data: {
        userId,
        deviceId: dto.deviceId,
        companyId: dto.companyId,
        entityType: dto.entityType,
        lastSyncAt: new Date(dto.lastSyncAt),
        lastServerCursor: dto.lastServerCursor,
        metadata: dto.metadata as any,
      },
    });
  }

  async findConflicts(query: QuerySyncConflictDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, entityType } = query;
    const skip = (page - 1) * limit;
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.OfflineSyncRecordWhereInput = { status: OfflineSyncRecordStatus.CONFLICT };

    if (entityType) where.entityType = entityType;
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.syncBatch = { companyId };
    } else if (accessibleIds !== null) {
      where.syncBatch = { companyId: { in: accessibleIds } };
    }

    const [data, total] = await Promise.all([
      this.prisma.offlineSyncRecord.findMany({
        where,
        include: {
          syncBatch: {
            select: { id: true, batchNumber: true, companyId: true, userId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.offlineSyncRecord.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveConflict(id: string, dto: ResolveConflictDto, user: AuthUser) {
    const record = await this.prisma.offlineSyncRecord.findFirst({
      where: { id },
      include: { syncBatch: { select: { companyId: true } } },
    });
    if (!record) throw new NotFoundException('Sync record not found');
    await this.companyScope.assertCanAccessCompany(user, record.syncBatch.companyId);
    const userId = user.id;
    const resolution = this.offlineSyncControl.resolveRecord({
      record,
      resolution: dto.resolution,
      resolvedValue: dto.resolvedValue,
    });

    const updated = await this.prisma.offlineSyncRecord.update({
      where: { id },
      data: {
        status: resolution.status,
        resolvedById: userId,
        resolvedAt: new Date(),
        ...(resolution.serverValue !== undefined && { serverValue: resolution.serverValue as any }),
        conflictReason: resolution.conflictReason,
      },
    });

    await this.auditLogs.log({
      action: 'SYNC_CONFLICT_RESOLVED',
      entityType: 'OfflineSyncRecord',
      entityId: id,
      userId,
      severity: AuditSeverity.LOW,
    });

    return updated;
  }
}
