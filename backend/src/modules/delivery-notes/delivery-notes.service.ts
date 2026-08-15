import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { UpdateDeliveryNoteDto, DeliverDto } from './dto/update-delivery-note.dto';
import { QueryDeliveryNoteDto } from './dto/query-delivery-note.dto';
import { applyCompanyScopeWhere } from '../../common/services';

/**
 * Server-derived facts about WHY a delivery note is being created. Deliberately
 * a separate argument rather than a DTO field, mirroring
 * SalesOrdersService.create(dto, user, context) and its
 * SalesOrderCreateContext.mobilePosTerminalId: nothing on this object may ever
 * be sourced from a request body, so no client can claim to be a counter sale.
 */
export interface DeliveryNoteCreateContext {
  /**
   * SalesOrder id of the POS counter sale this note is auto-issued for.
   *
   * Two jobs, both structural:
   *  - `delivery_notes_companyId_counterSaleOrderId_key` makes "one auto note
   *    per counter sale" a database guarantee, so a replayed or raced sale
   *    cannot produce a second note;
   *  - it marks the note as a COLLECTION rather than a DISPATCH, which is what
   *    keeps it out of every delivery worklist the office works from.
   *
   * Server-derived only. Never sourced from a DTO.
   */
  counterSaleOrderId?: string;
}

@Injectable()
export class DeliveryNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async create(
    dto: CreateDeliveryNoteDto,
    userId: string,
    context: DeliveryNoteCreateContext = {},
  ) {
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
          // NULL on every desk-created note; the sales-order id on a POS counter
          // sale. The unique index on (companyId, counterSaleOrderId) is what
          // decides a create race, so this value is written by the INSERT itself
          // rather than stamped afterwards.
          counterSaleOrderId: context.counterSaleOrderId ?? null,
          createdById: userId,
        },
      });
      await tx.deliveryNoteLine.createMany({
        // `dto.lines[].salesOrderLineId` is accepted by the DTO and deliberately
        // NOT written: `delivery_note_lines` has no such column, in the schema or
        // in any migration. Prisma strips `undefined` but forwards a DEFINED
        // value straight to the engine, which rejects the unknown argument — so
        // emitting it here failed every desk-created note (the modal always
        // sends a real sales-order line id). See CreateDeliveryNoteLineDto.
        //
        // The return-type annotation is load-bearing, and is why this went
        // unnoticed for so long: an un-annotated `.map()` infers its element type
        // FROM the literal, so there is nothing to check it against. Annotating
        // the callback makes the literal contextually typed and fresh, which
        // turns a non-column key into a build error instead of a 500.
        data: dto.lines.map(
          (l): Prisma.DeliveryNoteLineCreateManyInput => ({
            deliveryNoteId: dn.id,
            productId: l.productId,
            description: l.description,
            orderedQuantity: l.quantity,
            deliveredQuantity: l.quantity,
            unitId: l.unitId,
          }),
        ),
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
    const {
      page = 1,
      limit = 20,
      companyId,
      branchId,
      status,
      customerId,
      includeCounterSales,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    // The delivery-notes list is the office's DISPATCH worklist. A POS counter
    // sale is a collection — the customer already walked out with the goods —
    // so its auto-issued note is not work anybody has to do, and by default it
    // is not shown. Opt in explicitly to audit them.
    if (!includeCounterSales) where.counterSaleOrderId = null;

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
          // Same phantom column as in create() — never written, and guarded the
          // same way. See above.
          data: dto.lines.map(
            (l): Prisma.DeliveryNoteLineCreateManyInput => ({
              deliveryNoteId: id,
              productId: l.productId,
              description: l.description,
              orderedQuantity: l.quantity,
              deliveredQuantity: l.quantity,
              unitId: l.unitId,
            }),
          ),
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
