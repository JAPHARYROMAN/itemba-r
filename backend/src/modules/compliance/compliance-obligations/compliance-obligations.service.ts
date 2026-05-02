import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateComplianceObligationDto } from './dto/create-compliance-obligation.dto';
import { UpdateComplianceObligationDto } from './dto/update-compliance-obligation.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class ComplianceObligationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status, priority, obligationType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (obligationType) where.obligationType = obligationType;
    const [data, total] = await Promise.all([
      this.prisma.complianceObligation.findMany({ where, skip, take: Number(limit), orderBy: { dueDate: 'asc' } }),
      this.prisma.complianceObligation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.complianceObligation.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Compliance obligation not found');
    return record;
  }

  async create(dto: CreateComplianceObligationDto, user: any) {
    const record = await this.prisma.complianceObligation.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ComplianceObligation', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateComplianceObligationDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.complianceObligation.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ComplianceObligation', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async complete(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.complianceObligation.update({ where: { id }, data: { status: 'COMPLETED' as any, completedById: user.id, completedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ComplianceObligation', entityId: id, newValue: { status: 'COMPLETED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.complianceObligation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ComplianceObligation', entityId: id, newValue: {} });
    return { message: 'Compliance obligation deleted' };
  }
}
