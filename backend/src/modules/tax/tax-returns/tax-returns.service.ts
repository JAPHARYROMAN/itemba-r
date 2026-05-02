import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxReturnDto } from './dto/create-tax-return.dto';
import { UpdateTaxReturnDto } from './dto/update-tax-return.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class TaxReturnsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.taxReturn.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.taxReturn.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxReturn.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Tax return not found');
    return record;
  }

  async create(dto: CreateTaxReturnDto, user: any) {
    const record = await this.prisma.taxReturn.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxReturn', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxReturnDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async prepare(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'PREPARED' as any, preparedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'PREPARED' } });
    return record;
  }

  async review(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'REVIEWED' as any, reviewedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'REVIEWED' } });
    return record;
  }

  async approve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'APPROVED' as any, approvedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'APPROVED' } });
    return record;
  }

  async submit(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'SUBMITTED' as any, submittedById: user.id, submissionDate: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'SUBMITTED' } });
    return record;
  }

  async markPaid(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'PAID' as any, paidById: user.id, paymentDate: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'PAID' } });
    return record;
  }

  async cancel(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'CANCELLED' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'CANCELLED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxReturn.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxReturn', entityId: id, newValue: {} });
    return { message: 'Tax return deleted' };
  }
}
