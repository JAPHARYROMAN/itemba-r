import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, ScheduleFrequency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';

@Injectable()
export class ScheduledReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId, reportDefinitionId, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };
    if (reportDefinitionId) where.reportDefinitionId = reportDefinitionId;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
    const [data, total] = await Promise.all([
      this.prisma.scheduledReport.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.scheduledReport.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.scheduledReport.findFirst({
      where: {
        id,
        deletedAt: null,
        ...((await this.companyScope.companyWhereFor(user)) as any),
      },
    });
    if (!record) throw new NotFoundException('Scheduled Report not found');
    return record;
  }

  async create(dto: CreateScheduledReportDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    // A freshly-created row must arm nextRunAt from its frequency, otherwise the
    // dispatch selector (nextRunAt: { not: null, lte: now }) never picks it up
    // and the schedule silently never fires. Only arm active schedules; an
    // inactive one is armed on activate().
    const isActive = (dto as { isActive?: boolean }).isActive ?? true;
    const record = await this.prisma.scheduledReport.create({
      data: {
        ...dto,
        createdById: user.id,
        nextRunAt: isActive ? this.computeNextRunAt(dto.frequency, new Date()) : null,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ScheduledReport',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async update(id: string, dto: Partial<CreateScheduledReportDto>, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (dto.companyId !== undefined) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    }
    const data: Partial<CreateScheduledReportDto> & { nextRunAt?: Date } = { ...dto };
    // If the cadence changes on an active schedule, re-derive nextRunAt from the
    // new frequency so the next fire respects the updated cadence instead of a
    // window computed from the old one.
    if (dto.frequency !== undefined && dto.frequency !== existing.frequency && existing.isActive) {
      data.nextRunAt = this.computeNextRunAt(dto.frequency, new Date());
    }
    const record = await this.prisma.scheduledReport.update({ where: { id }, data });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async run(id: string, user: AuthUser) {
    const startedAt = Date.now();
    // Fetch by id (not through companyWhereFor). companyWhereFor spreads a
    // { companyId } / { id: { in: [...] } } filter that, for group-level reports
    // (companyId=null) — and for a group-scoped principal with no explicit
    // grants (the shape resolveReportPrincipal returns) — clobbers the id filter
    // to { id: { in: [] } }, so the row can never be found and run() throws
    // NotFound forever. Authorization is enforced below by assertCanAccessCompany,
    // which correctly handles the group-level (companyId=null) case.
    const schedule = await this.prisma.scheduledReport.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        reportDefinition: true,
        savedReportView: true,
      },
    });
    if (!schedule) throw new NotFoundException('Scheduled Report not found');
    await this.companyScope.assertCanAccessCompany(user, schedule.companyId, AccessLevel.READ);

    const rows = this.buildSnapshotRows(schedule);
    const exportFile = this.materializeExport({
      format: schedule.exportFormat,
      reportName: schedule.name,
      datasetKey: schedule.reportDefinition.datasetKey,
      rows,
    });

    const run = await this.prisma.reportRun.create({
      data: {
        reportRunNumber: `RPT-SCHED-${Date.now()}`,
        reportDefinitionId: schedule.reportDefinitionId,
        savedReportViewId: schedule.savedReportViewId,
        companyId: schedule.companyId ?? null,
        requestedById: user.id,
        filters: {
          scheduleId: schedule.id,
          scheduleCode: schedule.scheduleCode,
          scheduleConfig: schedule.scheduleConfig,
          savedViewFilters: schedule.savedReportView?.filters ?? undefined,
        },
        status: 'COMPLETED',
        rowCount: rows.length,
        executionTimeMs: Date.now() - startedAt,
        completedAt: new Date(),
        resultSummary: {
          dataset: schedule.reportDefinition.datasetKey,
          exportFormat: schedule.exportFormat,
          filename: exportFile.filename,
          mimeType: exportFile.mimeType,
          sizeBytes: exportFile.content.length,
          contentBase64: exportFile.content.toString('base64'),
          generatedAt: new Date().toISOString(),
        },
      },
    });

    await this.prisma.dataExportLog.create({
      data: {
        exportNumber: `EXP-${Date.now()}`,
        companyId: schedule.companyId ?? null,
        exportedById: user.id,
        exportType: 'FINANCIAL_REPORT',
        filters: run.filters as any,
        fileName: exportFile.filename,
        status: 'COMPLETED',
        completedAt: new Date(),
        notes: `Generated from scheduled report ${schedule.scheduleCode}`,
      },
    });

    // Stamp lastRunAt and advance nextRunAt. This is idempotent and safe for the
    // two callers: the job-worker CAS-advances nextRunAt to a FUTURE value BEFORE
    // invoking run(), so here we only re-arm when the row's nextRunAt is still
    // null or already due (past) — that is the direct HTTP /run path. When the
    // worker calls us, nextRunAt is already in the future and we leave it intact,
    // preventing a double-advance that would skip a window.
    const completedAt = new Date();
    const advanceData: { lastRunAt: Date; nextRunAt?: Date } = { lastRunAt: completedAt };
    if (schedule.isActive) {
      const current = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
      if (!current || current.getTime() <= completedAt.getTime()) {
        advanceData.nextRunAt = this.computeNextRunAt(schedule.frequency, completedAt);
      }
    }
    await this.prisma.scheduledReport.update({ where: { id }, data: advanceData });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      companyId: schedule.companyId ?? undefined,
      newValue: { triggered: true, reportRunId: run.id, exportFile: exportFile.filename } as any,
    });
    return {
      message: 'Schedule triggered',
      id,
      reportRunId: run.id,
      export: {
        filename: exportFile.filename,
        mimeType: exportFile.mimeType,
        sizeBytes: exportFile.content.length,
      },
    };
  }

  async activate(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    // Re-arm nextRunAt on (re)activation if it is missing or stale (in the past),
    // so a report that was created inactive — or whose window lapsed while
    // deactivated — becomes due again. An already-armed future window is kept.
    const data: { isActive: true; nextRunAt?: Date } = { isActive: true };
    const current = existing.nextRunAt ? new Date(existing.nextRunAt) : null;
    if (!current || current.getTime() <= Date.now()) {
      data.nextRunAt = this.computeNextRunAt(existing.frequency, new Date());
    }
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data,
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: { isActive: true, nextRunAt: data.nextRunAt ?? null } as any,
    });
    return record;
  }

  async deactivate(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: { isActive: false } as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: {} as any,
    });
    return record;
  }

  /**
   * Advance a scheduled report's nextRunAt based on its frequency. Kept in lock
   * step with JobWorkerService.computeNextScheduledReportRunAt so a schedule
   * armed here and advanced by the dispatch worker use identical cadence math.
   */
  private computeNextRunAt(frequency: ScheduleFrequency | string, from: Date): Date {
    const next = new Date(from);
    switch (frequency) {
      case ScheduleFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case ScheduleFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case ScheduleFrequency.QUARTERLY:
        next.setMonth(next.getMonth() + 3);
        break;
      case ScheduleFrequency.ANNUAL:
        next.setFullYear(next.getFullYear() + 1);
        break;
      case ScheduleFrequency.MONTHLY:
      case ScheduleFrequency.CUSTOM:
      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }
    return next;
  }

  private buildSnapshotRows(schedule: {
    scheduleCode: string;
    name: string;
    exportFormat: string;
    reportDefinition: { reportCode: string; name: string; datasetKey: string; reportCategory: string };
    savedReportView?: { name: string; filters: any; columns: any } | null;
    companyId?: string | null;
  }) {
    return [
      { field: 'Schedule Code', value: schedule.scheduleCode },
      { field: 'Schedule Name', value: schedule.name },
      { field: 'Report Code', value: schedule.reportDefinition.reportCode },
      { field: 'Report Name', value: schedule.reportDefinition.name },
      { field: 'Dataset', value: schedule.reportDefinition.datasetKey },
      { field: 'Category', value: schedule.reportDefinition.reportCategory },
      { field: 'Company ID', value: schedule.companyId ?? 'GROUP' },
      { field: 'Saved View', value: schedule.savedReportView?.name ?? 'Default' },
      { field: 'Generated At', value: new Date().toISOString() },
    ];
  }

  private materializeExport(input: {
    format: string;
    reportName: string;
    datasetKey: string;
    rows: Array<Record<string, string>>;
  }): { filename: string; mimeType: string; content: Buffer } {
    const safeName = input.reportName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    switch (input.format) {
      case 'PDF': {
        const lines = [
          input.reportName,
          `Dataset: ${input.datasetKey}`,
          '',
          ...input.rows.map((row) => `${row.field}: ${row.value}`),
        ];
        return {
          filename: `${safeName}-${stamp}.pdf`,
          mimeType: 'application/pdf',
          content: this.renderSimplePdf(lines),
        };
      }
      case 'EXCEL': {
        return {
          filename: `${safeName}-${stamp}.xls`,
          mimeType: 'application/vnd.ms-excel',
          content: Buffer.from(this.renderExcelXml(input.rows), 'utf8'),
        };
      }
      case 'CSV': {
        return {
          filename: `${safeName}-${stamp}.csv`,
          mimeType: 'text/csv',
          content: Buffer.from(this.renderCsv(input.rows), 'utf8'),
        };
      }
      case 'JSON':
      case 'DASHBOARD_ONLY':
      default:
        return {
          filename: `${safeName}-${stamp}.json`,
          mimeType: 'application/json',
          content: Buffer.from(JSON.stringify({ dataset: input.datasetKey, rows: input.rows }, null, 2), 'utf8'),
        };
    }
  }

  private renderCsv(rows: Array<Record<string, string>>) {
    const escape = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return ['Field,Value', ...rows.map((row) => `${escape(row.field)},${escape(row.value)}`)].join('\n');
  }

  private renderExcelXml(rows: Array<Record<string, string>>) {
    const cell = (value: string) => `<Cell><Data ss:Type="String">${this.escapeXml(value)}</Data></Cell>`;
    const tableRows = [
      `<Row>${cell('Field')}${cell('Value')}</Row>`,
      ...rows.map((row) => `<Row>${cell(row.field)}${cell(row.value)}</Row>`),
    ].join('');
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Report"><Table>${tableRows}</Table></Worksheet>
</Workbook>`;
  }

  private renderSimplePdf(lines: string[]) {
    const escapedLines = lines.flatMap((line) => this.wrapText(line, 88)).map((line, index) => {
      const y = 760 - index * 16;
      return `BT /F1 10 Tf 50 ${Math.max(y, 40)} Td (${this.escapePdf(line)}) Tj ET`;
    });
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(escapedLines.join('\n'), 'utf8')} >>\nstream\n${escapedLines.join('\n')}\nendstream`,
    ];
    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(body, 'utf8'));
      body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(body, 'utf8');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
      body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(body, 'utf8');
  }

  private wrapText(value: string, width: number) {
    if (value.length <= width) return [value];
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += width) chunks.push(value.slice(i, i + width));
    return chunks;
  }

  private escapeXml(value: string) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapePdf(value: string) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
