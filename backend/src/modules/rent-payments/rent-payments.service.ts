import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentPaymentDto } from './dto/create-rent-payment.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RentPaymentsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

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

    // Payment + invoice update must be atomic — otherwise a successful payment
    // followed by a failed invoice update leaves the ledger out of sync.
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rentPayment.create({
        data: { ...dto, paymentDate: new Date(dto.paymentDate) },
      });

      const invoice = await tx.rentInvoice.findFirst({
        where: { id: dto.rentInvoiceId, deletedAt: null },
      });
      if (invoice) {
        const newPaidAmount = Number(invoice.paidAmount || 0) + Number(dto.amount);
        const newOutstandingAmount = Number(invoice.outstandingAmount) - Number(dto.amount);
        const newStatus = newOutstandingAmount <= 0 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.rentInvoice.update({
          where: { id: dto.rentInvoiceId },
          data: {
            paidAmount: newPaidAmount,
            outstandingAmount: newOutstandingAmount,
            status: newStatus as any,
          },
        });
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
