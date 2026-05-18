import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /**
   * Phase 4 — auto-compute return totals from posted TaxTransactions inside
   * the return's filing period.
   *
   * Sums:
   *   taxableAmount     = Σ taxableAmount (POSTED, in-period, matching taxTypeId)
   *   taxPayable        = Σ taxAmount where direction = OUTPUT
   *   taxRecoverable    = Σ taxAmount where direction = INPUT
   *   netTaxDue         = taxPayable − taxRecoverable
   *   totalDue          = netTaxDue + penalties + interest
   *   outstandingAmount = totalDue − amountPaid
   *
   * Also transitions status DRAFT → PREPARED and stamps preparedById.
   * Idempotent: re-running on a PREPARED return recomputes and overwrites.
   */
  async autoComputeFromTransactions(id: string, user: any) {
    const record = await this.findOne(id, user);
    if (record.status === 'SUBMITTED' || record.status === 'PAID' || record.status === 'CLOSED') {
      throw new BadRequestException(
        'Cannot recompute a return that has been submitted, paid, or closed',
      );
    }

    const filingPeriod = await this.prisma.taxFilingPeriod.findUnique({
      where: { id: record.taxFilingPeriodId },
      select: { periodStart: true, periodEnd: true },
    });
    if (!filingPeriod) throw new NotFoundException('Tax filing period not found');

    const txs = await this.prisma.taxTransaction.findMany({
      where: {
        companyId: record.companyId,
        taxTypeId: record.taxTypeId,
        deletedAt: null,
        status: 'POSTED' as any,
        transactionDate: { gte: filingPeriod.periodStart, lte: filingPeriod.periodEnd },
      },
      select: { taxableAmount: true, taxAmount: true, direction: true },
    });

    let taxableAmount = new Prisma.Decimal(0);
    let taxPayable = new Prisma.Decimal(0);
    let taxRecoverable = new Prisma.Decimal(0);
    let outputCount = 0;
    let inputCount = 0;
    for (const t of txs) {
      taxableAmount = taxableAmount.plus(t.taxableAmount);
      if (t.direction === 'OUTPUT') {
        taxPayable = taxPayable.plus(t.taxAmount);
        outputCount++;
      } else {
        taxRecoverable = taxRecoverable.plus(t.taxAmount);
        inputCount++;
      }
    }

    const netTaxDue = taxPayable.minus(taxRecoverable);
    const penalties = new Prisma.Decimal(record.penalties);
    const interest = new Prisma.Decimal(record.interest);
    const totalDue = netTaxDue.plus(penalties).plus(interest);
    const amountPaid = new Prisma.Decimal(record.amountPaid);
    const outstandingAmount = totalDue.minus(amountPaid);

    const updated = await this.prisma.taxReturn.update({
      where: { id },
      data: {
        taxableAmount,
        taxPayable,
        taxRecoverable,
        netTaxDue,
        totalDue,
        outstandingAmount,
        status: 'PREPARED' as any,
        preparedById: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'AUTO_COMPUTE',
      entityType: 'TaxReturn',
      entityId: id,
      newValue: {
        txCount: txs.length,
        outputCount,
        inputCount,
        taxPayable: taxPayable.toString(),
        taxRecoverable: taxRecoverable.toString(),
        netTaxDue: netTaxDue.toString(),
      },
    });

    return {
      ...updated,
      _audit: {
        transactionsScanned: txs.length,
        outputCount,
        inputCount,
      },
    };
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
