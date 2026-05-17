import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateFuelCreditSaleDto } from './dto/create-fuel-credit-sale.dto';
import { UpdateFuelCreditSaleDto } from './dto/update-fuel-credit-sale.dto';

@Injectable()
export class FuelCreditSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateFuelCreditSaleDto, user: AuthUser) {
    const creditSaleNumber = await this.codes.next({ entityType: 'FuelCreditSale', companyId: dto.companyId });

    const sale = await this.prisma.fuelCreditSale.create({
      data: {
        creditSaleNumber,
        companyId: dto.companyId,
        branchId: dto.branchId,
        customerId: dto.customerId,
        productId: dto.productId,
        fuelShiftId: dto.fuelShiftId,
        vehicleNumber: dto.vehicleNumber,
        driverName: dto.driverName,
        litres: dto.litres,
        pricePerLitre: dto.pricePerLitre,
        totalAmount: dto.totalAmount,
        saleDate: new Date(dto.saleDate),
        salesOrderId: dto.salesOrderId,
        notes: dto.notes,
        status: 'OPEN',
        createdById: user.id,
      },
    });

    try {
      const receivableNumber = await this.codes.next({ entityType: 'Receivable', companyId: dto.companyId });
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId }, select: { divisionId: true } });
      const receivable = await this.prisma.receivable.create({
        data: {
          receivableNumber,
          companyId: dto.companyId,
          divisionId: branch?.divisionId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          customerName: customer?.name ?? 'Unknown',
          sourceType: 'FUEL_CREDIT_SALE',
          sourceId: sale.id,
          amount: dto.totalAmount,
          outstandingAmount: dto.totalAmount,
          paidAmount: 0,
          currency: CurrencyCode.TZS,
          issueDate: new Date(dto.saleDate),
        },
      });
      await this.prisma.fuelCreditSale.update({
        where: { id: sale.id },
        data: { receivableId: receivable.id },
      });
    } catch {
      // Receivable creation failure must not block the credit sale
    }

    const updated = await this.prisma.fuelCreditSale.findUnique({ where: { id: sale.id } });

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_CREATE',
      entityType: 'FuelCreditSale',
      entityId: sale.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async findAll(query: Record<string, string>) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelCreditSale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
      }),
      this.prisma.fuelCreditSale.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const sale = await this.prisma.fuelCreditSale.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        product: true,
        receivable: true,
      },
    });
    if (!sale) throw new NotFoundException('Fuel credit sale not found');

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_VIEW',
      entityType: 'FuelCreditSale',
      entityId: id,
      userId: user.id,
      companyId: sale.companyId,
    });

    return sale;
  }

  async update(id: string, dto: UpdateFuelCreditSaleDto, user: AuthUser) {
    const existing = await this.prisma.fuelCreditSale.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Fuel credit sale not found');
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Only OPEN credit sales can be updated');
    }

    const updated = await this.prisma.fuelCreditSale.update({
      where: { id },
      data: {
        ...(dto.customerId !== undefined && { customerId: dto.customerId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.fuelShiftId !== undefined && { fuelShiftId: dto.fuelShiftId }),
        ...(dto.vehicleNumber !== undefined && { vehicleNumber: dto.vehicleNumber }),
        ...(dto.driverName !== undefined && { driverName: dto.driverName }),
        ...(dto.litres !== undefined && { litres: dto.litres }),
        ...(dto.pricePerLitre !== undefined && { pricePerLitre: dto.pricePerLitre }),
        ...(dto.totalAmount !== undefined && { totalAmount: dto.totalAmount }),
        ...(dto.saleDate !== undefined && { saleDate: new Date(dto.saleDate) }),
        ...(dto.salesOrderId !== undefined && { salesOrderId: dto.salesOrderId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_UPDATE',
      entityType: 'FuelCreditSale',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async markInvoiced(id: string, user: AuthUser) {
    const existing = await this.prisma.fuelCreditSale.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Fuel credit sale not found');
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Only OPEN credit sales can be marked as invoiced');
    }

    const updated = await this.prisma.fuelCreditSale.update({
      where: { id },
      data: { status: 'INVOICED' },
    });

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_INVOICED',
      entityType: 'FuelCreditSale',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: 'OPEN' },
      newValue: { status: 'INVOICED' },
    });

    return updated;
  }

  async cancel(id: string, reason: string, user: AuthUser) {
    const existing = await this.prisma.fuelCreditSale.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Fuel credit sale not found');
    if (!['OPEN', 'INVOICED'].includes(existing.status)) {
      throw new BadRequestException('Only OPEN or INVOICED credit sales can be cancelled');
    }

    const notes = reason
      ? `[CANCELLED] ${reason}${existing.notes ? `\n${existing.notes}` : ''}`
      : existing.notes ?? undefined;

    const updated = await this.prisma.fuelCreditSale.update({
      where: { id },
      data: { status: 'CANCELLED', notes },
    });

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_CANCEL',
      entityType: 'FuelCreditSale',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'CANCELLED', reason },
    });

    return updated;
  }

  async softDelete(id: string, user: AuthUser) {
    const existing = await this.prisma.fuelCreditSale.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Fuel credit sale not found');
    if (!['OPEN', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestException('Only OPEN or CANCELLED credit sales can be deleted');
    }

    await this.prisma.fuelCreditSale.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_CREDIT_SALE_DELETE',
      entityType: 'FuelCreditSale',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
