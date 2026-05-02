import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateSalesCommissionDto,
  SalesCommissionBasisDto,
} from './dto/create-sales-commission.dto';
import { UpdateSalesCommissionDto } from './dto/update-sales-commission.dto';
import { applyCompanyScopeWhere } from '../../common/services';

/**
 * Sales-commission lifecycle:
 *
 *   DRAFT       — created (manually now; auto on order paid in Sprint D)
 *   APPROVED    — manager-approved; payroll calculator picks these up as
 *                 a non-statutory "Sales Commission" allowance on the next
 *                 pay period for the linked employee
 *   PAID        — picked up by a payroll run that subsequently reached PAID;
 *                 `paidPayrollEntryId` set
 *   CANCELLED   — voided (e.g. order returned)
 *
 * The amount is snapshotted at creation/approval so subsequent policy or
 * order-amount changes don't retroactively alter approved commissions.
 */
@Injectable()
export class SalesCommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, salesOrderId, status, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (employeeId) where.employeeId = employeeId;
    if (salesOrderId) where.salesOrderId = salesOrderId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.salesCommission.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true } },
          salesOrder: {
            select: {
              id: true,
              salesOrderNumber: true,
              orderDate: true,
              subtotal: true,
              totalAmount: true,
              status: true,
              paymentStatus: true,
            },
          },
        },
      }),
      this.prisma.salesCommission.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.salesCommission.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true } },
        salesOrder: true,
        paidPayrollEntry: {
          select: {
            id: true,
            payrollRunId: true,
            netPay: true,
            payrollRun: { select: { payrollRunNumber: true, paidAt: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales commission not found');
    return record;
  }

  /**
   * Create a commission for a sales order. If `dto.amount` is omitted, the
   * service derives it from basis × rate applied to the order's subtotal/net.
   */
  async create(dto: CreateSalesCommissionDto, user: any) {
    if (!dto.salesOrderId) {
      throw new BadRequestException('salesOrderId is required.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId: dto.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('Employee not found in this company');

    const order = await this.prisma.salesOrder.findFirst({
      where: { id: dto.salesOrderId, companyId: dto.companyId, deletedAt: null },
      select: { subtotal: true, discountAmount: true, totalAmount: true, currency: true },
    });
    if (!order) throw new NotFoundException('Sales order not found for this company');
    const source: { subtotal: unknown; discountAmount?: unknown; totalAmount?: unknown; currency: string } = order;

    const amount = dto.amount ?? this.computeAmount(source, dto.basis, dto.rate);
    if (amount < 0) throw new BadRequestException('Commission amount must be non-negative');

    const record = await this.prisma.salesCommission.create({
      data: {
        companyId: dto.companyId,
        employeeId: dto.employeeId,
        salesOrderId: dto.salesOrderId,
        basis: dto.basis,
        rate: dto.basis === SalesCommissionBasisDto.FLAT ? 0 : dto.rate,
        amount,
        currency: source.currency,
        notes: dto.notes,
        status: 'DRAFT',
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'SalesCommission',
      entityId: record.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateSalesCommissionDto, user: any) {
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT commissions can be edited');
    }

    let nextAmount: number | undefined = dto.amount;
    if (dto.basis !== undefined || dto.rate !== undefined) {
      const basis = dto.basis ?? (existing.basis as SalesCommissionBasisDto);
      const rate = dto.rate ?? Number(existing.rate);
      if (dto.amount === undefined) {
        const src = existing.salesOrder;
        if (src) {
          nextAmount = this.computeAmount(
            {
              subtotal: src.subtotal,
              discountAmount: src.discountAmount,
              totalAmount: src.totalAmount,
            },
            basis,
            rate,
          );
        }
      }
    }

    const record = await this.prisma.salesCommission.update({
      where: { id },
      data: {
        ...(dto.basis ? { basis: dto.basis } : {}),
        ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
        ...(nextAmount !== undefined ? { amount: nextAmount } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SalesCommission',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async approve(id: string, user: any) {
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT commissions can be approved');
    }
    const record = await this.prisma.salesCommission.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SalesCommission',
      entityId: id,
      newValue: { status: 'APPROVED' },
    });
    return record;
  }

  async cancel(id: string, reason: string | undefined, user: any) {
    const existing = await this.findOne(id, user);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Cannot cancel a commission already paid via payroll');
    }
    const record = await this.prisma.salesCommission.update({
      where: { id },
      data: { status: 'CANCELLED', notes: reason ?? existing.notes },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SalesCommission',
      entityId: id,
      newValue: { status: 'CANCELLED', reason },
    });
    return record;
  }

  async remove(id: string, user: any) {
    const existing = await this.findOne(id, user);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Cannot delete a paid commission');
    }
    await this.prisma.salesCommission.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'SalesCommission',
      entityId: id,
      newValue: {},
    });
    return { message: 'Sales commission deleted' };
  }

  /**
   * Compute commission amount for given basis × rate against an order.
   * NET basis = subtotal − discount (pre-tax net). FLAT returns rate as-is
   * but commissions go via dto.amount in that case (we use 0 here as a
   * conservative default).
   */
  private computeAmount(
    order: { subtotal: unknown; discountAmount?: unknown; totalAmount?: unknown },
    basis: SalesCommissionBasisDto | string,
    rate: number,
  ): number {
    const sub = Number(order.subtotal ?? 0);
    const disc = Number(order.discountAmount ?? 0);
    let base = 0;
    switch (basis) {
      case 'GROSS':
        base = sub;
        break;
      case 'NET':
        base = Math.max(0, sub - disc);
        break;
      case 'FLAT':
        return 0;
      default:
        base = sub;
    }
    return Math.round(base * rate * 100) / 100;
  }
}
