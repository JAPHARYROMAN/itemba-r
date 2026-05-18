import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentPaymentDto } from './dto/create-rent-payment.dto';
import { applyCompanyScopeWhere } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

@Injectable()
export class RentPaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async create(dto: CreateRentPaymentDto, userId: string) {
    // Idempotency: if the caller has supplied a key and a payment already exists
    // under (companyId, idempotencyKey), return the existing record verbatim.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.rentPayment.findFirst({
        where: {
          companyId: dto.companyId,
          idempotencyKey: dto.idempotencyKey,
          deletedAt: null,
        },
      });
      if (existing) return existing;
    }

    // Payment + invoice update + receivable update + JE posting must be atomic
    // — otherwise a successful payment followed by a failed downstream step
    // leaves the ledger out of sync.
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rentPayment.create({
        data: { ...dto, paymentDate: new Date(dto.paymentDate) },
      });

      const invoice = await tx.rentInvoice.findFirst({
        where: { id: dto.rentInvoiceId, deletedAt: null },
      });
      if (invoice) {
        const amount = new Prisma.Decimal(dto.amount);
        const newPaidAmount = new Prisma.Decimal(invoice.paidAmount || 0).plus(amount);
        const newOutstandingAmount = new Prisma.Decimal(invoice.outstandingAmount).minus(amount);
        const newStatus = newOutstandingAmount.lte(0) ? 'PAID' : 'PARTIALLY_PAID';

        await tx.rentInvoice.update({
          where: { id: dto.rentInvoiceId },
          data: {
            paidAmount: newPaidAmount,
            outstandingAmount: newOutstandingAmount,
            status: newStatus as any,
          },
        });

        // Mirror the payment against the linked Receivable (created when the
        // invoice was issued). Keeps AR aging accurate without the user having
        // to record the payment twice.
        if (invoice.receivableId) {
          const receivable = await tx.receivable.findUnique({
            where: { id: invoice.receivableId },
          });
          if (receivable) {
            const arPaid = new Prisma.Decimal(receivable.paidAmount).plus(amount);
            const arOutstanding = new Prisma.Decimal(receivable.outstandingAmount).minus(amount);
            await tx.receivable.update({
              where: { id: receivable.id },
              data: {
                paidAmount: arPaid,
                outstandingAmount: arOutstanding,
                status: arOutstanding.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
              },
            });
          }
        }

        // Post DR Cash (or CashAccount-linked) / CR AR Control for the receipt.
        const [arAccount, cashAccount] = await Promise.all([
          this.accountResolver.resolve(invoice.companyId, 'AR_CONTROL', tx),
          this.accountResolver.resolve(invoice.companyId, 'CASH_ON_HAND', tx),
        ]);
        await this.postingEngine.postLines(
          {
            companyId: invoice.companyId,
            transactionDate: new Date(dto.paymentDate),
            description: `Rent payment ${created.rentPaymentNumber} for ${invoice.rentInvoiceNumber}`,
            referenceType: 'RentPayment',
            referenceId: created.id,
            moduleName: 'rent-payments',
            userId,
            lines: [
              {
                accountId: cashAccount.id,
                debit: amount,
                description: `Cash received — rent`,
              },
              {
                accountId: arAccount.id,
                credit: amount,
                description: `AR settlement — ${invoice.rentInvoiceNumber}`,
              },
            ],
          },
          tx,
        );
      }

      return created;
    });

    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'RentPayment',
      entityId: payment.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return payment;
  }

  async findAll(companyId?: string, rentInvoiceId?: string, tenantId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (rentInvoiceId) where.rentInvoiceId = rentInvoiceId;
    if (tenantId) where.tenantId = tenantId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rentPayment.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.rentPayment.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.rentPayment.findFirst({
      where: { id, deletedAt: null },
      include: {
        tenant: { select: { name: true } },
        rentInvoice: { select: { rentInvoiceNumber: true } },
      },
    });
    if (!item) throw new NotFoundException('RentPayment not found');
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.rentPayment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RentPayment', entityId: id, newValue: {} });
    return { message: 'RentPayment deleted' };
  }
}
