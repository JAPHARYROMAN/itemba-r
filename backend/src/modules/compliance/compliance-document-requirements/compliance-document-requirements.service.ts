import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateComplianceDocumentRequirementDto } from './dto/create-compliance-document-requirement.dto';
import { UpdateComplianceDocumentRequirementDto } from './dto/update-compliance-document-requirement.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class ComplianceDocumentRequirementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, requirementType, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (requirementType) where.requirementType = requirementType;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.complianceDocumentRequirement.findMany({ where, skip, take: Number(limit), orderBy: { title: 'asc' } }),
      this.prisma.complianceDocumentRequirement.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.complianceDocumentRequirement.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Compliance document requirement not found');
    return record;
  }

  async create(dto: CreateComplianceDocumentRequirementDto, user: any) {
    const record = await this.prisma.complianceDocumentRequirement.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ComplianceDocumentRequirement', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateComplianceDocumentRequirementDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.complianceDocumentRequirement.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ComplianceDocumentRequirement', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.complianceDocumentRequirement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ComplianceDocumentRequirement', entityId: id, newValue: {} });
    return { message: 'Compliance document requirement deleted' };
  }
}
