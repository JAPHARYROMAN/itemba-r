import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateComplianceEventDto } from './dto/create-compliance-event.dto';
import { UpdateComplianceEventDto } from './dto/update-compliance-event.dto';

@Injectable()
export class ComplianceEventsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, complianceObligationId, eventType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (complianceObligationId) where.complianceObligationId = complianceObligationId;
    if (eventType) where.eventType = eventType;
    const [data, total] = await Promise.all([
      this.prisma.complianceEvent.findMany({ where, skip, take: Number(limit), orderBy: { eventDate: 'desc' } }),
      this.prisma.complianceEvent.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.complianceEvent.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Compliance event not found');
    return record;
  }

  async create(dto: CreateComplianceEventDto, user: any) {
    const record = await this.prisma.complianceEvent.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ComplianceEvent', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateComplianceEventDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.complianceEvent.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ComplianceEvent', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.complianceEvent.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ComplianceEvent', entityId: id, newValue: {} });
    return { message: 'Compliance event deleted' };
  }
}
