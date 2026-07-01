import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { QueryDebtDto } from './dto/query-debt.dto';
import { AccessLevel, DebtStatus, Prisma } from '@prisma/client';

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /**
   * Derive the payment status from the amounts. A caller-supplied non-payment
   * state (WRITTEN_OFF / DISPUTED / RESTRUCTURED) is preserved; otherwise the
   * status is computed from amountPaid vs amount so the two can never drift.
   */
  private deriveStatus(
    amount: Prisma.Decimal,
    amountPaid: Prisma.Decimal,
    requested?: DebtStatus,
  ): DebtStatus {
    if (
      requested === DebtStatus.WRITTEN_OFF ||
      requested === DebtStatus.DISPUTED ||
      requested === DebtStatus.RESTRUCTURED
    ) {
      return requested;
    }
    if (amountPaid.lessThanOrEqualTo(0)) return DebtStatus.OUTSTANDING;
    if (amountPaid.greaterThanOrEqualTo(amount)) return DebtStatus.PAID;
    return DebtStatus.PARTIALLY_PAID;
  }

  async findAll(query: QueryDebtDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, status, riskLevel, search, dueBefore } = query;
    const skip = (page - 1) * limit;
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.DebtWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (status) where.status = status;
    if (riskLevel) where.riskLevel = riskLevel;
    if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };
    if (search) {
      where.OR = [
        { creditorName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.debt.findMany({
        where,
        include: { company: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.debt.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.debt.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!record) throw new NotFoundException('Debt not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
      await this.auditLogs.log({
        action: 'debt.view',
        entityType: 'Debt',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        metadata: { creditorName: record.creditorName },
      });
    }
    return record;
  }

  async create(dto: CreateDebtDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const createdById = user.id;
    const amount = new Prisma.Decimal(dto.amount);
    const amountPaid = dto.amountPaid ? new Prisma.Decimal(dto.amountPaid) : new Prisma.Decimal(0);
    if (amount.isNegative()) {
      throw new BadRequestException('amount must be >= 0');
    }
    if (amountPaid.isNegative()) {
      throw new BadRequestException('amountPaid must be >= 0');
    }
    if (amountPaid.greaterThan(amount)) {
      throw new BadRequestException('amountPaid cannot exceed amount');
    }
    const status = this.deriveStatus(amount, amountPaid, dto.status);
    const record = await this.prisma.debt.create({
      data: {
        companyId: dto.companyId,
        creditorName: dto.creditorName,
        creditorContact: dto.creditorContact,
        amount,
        amountPaid,
        currency: dto.currency,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        description: dto.description,
        invoiceNumber: dto.invoiceNumber,
        status,
        riskLevel: dto.riskLevel,
        notes: dto.notes,
        createdById,
      },
    });
    await this.auditLogs.log({
      action: 'debt.create',
      entityType: 'Debt',
      entityId: record.id,
      userId: createdById,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateDebtDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const actorId = user.id;

    // Validate the resulting amount / amountPaid server-side so a client cannot
    // set amountPaid above the debt amount (or negative).
    const nextAmount =
      dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : new Prisma.Decimal(existing.amount);
    const nextAmountPaid =
      dto.amountPaid !== undefined
        ? dto.amountPaid
          ? new Prisma.Decimal(dto.amountPaid)
          : new Prisma.Decimal(0)
        : new Prisma.Decimal(existing.amountPaid);
    if (nextAmount.isNegative()) {
      throw new BadRequestException('amount must be >= 0');
    }
    if (nextAmountPaid.isNegative()) {
      throw new BadRequestException('amountPaid must be >= 0');
    }
    if (nextAmountPaid.greaterThan(nextAmount)) {
      throw new BadRequestException('amountPaid cannot exceed amount');
    }

    // Derive the payment status server-side from the resulting amounts whenever
    // amounts or status are touched, so amountPaid and status can never drift
    // out of sync. Non-payment states (WRITTEN_OFF/DISPUTED/LEGAL_ACTION) the
    // caller explicitly sets are preserved.
    const amountsChanged = dto.amount !== undefined || dto.amountPaid !== undefined;
    const nextStatus =
      amountsChanged || dto.status !== undefined
        ? this.deriveStatus(nextAmount, nextAmountPaid, dto.status ?? existing.status)
        : undefined;

    const record = await this.prisma.debt.update({
      where: { id },
      data: {
        ...(dto.creditorName && { creditorName: dto.creditorName }),
        ...(dto.creditorContact !== undefined && { creditorContact: dto.creditorContact }),
        ...(dto.amount && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.amountPaid !== undefined && {
          amountPaid: dto.amountPaid ? new Prisma.Decimal(dto.amountPaid) : new Prisma.Decimal(0),
        }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
        ...(dto.description && { description: dto.description }),
        ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
        ...(nextStatus !== undefined && { status: nextStatus }),
        ...(dto.riskLevel && { riskLevel: dto.riskLevel }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({
      action: 'debt.update',
      entityType: 'Debt',
      entityId: id,
      userId: actorId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const actorId = user.id;
    await this.prisma.debt.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'debt.delete',
      entityType: 'Debt',
      entityId: id,
      userId: actorId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }

  async getSummary(user: AuthUser) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const scope: Prisma.DebtWhereInput =
      accessibleIds === null ? {} : { companyId: { in: accessibleIds } };
    const base: Prisma.DebtWhereInput = { deletedAt: null, ...scope };
    // A debt still owes money while it is OUTSTANDING or PARTIALLY_PAID; the
    // remaining liability is amount - amountPaid, not the gross amount. Only
    // these two statuses have a positive balance (PAID/WRITTEN_OFF/DISPUTED/
    // RESTRUCTURED are excluded).
    const outstanding: Prisma.DebtWhereInput = {
      ...base,
      status: { in: [DebtStatus.OUTSTANDING, DebtStatus.PARTIALLY_PAID] },
    };

    const [
      totalCount,
      outstandingCount,
      overdueCount,
      highRiskCount,
      totalAmount,
      totalOutstanding,
    ] = await Promise.all([
      this.prisma.debt.count({ where: base }),
      this.prisma.debt.count({ where: outstanding }),
      this.prisma.debt.count({ where: { ...outstanding, dueDate: { lt: new Date() } } }),
      this.prisma.debt.count({ where: { ...base, riskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
      this.prisma.debt.aggregate({ where: base, _sum: { amount: true } }),
      // Sum both columns for the owed set so we can net amountPaid off amount.
      this.prisma.debt.aggregate({ where: outstanding, _sum: { amount: true, amountPaid: true } }),
    ]);
    const outstandingGross = totalOutstanding._sum.amount ?? new Prisma.Decimal(0);
    const outstandingPaid = totalOutstanding._sum.amountPaid ?? new Prisma.Decimal(0);
    const totalOutstandingAmount = new Prisma.Decimal(outstandingGross).minus(outstandingPaid);
    return {
      totalCount,
      outstandingCount,
      overdueCount,
      highRiskCount,
      totalAmount: totalAmount._sum.amount ?? 0,
      totalOutstandingAmount,
    };
  }

  async getOverdue(user: AuthUser) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.DebtWhereInput = {
      deletedAt: null,
      status: DebtStatus.OUTSTANDING,
      dueDate: { lt: new Date() },
      ...(accessibleIds === null ? {} : { companyId: { in: accessibleIds } }),
    };
    return this.prisma.debt.findMany({
      where,
      include: { company: { select: { id: true, name: true, code: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  async getAuditHistory(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Debt', entityId: id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
