import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { UpdateDeliveryNoteDto, DeliverDto } from './dto/update-delivery-note.dto';
import { QueryDeliveryNoteDto } from './dto/query-delivery-note.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateDeliveryNoteDto, userId: string) {
    const deliveryNoteNumber = await this.codes.next({ entityType: 'DeliveryNote', companyId: dto.companyId });

    const record = await this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.create({
        data: {
          deliveryNoteNumber,
          companyId: dto.companyId,
          branchId: dto.branchId,
          salesOrderId: dto.salesOrderId,
          customerId: dto.customerId,
          customerName: dto.customerName,
          deliveryDate: new Date(dto.deliveryDate),
          deliveryAddress: dto.deliveryAddress,
          deliveredById: dto.deliveredById,
          vehicleNumber: dto.vehicleNumber,
          driverName: dto.driverName,
          status: 'DRAFT',
          notes: dto.notes,
          createdById: userId,
        },
      });
      await tx.deliveryNoteLine.createMany({
        data: dto.lines.map((l) => ({
          deliveryNoteId: dn.id,
          productId: l.productId,
          description: l.description,
          orderedQuantity: l.quantity,
          deliveredQuantity: l.quantity,
          unitId: l.unitId,
          salesOrderLineId: l.salesOrderLineId,
        })),
      });
      return dn;
    });

    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_CREATE',
      entityType: 'DeliveryNote',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return this.findOne(record.id);
  }

  async findAll(query: QueryDeliveryNoteDto, user?: any) {
    const { page = 1, limit = 20, companyId, branchId, status, customerId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [data, total] = await Promise.all([
      this.prisma.deliveryNote.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.deliveryNote.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: any) {
    const where: any = { id, deletedAt: null };
    if (user) applyCompanyScopeWhere(where, user);
    const record = await this.prisma.deliveryNote.findFirst({
      where,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            website: true,
            logoUrl: true,
            group: { select: { name: true, code: true, address: true, phone: true, email: true, website: true } },
            profile: {
              select: {
                registeredName: true,
                tradingName: true,
                brelaRegNumber: true,
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
        customer: { select: { id: true, name: true, customerCode: true, phone: true, email: true, address: true, contactPerson: true } },
        salesOrder: { select: { id: true, salesOrderNumber: true, orderDate: true } },
        deliveredBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true, productCode: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Delivery note not found');
    return record;
  }

  async update(id: string, dto: UpdateDeliveryNoteDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Can only update DRAFT delivery notes');

    await this.prisma.$transaction(async (tx) => {
      if (dto.lines?.length) {
        await tx.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: id } });
        await tx.deliveryNoteLine.createMany({
          data: dto.lines.map((l) => ({
            deliveryNoteId: id,
            productId: l.productId,
            description: l.description,
            orderedQuantity: l.quantity,
            deliveredQuantity: l.quantity,
            unitId: l.unitId,
            salesOrderLineId: l.salesOrderLineId,
          })),
        });
      }
      await tx.deliveryNote.update({
        where: { id },
        data: {
          ...(dto.deliveryDate && { deliveryDate: new Date(dto.deliveryDate) }),
          ...(dto.deliveryAddress !== undefined && { deliveryAddress: dto.deliveryAddress }),
          ...(dto.deliveredById !== undefined && { deliveredById: dto.deliveredById }),
          ...(dto.vehicleNumber !== undefined && { vehicleNumber: dto.vehicleNumber }),
          ...(dto.driverName !== undefined && { driverName: dto.driverName }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_UPDATE',
      entityType: 'DeliveryNote',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return this.findOne(id);
  }

  async dispatch(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT notes can be dispatched');
    const record = await this.prisma.deliveryNote.update({ where: { id }, data: { status: 'DISPATCHED' } });
    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_DISPATCHED',
      entityType: 'DeliveryNote',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async deliver(id: string, dto: DeliverDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DISPATCHED') throw new BadRequestException('Only DISPATCHED notes can be delivered');
    const record = await this.prisma.deliveryNote.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        ...(dto.receivedByName && { receivedByName: dto.receivedByName }),
        ...(dto.receivedByPhone && { receivedByPhone: dto.receivedByPhone }),
      },
    });
    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_DELIVERED',
      entityType: 'DeliveryNote',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async cancel(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (!['DRAFT', 'DISPATCHED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or DISPATCHED notes can be cancelled');
    }
    const record = await this.prisma.deliveryNote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_CANCELLED',
      entityType: 'DeliveryNote',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT notes can be deleted');
    await this.prisma.deliveryNote.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'DELIVERY_NOTE_DELETE',
      entityType: 'DeliveryNote',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
