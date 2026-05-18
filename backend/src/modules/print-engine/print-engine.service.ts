import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Print engine. Renders templates and produces final artifacts in three formats:
 *
 *   HTML  — variable substitution into the template's content (`{{ key }}`).
 *   PDF   — server-side PDF generation via pdfkit (header / paragraphs /
 *           data table). No headless browser required.
 *   EXCEL — workbook generation via exceljs. Accepts an optional `sheetData`
 *           array of row objects; if absent, falls back to the template content
 *           rendered as a single column.
 *
 * Each call persists a GeneratedDocument record for the audit trail. PDF and
 * Excel callers receive a Buffer suitable for streaming to the client; the DB
 * record only captures the metadata (title / template / who / when), not the
 * binary itself.
 */
@Injectable()
export class PrintEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Render to HTML and persist the result. Backwards-compatible with the
   * pre-Phase 4 contract. Callers that need PDF/Excel should use
   * {@link renderPdf} / {@link renderExcel}.
   */
  async render(dto: any, user: any) {
    const { templateId, entityType, entityId, data } = dto;
    const { template, html } = await this.loadAndFillTemplate(templateId, entityType, entityId, data);

    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `DOC-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent: html,
        title: `${template.name} - ${new Date().toISOString()}`,
        generatedById: user.id,
      },
    });

    await this.auditLogs.log({ action: 'RENDER', entityType: 'GeneratedDocument', entityId: generated.id, userId: user.id, companyId: template.companyId ?? undefined });
    return { id: generated.id, html };
  }

  /**
   * Phase 4 — produce a real PDF via pdfkit. The template's `content` is
   * treated as plain text (HTML tags stripped); for richer layouts the caller
   * can pass `pdfSections` to override the body structure.
   *
   * Returns { id, filename, buffer, mimeType } so the controller can stream it.
   */
  async renderPdf(dto: any, user: any): Promise<{ id: string; filename: string; buffer: Buffer; mimeType: string }> {
    const { templateId, entityType, entityId, data, pdfSections } = dto;
    const { template, html } = await this.loadAndFillTemplate(templateId, entityType, entityId, data);

    const buffer = await this.htmlToPdf({
      title: template.name,
      bodyText: this.stripHtml(html),
      sections: pdfSections,
    });

    const filename = `${template.name.replace(/[^a-z0-9-]+/gi, '_')}_${Date.now()}.pdf`;
    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `PDF-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent: `[PDF artifact: ${filename}, ${buffer.length} bytes]`,
        title: filename,
        generatedById: user.id,
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

  /**
   * Phase 4 — produce an .xlsx workbook via exceljs. Accepts:
   *   sheetData: Array<Record<string, any>> — one sheet of rows, with column
   *              headers derived from the first row's keys.
   *   sheetName: string — defaults to "Report".
   *   data:      Record<string, any> — top-of-sheet metadata block.
   */
  async renderExcel(dto: any, user: any): Promise<{ id: string; filename: string; buffer: Buffer; mimeType: string }> {
    const { templateId, entityType, entityId, data, sheetData, sheetName } = dto;
    const { template } = await this.loadAndFillTemplate(templateId, entityType, entityId, data);

    const rows: Array<Record<string, unknown>> = Array.isArray(sheetData) ? sheetData : [];
    const buffer = await this.dataToExcel({
      sheetName: sheetName ?? template.name ?? 'Report',
      title: template.name,
      metadata: data ?? {},
      rows,
    });

    const filename = `${template.name.replace(/[^a-z0-9-]+/gi, '_')}_${Date.now()}.xlsx`;
    const generated = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: `XLS-${Date.now()}`,
        templateId,
        entityType: entityType ?? 'UNKNOWN',
        entityId: entityId ?? 'UNKNOWN',
        companyId: template.companyId ?? null,
        renderedContent: `[XLSX artifact: ${filename}, ${buffer.length} bytes, ${rows.length} rows]`,
        title: filename,
        generatedById: user.id,
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

  // ─── Internals ──────────────────────────────────────────────────────────

  private async loadAndFillTemplate(
    templateId: string,
    entityType: string | undefined,
    entityId: string | undefined,
    data: Record<string, unknown> | undefined,
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

  /** Crude HTML-to-text strip — sufficient for template plain-text bodies. */
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
      .trim();
  }

  private async htmlToPdf(input: {
    title: string;
    bodyText: string;
    sections?: Array<{ heading?: string; paragraph?: string; rows?: string[][] }>;
  }): Promise<Buffer> {
    // Lazy-load pdfkit so the import is only evaluated when PDF rendering is
    // actually requested (keeps cold-start fast for HTML-only callers).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit');
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header.
        doc.fontSize(18).text(input.title, { underline: false });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toISOString()}`);
        doc.fillColor('black').moveDown(1);

        // Either explicit sections or the plain body text.
        if (input.sections && input.sections.length > 0) {
          for (const sec of input.sections) {
            if (sec.heading) {
              doc.fontSize(13).font('Helvetica-Bold').text(sec.heading);
              doc.font('Helvetica').moveDown(0.3);
            }
            if (sec.paragraph) {
              doc.fontSize(11).text(sec.paragraph, { align: 'left' });
              doc.moveDown(0.5);
            }
            if (sec.rows && sec.rows.length > 0) {
              doc.fontSize(10);
              for (const row of sec.rows) {
                doc.text(row.join('   '));
              }
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
    // Lazy-load exceljs for the same reason as pdfkit above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ITEMBA-R';
    wb.created = new Date();

    const ws = wb.addWorksheet(input.sheetName.slice(0, 31)); // Excel sheet-name limit

    // Top metadata block.
    ws.addRow([input.title]).font = { bold: true, size: 14 };
    ws.addRow([`Generated ${new Date().toISOString()}`]).font = { italic: true };
    ws.addRow([]);
    for (const [k, v] of Object.entries(input.metadata)) {
      ws.addRow([k, String(v ?? '')]);
    }
    ws.addRow([]);

    // Data table.
    if (input.rows.length > 0) {
      const headers = Object.keys(input.rows[0]);
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      });
      for (const row of input.rows) {
        ws.addRow(headers.map((h) => row[h] ?? ''));
      }
      // Auto-fit columns by header length (rough).
      headers.forEach((h, i) => {
        ws.getColumn(i + 1).width = Math.max(h.length + 2, 14);
      });
    } else {
      ws.addRow(['(no data rows supplied)']);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
