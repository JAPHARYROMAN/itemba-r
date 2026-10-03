import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TaxByPartyQueryDto } from './dto/tax-by-party-query.dto';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxTransactionDto } from './dto/create-tax-transaction.dto';
import { UpdateTaxTransactionDto } from './dto/update-tax-transaction.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

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
    applyCompanyScopeWhere(where, user, companyId);
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

  /**
   * Party linkage (Phase 3 PR-7): taxable and tax amounts per party, direction, tax type and
   * currency over a date range, from the party snapshot each row carries. Rows without a party
   * are their own group ("No party"), so nothing is hidden. Reversed and deleted rows are left
   * out. Read-only.
   */
  async byParty(user: any, query: TaxByPartyQueryDto) {
    const where: any = { deletedAt: null, status: { not: 'REVERSED' }, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, query.companyId);
    if (query.direction) where.direction = query.direction;
    const from = query.dateFrom ? new Date(query.dateFrom) : null;
    const to = query.dateTo ? new Date(query.dateTo) : null;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime())))
      throw new BadRequestException('Invalid date range');
    if (from || to) {
      where.transactionDate = {};
      if (from) where.transactionDate.gte = from;
      if (to) where.transactionDate.lte = to;
    }
    const grouped = await this.prisma.taxTransaction.groupBy({
      by: ['partyType', 'supplierId', 'customerId', 'partyTin', 'partyVrn', 'direction', 'taxTypeId', 'currency'],
      where,
      _sum: { taxableAmount: true, taxAmount: true },
      _count: { _all: true },
    });
    const supplierIds = [...new Set(grouped.map((g) => g.supplierId).filter((v): v is string => !!v))];
    const customerIds = [...new Set(grouped.map((g) => g.customerId).filter((v): v is string => !!v))];
    const taxTypeIds = [...new Set(grouped.map((g) => g.taxTypeId))];
    const [suppliers, customers, taxTypes] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, supplierCode: true } })
        : [],
      customerIds.length
        ? this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, customerCode: true } })
        : [],
      taxTypeIds.length
        ? this.prisma.taxType.findMany({ where: { id: { in: taxTypeIds } }, select: { id: true, name: true, taxTypeCode: true } })
        : [],
    ]);
    const supplierBy = new Map(suppliers.map((s) => [s.id, { name: s.name, code: s.supplierCode }]));
    const customerBy = new Map(customers.map((c) => [c.id, { name: c.name, code: c.customerCode }]));
    const taxTypeBy = new Map(taxTypes.map((t) => [t.id, { id: t.id, name: t.name, code: t.taxTypeCode }]));
    const money = (v: Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);
    const rows = grouped
      .map((g) => {
        const kind = g.partyType === 'SUPPLIER' ? 'supplier' : g.partyType === 'CUSTOMER' ? 'customer' : null;
        const partyId = kind === 'supplier' ? g.supplierId : kind === 'customer' ? g.customerId : null;
        const party = kind === 'supplier' ? supplierBy.get(partyId!) : kind === 'customer' ? customerBy.get(partyId!) : null;
        return {
          partyType: g.partyType,
          kind,
          partyId,
          name: party?.name ?? (kind ? partyId : 'No party'),
          code: party?.code ?? null,
          tin: g.partyTin,
          vrn: g.partyVrn,
          direction: g.direction,
          taxType: taxTypeBy.get(g.taxTypeId) ?? { id: g.taxTypeId, name: g.taxTypeId, code: null },
          currency: g.currency,
          taxable: money(g._sum.taxableAmount),
          tax: money(g._sum.taxAmount),
          transactions: g._count._all,
        };
      })
      .sort((a, b) => Math.abs(Number(b.tax)) - Math.abs(Number(a.tax)) || (a.name ?? '').localeCompare(b.name ?? ''));
    const totals: Record<string, { taxable: string; tax: string; transactions: number }> = {};
    for (const g of grouped) {
      const key = `${g.direction}:${g.currency}`;
      const t = totals[key] ?? { taxable: '0.00', tax: '0.00', transactions: 0 };
      totals[key] = {
        taxable: new Prisma.Decimal(t.taxable).plus(g._sum.taxableAmount ?? 0).toFixed(2),
        tax: new Prisma.Decimal(t.tax).plus(g._sum.taxAmount ?? 0).toFixed(2),
        transactions: t.transactions + g._count._all,
      };
    }
    return {
      companyId: query.companyId,
      dateFrom: from,
      dateTo: to,
      direction: query.direction ?? null,
      rows,
      untagged: rows.filter((r) => r.partyType === 'NONE').length,
      totals: Object.entries(totals).map(([key, value]) => {
        const [direction, currency] = key.split(':');
        return { direction, currency, ...value };
      }),
    };
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
