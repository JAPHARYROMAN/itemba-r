import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, ExternalPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExternalPaymentDto } from './dto/create-external-payment.dto';
import { QueryExternalPaymentDto } from './dto/query-external-payment.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class ExternalPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
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

  async findAll(query: QueryExternalPaymentDto, includeSensitive: boolean, user?: any) {
    const { page = 1, limit = 20, companyId, providerId, status, paymentContextType } = query;
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 20;
    const skip = (pageNumber - 1) * limitNumber;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    if (paymentContextType) where.paymentContextType = paymentContextType;

    const [data, total] = await Promise.all([
      this.prisma.externalPayment.findMany({
        where,
        select: this.buildSelect(includeSensitive),
        orderBy: { initiatedAt: 'desc' },
        skip,
        take: limitNumber,
      }),
      this.prisma.externalPayment.count({ where }),
    ]);
    return {
      data,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async findOne(id: string, includeSensitive: boolean, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
      select: this.buildSelect(includeSensitive),
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async findOneForCompany(id: string, includeSensitive: boolean, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
      select: this.buildSelect(includeSensitive),
    });
    if (!record) throw new NotFoundException('External payment not found');
    return record;
  }

  async create(dto: CreateExternalPaymentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    return this.createTrusted(dto, user.id);
  }

  async createForCompany(dto: CreateExternalPaymentDto, actorId: string, companyId: string) {
    return this.createTrusted({ ...dto, companyId }, null, { integrationActorId: actorId });
  }

  private async createTrusted(
    dto: CreateExternalPaymentDto,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
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
        initiatedById: userId ?? null,
        idempotencyKey: dto.idempotencyKey,
      },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_CREATED',
      entityType: 'ExternalPayment',
      entityId: record.id,
      userId: userId ?? undefined,
      companyId: record.companyId,
      newValue: record as any,
      metadata,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  async confirm(id: string, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
    return this.confirmTrusted(record, user.id);
  }

  async confirmForCompany(id: string, actorId: string, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
    });
    if (!record) throw new NotFoundException('External payment not found');
    return this.confirmTrusted(record, null, { integrationActorId: actorId });
  }

  private async confirmTrusted(
    record: Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status === ExternalPaymentStatus.SUCCESS) {
      return this.prisma.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
    }
    if (
      record.status !== ExternalPaymentStatus.INITIATED &&
      record.status !== ExternalPaymentStatus.PENDING
    ) {
      throw new BadRequestException('Payment cannot be confirmed in its current status');
    }

    // ITMB-078: close the check-then-act race with a conditional atomic update
    // guarded on the current status so concurrent confirms cannot both win.
    const { count } = await this.prisma.externalPayment.updateMany({
      where: {
        id: record.id,
        status: { in: [ExternalPaymentStatus.INITIATED, ExternalPaymentStatus.PENDING] },
      },
      data: {
        status: ExternalPaymentStatus.SUCCESS,
        confirmedById: userId ?? null,
        confirmedAt: new Date(),
      },
    });
    if (count === 0) {
      // Another request already transitioned the row; return its current state.
      const current = await this.prisma.externalPayment.findUnique({
        where: { id: record.id },
      });
      if (current?.status === ExternalPaymentStatus.SUCCESS) {
        return this.prisma.externalPayment.findUnique({
          where: { id: record.id },
          select: this.buildSelect(false),
        });
      }
      throw new BadRequestException('Payment cannot be confirmed in its current status');
    }

    const updated = await this.prisma.externalPayment.findUnique({
      where: { id: record.id },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_CONFIRMED',
      entityType: 'ExternalPayment',
      entityId: record.id,
      userId: userId ?? undefined,
      companyId: record.companyId,
      metadata,
      severity: AuditSeverity.MEDIUM,
    });

    return updated;
  }

  async reverse(id: string, user: AuthUser) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('External payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
    return this.reverseTrusted(record, user.id);
  }

  async reverseForCompany(id: string, actorId: string, companyId: string) {
    const record = await this.prisma.externalPayment.findFirst({
      where: { id, deletedAt: null, companyId },
    });
    if (!record) throw new NotFoundException('External payment not found');
    return this.reverseTrusted(record, null, { integrationActorId: actorId });
  }

  private async reverseTrusted(
    record: Awaited<ReturnType<PrismaService['externalPayment']['findFirst']>>,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (!record) throw new NotFoundException('External payment not found');
    if (record.status === ExternalPaymentStatus.REVERSED) {
      return this.prisma.externalPayment.findUnique({
        where: { id: record.id },
        select: this.buildSelect(false),
      });
    }
    if (record.status !== ExternalPaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be reversed');
    }

    // ITMB-078: close the check-then-act race with a conditional atomic update
    // guarded on the SUCCESS status so concurrent reversals cannot both win.
    const { count } = await this.prisma.externalPayment.updateMany({
      where: {
        id: record.id,
        status: ExternalPaymentStatus.SUCCESS,
      },
      data: { status: ExternalPaymentStatus.REVERSED },
    });
    if (count === 0) {
      // Another request already transitioned the row; return its current state.
      const current = await this.prisma.externalPayment.findUnique({
        where: { id: record.id },
      });
      if (current?.status === ExternalPaymentStatus.REVERSED) {
        return this.prisma.externalPayment.findUnique({
          where: { id: record.id },
          select: this.buildSelect(false),
        });
      }
      throw new BadRequestException('Only successful payments can be reversed');
    }

    const updated = await this.prisma.externalPayment.findUnique({
      where: { id: record.id },
      select: this.buildSelect(false),
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_PAYMENT_REVERSED',
      entityType: 'ExternalPayment',
      entityId: record.id,
      userId: userId ?? undefined,
      companyId: record.companyId,
      metadata,
      severity: AuditSeverity.HIGH,
    });

    return updated;
  }
}
