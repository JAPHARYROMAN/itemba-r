import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma, SupplierOrderDraftStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import {
  CreateSupplierOrderDraftDto,
  QuerySupplierOrderDraftDto,
  SupplierOrderDraftExportAuditDto,
  SupplierOrderDraftLineDto,
  UpdateSupplierOrderDraftDto,
} from './dto/supplier-order-draft.dto';

const draftInclude = Prisma.validator<Prisma.SupplierOrderDraftInclude>()({
  company: {
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
      email: true,
      website: true,
      logoUrl: true,
      group: { select: { name: true, address: true, phone: true, email: true, website: true } },
      profile: {
        select: {
          registeredName: true,
          brelaRegNumber: true,
          tin: true,
          vrn: true,
          registeredAddress: true,
          postalAddress: true,
        },
      },
    },
  },
  division: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true, address: true } },
  supplier: { select: { id: true, name: true, supplierCode: true, status: true } },
  createdBy: { select: { id: true, fullName: true, email: true } },
  lines: { orderBy: { lineNumber: 'asc' as const } },
});

type DraftPayload = Prisma.SupplierOrderDraftGetPayload<{ include: typeof draftInclude }>;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class SupplierOrderDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QuerySupplierOrderDraftDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const where: Prisma.SupplierOrderDraftWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      ...(query.divisionId && { divisionId: query.divisionId }),
      ...(query.branchId && { branchId: query.branchId }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.status && { status: query.status }),
      ...((query.dateFrom || query.dateTo) && {
        draftDate: {
          ...(query.dateFrom && { gte: dateRangeStart(query.dateFrom) }),
          ...(query.dateTo && { lte: dateRangeEnd(query.dateTo) }),
        },
      }),
      ...(query.search && {
        OR: [
          { draftNumber: { contains: query.search, mode: 'insensitive' } },
          { supplierName: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
          { lines: { some: { description: { contains: query.search, mode: 'insensitive' } } } },
        ],
      }),
    };

    const [data, total, grouped] = await Promise.all([
      this.prisma.supplierOrderDraft.findMany({
        where,
        include: draftInclude,
        orderBy: [{ draftDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supplierOrderDraft.count({ where }),
      this.prisma.supplierOrderDraft.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: grouped.map((row) => ({
        status: row.status,
        count: row._count._all,
        totalAmount: Number(row._sum.totalAmount ?? 0),
      })),
    };
  }

  async findOne(
    id: string,
    user: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ): Promise<DraftPayload> {
    const draft = await this.prisma.supplierOrderDraft.findFirst({
      where: { id, deletedAt: null },
      include: draftInclude,
    });
    if (!draft) throw new NotFoundException('Supplier order draft not found');
    await this.companyScope.assertCanAccessCompany(user, draft.companyId, minimum);
    return draft;
  }

  async create(dto: CreateSupplierOrderDraftDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.validateScope(dto.companyId, dto.divisionId, dto.branchId);
    const supplier = await this.resolveSupplier(dto);
    const totals = this.calculateLines(dto.lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const draftNumber = await this.codes.next({
        companyId: dto.companyId,
        entityType: 'SupplierOrderDraft',
        tx,
      });
      return tx.supplierOrderDraft.create({
        data: {
          draftNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId || null,
          branchId: dto.branchId || null,
          supplierId: supplier.supplierId,
          supplierName: supplier.name,
          supplierAddress: supplier.address,
          supplierContact: supplier.contact,
          supplierTin: supplier.tin,
          supplierVrn: supplier.vrn,
          supplierPhone: supplier.phone,
          supplierEmail: supplier.email,
          draftDate: new Date(dto.draftDate),
          neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
          currency: dto.currency,
          title: this.clean(dto.title),
          deliveryInstructions: this.clean(dto.deliveryInstructions),
          terms: this.clean(dto.terms),
          notes: this.clean(dto.notes),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          hasUnpricedLines: totals.hasUnpricedLines,
          createdById: user.id,
          lines: { create: totals.lines },
        },
        include: draftInclude,
      });
    });

    await this.audit('SUPPLIER_ORDER_DRAFT_CREATE', created, user, undefined, {
      draftNumber: created.draftNumber,
      status: created.status,
      hasUnpricedLines: created.hasUnpricedLines,
    });
    return created;
  }

  async update(id: string, dto: UpdateSupplierOrderDraftDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    this.requireDraft(existing.status, 'edit');
    if (dto.companyId !== existing.companyId) {
      throw new BadRequestException('The company cannot be changed after a draft is created');
    }
    await this.validateScope(existing.companyId, dto.divisionId, dto.branchId);
    const supplier = await this.resolveSupplier(dto);
    const totals = this.calculateLines(dto.lines);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplierOrderDraftLine.deleteMany({ where: { draftId: id } });
      return tx.supplierOrderDraft.update({
        where: { id },
        data: {
          divisionId: dto.divisionId || null,
          branchId: dto.branchId || null,
          supplierId: supplier.supplierId,
          supplierName: supplier.name,
          supplierAddress: supplier.address,
          supplierContact: supplier.contact,
          supplierTin: supplier.tin,
          supplierVrn: supplier.vrn,
          supplierPhone: supplier.phone,
          supplierEmail: supplier.email,
          draftDate: new Date(dto.draftDate),
          neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
          currency: dto.currency,
          title: this.clean(dto.title),
          deliveryInstructions: this.clean(dto.deliveryInstructions),
          terms: this.clean(dto.terms),
          notes: this.clean(dto.notes),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          hasUnpricedLines: totals.hasUnpricedLines,
          lines: { create: totals.lines },
        },
        include: draftInclude,
      });
    });

    await this.audit('SUPPLIER_ORDER_DRAFT_UPDATE', updated, user, {
      supplierName: existing.supplierName,
      totalAmount: Number(existing.totalAmount),
    });
    return updated;
  }

  async duplicate(id: string, user: AuthUser) {
    const source = await this.findOne(id, user, AccessLevel.WRITE);
    const dto: CreateSupplierOrderDraftDto = {
      companyId: source.companyId,
      divisionId: source.divisionId ?? undefined,
      branchId: source.branchId ?? undefined,
      supplierId: source.supplierId ?? undefined,
      supplierName: source.supplierName,
      supplierAddress: source.supplierAddress ?? undefined,
      supplierContact: source.supplierContact ?? undefined,
      supplierTin: source.supplierTin ?? undefined,
      supplierVrn: source.supplierVrn ?? undefined,
      supplierPhone: source.supplierPhone ?? undefined,
      supplierEmail: source.supplierEmail ?? undefined,
      draftDate: new Date().toISOString(),
      neededBy: source.neededBy?.toISOString(),
      currency: source.currency,
      title: source.title ? `Copy of ${source.title}` : `Copy of ${source.draftNumber}`,
      deliveryInstructions: source.deliveryInstructions ?? undefined,
      terms: source.terms ?? undefined,
      notes: source.notes ?? undefined,
      lines: source.lines.map((line) => ({
        itemCode: line.itemCode ?? undefined,
        description: line.description,
        quantity: Number(line.quantity),
        unitLabel: line.unitLabel,
        unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
        discountAmount: Number(line.discountAmount),
        taxAmount: Number(line.taxAmount),
        notes: line.notes ?? undefined,
      })),
    };
    const created = await this.create(dto, user);
    await this.audit('SUPPLIER_ORDER_DRAFT_DUPLICATE', created, user, undefined, {
      sourceDraftId: source.id,
      sourceDraftNumber: source.draftNumber,
    });
    return created;
  }

  async send(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.WRITE);
    this.requireDraft(draft.status, 'mark as sent');
    return this.transition(draft, SupplierOrderDraftStatus.SENT, user, { sentAt: new Date() });
  }

  async accept(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.WRITE);
    this.requireStatus(draft.status, SupplierOrderDraftStatus.SENT, 'accept');
    return this.transition(draft, SupplierOrderDraftStatus.ACCEPTED, user, {
      acceptedAt: new Date(),
    });
  }

  async decline(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.WRITE);
    this.requireStatus(draft.status, SupplierOrderDraftStatus.SENT, 'decline');
    return this.transition(draft, SupplierOrderDraftStatus.DECLINED, user, {
      declinedAt: new Date(),
    });
  }

  async cancel(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.WRITE);
    if (
      draft.status !== SupplierOrderDraftStatus.DRAFT &&
      draft.status !== SupplierOrderDraftStatus.SENT
    ) {
      throw new BadRequestException('Only draft or sent supplier orders can be cancelled');
    }
    return this.transition(draft, SupplierOrderDraftStatus.CANCELLED, user, {
      cancelledAt: new Date(),
    });
  }

  async reopen(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.MANAGE);
    if (draft.status === SupplierOrderDraftStatus.DRAFT) return draft;
    return this.transition(draft, SupplierOrderDraftStatus.DRAFT, user, {
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      cancelledAt: null,
    });
  }

  async remove(id: string, user: AuthUser) {
    const draft = await this.findOne(id, user, AccessLevel.WRITE);
    this.requireDraft(draft.status, 'delete');
    await this.prisma.supplierOrderDraft.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit('SUPPLIER_ORDER_DRAFT_DELETE', draft, user);
    return { success: true };
  }

  async auditExport(id: string, dto: SupplierOrderDraftExportAuditDto, user: AuthUser) {
    const draft = await this.findOne(id, user);
    await this.audit('SUPPLIER_ORDER_DRAFT_EXPORT', draft, user, undefined, {
      format: dto.format,
      draftNumber: draft.draftNumber,
    });
    return { success: true };
  }

  private async transition(
    draft: DraftPayload,
    status: SupplierOrderDraftStatus,
    user: AuthUser,
    data: Prisma.SupplierOrderDraftUpdateInput,
  ) {
    const updated = await this.prisma.supplierOrderDraft.update({
      where: { id: draft.id },
      data: { ...data, status },
      include: draftInclude,
    });
    await this.audit(
      'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
      updated,
      user,
      {
        status: draft.status,
      },
      { status },
    );
    return updated;
  }

  private async validateScope(companyId: string, divisionId?: string, branchId?: string) {
    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!division)
        throw new BadRequestException('Division does not belong to the selected company');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, division: { companyId }, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('Branch does not belong to the selected company');
    }
  }

  private async resolveSupplier(dto: CreateSupplierOrderDraftDto) {
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: dto.companyId, deletedAt: null },
      });
      if (!supplier)
        throw new BadRequestException('Supplier does not belong to the selected company');
      return {
        supplierId: supplier.id,
        name: supplier.name,
        address: supplier.address,
        contact: supplier.contactPerson,
        tin: supplier.tin,
        vrn: supplier.vrn,
        phone: supplier.phone,
        email: supplier.email,
      };
    }

    const name = this.clean(dto.supplierName);
    if (!name) throw new BadRequestException('Supplier name is required');
    return {
      supplierId: null,
      name,
      address: this.clean(dto.supplierAddress),
      contact: this.clean(dto.supplierContact),
      tin: this.clean(dto.supplierTin),
      vrn: this.clean(dto.supplierVrn),
      phone: this.clean(dto.supplierPhone),
      email: this.clean(dto.supplierEmail),
    };
  }

  private calculateLines(lines: SupplierOrderDraftLineDto[]) {
    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let totalAmount = 0;
    let hasUnpricedLines = false;

    const calculated = lines.map((line, index) => {
      const quantity = Number(line.quantity);
      const discount = Number(line.discountAmount ?? 0);
      const tax = Number(line.taxAmount ?? 0);
      const unitPrice =
        line.unitPrice === null || line.unitPrice === undefined ? null : Number(line.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`Line ${index + 1} quantity must be greater than zero`);
      }
      if (discount < 0 || tax < 0) {
        throw new BadRequestException(`Line ${index + 1} discount and tax cannot be negative`);
      }
      if (unitPrice === null) {
        hasUnpricedLines = true;
        if (discount > 0 || tax > 0) {
          throw new BadRequestException(
            `Line ${index + 1} cannot have discount or tax without a price`,
          );
        }
        return {
          lineNumber: index + 1,
          itemCode: this.clean(line.itemCode),
          description: line.description.trim(),
          quantity,
          unitLabel: line.unitLabel.trim(),
          unitPrice: null,
          discountAmount: 0,
          taxAmount: 0,
          lineTotal: null,
          notes: this.clean(line.notes),
        };
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new BadRequestException(`Line ${index + 1} unit price must be greater than zero`);
      }
      const gross = money(quantity * unitPrice);
      if (discount > gross) {
        throw new BadRequestException(`Line ${index + 1} discount cannot exceed its priced amount`);
      }
      const lineTotal = money(gross - discount + tax);
      subtotal += gross;
      discountAmount += discount;
      taxAmount += tax;
      totalAmount += lineTotal;
      return {
        lineNumber: index + 1,
        itemCode: this.clean(line.itemCode),
        description: line.description.trim(),
        quantity,
        unitLabel: line.unitLabel.trim(),
        unitPrice,
        discountAmount: money(discount),
        taxAmount: money(tax),
        lineTotal,
        notes: this.clean(line.notes),
      };
    });

    return {
      lines: calculated,
      subtotal: money(subtotal),
      discountAmount: money(discountAmount),
      taxAmount: money(taxAmount),
      totalAmount: money(totalAmount),
      hasUnpricedLines,
    };
  }

  private requireDraft(status: SupplierOrderDraftStatus, action: string) {
    this.requireStatus(status, SupplierOrderDraftStatus.DRAFT, action);
  }

  private requireStatus(
    status: SupplierOrderDraftStatus,
    required: SupplierOrderDraftStatus,
    action: string,
  ) {
    if (status !== required) {
      throw new BadRequestException(
        `This action requires a ${required.toLowerCase()} supplier order draft; it cannot be used to ${action} the current ${status.toLowerCase()} document`,
      );
    }
  }

  private clean(value?: string | null) {
    const result = value?.trim();
    return result || null;
  }

  private audit(
    action: string,
    draft: Pick<DraftPayload, 'id' | 'companyId'>,
    user: AuthUser,
    oldValue?: Record<string, unknown>,
    newValue?: Record<string, unknown>,
  ) {
    return this.auditLogs.log({
      action,
      entityType: 'SupplierOrderDraft',
      entityId: draft.id,
      companyId: draft.companyId,
      userId: user.id,
      oldValue,
      newValue,
    });
  }
}
