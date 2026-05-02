import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxTransactionDto } from './dto/create-tax-transaction.dto';
import { UpdateTaxTransactionDto } from './dto/update-tax-transaction.dto';

@Injectable()
export class TaxTransactionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, direction, status, startDate, endDate } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }
    const [data, total] = await Promise.all([
      this.prisma.taxTransaction.findMany({ where, skip, take: Number(limit), orderBy: { transactionDate: 'desc' } }),
      this.prisma.taxTransaction.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxTransaction.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Tax transaction not found');
    return record;
  }

  async create(dto: CreateTaxTransactionDto, user: any) {
    const record = await this.prisma.taxTransaction.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxTransaction', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxTransactionDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxTransaction.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxTransaction', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async post(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxTransaction.update({ where: { id }, data: { status: 'POSTED' as any, postedById: user.id, postedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxTransaction', entityId: id, newValue: { status: 'POSTED' } });
    return record;
  }

  async reverse(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxTransaction.update({ where: { id }, data: { status: 'REVERSED' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxTransaction', entityId: id, newValue: { status: 'REVERSED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxTransaction', entityId: id, newValue: {} });
    return { message: 'Tax transaction deleted' };
  }
}
