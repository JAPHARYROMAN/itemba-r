import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentInvoiceDto } from './dto/create-rent-invoice.dto';
import { UpdateRentInvoiceDto } from './dto/update-rent-invoice.dto';
import { applyCompanyScopeWhere } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

function generateReceivableNumber(): string {
  return `AR-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class RentInvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async create(dto: CreateRentInvoiceDto, userId: string) {
    const item = await this.prisma.rentInvoice.create({
      data: {
        ...dto,
        invoiceDate: new Date(dto.invoiceDate),
        billingPeriodStart: new Date(dto.billingPeriodStart),
        billingPeriodEnd: new Date(dto.billingPeriodEnd),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RentInvoice', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, tenantId?: string, leaseAgreementId?: string, status?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (propertyId) where.propertyId = propertyId;
    if (tenantId) where.tenantId = tenantId;
    if (leaseAgreementId) where.leaseAgreementId = leaseAgreementId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rentInvoice.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.rentInvoice.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.rentInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        tenant: { select: { name: true } },
        leaseAgreement: { select: { leaseCode: true } },
        rentalUnit: { select: { unitNumber: true } },
      },
    });
    if (!item) throw new NotFoundException('RentInvoice not found');
    return item;
  }

  async update(id: string, dto: UpdateRentInvoiceDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.rentInvoice.update({
      where: { id },
      data: {
        ...dto,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
        billingPeriodStart: dto.billingPeriodStart ? new Date(dto.billingPeriodStart) : undefined,
        billingPeriodEnd: dto.billingPeriodEnd ? new Date(dto.billingPeriodEnd) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RentInvoice', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  /**
   * Phase 3B — issue a rent invoice. Atomically:
   *  1. Transition status DRAFT → ISSUED
   *  2. Create the backing Receivable (tenant becomes AR customer for this lease)
   *  3. Post DR AR Control / CR General Revenue for the invoice total
   *  4. Link invoice.receivableId → the new Receivable
   *
   * Idempotent on the invoice id — re-issuing an already-issued invoice is rejected
   * by the status guard so the JE is created at most once per invoice.
   */
  async issue(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new NotFoundException('Only DRAFT rent invoices can be issued');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const total = new Prisma.Decimal(existing.totalAmount);
      const tenant = await tx.tenant.findFirst({
        where: { id: existing.tenantId, deletedAt: null },
        select: { name: true, customerId: true },
      });

      // 1. Create the AR record. sourceType "RentInvoice" tells the Receivables
      //    service not to double-post when surfaced through that path.
      const receivable = await tx.receivable.create({
        data: {
          receivableNumber: generateReceivableNumber(),
          companyId: existing.companyId,
          customerId: tenant?.customerId ?? null,
          customerName: tenant?.name ?? 'Tenant',
          sourceType: 'RentInvoice',
          sourceId: existing.id,
          amount: total,
          paidAmount: 0,
          outstandingAmount: total,
          currency: existing.currency as any,
          issueDate: existing.invoiceDate,
          dueDate: existing.dueDate,
          status: 'OPEN',
          notes: `Rent invoice ${existing.rentInvoiceNumber}`,
        },
      });

      // 2. Post DR AR / CR Revenue inside the same tx.
      const [arAccount, revenueAccount] = await Promise.all([
        this.accountResolver.resolve(existing.companyId, 'AR_CONTROL', tx),
        this.accountResolver.resolve(existing.companyId, 'GENERAL_REVENUE', tx),
      ]);

      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: existing.companyId,
          transactionDate: existing.invoiceDate,
          description: `Rent invoice ${existing.rentInvoiceNumber}`,
          referenceType: 'RentInvoice',
          referenceId: existing.id,
          moduleName: 'rent-invoices',
          userId,
          lines: [
            {
              accountId: arAccount.id,
              debit: total,
              description: `AR — rent for ${tenant?.name ?? 'tenant'}`,
            },
            {
              accountId: revenueAccount.id,
              credit: total,
              description: `Rent revenue — ${existing.rentInvoiceNumber}`,
            },
          ],
        },
        tx,
      );

      // 3. Link receivable to JE and back-link invoice to receivable.
      await tx.receivable.update({
        where: { id: receivable.id },
        data: { journalEntryId: journalEntry.id },
      });

      const updated = await tx.rentInvoice.update({
        where: { id },
        data: { status: 'ISSUED' as any, receivableId: receivable.id },
      });

      return updated;
    });

    await this.audit.log({
      userId,
      action: 'ISSUE',
      entityType: 'RentInvoice',
      entityId: id,
      newValue: { status: 'ISSUED', receivableId: result.receivableId },
    });
    return result;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.rentInvoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RentInvoice', entityId: id, newValue: {} });
    return { message: 'RentInvoice deleted' };
  }
}
