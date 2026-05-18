import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class PrintEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async render(dto: any, user: any) {
    const { templateId, entityType, entityId, data } = dto;
    const outputFormat = ['HTML', 'PDF', 'TEXT', 'JSON'].includes(dto.outputFormat)
      ? dto.outputFormat
      : 'HTML';
    const { template, html } = await this.loadAndFillTemplate(
      templateId,
      entityType,
      entityId,
      data,
    );

    const renderedContent =
      outputFormat === 'PDF'
        ? (await this.htmlToPdf({ title: template.name, bodyText: this.stripHtml(html) })).toString(
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
      entityType,
      entityId,
      data,
    );
    const buffer = await this.htmlToPdf({
      title: template.name,
      bodyText: this.stripHtml(html),
      sections: pdfSections,
    });
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
    const { template } = await this.loadAndFillTemplate(templateId, entityType, entityId, data);
    const rows: Array<Record<string, unknown>> = Array.isArray(sheetData) ? sheetData : [];
    const buffer = await this.dataToExcel({
      sheetName: sheetName ?? template.name ?? 'Report',
      title: template.name,
      metadata: data ?? {},
      rows,
    });
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
    entityType?: string,
    entityId?: string,
    data?: Record<string, unknown>,
  ) {
    if (!templateId) throw new BadRequestException('templateId is required');
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id: templateId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!template) throw new NotFoundException('Active document template not found');

    let html: string = template.content ?? '';
    const vars: Record<string, unknown> = { ...(data ?? {}), entityType, entityId };
    for (const [key, value] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
    }
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

  private async htmlToPdf(input: {
    title: string;
    bodyText: string;
    sections?: Array<{ heading?: string; paragraph?: string; rows?: string[][] }>;
  }): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit');
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text(input.title);
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toISOString()}`);
        doc.fillColor('black').moveDown(1);

        if (input.sections?.length) {
          for (const section of input.sections) {
            if (section.heading) {
              doc.fontSize(13).font('Helvetica-Bold').text(section.heading);
              doc.font('Helvetica').moveDown(0.3);
            }
            if (section.paragraph) {
              doc.fontSize(11).text(section.paragraph, { align: 'left' });
              doc.moveDown(0.5);
            }
            if (section.rows?.length) {
              doc.fontSize(10);
              for (const row of section.rows) doc.text(row.join('   '));
              doc.moveDown(0.5);
            }
          }
        } else {
          doc.fontSize(11).text(input.bodyText || '(no content)', { align: 'left' });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async dataToExcel(input: {
    sheetName: string;
    title: string;
    metadata: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
  }): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ITEMBA-R';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(input.sheetName.slice(0, 31) || 'Report');

    worksheet.addRow([input.title]).font = { bold: true, size: 14 };
    worksheet.addRow([`Generated ${new Date().toISOString()}`]).font = { italic: true };
    worksheet.addRow([]);
    for (const [key, value] of Object.entries(input.metadata)) {
      worksheet.addRow([key, String(value ?? '')]);
    }
    worksheet.addRow([]);

    if (input.rows.length > 0) {
      const headers = Object.keys(input.rows[0]);
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      });
      for (const row of input.rows) {
        worksheet.addRow(headers.map((header) => row[header] ?? ''));
      }
      headers.forEach((header, index) => {
        worksheet.getColumn(index + 1).width = Math.max(header.length + 2, 14);
      });
    } else {
      worksheet.addRow(['(no data rows supplied)']);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private safeFilename(value: string): string {
    return value.replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '') || 'document';
  }
}
