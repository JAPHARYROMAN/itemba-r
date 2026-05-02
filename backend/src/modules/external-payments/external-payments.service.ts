import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity, ExternalPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExternalPaymentDto } from './dto/create-external-payment.dto';
import { QueryExternalPaymentDto } from './dto/query-external-payment.dto';

@Injectable()
export class ExternalPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private buildSelect(includeSensitive: boolean) {
    const base: any = {
      id: true,
      paymentNumber: true,
      companyId: true,
      providerId: true,
      connectionId: true,
      paymentContextType: true,
      paymentContextId: true,
      externalReference: true,
      payerName: true,
      payerPhone: true,
      amount: true,
      currency: true,
      paymentMethod: true,
      status: true,
      initiatedById: true,
      confirmedById: true,
      initiatedAt: true,
      confirmedAt: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
    };
    if (includeSensitive) base.rawProviderResponse = true;
    return base;
  }

  async findAll(query: QueryExternalPaymentDto, includeSensitive: boolean) {
    const { page = 1, limit = 20, companyId, providerId, status, paymentContextType } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    if (paymentContextType) where.paymentContextType = paymentContextType;

    const [data, total] = await Promise.all([
      this.prisma.externalPayment.findMany({
        where,
        select: this.buildSelect(includeSensitive),
        orderBy: { initiatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.externalPayment.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, includeSensitive: boolean, companyId?: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
      select: this.buildSelect(includeSensitive),
    });
    if (!record) throw new NotFoundException('External payment not found');
    return record;
  }

  async create(dto: CreateExternalPaymentDto, userId: string) {
    if (dto.idempotencyKey) {
      const replay = await this.prisma.externalPayment.findFirst({
        where: {
          companyId: dto.companyId,
          idempotencyKey: dto.idempotencyKey,
          deletedAt: null,
        },
        select: this.buildSelect(false),
      });
      if (replay) return replay;
    }

    const paymentNumber = `PAY-${Date.now().toString(36).toUpperCase()}`;

    const record = await this.prisma.externalPayment.create({
      data: {
        paymentNumber,
        companyId: dto.companyId,
        providerId: dto.providerId,
        connectionId: dto.connectionId,
        paymentContextType: dto.paymentContextType,
        paymentContextId: dto.paymentContextId,
        externalReference: dto.externalReference,
        payerName: dto.payerName,
        payerPhone: dto.payerPhone,
        amount: dto.amount,
        currency: dto.currency ?? 'TZS',
        paymentMethod: dto.paymentMethod,
        status: ExternalPaymentStatus.INITIATED,
        initiatedById: userId,
        idempotencyKey: dto.idempotencyKey,
      },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_CREATED',
      entityType: 'ExternalPayment',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  async confirm(id: string, userId: string, companyId?: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
    });
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status !== ExternalPaymentStatus.INITIATED && record.status !== ExternalPaymentStatus.PENDING) {
      throw new BadRequestException('Payment cannot be confirmed in its current status');
    }

    const updated = await this.prisma.externalPayment.update({
      where: { id },
      data: {
        status: ExternalPaymentStatus.SUCCESS,
        confirmedById: userId,
        confirmedAt: new Date(),
      },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_CONFIRMED',
      entityType: 'ExternalPayment',
      entityId: id,
      userId,
      companyId: record.companyId,
      severity: AuditSeverity.MEDIUM,
    });

    return updated;
  }

  async reverse(id: string, userId: string, companyId?: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
    });
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status !== ExternalPaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be reversed');
    }

    const updated = await this.prisma.externalPayment.update({
      where: { id },
      data: { status: ExternalPaymentStatus.REVERSED },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_REVERSED',
      entityType: 'ExternalPayment',
      entityId: id,
      userId,
      companyId: record.companyId,
      severity: AuditSeverity.HIGH,
    });

    return updated;
  }
}
