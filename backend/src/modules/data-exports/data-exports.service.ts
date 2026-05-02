import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, DataExportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDataExportDto } from './dto/create-data-export.dto';

/**
 * Data exports — produces a CSV/JSON dump of a domain table for compliance
 * or BI handoff.
 *
 * Previously, `create()` completed the export inline by immediately flipping
 * the row to COMPLETED — large exports would block the request thread or
 * fail silently.  This implementation:
 *
 *   - Creates the DataExportLog in REQUESTED status.
 *   - Enqueues a BackgroundJob of type DATA_EXPORT linking back via
 *     `correlationId = exportLog.id`.
 *   - The export worker (separate runner — see job-queue-configs/background-jobs)
 *     picks up the job, generates the file, writes it to storage, and flips
 *     the export row to COMPLETED with `fileName` / `filePath` populated.
 *
 *  Two helper methods are exposed for the worker:
 *   - markRunning(id) — call before processing
 *   - markCompleted(id, fileName, filePath) — call on success
 *   - markFailed(id, errorMessage) — call on failure
 */
@Injectable()
export class DataExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId, exportType, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { ...(await this.companyScope.companyWhereFor(user, companyId)) };
    if (exportType) where.exportType = exportType;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.dataExportLog.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dataExportLog.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.dataExportLog.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Data export log not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  /**
   * Create the export request and enqueue a background job to process it.
   * Returns the export log row in REQUESTED state — the actual file is
   * produced asynchronously.
   */
  async create(dto: CreateDataExportDto, user: AuthUser) {
    const exportNumber = `EXP-${Date.now().toString(36).toUpperCase()}`;
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.dataExportLog.create({
        data: {
          ...dto,
          companyId: companyId ?? null,
          exportNumber,
          exportedById: user.id,
          status: DataExportStatus.REQUESTED,
        } as any,
      });

      // Enqueue: the actual CSV/JSON generation happens in the worker.
      await tx.backgroundJob.create({
        data: {
          jobNumber: `JOB-EXP-${Date.now().toString(36).toUpperCase()}`,
          jobType: 'DATA_EXPORT',
          queueName: 'data-exports',
          companyId: companyId ?? null,
          requestedById: user.id,
          status: 'QUEUED',
          priority: 'NORMAL',
          payload: {
            exportLogId: record.id,
            exportType: dto.exportType,
            filters: dto.filters as any,
          },
          correlationId: record.id,
          idempotencyKey: exportNumber,
        },
      });

      return record;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'DataExportLog',
      entityId: result.id,
      companyId: result.companyId ?? undefined,
      newValue: { ...dto, companyId: result.companyId } as unknown as Record<string, unknown>,
    });

    return result;
  }

  private async resolveTargetCompanyId(user: AuthUser, requestedCompanyId?: string) {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId, AccessLevel.WRITE);
      return requestedCompanyId;
    }

    if (!this.companyScope.isGroupScoped(user) && user.companyId) {
      await this.companyScope.assertCanAccessCompany(user, user.companyId, AccessLevel.WRITE);
      return user.companyId;
    }

    await this.companyScope.assertCanAccessCompany(user, undefined, AccessLevel.WRITE);
    return undefined;
  }

  /** Worker callback: an export is starting. */
  async markRunning(id: string) {
    return this.prisma.dataExportLog.update({
      where: { id },
      data: { status: DataExportStatus.IN_PROGRESS },
    });
  }

  /** Worker callback: an export finished successfully. */
  async markCompleted(id: string, fileName: string, filePath: string) {
    return this.prisma.dataExportLog.update({
      where: { id },
      data: {
        status: DataExportStatus.COMPLETED,
        completedAt: new Date(),
        fileName,
        filePath,
      },
    });
  }

  /** Worker callback: an export failed. Records the error message. */
  async markFailed(id: string, errorMessage: string) {
    return this.prisma.dataExportLog.update({
      where: { id },
      data: {
        status: DataExportStatus.FAILED,
        completedAt: new Date(),
        notes: errorMessage,
      },
    });
  }
}
