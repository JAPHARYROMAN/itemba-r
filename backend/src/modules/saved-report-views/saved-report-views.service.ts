import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, ReportCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { REPORTS_CATALOG } from '../reports-catalog/catalog';
import { CreateSavedReportViewDto } from './dto/create-saved-report-view.dto';
import { UpdateSavedReportViewDto } from './dto/update-saved-report-view.dto';

/**
 * Catalog sectors that map 1:1 onto a ReportCategory enum value. Anything else
 * (OPERATIONS, BI, RECORDS_BOOK, …) lands on CUSTOM.
 */
const SECTOR_TO_CATEGORY: Partial<Record<string, ReportCategory>> = {
  FINANCE: ReportCategory.FINANCE,
  HR: ReportCategory.HR,
  PETROLEUM: ReportCategory.PETROLEUM,
  WESTSIDES: ReportCategory.WESTSIDES,
  COMPLIANCE: ReportCategory.COMPLIANCE,
  AGRICULTURE: ReportCategory.AGRICULTURE,
  CONSTRUCTION: ReportCategory.CONSTRUCTION,
  LOGISTICS: ReportCategory.LOGISTICS,
  ITEMBA: ReportCategory.EXECUTIVE,
};

@Injectable()
export class SavedReportViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, reportDefinitionId, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
      OR: [{ userId: user.id }, { isShared: true }],
    };
    if (reportDefinitionId) {
      // The runner filters by catalog id (e.g. 'finance.profit-and-loss');
      // resolve it to the mirrored ReportDefinition UUID. No definition row yet
      // simply means nothing has ever been saved for that report.
      const resolved = await this.findReportDefinitionId(String(reportDefinitionId));
      if (!resolved) return { data: [], total: 0, page: Number(page), limit: Number(limit) };
      where.reportDefinitionId = resolved;
    }
    const [data, total] = await Promise.all([
      this.prisma.savedReportView.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.savedReportView.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.savedReportView.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Saved Report View not found');
    await this.assertViewAccess(record, user, minimum);
    return record;
  }

  async create(dto: CreateSavedReportViewDto, user: AuthUser) {
    // Authorize the target company BEFORE any write (including the lazy
    // ReportDefinition registration below) so unauthorized requests leave no
    // trace.
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);
    const reportDefinitionId = await this.resolveOrRegisterReportDefinition(dto.reportDefinitionId);
    const record = await this.prisma.savedReportView.create({
      data: { ...dto, reportDefinitionId, companyId: companyId ?? null, userId: user.id },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'SavedReportView',
      entityId: record.id,
      companyId: record.companyId ?? undefined,
      newValue: { ...dto, companyId: record.companyId } as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateSavedReportViewDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Saved report view company cannot be changed');
    }

    const safeDto: any = { ...dto };
    delete safeDto.companyId;
    if (dto.reportDefinitionId) {
      safeDto.reportDefinitionId = await this.resolveOrRegisterReportDefinition(dto.reportDefinitionId);
    }
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { ...safeDto } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: record.id,
      companyId: existing.companyId ?? undefined,
      newValue: dto as any,
    });
    return record;
  }

  async share(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { isShared: true } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: { isShared: true } as any,
    });
    return record;
  }

  async setDefault(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.savedReportView.updateMany({
      where: { userId: user.id, deletedAt: null, companyId: existing.companyId },
      data: { isDefault: false },
    });
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { isDefault: true } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: { isDefault: true } as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: {} as any,
    });
    return record;
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

  /**
   * Resolve a client-supplied report identifier to a ReportDefinition UUID
   * WITHOUT creating anything. Accepts either a ReportDefinition UUID or a
   * reports-catalog id (e.g. 'finance.profit-and-loss') — catalog ids are
   * mirrored into report_definitions keyed by the unique `reportCode` column,
   * so both lookups collapse into one query. Returns null when no row exists.
   */
  private async findReportDefinitionId(reportDefinitionId: string): Promise<string | null> {
    const existing = await this.prisma.reportDefinition.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: reportDefinitionId }, { reportCode: reportDefinitionId }],
      },
      select: { id: true },
    });
    return existing?.id ?? null;
  }

  /**
   * Resolve a report identifier to a ReportDefinition UUID, lazily registering
   * a definition row for known catalog ids. The runner posts catalog ids (its
   * reports are static catalog entries, not seeded ReportDefinition rows); we
   * mirror the entry into report_definitions via upsert on the unique
   * `reportCode` column so the SavedReportView FK stays intact and concurrent
   * saves cannot race into duplicates. Unknown ids still 404 — DTO validation
   * alone must not let arbitrary strings mint definition rows.
   */
  private async resolveOrRegisterReportDefinition(reportDefinitionId: string): Promise<string> {
    const existing = await this.findReportDefinitionId(reportDefinitionId);
    if (existing) return existing;

    const entry = REPORTS_CATALOG.find((candidate) => candidate.id === reportDefinitionId);
    if (!entry) throw new NotFoundException('Report Definition not found');

    const definition = await this.prisma.reportDefinition.upsert({
      where: { reportCode: entry.id },
      // A soft-deleted mirror row is revived — the FK target must be live for
      // the saved-views list/filter path to resolve it again.
      update: { deletedAt: null },
      create: {
        reportCode: entry.id,
        name: entry.name,
        description: entry.description,
        reportCategory: SECTOR_TO_CATEGORY[entry.sector] ?? ReportCategory.CUSTOM,
        datasetKey: entry.id,
        isSystemReport: true,
        requiredPermission: entry.permission,
        isActive: true,
      },
      select: { id: true },
    });
    return definition.id;
  }

  private async assertViewAccess(record: any, user: AuthUser, minimum: AccessLevel) {
    const isOwner = record.userId === user.id;
    const isShared = record.isShared === true;
    const isGroupScoped = this.companyScope.isGroupScoped(user);

    if (!isGroupScoped && !isOwner && !isShared) {
      throw new ForbiddenException('You do not have access to this saved report view');
    }

    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    if (minimum !== AccessLevel.READ && !isGroupScoped && !isOwner) {
      throw new ForbiddenException('You cannot modify this saved report view');
    }
  }
}
