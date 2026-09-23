import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import { renderDocument } from '../generated-documents/document-renderer';
import { BusinessPdfModel } from '../generated-documents/pdf-builder';

@Injectable()
export class PrintEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly generatedDocuments: GeneratedDocumentsService,
  ) {}

  async render(dto: any, user: any) {
    const { templateId, entityType, entityId, data } = dto;
    const outputFormat = ['HTML', 'PDF', 'TEXT', 'JSON'].includes(dto.outputFormat)
      ? dto.outputFormat
      : 'HTML';
    const { template, html } = await this.loadAndFillTemplate(
      templateId,
      user,
      entityType,
      entityId,
      data,
    );

    const renderedContent =
      outputFormat === 'PDF'
        ? (await this.templatePdf(template, this.stripHtml(html), undefined, user)).toString(
            'base64',
          )
        : outputFormat === 'TEXT'
          ? this.stripHtml(html)
          : outputFormat === 'JSON'
            ? JSON.stringify({ templateId, entityType, entityId, data: { ...(data ?? {}) }, html })
            : html;

    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `DOC-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent,
        outputFormat,
        title: `${template.name} - ${new Date().toISOString()}`,
        generatedById: user.id,
        metadata:
          outputFormat === 'PDF'
            ? { encoding: 'base64', mimeType: 'application/pdf' }
            : {
                mimeType:
                  outputFormat === 'TEXT'
                    ? 'text/plain'
                    : outputFormat === 'JSON'
                      ? 'application/json'
                      : 'text/html',
              },
      },
    });

    await this.auditLogs.log({
      action: 'RENDER',
      entityType: 'GeneratedDocument',
      entityId: generated.id,
      userId: user.id,
      companyId: template.companyId ?? undefined,
    });
    return { id: generated.id, outputFormat, content: renderedContent };
  }

  async renderPdf(
    dto: any,
    user: any,
  ): Promise<{ id: string; filename: string; buffer: Buffer; mimeType: string }> {
    const { templateId, entityType, entityId, data, pdfSections } = dto;
    const { template, html } = await this.loadAndFillTemplate(
      templateId,
      user,
      entityType,
      entityId,
      data,
    );
    const buffer = await this.templatePdf(template, this.stripHtml(html), pdfSections, user);
    const filename = `${this.safeFilename(template.name)}_${Date.now()}.pdf`;

    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `PDF-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent: `[PDF artifact: ${filename}, ${buffer.length} bytes]`,
        outputFormat: 'PDF',
        title: filename,
        generatedById: user.id,
        metadata: { byteLength: buffer.length, filename, mimeType: 'application/pdf' },
      },
    });

    await this.auditLogs.log({
      action: 'RENDER_PDF',
      entityType: 'GeneratedDocument',
      entityId: generated.id,
      userId: user.id,
      companyId: template.companyId ?? undefined,
      metadata: { byteLength: buffer.length, filename } as any,
    });

    return { id: generated.id, filename, buffer, mimeType: 'application/pdf' };
  }

  async renderExcel(
    dto: any,
    user: any,
  ): Promise<{ id: string; filename: string; buffer: Buffer; mimeType: string }> {
    const { templateId, entityType, entityId, data, sheetData, sheetName } = dto;
    const { template } = await this.loadAndFillTemplate(
      templateId,
      user,
      entityType,
      entityId,
      data,
    );
    const rows: Array<Record<string, unknown>> = Array.isArray(sheetData) ? sheetData : [];
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const buffer = await renderDocument(
      {
        title: template.name,
        reference: entityId ?? template.id,
        generatedAt: new Date(),
        organization: await this.generatedDocuments.letterhead(
          template.companyId ?? undefined,
          user,
        ),
        meta: Object.entries(data ?? {}).map(([label, value]) => ({
          label,
          value: String(value ?? ''),
        })),
        sections: [
          {
            title: sheetName ?? 'Report',
            table: {
              headers,
              rows: rows.map((row) => headers.map((header) => String(row[header] ?? ''))),
              numericColumns: headers.flatMap((header, index) =>
                rows.every((row) => typeof row[header] === 'number') ? [index] : [],
              ),
            },
          },
        ],
      },
      'xlsx',
    );
    const filename = `${this.safeFilename(template.name)}_${Date.now()}.xlsx`;

    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `XLS-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent: `[XLSX artifact: ${filename}, ${buffer.length} bytes, ${rows.length} rows]`,
        outputFormat: 'EXCEL',
        title: filename,
        generatedById: user.id,
        metadata: {
          byteLength: buffer.length,
          rowCount: rows.length,
          filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
    });

    await this.auditLogs.log({
      action: 'RENDER_EXCEL',
      entityType: 'GeneratedDocument',
      entityId: generated.id,
      userId: user.id,
      companyId: template.companyId ?? undefined,
      metadata: { byteLength: buffer.length, rowCount: rows.length, filename } as any,
    });

    return {
      id: generated.id,
      filename,
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async loadAndFillTemplate(
    templateId: string,
    user: AuthUser,
    entityType?: string,
    entityId?: string,
    data?: Record<string, unknown>,
  ) {
    if (!templateId) throw new BadRequestException('templateId is required');
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id: templateId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!template) throw new NotFoundException('Active document template not found');
    // Enforce company scoping (mirrors DocumentTemplatesService.findOne): a user
    // may only render a template belonging to a company they can access. Prevents
    // cross-company template content (letterhead, terms, fields) from leaking to
    // a caller that merely holds the print_engine.render permission.
    await this.companyScope.assertCanAccessCompany(user, template.companyId, AccessLevel.READ);

    let html: string = template.content ?? '';
    const vars: Record<string, unknown> = { ...(data ?? {}), entityType, entityId };
    // Replace {{ key }} placeholders via a single precompiled pattern, looking the
    // captured name up in `vars`. Avoids compiling user-controlled keys into a
    // RegExp (regex injection / ReDoS) while preserving legitimate placeholders.
    html = html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : match,
    );
    return { template, html };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async templatePdf(
    template: { id: string; name: string; companyId?: string | null },
    bodyText: string,
    sections: Array<{ heading?: string; paragraph?: string; rows?: string[][] }> | undefined,
    user: AuthUser,
  ) {
    const model: Omit<BusinessPdfModel, 'organization'> = {
      title: template.name,
      reference: template.id,
      generatedAt: new Date(),
      meta: [],
      sections: sections?.length
        ? sections.map((section) => ({
            title: section.heading ?? 'Details',
            paragraphs: [
              section.paragraph ?? '',
              ...(section.rows ?? []).map((row) => row.join('   ')),
            ],
          }))
        : [{ title: 'Details', paragraphs: [bodyText || '(no content)'] }],
    };
    return this.generatedDocuments.renderLetterheadPdf(
      { companyId: template.companyId ?? user.companyId },
      model,
      user,
    );
  }

  private safeFilename(value: string): string {
    return value.replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '') || 'document';
  }
}
