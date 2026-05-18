import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import {
  CreateSupplierInvoiceDto,
  SupplierInvoiceLineDto,
} from './dto/create-supplier-invoice.dto';
import { UpdateSupplierInvoiceDto } from './dto/update-supplier-invoice.dto';
import { QuerySupplierInvoiceDto } from './dto/query-supplier-invoice.dto';
import { ApproveSupplierInvoiceDto } from './dto/approve-supplier-invoice.dto';

const MONEY_TOLERANCE = new Prisma.Decimal('0.01');
const QTY_TOLERANCE = new Prisma.Decimal('0.0001');

function generatePayableNumber(): string {
  return `AP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

function generateMatchNumber(): string {
  return `TWM-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class SupplierInvoicesService {
  private readonly logger = new Logger(SupplierInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async findAll(query: QuerySupplierInvoiceDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      supplierId,
      status,
      purchaseOrderId,
      goodsReceivedNoteId,
      search,
      page = 1,
      limit = 20,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    // Phase 1: hierarchy-scoped where clause covers company + optional division + branch.
    const where: Prisma.SupplierInvoiceWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.scopedWhereFor(user, { companyId, divisionId, branchId })),
    };

    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (goodsReceivedNoteId) where.goodsReceivedNoteId = goodsReceivedNoteId;
    if (search) {
      where.OR = [
        { supplierInvoiceNumber: { contains: search, mode: 'insensitive' } },
        { invoiceReference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true, code: true } },
          goodsReceivedNote: { select: { id: true, grnNumber: true, status: true } },
          lines: true,
        },
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);

    const data = await this.decorateInvoices(items);
    return {
      data,
      items: data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        goodsReceivedNote: { select: { id: true, grnNumber: true, status: true } },
        lines: true,
      },
    });
    if (!item) throw new NotFoundException('Supplier invoice not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    const [decorated] = await this.decorateInvoices([item]);
    return decorated;
  }

  async create(dto: CreateSupplierInvoiceDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.divisionId) {
      this.companyScope.assertCanAccessDivision(user, dto.divisionId, AccessLevel.WRITE);
    }
    if (dto.branchId) {
      this.companyScope.assertCanAccessBranch(user, dto.branchId, AccessLevel.WRITE);
    }
    await this.assertInvoiceNumberAvailable(dto.companyId, dto.supplierInvoiceNumber);

    const refs = await this.assertProcurementReferences({
      companyId: dto.companyId,
      supplierId: dto.supplierId,
      purchaseOrderId: dto.purchaseOrderId,
      goodsReceivedNoteId: dto.goodsReceivedNoteId,
    });
    const totals = this.buildInvoiceLines(dto.lines, dto.totalAmount);

    // Phase 1: auto-derive division/branch from GRN (preferred) or PO when not supplied.
    const divisionId = dto.divisionId ?? refs.divisionId;
    const branchId = dto.branchId ?? refs.branchId;

    const item = await this.prisma.supplierInvoice.create({
      data: {
        supplierInvoiceNumber: dto.supplierInvoiceNumber.trim(),
        companyId: dto.companyId,
        divisionId,
        branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: refs.purchaseOrderId,
        goodsReceivedNoteId: dto.goodsReceivedNoteId,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        invoiceReference: dto.invoiceReference?.trim() || undefined,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        outstandingAmount: totals.totalAmount,
        currency: dto.currency ?? CurrencyCode.TZS,
        status: 'DRAFT',
        notes: dto.notes?.trim() || undefined,
        createdById: user.id,
        lines: { create: totals.lines },
      },
      include: { lines: true },
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_CREATE',
      entityType: 'SupplierInvoice',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
      newValue: item as any,
    });

    return item;
  }

  async update(id: string, dto: UpdateSupplierInvoiceDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'RECEIVED', 'DISPUTED'].includes(existing.status)) {
      throw new BadRequestException('Only draft, received, or disputed invoices can be updated');
    }
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Supplier invoice company cannot be changed');
    }
    if (
      dto.supplierInvoiceNumber &&
      dto.supplierInvoiceNumber.trim() !== existing.supplierInvoiceNumber
    ) {
      await this.assertInvoiceNumberAvailable(existing.companyId, dto.supplierInvoiceNumber, id);
    }

    const supplierId = dto.supplierId ?? existing.supplierId;
    const refs = await this.assertProcurementReferences({
      companyId: existing.companyId,
      supplierId,
      purchaseOrderId: dto.purchaseOrderId ?? existing.purchaseOrderId ?? undefined,
      goodsReceivedNoteId: dto.goodsReceivedNoteId ?? existing.goodsReceivedNoteId ?? undefined,
    });
    const totals = dto.lines ? this.buildInvoiceLines(dto.lines, dto.totalAmount) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (totals) {
        await tx.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: id } });
      }
      return tx.supplierInvoice.update({
        where: { id },
        data: {
          ...(dto.supplierInvoiceNumber !== undefined && {
            supplierInvoiceNumber: dto.supplierInvoiceNumber.trim(),
          }),
          ...(dto.supplierId !== undefined && { supplierId }),
          ...(dto.purchaseOrderId !== undefined && { purchaseOrderId: refs.purchaseOrderId }),
          ...(dto.goodsReceivedNoteId !== undefined && {
            goodsReceivedNoteId: dto.goodsReceivedNoteId || null,
          }),
          ...(dto.invoiceDate !== undefined && { invoiceDate: new Date(dto.invoiceDate) }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
          ...(dto.invoiceReference !== undefined && {
            invoiceReference: dto.invoiceReference?.trim() || null,
          }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...(totals && {
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            totalAmount: totals.totalAmount,
            outstandingAmount: totals.totalAmount,
            status: 'DRAFT',
            lines: { create: totals.lines },
          }),
        },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_UPDATE',
      entityType: 'SupplierInvoice',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      newValue: updated as any,
    });

    return updated;
  }

  async runMatch(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const match = await this.createThreeWayMatch(existing, user.id);
    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_MATCH',
      entityType: 'SupplierInvoice',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      newValue: match as any,
    });
    return match;
  }

  async approve(id: string, dto: ApproveSupplierInvoiceDto | undefined, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'RECEIVED', 'MATCHED', 'DISPUTED'].includes(existing.status)) {
      throw new BadRequestException('Invoice cannot be approved in its current status');
    }
    if (!existing.lines?.length) {
      throw new BadRequestException('Supplier invoice must have at least one line before approval');
    }

    let match: any = null;
    if (existing.purchaseOrderId) {
      match = await this.createThreeWayMatch(existing, user.id);
      if (match.matchStatus === 'VARIANCE' && !dto?.allowVariance) {
        throw new BadRequestException(
          'Supplier invoice has PO/GRN variance. Review the match or approve with variance.',
        );
      }
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: existing.supplierId, companyId: existing.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException('Supplier does not belong to this company');

    const updated = await this.prisma.$transaction(async (tx) => {
      const payable = existing.payableId
        ? await tx.payable.update({
            where: { id: existing.payableId },
            data: {
              supplierId: supplier.id,
              supplierName: supplier.name,
              // Phase 1: keep payable's division/branch aligned with the invoice's.
              divisionId: existing.divisionId,
              branchId: existing.branchId,
              amount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              outstandingAmount: new Prisma.Decimal(existing.totalAmount)
                .minus(existing.paidAmount ?? 0)
                .toDecimalPlaces(2),
              currency: existing.currency as CurrencyCode,
              issueDate: existing.invoiceDate,
              dueDate: existing.dueDate,
              sourceType: 'SupplierInvoice',
              sourceId: existing.id,
              notes: `Supplier invoice ${existing.supplierInvoiceNumber}`,
            },
          })
        : await tx.payable.create({
            data: {
              payableNumber: generatePayableNumber(),
              companyId: existing.companyId,
              // Phase 1: propagate hierarchy scope from the supplier invoice.
              divisionId: existing.divisionId,
              branchId: existing.branchId,
              supplierId: supplier.id,
              supplierName: supplier.name,
              sourceType: 'SupplierInvoice',
              sourceId: existing.id,
              amount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              paidAmount: 0,
              outstandingAmount: new Prisma.Decimal(existing.totalAmount).toDecimalPlaces(2),
              currency: existing.currency as CurrencyCode,
              issueDate: existing.invoiceDate,
              dueDate: existing.dueDate,
              status: 'OPEN',
              notes: `Supplier invoice ${existing.supplierInvoiceNumber}`,
            },
          });

      if (existing.purchaseOrderId) {
        await tx.purchaseOrder.updateMany({
          where: { id: existing.purchaseOrderId, companyId: existing.companyId, deletedAt: null },
          data: { payableId: payable.id },
        });
      }

      // Phase 2 — GL posting: DR Inventory (net of tax) + DR Tax VAT Receivable
      // (if any) / CR AP_CONTROL. Posted inside the same transaction so the
      // invoice approval, payable creation, and journal entry are atomic.
      // Idempotency: invoice status transitions to APPROVED at the end of this
      // transaction; a second approve() call hits the status guard above and
      // throws before it gets here, so the JE is created at most once per invoice.
      const totalAmount = new Prisma.Decimal(existing.totalAmount);
      const taxAmount = new Prisma.Decimal(existing.taxAmount ?? 0);
      const netOfTax = totalAmount.minus(taxAmount);

      const [inventoryAccount, apAccount, taxAccount] = await Promise.all([
        this.accountResolver.resolve(existing.companyId, 'INVENTORY', tx),
        this.accountResolver.resolve(existing.companyId, 'AP_CONTROL', tx),
        taxAmount.gt(0)
          ? this.accountResolver.resolve(existing.companyId, 'TAX_VAT_RECEIVABLE', tx)
          : Promise.resolve(null),
      ]);

      const lines: Array<{ accountId: string; debit?: Prisma.Decimal; credit?: Prisma.Decimal; description?: string }> = [
        {
          accountId: inventoryAccount.id,
          debit: netOfTax,
          description: `Inventory received — ${existing.supplierInvoiceNumber}`,
        },
        {
          accountId: apAccount.id,
          credit: totalAmount,
          description: `Supplier invoice ${existing.supplierInvoiceNumber}`,
        },
      ];
      if (taxAmount.gt(0) && taxAccount) {
        lines.push({
          accountId: taxAccount.id,
          debit: taxAmount,
          description: `Input VAT on ${existing.supplierInvoiceNumber}`,
        });
      }

      const journalEntry = await this.postingEngine.postLines(
        {
          companyId: existing.companyId,
          divisionId: existing.divisionId ?? undefined,
          branchId: existing.branchId ?? undefined,
          transactionDate: existing.invoiceDate,
          description: `Supplier invoice ${existing.supplierInvoiceNumber}`,
          referenceType: 'SupplierInvoice',
          referenceId: existing.id,
          moduleName: 'supplier-invoices',
          userId: user.id,
          lines,
        },
        tx,
      );

      // Link the Payable to the journal entry so the GL audit trail closes.
      await tx.payable.update({
        where: { id: payable.id },
        data: { journalEntryId: journalEntry.id },
      });

      return tx.supplierInvoice.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: user.id,
          payableId: payable.id,
        },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_INVOICE_APPROVE',
      entityType: 'SupplierInvoice',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      newValue: { invoice: updated, match } as any,
    });

    return updated;
  }

  private buildInvoiceLines(lines: SupplierInvoiceLineDto[], submittedTotal?: number) {
    if (!lines?.length) throw new BadRequestException('Supplier invoice must have line items');

    let subtotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);
    let discountAmount = new Prisma.Decimal(0);

    const data = lines.map((line, index) => {
      const description = line.description.trim();
      if (!description) throw new BadRequestException(`Line ${index + 1}: description is required`);

      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const tax = new Prisma.Decimal(line.taxAmount ?? 0);
      const discount = new Prisma.Decimal(line.discountAmount ?? 0);
      const gross = quantity.mul(unitPrice);
      const lineTotal = gross.minus(discount).plus(tax);

      if (quantity.lte(0)) {
        throw new BadRequestException(`Line ${index + 1}: quantity must be greater than zero`);
      }
      if (unitPrice.lt(0) || tax.lt(0) || discount.lt(0)) {
        throw new BadRequestException(`Line ${index + 1}: amounts cannot be negative`);
      }
      if (
        line.lineTotal !== undefined &&
        !this.withinTolerance(lineTotal, new Prisma.Decimal(line.lineTotal), MONEY_TOLERANCE)
      ) {
        throw new BadRequestException(
          `Line ${index + 1}: line total does not match quantity/price`,
        );
      }

      subtotal = subtotal.plus(gross);
      taxAmount = taxAmount.plus(tax);
      discountAmount = discountAmount.plus(discount);

      return {
        productId: line.productId || undefined,
        description,
        quantity,
        unitId: line.unitId || undefined,
        unitPrice,
        taxAmount: tax,
        discountAmount: discount,
        lineTotal,
      };
    });

    const totalAmount = subtotal.minus(discountAmount).plus(taxAmount);
    if (
      submittedTotal !== undefined &&
      !this.withinTolerance(totalAmount, new Prisma.Decimal(submittedTotal), MONEY_TOLERANCE)
    ) {
      throw new BadRequestException('Invoice total does not match the line item totals');
    }

    return { lines: data, subtotal, taxAmount, discountAmount, totalAmount };
  }

  private async assertInvoiceNumberAvailable(
    companyId: string,
    invoiceNumber: string,
    id?: string,
  ) {
    const existing = await this.prisma.supplierInvoice.findFirst({
      where: {
        companyId,
        supplierInvoiceNumber: invoiceNumber.trim(),
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Supplier invoice number already exists for this company');
    }
  }

  private async assertProcurementReferences(refs: {
    companyId: string;
    supplierId: string;
    purchaseOrderId?: string;
    goodsReceivedNoteId?: string;
  }) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: refs.supplierId, companyId: refs.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException('Supplier does not belong to this company');

    let purchaseOrderId = refs.purchaseOrderId || undefined;
    // Phase 1: collect division/branch from the strongest source (GRN first, then PO).
    let derivedDivisionId: string | undefined;
    let derivedBranchId: string | undefined;
    let poDivisionId: string | undefined;
    let poBranchId: string | undefined;

    if (refs.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: refs.purchaseOrderId, companyId: refs.companyId, deletedAt: null },
        select: { id: true, supplierId: true, divisionId: true, branchId: true },
      });
      if (!po) throw new BadRequestException('Purchase order does not belong to this company');
      if (po.supplierId && po.supplierId !== refs.supplierId) {
        throw new BadRequestException('Purchase order supplier does not match invoice supplier');
      }
      poDivisionId = po.divisionId ?? undefined;
      poBranchId = po.branchId ?? undefined;
    }

    if (refs.goodsReceivedNoteId) {
      const grn = await this.prisma.goodsReceivedNote.findFirst({
        where: { id: refs.goodsReceivedNoteId, companyId: refs.companyId, deletedAt: null },
        select: {
          id: true,
          supplierId: true,
          purchaseOrderId: true,
          divisionId: true,
          branchId: true,
        },
      });
      if (!grn) throw new BadRequestException('GRN does not belong to this company');
      if (grn.supplierId !== refs.supplierId) {
        throw new BadRequestException('GRN supplier does not match invoice supplier');
      }
      if (purchaseOrderId && grn.purchaseOrderId && grn.purchaseOrderId !== purchaseOrderId) {
        throw new BadRequestException('GRN is not linked to the selected purchase order');
      }
      purchaseOrderId = purchaseOrderId || grn.purchaseOrderId || undefined;
      derivedDivisionId = grn.divisionId ?? undefined;
      derivedBranchId = grn.branchId ?? undefined;
    }

    return {
      purchaseOrderId,
      divisionId: derivedDivisionId ?? poDivisionId,
      branchId: derivedBranchId ?? poBranchId,
    };
  }

  private async createThreeWayMatch(invoice: any, userId: string) {
    if (!invoice.purchaseOrderId) {
      throw new BadRequestException('Purchase order is required for three-way matching');
    }

    const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
      where: { id: invoice.purchaseOrderId, companyId: invoice.companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!purchaseOrder) throw new BadRequestException('Purchase order not found for invoice');
    if (purchaseOrder.supplierId && purchaseOrder.supplierId !== invoice.supplierId) {
      throw new BadRequestException('Purchase order supplier does not match invoice supplier');
    }

    const grn = invoice.goodsReceivedNoteId
      ? await this.prisma.goodsReceivedNote.findFirst({
          where: {
            id: invoice.goodsReceivedNoteId,
            companyId: invoice.companyId,
            supplierId: invoice.supplierId,
            deletedAt: null,
          },
          include: { lines: true },
        })
      : null;
    if (invoice.goodsReceivedNoteId && !grn) {
      throw new BadRequestException('GRN not found for invoice');
    }

    const quantityVariance = grn
      ? this.quantityVariance(
          this.groupQuantities(grn.lines, 'acceptedQuantity'),
          this.groupQuantities(invoice.lines, 'quantity'),
        )
      : this.quantityVariance(
          this.groupQuantities(purchaseOrder.lines, 'quantity'),
          this.groupQuantities(invoice.lines, 'quantity'),
        );
    const amountVariance = this.amountVarianceAgainstPurchaseOrder(invoice, purchaseOrder.lines);
    const matchStatus =
      quantityVariance.lte(QTY_TOLERANCE) && amountVariance.lte(MONEY_TOLERANCE)
        ? 'MATCHED'
        : 'VARIANCE';

    const match = await this.prisma.threeWayMatch.create({
      data: {
        matchNumber: generateMatchNumber(),
        companyId: invoice.companyId,
        purchaseOrderId: invoice.purchaseOrderId,
        goodsReceivedNoteId: invoice.goodsReceivedNoteId,
        supplierInvoiceId: invoice.id,
        matchStatus,
        quantityVariance,
        amountVariance,
        notes:
          matchStatus === 'MATCHED'
            ? 'PO, GRN, and supplier invoice matched'
            : 'Variance detected between PO/GRN and supplier invoice',
        matchedById: userId,
      },
    });

    await this.prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { status: matchStatus === 'MATCHED' ? 'MATCHED' : 'DISPUTED' },
    });

    return match;
  }

  private groupQuantities(lines: any[], quantityField: string) {
    const grouped = new Map<string, Prisma.Decimal>();
    for (const line of lines ?? []) {
      const key = line.productId
        ? `product:${line.productId}`
        : `desc:${line.description ?? line.id}`;
      const quantity = new Prisma.Decimal(line[quantityField] ?? 0);
      grouped.set(key, (grouped.get(key) ?? new Prisma.Decimal(0)).plus(quantity));
    }
    return grouped;
  }

  private quantityVariance(
    expected: Map<string, Prisma.Decimal>,
    actual: Map<string, Prisma.Decimal>,
  ) {
    let variance = new Prisma.Decimal(0);
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const key of keys) {
      variance = variance.plus(
        (expected.get(key) ?? new Prisma.Decimal(0))
          .minus(actual.get(key) ?? new Prisma.Decimal(0))
          .abs(),
      );
    }
    return variance;
  }

  private amountVarianceAgainstPurchaseOrder(invoice: any, purchaseOrderLines: any[]) {
    const poLinesByProduct = new Map<string, any>();
    let purchaseOrderTotal = new Prisma.Decimal(0);
    for (const line of purchaseOrderLines ?? []) {
      purchaseOrderTotal = purchaseOrderTotal.plus(line.lineTotal ?? 0);
      if (line.productId) poLinesByProduct.set(line.productId, line);
    }

    let expectedAmount = new Prisma.Decimal(0);
    let hasLineMatch = false;
    for (const line of invoice.lines ?? []) {
      const poLine = line.productId ? poLinesByProduct.get(line.productId) : null;
      if (!poLine) continue;
      hasLineMatch = true;
      expectedAmount = expectedAmount
        .plus(new Prisma.Decimal(line.quantity).mul(poLine.unitCost))
        .minus(line.discountAmount ?? 0)
        .plus(line.taxAmount ?? 0);
    }

    if (!hasLineMatch) {
      return new Prisma.Decimal(invoice.totalAmount).minus(purchaseOrderTotal).abs();
    }

    return new Prisma.Decimal(invoice.totalAmount).minus(expectedAmount).abs();
  }

  private withinTolerance(
    actual: Prisma.Decimal,
    expected: Prisma.Decimal,
    tolerance: Prisma.Decimal,
  ) {
    return actual.minus(expected).abs().lte(tolerance);
  }

  private async decorateInvoices(items: any[]) {
    if (!items.length) return items;

    const supplierIds = Array.from(new Set(items.map((item) => item.supplierId).filter(Boolean)));
    const purchaseOrderIds = Array.from(
      new Set(items.map((item) => item.purchaseOrderId).filter(Boolean)),
    );
    const payableIds = Array.from(new Set(items.map((item) => item.payableId).filter(Boolean)));
    const invoiceIds = items.map((item) => item.id);

    const [suppliers, purchaseOrders, payables, matches] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, name: true, supplierCode: true },
          })
        : [],
      purchaseOrderIds.length
        ? this.prisma.purchaseOrder.findMany({
            where: { id: { in: purchaseOrderIds } },
            select: { id: true, purchaseOrderNumber: true, totalAmount: true, status: true },
          })
        : [],
      payableIds.length
        ? this.prisma.payable.findMany({
            where: { id: { in: payableIds } },
            select: {
              id: true,
              payableNumber: true,
              status: true,
              paidAmount: true,
              outstandingAmount: true,
            },
          })
        : [],
      this.prisma.threeWayMatch.findMany({
        where: { supplierInvoiceId: { in: invoiceIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.id, po]));
    const payablesById = new Map(payables.map((payable) => [payable.id, payable]));
    const matchesByInvoiceId = new Map<string, any>();
    for (const match of matches) {
      if (match.supplierInvoiceId && !matchesByInvoiceId.has(match.supplierInvoiceId)) {
        matchesByInvoiceId.set(match.supplierInvoiceId, match);
      }
    }

    return items.map((item) => ({
      ...item,
      supplier: suppliersById.get(item.supplierId) ?? null,
      purchaseOrder: item.purchaseOrderId
        ? (purchaseOrdersById.get(item.purchaseOrderId) ?? null)
        : null,
      payable: item.payableId ? (payablesById.get(item.payableId) ?? null) : null,
      latestMatch: matchesByInvoiceId.get(item.id) ?? null,
    }));
  }
}
