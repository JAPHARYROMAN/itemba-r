import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, ReportRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateReportRunDto } from './dto/create-report-run.dto';

@Injectable()
export class ReportRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, reportDefinitionId, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { ...(await this.companyScope.companyWhereFor(user, companyId)) };
    if (reportDefinitionId) where.reportDefinitionId = reportDefinitionId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.reportRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.reportRun.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.reportRun.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Report Run not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateReportRunDto, user: AuthUser) {
    const reportDef = await this.prisma.reportDefinition.findFirst({ where: { id: dto.reportDefinitionId, deletedAt: null } });
    if (!reportDef) throw new NotFoundException('Report Definition not found');

    let companyId = await this.resolveTargetCompanyId(user, dto.companyId);
    if (dto.savedReportViewId) {
      const savedView = await this.prisma.savedReportView.findFirst({
        where: {
          id: dto.savedReportViewId,
          reportDefinitionId: dto.reportDefinitionId,
          deletedAt: null,
          OR: [{ userId: user.id }, { isShared: true }],
        },
      });
      if (!savedView) throw new NotFoundException('Saved Report View not found');
      await this.companyScope.assertCanAccessCompany(user, savedView.companyId, AccessLevel.READ);
      if (savedView.companyId) {
        if (!companyId) {
          await this.companyScope.assertCanAccessCompany(user, savedView.companyId, AccessLevel.WRITE);
          companyId = savedView.companyId;
        } else if (companyId !== savedView.companyId) {
          throw new BadRequestException('Saved report view belongs to a different company');
        }
      }
    }

    const run = await this.prisma.reportRun.create({
      data: {
        reportRunNumber: `RPT-RUN-${Date.now()}`,
        reportDefinitionId: dto.reportDefinitionId,
        savedReportViewId: dto.savedReportViewId,
        companyId: companyId ?? null,
        requestedById: user.id,
        filters: dto.filters,
        status: ReportRunStatus.REQUESTED,
      },
    });

    const completedRun = await this.prisma.reportRun.update({
      where: { id: run.id },
      data: {
        status: ReportRunStatus.COMPLETED,
        completedAt: new Date(),
        resultSummary: {
          dataset: reportDef.datasetKey,
          filters: dto.filters,
          rowCount: 0,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ReportRun',
      entityId: run.id,
      companyId: completedRun.companyId ?? undefined,
      newValue: { ...dto, companyId: completedRun.companyId } as any,
    });
    return completedRun;
  }

  async getResults(id: string, user: AuthUser) {
    const run = await this.findOne(id, user);
    return { run, results: [] };
  }

  async export(id: string, user: AuthUser) {
    const run = await this.findOne(id, user);
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ReportRunExport',
      entityId: id,
      companyId: run.companyId ?? undefined,
      newValue: { runId: run.id, format: 'PDF' } as any,
    });
    return { message: 'Export initiated', runId: run.id };
  }

  async cancel(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.reportRun.update({ where: { id }, data: { status: ReportRunStatus.CANCELLED } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ReportRun',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: { status: 'CANCELLED' } as any,
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
}
