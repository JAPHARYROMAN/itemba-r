import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateHrDocumentDto } from './dto/create-hr-document.dto';
import { UpdateHrDocumentDto } from './dto/update-hr-document.dto';

@Injectable()
export class HrDocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  /**
   * Fields selected from the linked Document — only the operator-visible
   * metadata. The storage key, raw mime, and confidential flag stay on the
   * Document model and are accessed via the Documents Vault directly.
   */
  private readonly documentSelect = {
    id: true,
    title: true,
    fileName: true,
    fileSizeBytes: true,
    mimeType: true,
    expiryDate: true,
    renewalDate: true,
    status: true,
    version: true,
  } as const;

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, documentCategory } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (employeeId) where.employeeId = employeeId;
    if (documentCategory) where.documentCategory = documentCategory;
    const [data, total] = await Promise.all([
      this.prisma.hRDocument.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
          document: { select: this.documentSelect },
        },
      }),
      this.prisma.hRDocument.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.hRDocument.findFirst({
      where: { id, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
        document: { select: this.documentSelect },
      },
    });
    if (!record) throw new NotFoundException('HR document not found');
    return record;
  }

  async create(dto: CreateHrDocumentDto, user: any) {
    const record = await this.prisma.hRDocument.create({ data: dto as any });
    await this.audit.log({ userId: user.id, action: 'DOCUMENT_UPLOAD', entityType: 'HRDocument', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateHrDocumentDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.hRDocument.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'DOCUMENT_UPDATE', entityType: 'HRDocument', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.hRDocument.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DOCUMENT_DELETE', entityType: 'HRDocument', entityId: id, newValue: {} });
    return { message: 'HR document deleted' };
  }
}
