import { Injectable, NotFoundException } from '@nestjs/common';
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

    const template = await this.prisma.documentTemplate.findFirst({ where: { id: templateId, deletedAt: null, status: 'ACTIVE' } });
    if (!template) throw new NotFoundException('Active document template not found');

    let html: string = template.content ?? '';
    const vars = { ...(data ?? {}), entityType, entityId };
    for (const [key, value] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
    }

    const renderedContent =
      outputFormat === 'PDF'
        ? this.renderSimplePdf([template.name, '', ...html.replace(/<[^>]+>/g, ' ').split(/\s{2,}/)]).toString('base64')
        : outputFormat === 'TEXT'
          ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : outputFormat === 'JSON'
            ? JSON.stringify({ templateId, entityType, entityId, data: vars, html })
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
            : { mimeType: outputFormat === 'TEXT' ? 'text/plain' : outputFormat === 'JSON' ? 'application/json' : 'text/html' },
      },
    });

    await this.auditLogs.log({ action: 'RENDER', entityType: 'GeneratedDocument', entityId: generated.id, userId: user.id, companyId: template.companyId ?? undefined });
    return { id: generated.id, outputFormat, content: renderedContent };
  }

  private renderSimplePdf(lines: string[]) {
    const stream = lines
      .flatMap((line) => this.wrapText(line, 88))
      .slice(0, 45)
      .map((line, index) => `BT /F1 10 Tf 50 ${760 - index * 16} Td (${this.escapePdf(line)}) Tj ET`)
      .join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
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

  private escapePdf(value: string) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
