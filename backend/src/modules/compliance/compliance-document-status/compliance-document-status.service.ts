import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateComplianceDocumentStatusDto } from './dto/create-compliance-document-status.dto';
import { UpdateComplianceDocumentStatusDto } from './dto/update-compliance-document-status.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class ComplianceDocumentStatusService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, requirementId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (requirementId) where.requirementId = requirementId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.complianceDocumentStatus.findMany({ where, skip, take: Number(limit), orderBy: { companyId: 'asc' } }),
      this.prisma.complianceDocumentStatus.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const where = applyCompanyScopeWhere({ id }, user, null);
    const record = await this.prisma.complianceDocumentStatus.findFirst({ where });
    if (!record) throw new NotFoundException('Compliance document status not found');
    return record;
  }

  async create(dto: CreateComplianceDocumentStatusDto, user: any) {
    const record = await this.prisma.complianceDocumentStatus.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ComplianceDocumentStatus', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateComplianceDocumentStatusDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.complianceDocumentStatus.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ComplianceDocumentStatus', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.complianceDocumentStatus.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ComplianceDocumentStatus', entityId: id, newValue: {} });
    return { message: 'Compliance document status deleted' };
  }
}
