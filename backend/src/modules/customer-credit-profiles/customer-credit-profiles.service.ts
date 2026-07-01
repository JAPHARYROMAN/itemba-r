import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, CreditRiskRating, CreditStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class CustomerCreditProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, customerId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (customerId) where.customerId = customerId;
    const [items, total] = await Promise.all([
      this.prisma.customerCreditProfile.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.customerCreditProfile.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const item = await this.prisma.customerCreditProfile.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Credit profile not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, item.companyId, AccessLevel.READ);
    }
    return item;
  }

  async create(dto: any, user: AuthUser) {
    if (!dto?.companyId) throw new BadRequestException('companyId is required');
    if (!dto?.customerId) throw new BadRequestException('customerId is required');

    // Authorize against the client-supplied companyId (never trust it blindly).
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    // The customer must belong to the same company the profile is being created under.
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.companyId !== dto.companyId) {
      throw new BadRequestException('Customer does not belong to the specified company');
    }

    const data = this.buildWriteData(dto, {
      companyId: dto.companyId,
      customerId: dto.customerId,
    }) as Prisma.CustomerCreditProfileUncheckedCreateInput;

    const item = await this.prisma.customerCreditProfile.create({ data });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'CustomerCreditProfile', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user);
    // Mutation requires WRITE on the record's own company; companyId/customerId are immutable.
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);

    const data = this.buildWriteData(dto, {}) as Prisma.CustomerCreditProfileUncheckedUpdateInput;
    if (Object.keys(data).length === 0) {
      return existing;
    }

    const updated = await this.prisma.customerCreditProfile.update({ where: { id }, data });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CustomerCreditProfile', entityId: id, userId: user.id, companyId: existing.companyId, oldValue: existing, newValue: updated });
    return updated;
  }

  /**
   * Whitelist and coerce only the mutable columns of CustomerCreditProfile.
   * Prevents mass-assignment: companyId/customerId are only ever set from
   * `fixed` (on create) and can never be tampered on update. Never writes
   * server-managed / non-existent columns (e.g. createdById does not exist).
   */
  private buildWriteData(
    dto: any,
    fixed: { companyId?: string; customerId?: string },
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    if (fixed.companyId !== undefined) data.companyId = fixed.companyId;
    if (fixed.customerId !== undefined) data.customerId = fixed.customerId;

    if (dto?.creditLimit !== undefined) {
      const creditLimit = new Prisma.Decimal(dto.creditLimit);
      if (creditLimit.isNaN() || creditLimit.lt(0)) {
        throw new BadRequestException('creditLimit must be a non-negative amount');
      }
      data.creditLimit = creditLimit;
    }
    if (dto?.currency !== undefined) data.currency = String(dto.currency);
    if (dto?.paymentTermsDays !== undefined && dto.paymentTermsDays !== null) {
      const days = Number(dto.paymentTermsDays);
      if (!Number.isInteger(days) || days < 0) {
        throw new BadRequestException('paymentTermsDays must be a non-negative integer');
      }
      data.paymentTermsDays = days;
    } else if (dto?.paymentTermsDays === null) {
      data.paymentTermsDays = null;
    }
    if (dto?.riskRating !== undefined) {
      if (!Object.values(CreditRiskRating).includes(dto.riskRating)) {
        throw new BadRequestException('Invalid riskRating');
      }
      data.riskRating = dto.riskRating;
    }
    if (dto?.creditStatus !== undefined) {
      if (!Object.values(CreditStatus).includes(dto.creditStatus)) {
        throw new BadRequestException('Invalid creditStatus');
      }
      data.creditStatus = dto.creditStatus;
    }
    if (dto?.currentOutstanding !== undefined) {
      const currentOutstanding = new Prisma.Decimal(dto.currentOutstanding);
      if (currentOutstanding.isNaN() || currentOutstanding.lt(0)) {
        throw new BadRequestException('currentOutstanding must be a non-negative amount');
      }
      data.currentOutstanding = currentOutstanding;
    }
    if (dto?.overdueAmount !== undefined) {
      const overdueAmount = new Prisma.Decimal(dto.overdueAmount);
      if (overdueAmount.isNaN() || overdueAmount.lt(0)) {
        throw new BadRequestException('overdueAmount must be a non-negative amount');
      }
      data.overdueAmount = overdueAmount;
    }
    if (dto?.lastReviewedAt !== undefined) {
      data.lastReviewedAt = dto.lastReviewedAt === null ? null : new Date(dto.lastReviewedAt);
    }
    if (dto?.reviewedById !== undefined) data.reviewedById = dto.reviewedById === null ? null : String(dto.reviewedById);
    if (dto?.notes !== undefined) data.notes = dto.notes === null ? null : String(dto.notes);

    return data;
  }
}
