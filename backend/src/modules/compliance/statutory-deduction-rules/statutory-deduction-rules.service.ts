import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateStatutoryDeductionRuleDto } from './dto/create-statutory-deduction-rule.dto';
import { UpdateStatutoryDeductionRuleDto } from './dto/update-statutory-deduction-rule.dto';

@Injectable()
export class StatutoryDeductionRulesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status, taxTypeId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (taxTypeId) where.taxTypeId = taxTypeId;
    const [data, total] = await Promise.all([
      this.prisma.statutoryDeductionRule.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.statutoryDeductionRule.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.statutoryDeductionRule.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Statutory deduction rule not found');
    return record;
  }

  async create(dto: CreateStatutoryDeductionRuleDto, user: any) {
    const record = await this.prisma.statutoryDeductionRule.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'StatutoryDeductionRule', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateStatutoryDeductionRuleDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.statutoryDeductionRule.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'StatutoryDeductionRule', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.statutoryDeductionRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'StatutoryDeductionRule', entityId: id, newValue: {} });
    return { message: 'Statutory deduction rule deleted' };
  }
}
