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

    const template = await this.prisma.documentTemplate.findFirst({ where: { id: templateId, deletedAt: null, status: 'ACTIVE' } });
    if (!template) throw new NotFoundException('Active document template not found');

    let html: string = template.content ?? '';
    const vars = { ...(data ?? {}), entityType, entityId };
    for (const [key, value] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
    }

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
}
