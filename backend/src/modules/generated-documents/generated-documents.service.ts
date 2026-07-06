import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  AccessLevel,
  DocumentCategory,
  DocumentOwnerType,
  DocumentTemplateFormat,
  DocumentTemplateStatus,
  DocumentTemplateType,
  GeneratedDocumentFormat,
  GeneratedDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from '../documents/documents.service';
import {
  BUSINESS_PDF_ENTITY_TYPES,
  BusinessPdfEntityType,
  GenerateBusinessPdfDto,
} from './dto/generate-business-pdf.dto';
import { GenerateTablePdfDto } from './dto/generate-table-pdf.dto';
import {
  BusinessPdfImage,
  BusinessPdfModel,
  BusinessPdfOrganization,
  BusinessPdfSection,
  buildBusinessPdf,
} from './pdf-builder';

const DEFAULT_ITEMBA_LOGO_URL = '/brand/itemba-group-logo.png';
const TABLE_PDF_ENTITY_TYPE = 'TABLE_EXPORT';
const TABLE_PDF_MAX_CELL_LENGTH = 300;

@Injectable()
export class GeneratedDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly documents: DocumentsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, templateId, entityType, entityId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (templateId) where.templateId = templateId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [items, total] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.generatedDocument.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.generatedDocument.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Generated document not found');
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user, item.companyId);
    const scoped = await this.prisma.generatedDocument.findFirst({ where });
    if (!scoped) throw new NotFoundException('Generated document not found');
    return item;
  }

  async generateBusinessPdf(dto: GenerateBusinessPdfDto, user: AuthUser, ipAddress?: string) {
    this.assertCanAccessBusinessPdfSource(dto.entityType, user);
    const model = await this.buildBusinessPdfModel(dto.entityType, dto.entityId, user);
    await this.attachLogoImage(model.pdf.organization, user);
    const buffer = buildBusinessPdf(model.pdf);
    const template = await this.ensureSystemTemplate(dto.entityType, model.companyId, user.id);
    const generatedNumber = await this.generatedDocumentNumber(dto.entityType);
    const fileName = `${model.fileStem}.pdf`;

    const document = await this.documents.createFromBuffer(
      {
        buffer,
        fileName,
        mimeType: 'application/pdf',
        title: model.title,
        ownerType:
          dto.entityType === 'CUSTOMER_PROFILE'
            ? DocumentOwnerType.CUSTOMER
            : DocumentOwnerType.TRANSACTION,
        ownerId: dto.entityId,
        companyId: model.companyId,
        branchId: model.branchId,
        category: model.category,
        documentCode: generatedNumber,
        description: `Generated ${model.pdf.title} PDF for ${model.reference}`,
        tags: ['generated', 'pdf', dto.entityType.toLowerCase()],
      },
      user,
      ipAddress,
      AccessLevel.READ,
    );

    const generatedDocument = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: generatedNumber,
        companyId: model.companyId,
        templateId: template.id,
        entityType: dto.entityType,
        entityId: dto.entityId,
        title: model.title,
        renderedContent: JSON.stringify({
          title: model.pdf.title,
          reference: model.reference,
          documentId: document.id,
        }),
        outputFormat: GeneratedDocumentFormat.PDF,
        documentId: document.id,
        generatedById: user.id,
        status: GeneratedDocumentStatus.STORED,
        metadata: {
          fileName,
          fileSizeBytes: buffer.byteLength,
          mimeType: 'application/pdf',
          sourceReference: model.reference,
        },
      },
    });

    await this.auditLogs.log({
      action: 'GENERATED_DOCUMENT_CREATE',
      entityType: 'GeneratedDocument',
      entityId: generatedDocument.id,
      userId: user.id,
      companyId: model.companyId ?? undefined,
      ipAddress,
      metadata: {
        sourceEntityType: dto.entityType,
        sourceEntityId: dto.entityId,
        documentId: document.id,
        generatedDocumentNumber: generatedDocument.generatedDocumentNumber,
      },
    });

    return { generatedDocument, document };
  }

  /**
   * Branded PDF from an arbitrary client-supplied table (the PDF twin of the
   * client-side CSV exports). Only a GeneratedDocument bookkeeping row is
   * persisted — deliberately NO Document/file: arbitrary client-supplied
   * tables are not worth storing as company documents. The PDF is streamed
   * once and regenerated on demand.
   */
  async generateTablePdf(dto: GenerateTablePdfDto, user: AuthUser, ipAddress?: string) {
    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.READ);
    }
    const companyId = dto.companyId ?? user.companyId ?? null;
    const company = companyId
      ? await this.prisma.company.findFirst({
          where: { id: companyId, deletedAt: null },
          select: companySelect().select,
        })
      : null;

    const org = organization(company);
    await this.attachLogoImage(org, user);

    const generatedNumber = await this.generatedDocumentNumber(TABLE_PDF_ENTITY_TYPE);
    const generatedAt = new Date();
    const headers = dto.columns.map(truncateCell);
    const rows = dto.rows.map((row) => row.map(truncateCell));

    const buffer = buildBusinessPdf({
      title: dto.title,
      subtitle: dto.subtitle,
      reference: generatedNumber,
      organization: org,
      generatedAt,
      meta: (dto.meta ?? []).map((entry) => kv(entry.label, entry.value)),
      sections: [
        {
          title: 'Data',
          table: { headers, rows, numericColumns: dto.numericColumns },
        },
      ],
    });

    const template = await this.ensureSystemTemplate(TABLE_PDF_ENTITY_TYPE, companyId, user.id);
    const fileStem = safeFileStem(dto.baseName ?? dto.title);
    const fileName = `${fileStem}-${generatedAt.toISOString().slice(0, 10)}.pdf`;

    const generatedDocument = await this.prisma.generatedDocument.create({
      data: {
        generatedDocumentNumber: generatedNumber,
        companyId,
        templateId: template.id,
        entityType: TABLE_PDF_ENTITY_TYPE,
        entityId: generatedNumber,
        title: dto.title,
        renderedContent: JSON.stringify({ title: dto.title, reference: generatedNumber }),
        outputFormat: GeneratedDocumentFormat.PDF,
        documentId: null,
        generatedById: user.id,
        status: GeneratedDocumentStatus.GENERATED,
        metadata: {
          fileName,
          fileSizeBytes: buffer.byteLength,
          rowCount: rows.length,
          columnCount: headers.length,
          companyId,
        },
      },
    });

    await this.auditLogs.log({
      action: 'GENERATED_DOCUMENT_CREATE',
      entityType: 'GeneratedDocument',
      entityId: generatedDocument.id,
      userId: user.id,
      companyId: companyId ?? undefined,
      ipAddress,
      metadata: {
        sourceEntityType: TABLE_PDF_ENTITY_TYPE,
        generatedDocumentNumber: generatedDocument.generatedDocumentNumber,
        fileName,
        rowCount: rows.length,
        columnCount: headers.length,
      },
    });

    return { buffer, fileName, generatedDocumentId: generatedDocument.id };
  }

  async download(id: string, user: AuthUser, ipAddress?: string) {
    const item = await this.prisma.generatedDocument.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Generated document not found');

    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user, item.companyId);
    const scoped = await this.prisma.generatedDocument.findFirst({ where });
    if (!scoped) throw new NotFoundException('Generated document not found');

    const entityType = scoped.entityType;
    if (isBusinessPdfEntityType(entityType)) {
      this.assertCanAccessBusinessPdfSource(entityType, user);
    } else if (
      !hasPermission(user, 'documents.manage') &&
      !hasPermission(user, 'generated_documents.view')
    ) {
      throw new ForbiddenException('Access denied for this generated document');
    }

    if (!scoped.documentId) throw new NotFoundException('Generated document file not found');
    return this.documents.download(scoped.documentId, user, ipAddress);
  }

  private async attachLogoImage(organization: BusinessPdfOrganization, user: AuthUser) {
    const documentId = logoDocumentId(organization.logoUrl);
    if (!documentId) {
      organization.logoImage = defaultLogoImage(organization.logoUrl);
      return;
    }

    try {
      const file = await this.documents.readFileBuffer(documentId, user);
      const mimeType = file.mimeType.toLowerCase();
      organization.logoImage = { data: file.buffer, mimeType };
    } catch {
      organization.logoImage = defaultLogoImage();
    }
  }

  private assertCanAccessBusinessPdfSource(entityType: BusinessPdfEntityType, user: AuthUser) {
    if (hasPermission(user, 'documents.manage')) return;
    const requiredPermission = permissionForBusinessPdfEntity(entityType);
    if (!hasPermission(user, requiredPermission)) {
      throw new ForbiddenException(
        `Access denied. Missing permission for ${label(entityType)} PDF generation`,
      );
    }
  }

  private async buildBusinessPdfModel(
    entityType: BusinessPdfEntityType,
    entityId: string,
    user: AuthUser,
  ): Promise<ResolvedBusinessPdfModel> {
    switch (entityType) {
      case 'SALES_ORDER':
        return this.salesOrderPdf(entityId, user);
      case 'PURCHASE_ORDER':
        return this.purchaseOrderPdf(entityId, user);
      case 'QUOTATION':
        return this.quotationPdf(entityId, user);
      case 'PROFORMA_INVOICE':
        return this.proformaPdf(entityId, user);
      case 'DELIVERY_NOTE':
        return this.deliveryNotePdf(entityId, user);
      case 'CUSTOMER_PROFILE':
        return this.customerProfilePdf(entityId, user);
      case 'GOODS_RECEIVED_NOTE':
        return this.grnPdf(entityId, user);
      case 'SUPPLIER_INVOICE':
        return this.supplierInvoicePdf(entityId, user);
      case 'PAYSLIP':
        return this.payslipPdf(entityId, user);
      case 'CREDIT_NOTE':
        return this.creditNotePdf(entityId, user);
      case 'CUSTOMER_PAYMENT_RECEIPT':
        return this.customerPaymentReceiptPdf(entityId, user);
      default:
        throw new BadRequestException('Unsupported document entity type');
    }
  }

  private async salesOrderPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.salesOrder.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        createdBy: { select: { fullName: true } },
        confirmedBy: { select: { fullName: true } },
        cashAccount: { select: { accountName: true, accountType: true } },
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales order not found');

    const reference = record.salesOrderNumber ?? record.id.slice(0, 8);
    const customerName = record.customer?.name ?? record.customerName ?? 'Walk-in customer';
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.OTHER, {
      title: 'Sales Order',
      subtitle: customerName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Order Number', reference),
        kv('Order Date', date(record.orderDate)),
        kv('Due Date', date(record.dueDate)),
        kv('Payment Status', label(record.paymentStatus)),
      ],
      sections: [
        {
          title: 'Customer and Order Details',
          items: [
            kv('Customer', customerName),
            kv('Sales Type', label(record.salesType)),
            kv('Payment Method', label(record.paymentMethod)),
            kv('Payment Reference', value(record.paymentReference)),
            kv('Cash Account', value(record.cashAccount?.accountName)),
            kv('Prepared By', value(record.createdBy?.fullName)),
            kv('Confirmed By', value(record.confirmedBy?.fullName)),
            kv('Currency', value(record.currency)),
          ],
        },
        lineSection(
          record.lines.map((line) => [
            line.description || line.product?.name || 'N/A',
            line.product?.sku ?? line.product?.productCode ?? 'N/A',
            qty(line.quantity),
            line.unit?.symbol ?? line.unit?.name ?? 'N/A',
            money(line.unitPrice, record.currency),
            money(line.discountAmount, record.currency),
            money(line.taxAmount, record.currency),
            money(line.lineTotal, record.currency),
          ]),
          record.currency,
          [
            total('Subtotal', record.subtotal, record.currency),
            total('Discount', record.discountAmount, record.currency),
            total('Tax', record.taxAmount, record.currency),
            total('Total', record.totalAmount, record.currency, true),
            total('Paid', record.paidAmount, record.currency),
            total('Outstanding', record.outstandingAmount, record.currency, true),
          ],
        ),
        notesSection(record.notes),
        { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Customer'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async purchaseOrderPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.purchaseOrder.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        supplier: supplierSelect(),
        createdBy: { select: { fullName: true } },
        confirmedBy: { select: { fullName: true } },
        receivedBy: { select: { fullName: true } },
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Purchase order not found');

    const reference = record.purchaseOrderNumber ?? record.id.slice(0, 8);
    const supplierName = record.supplier?.name ?? record.supplierName ?? 'N/A';
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.OTHER, {
      title: 'Purchase Order',
      subtitle: supplierName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Purchase Order', reference),
        kv('Order Date', date(record.orderDate)),
        kv('Expected Date', date(record.expectedDate)),
        kv('Payment Status', label(record.paymentStatus)),
      ],
      sections: [
        supplierDetails(supplierName, record.supplier, [
          kv('Purchase Type', label(record.purchaseType)),
          kv('Prepared By', value(record.createdBy?.fullName)),
          kv('Confirmed By', value(record.confirmedBy?.fullName)),
          kv('Received By', value(record.receivedBy?.fullName)),
          kv('Confirmed At', date(record.confirmedAt)),
          kv('Received At', date(record.receivedAt)),
          kv('Currency', value(record.currency)),
        ]),
        lineSection(purchaseLineRows(record.lines, record.currency), record.currency, [
          total('Subtotal', record.subtotal, record.currency),
          total('Discount', record.discountAmount, record.currency),
          total('Tax', record.taxAmount, record.currency),
          total('Total', record.totalAmount, record.currency, true),
          total('Paid', record.paidAmount, record.currency),
          total('Outstanding', record.outstandingAmount, record.currency, true),
        ]),
        notesSection(record.notes),
        { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Supplier'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async quotationPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.quotation.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Quotation not found');
    const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
    return this.wrapPdf(
      record.companyId,
      record.branchId,
      record.quotationNumber,
      DocumentCategory.OTHER,
      {
        title: 'Quotation',
        subtitle: customerName,
        reference: record.quotationNumber,
        status: label(record.status),
        organization: organization(record.company, record.branch),
        generatedAt: new Date(),
        meta: [
          kv('Quotation Number', record.quotationNumber),
          kv('Quotation Date', date(record.quotationDate)),
          kv('Valid Until', date(record.validUntil)),
          kv('Quotation Type', label(record.quotationType)),
        ],
        sections: [
          customerDetails(customerName, record.customer, [
            kv('Approved At', date(record.approvedAt)),
            kv('Converted Sales Order', value(record.convertedSalesOrderId)),
          ]),
          lineSection(standardLineRows(record.lines, record.currency), record.currency, [
            total('Subtotal', record.subtotal, record.currency),
            total('Discount', record.discountAmount, record.currency),
            total('Tax', record.taxAmount, record.currency),
            total('Total', record.totalAmount, record.currency, true),
          ]),
          notesSection(record.notes),
          { title: 'Acceptance', signatures: ['Issued By', 'Customer Acceptance', 'Approved By'] },
        ].filter(Boolean) as BusinessPdfSection[],
      },
    );
  }

  private async proformaPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.proformaInvoice.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        quotation: { select: { quotationNumber: true } },
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Proforma invoice not found');
    const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
    return this.wrapPdf(
      record.companyId,
      record.branchId,
      record.proformaNumber,
      DocumentCategory.INVOICE,
      {
        title: 'Proforma Invoice',
        subtitle: customerName,
        reference: record.proformaNumber,
        status: label(record.status),
        organization: organization(record.company, record.branch),
        generatedAt: new Date(),
        meta: [
          kv('Proforma Number', record.proformaNumber),
          kv('Proforma Date', date(record.proformaDate)),
          kv('Valid Until', date(record.validUntil)),
          kv('Related Quotation', value(record.quotation?.quotationNumber ?? record.quotationId)),
        ],
        sections: [
          customerDetails(customerName, record.customer, [
            kv('Converted Sales Order', value(record.convertedSalesOrderId)),
            kv('Currency', value(record.currency)),
          ]),
          lineSection(standardLineRows(record.lines, record.currency), record.currency, [
            total('Subtotal', record.subtotal, record.currency),
            total('Discount', record.discountAmount, record.currency),
            total('Tax', record.taxAmount, record.currency),
            total('Total', record.totalAmount, record.currency, true),
          ]),
          notesSection(record.notes),
          { title: 'Authorization', signatures: ['Issued By', 'Reviewed By', 'Customer'] },
        ].filter(Boolean) as BusinessPdfSection[],
      },
    );
  }

  private async deliveryNotePdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.deliveryNote.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        salesOrder: { select: { salesOrderNumber: true, orderDate: true } },
        deliveredBy: { select: { fullName: true } },
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Delivery note not found');
    const reference = record.deliveryNoteNumber ?? record.id.slice(0, 8);
    const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.OTHER, {
      title: 'Delivery Note',
      subtitle: customerName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Delivery Note', reference),
        kv('Delivery Date', date(record.deliveryDate)),
        kv('Sales Order', value(record.salesOrder?.salesOrderNumber)),
        kv('Vehicle', value(record.vehicleNumber)),
      ],
      sections: [
        {
          title: 'Delivery Details',
          items: [
            kv('Customer', customerName),
            kv('Customer Code', value(record.customer?.customerCode)),
            kv('Delivery Address', value(record.deliveryAddress ?? record.customer?.address)),
            kv('Customer Contact', value(record.customer?.contactPerson)),
            kv('Driver', value(record.driverName)),
            kv('Delivered By', value(record.deliveredBy?.fullName)),
            kv('Received By', value(record.receivedByName)),
            kv('Receiver Phone', value(record.receivedByPhone)),
          ],
        },
        {
          title: 'Line Items',
          table: {
            headers: ['Item', 'SKU', 'Ordered', 'Delivered', 'Unit'],
            numericColumns: [2, 3],
            mutedColumns: [1],
            rows: record.lines.map((line) => [
              line.description || line.product?.name || 'N/A',
              line.product?.sku ?? line.product?.productCode ?? 'N/A',
              qty(line.orderedQuantity),
              qty(line.deliveredQuantity),
              line.unit?.symbol ?? line.unit?.name ?? 'N/A',
            ]),
          },
        },
        notesSection(record.notes),
        { title: 'Acknowledgement', signatures: ['Dispatch Clerk', 'Driver', 'Receiver'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async customerProfilePdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const customer = await this.prisma.customer.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const [recentOrders, receivableSummary] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: { companyId: customer.companyId, customerId: id, deletedAt: null },
        orderBy: { orderDate: 'desc' },
        take: 10,
        select: {
          salesOrderNumber: true,
          orderDate: true,
          totalAmount: true,
          outstandingAmount: true,
          status: true,
          paymentStatus: true,
        },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId: customer.companyId,
          customerId: id,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
    ]);

    return this.wrapPdf(
      customer.companyId,
      customer.branchId,
      customer.customerCode,
      DocumentCategory.OTHER,
      {
        title: 'Customer Profile',
        subtitle: customer.name,
        reference: customer.customerCode,
        status: label(customer.status),
        organization: organization(customer.company, customer.branch),
        generatedAt: new Date(),
        meta: [
          kv('Customer Code', customer.customerCode),
          kv('Customer Type', label(customer.customerType)),
          kv('Payment Terms', value(customer.paymentTerms)),
          kv('Open Receivables', String(receivableSummary._count.id)),
        ],
        sections: [
          {
            title: 'Customer Details',
            items: [
              kv('Customer Name', customer.name),
              kv('Legal Name', value(customer.legalName)),
              kv('Status', label(customer.status)),
              kv('Phone', value(customer.phone)),
              kv('Email', value(customer.email)),
              kv('Contact Person', value(customer.contactPerson)),
              kv('Address', value(customer.address)),
              kv('Outstanding', money(receivableSummary._sum.outstandingAmount, 'TZS')),
            ],
          },
          {
            title: 'Recent Orders',
            table: {
              headers: ['Order', 'Date', 'Status', 'Payment', 'Total', 'Outstanding'],
              numericColumns: [4, 5],
              rows: recentOrders.map((order) => [
                order.salesOrderNumber,
                date(order.orderDate),
                label(order.status),
                label(order.paymentStatus),
                money(order.totalAmount, 'TZS'),
                money(order.outstandingAmount, 'TZS'),
              ]),
            },
          },
        ],
      },
    );
  }

  private async grnPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.goodsReceivedNote.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        receivedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        lines: true,
      },
    });
    if (!record) throw new NotFoundException('Goods received note not found');

    // GoodsReceivedNote has no supplier/purchaseOrder relations and its lines
    // have no product/unit relations — resolve display names with secondary
    // lookups instead of includes.
    const [supplier, purchaseOrder, lookups] = await Promise.all([
      this.prisma.supplier.findFirst({
        where: { id: record.supplierId },
        select: supplierSelect().select,
      }),
      record.purchaseOrderId
        ? this.prisma.purchaseOrder.findFirst({
            where: { id: record.purchaseOrderId },
            select: { purchaseOrderNumber: true },
          })
        : null,
      this.productAndUnitMaps(
        record.lines.map((line) => line.productId),
        record.lines.map((line) => line.unitId),
      ),
    ]);

    const reference = record.grnNumber ?? record.id.slice(0, 8);
    const supplierName = supplier?.name ?? 'N/A';
    const lineValue = (line: { acceptedQuantity: unknown; unitCost: unknown }) =>
      Number(line.acceptedQuantity ?? 0) * Number(line.unitCost ?? 0);
    const totalValue = record.lines.reduce((sum, line) => sum + lineValue(line), 0);
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.OTHER, {
      title: 'Goods Received Note',
      subtitle: supplierName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('GRN Number', reference),
        kv('Received Date', date(record.receivedDate)),
        kv('Purchase Order', value(purchaseOrder?.purchaseOrderNumber ?? record.purchaseOrderId)),
        kv('Posted At', date(record.postedAt)),
      ],
      sections: [
        supplierDetails(supplierName, supplier, [
          kv('Received By', value(record.receivedBy?.fullName)),
          kv('Approved By', value(record.approvedBy?.fullName)),
        ]),
        {
          title: 'Line Items',
          table: {
            headers: [
              'Item',
              'SKU',
              'Ordered',
              'Received',
              'Accepted',
              'Rejected',
              'Unit',
              'Unit Cost',
              'Line Value',
            ],
            numericColumns: [2, 3, 4, 5, 7, 8],
            mutedColumns: [1],
            rows: record.lines.map((line) => {
              const product = lookups.products.get(line.productId);
              const unit = lookups.units.get(line.unitId);
              return [
                product?.name ?? 'N/A',
                product?.sku ?? product?.productCode ?? 'N/A',
                qty(line.orderedQuantity),
                qty(line.receivedQuantity),
                qty(line.acceptedQuantity),
                qty(line.rejectedQuantity),
                unit?.symbol ?? unit?.name ?? 'N/A',
                money(line.unitCost),
                money(lineValue(line)),
              ];
            }),
          },
          totals: [total('Total Value', totalValue, 'TZS', true)],
        },
        notesSection(record.notes),
        { title: 'Acknowledgement', signatures: ['Received By', 'Inspected By', 'Approved By'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async supplierInvoicePdf(
    id: string,
    user: AuthUser,
  ): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.supplierInvoice.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        goodsReceivedNote: { select: { grnNumber: true } },
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        lines: true,
      },
    });
    if (!record) throw new NotFoundException('Supplier invoice not found');

    // SupplierInvoice has no supplier relation and its lines have no
    // product/unit relations — resolve display names with secondary lookups.
    const [supplier, lookups] = await Promise.all([
      this.prisma.supplier.findFirst({
        where: { id: record.supplierId },
        select: supplierSelect().select,
      }),
      this.productAndUnitMaps(
        record.lines.map((line) => line.productId),
        record.lines.map((line) => line.unitId),
      ),
    ]);

    const reference = record.supplierInvoiceNumber ?? record.id.slice(0, 8);
    const supplierName = supplier?.name ?? 'N/A';
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.INVOICE, {
      title: 'Supplier Invoice',
      subtitle: supplierName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Invoice Number', reference),
        kv('Invoice Date', date(record.invoiceDate)),
        kv('Due Date', date(record.dueDate)),
        kv('Supplier Reference', value(record.invoiceReference)),
      ],
      sections: [
        supplierDetails(supplierName, supplier, [
          kv('Goods Received Note', value(record.goodsReceivedNote?.grnNumber)),
          kv('Prepared By', value(record.createdBy?.fullName)),
          kv('Approved By', value(record.approvedBy?.fullName)),
          kv('Approved At', date(record.approvedAt)),
          kv('Currency', value(record.currency)),
        ]),
        lineSection(
          record.lines.map((line) => {
            const product = line.productId ? lookups.products.get(line.productId) : undefined;
            const unit = line.unitId ? lookups.units.get(line.unitId) : undefined;
            return [
              line.description || product?.name || 'N/A',
              product?.sku ?? product?.productCode ?? 'N/A',
              qty(line.quantity),
              unit?.symbol ?? unit?.name ?? 'N/A',
              money(line.unitPrice, record.currency),
              money(line.discountAmount, record.currency),
              money(line.taxAmount, record.currency),
              money(line.lineTotal, record.currency),
            ];
          }),
          record.currency,
          [
            total('Subtotal', record.subtotal, record.currency),
            total('Discount', record.discountAmount, record.currency),
            total('Tax', record.taxAmount, record.currency),
            total('Total', record.totalAmount, record.currency, true),
            total('Paid', record.paidAmount, record.currency),
            total('Outstanding', record.outstandingAmount, record.currency, true),
          ],
        ),
        notesSection(record.notes),
        { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Supplier'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async payslipPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    // Deliberately company-scoped: the hr/payslips read service queries the
    // payroll entry without applyCompanyScopeWhere — do not copy that flaw.
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.payrollEntry.findFirst({
      where,
      include: {
        company: companySelect(),
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            tin: true,
            nssfNumber: true,
            nhifNumber: true,
            bankName: true,
            bankAccountNumber: true,
            department: { select: { name: true } },
            position: { select: { title: true } },
            branch: branchSelect(),
          },
        },
        payrollRun: {
          select: {
            payrollRunNumber: true,
            runDate: true,
            payrollPeriod: {
              select: { name: true, startDate: true, endDate: true, paymentDate: true },
            },
          },
        },
        allowances: {
          include: { allowanceType: { select: { name: true, code: true } } },
          orderBy: { createdAt: 'asc' },
        },
        deductions: {
          include: { deductionType: { select: { name: true, code: true } } },
          orderBy: { createdAt: 'asc' },
        },
        statutoryLines: {
          include: { taxType: { select: { name: true, taxTypeCode: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!record) throw new NotFoundException('Payslip not found');

    const employee = record.employee;
    const period = record.payrollRun?.payrollPeriod;
    const runNumber = record.payrollRun?.payrollRunNumber ?? record.id.slice(0, 8);
    const reference = `${runNumber}-${employee?.employeeCode ?? 'EMP'}`;
    const employeeStatutory = record.statutoryLines.filter(
      (line) => Number(line.employeeContribution) > 0,
    );
    const employerStatutory = record.statutoryLines.filter(
      (line) => Number(line.employerContribution) > 0,
    );
    const employerTotal = employerStatutory.reduce(
      (sum, line) => sum + Number(line.employerContribution),
      0,
    );

    return this.wrapPdf(
      record.companyId,
      employee?.branch?.id ?? null,
      reference,
      DocumentCategory.PAYROLL_DOCUMENT,
      {
        title: 'Payslip',
        subtitle: employee?.fullName ?? undefined,
        reference,
        status: label(record.status),
        organization: organization(record.company, employee?.branch),
        generatedAt: new Date(),
        meta: [
          kv('Payroll Run', value(record.payrollRun?.payrollRunNumber)),
          kv('Pay Period', value(period?.name)),
          kv('Period Dates', period ? `${date(period.startDate)} - ${date(period.endDate)}` : null),
          kv('Payment Date', date(period?.paymentDate)),
        ],
        sections: [
          {
            title: 'Employee Details',
            items: [
              kv('Employee', employee?.fullName),
              kv('Employee Code', employee?.employeeCode),
              kv('Department', employee?.department?.name),
              kv('Position', employee?.position?.title),
              kv('TIN', employee?.tin),
              kv('NSSF Number', employee?.nssfNumber),
              kv('NHIF Number', employee?.nhifNumber),
              kv('Bank', employee?.bankName),
              kv('Bank Account', employee?.bankAccountNumber),
            ],
          },
          {
            title: 'Earnings',
            table: {
              headers: ['Earning', 'Amount'],
              numericColumns: [1],
              rows: [
                ['Base Pay', money(record.basePay)],
                ['Attendance Pay', money(record.attendancePay)],
                ['Overtime Pay', money(record.overtimePay)],
                ...record.allowances.map((allowance) => [
                  allowance.allowanceType?.name ?? allowance.description ?? 'Allowance',
                  money(allowance.amount),
                ]),
              ],
            },
            totals: [total('Gross Pay', record.grossPay, 'TZS', true)],
          },
          {
            title: 'Deductions',
            table: {
              headers: ['Deduction', 'Amount'],
              numericColumns: [1],
              rows: [
                ...employeeStatutory.map((line) => [
                  line.taxType?.name ?? line.taxType?.taxTypeCode ?? 'Statutory deduction',
                  money(line.employeeContribution),
                ]),
                ...record.deductions.map((deduction) => [
                  deduction.deductionType?.name ?? deduction.description ?? 'Deduction',
                  money(deduction.amount),
                ]),
              ],
            },
            totals: [
              total('Total Deductions', record.totalDeductions, 'TZS', true),
              total('Net Pay', record.netPay, 'TZS', true),
            ],
          },
          employerStatutory.length
            ? {
                title: 'Employer Contributions',
                table: {
                  headers: ['Contribution', 'Amount'],
                  numericColumns: [1],
                  rows: employerStatutory.map((line) => [
                    line.taxType?.name ?? line.taxType?.taxTypeCode ?? 'Statutory contribution',
                    money(line.employerContribution),
                  ]),
                },
                totals: [total('Total Employer Contributions', employerTotal, 'TZS', true)],
              }
            : null,
          notesSection(record.notes),
          { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Employee'] },
        ].filter(Boolean) as BusinessPdfSection[],
      },
    );
  }

  private async creditNotePdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.creditNote.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        salesOrder: { select: { salesOrderNumber: true } },
        receivable: { select: { receivableNumber: true } },
        createdBy: { select: { fullName: true } },
        lines: {
          include: {
            product: { select: { name: true, sku: true, productCode: true } },
            unit: { select: { name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Credit note not found');

    const reference = record.creditNoteNumber ?? record.id.slice(0, 8);
    const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
    const unappliedAmount = Number(record.totalAmount ?? 0) - Number(record.appliedAmount ?? 0);
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.OTHER, {
      title: 'Credit Note',
      subtitle: customerName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Credit Note Number', reference),
        kv('Issue Date', date(record.issueDate)),
        kv('Sales Order', value(record.salesOrder?.salesOrderNumber)),
        kv('Receivable', value(record.receivable?.receivableNumber)),
      ],
      sections: [
        customerDetails(customerName, record.customer, [
          kv('Reason', value(record.reason)),
          kv('Prepared By', value(record.createdBy?.fullName)),
          kv('Currency', value(record.currency)),
        ]),
        {
          title: 'Line Items',
          table: {
            headers: ['Item', 'SKU', 'Qty', 'Unit', 'Unit Price', 'Tax', 'Line Total'],
            numericColumns: [2, 4, 5, 6],
            mutedColumns: [1],
            rows: record.lines.map((line) => [
              line.description || line.product?.name || 'N/A',
              line.product?.sku ?? line.product?.productCode ?? 'N/A',
              qty(line.quantity),
              line.unit?.symbol ?? line.unit?.name ?? 'N/A',
              money(line.unitPrice, record.currency),
              money(line.taxAmount, record.currency),
              money(line.lineTotal, record.currency),
            ]),
          },
          totals: [
            total('Subtotal', record.subtotal, record.currency),
            total('Tax', record.taxAmount, record.currency),
            total('Total', record.totalAmount, record.currency, true),
            total('Applied', record.appliedAmount, record.currency),
            total('Unapplied', unappliedAmount, record.currency, true),
          ],
        },
        notesSection(record.notes),
        { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Customer'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  private async customerPaymentReceiptPdf(
    id: string,
    user: AuthUser,
  ): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.customerPayment.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        customer: customerSelect(),
        cashAccount: { select: { accountName: true } },
        createdBy: { select: { fullName: true } },
        allocations: {
          include: {
            receivable: { select: { receivableNumber: true, dueDate: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!record) throw new NotFoundException('Customer payment not found');

    const reference = record.paymentNumber ?? record.id.slice(0, 8);
    const customerName = record.customer?.name ?? 'N/A';
    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.RECEIPT, {
      title: 'Payment Receipt',
      subtitle: customerName,
      reference,
      status: label(record.status),
      organization: organization(record.company, record.branch),
      generatedAt: new Date(),
      meta: [
        kv('Receipt Number', reference),
        kv('Payment Date', date(record.paymentDate)),
        kv('Payment Method', label(record.method)),
        kv('Reference', value(record.reference)),
      ],
      sections: [
        customerDetails(customerName, record.customer, [
          kv('Cash Account', value(record.cashAccount?.accountName)),
          kv('Received By', value(record.createdBy?.fullName)),
          kv('Currency', value(record.currency)),
        ]),
        {
          title: 'Receivable Allocations',
          table: {
            headers: ['Receivable', 'Due Date', 'Status', 'Amount Applied'],
            numericColumns: [3],
            rows: record.allocations.map((allocation) => [
              allocation.receivable?.receivableNumber ?? 'N/A',
              date(allocation.receivable?.dueDate),
              label(allocation.receivable?.status),
              money(allocation.amount, record.currency),
            ]),
          },
          totals: [
            total('Amount Received', record.amount, record.currency, true),
            total('Applied to Receivables', record.appliedAmount, record.currency),
            total('Unapplied (On Account)', record.unappliedAmount, record.currency, true),
          ],
        },
        notesSection(record.notes),
        { title: 'Acknowledgement', signatures: ['Received By', 'Customer'] },
      ].filter(Boolean) as BusinessPdfSection[],
    });
  }

  /**
   * GRN/SupplierInvoice lines carry scalar productId/unitId with no Prisma
   * relations, so display names come from batched id→record lookup maps.
   */
  private async productAndUnitMaps(
    productIds: Array<string | null | undefined>,
    unitIds: Array<string | null | undefined>,
  ) {
    const productIdList = uniqueIds(productIds);
    const unitIdList = uniqueIds(unitIds);
    const [products, units] = await Promise.all([
      productIdList.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIdList } },
            select: { id: true, name: true, sku: true, productCode: true },
          })
        : [],
      unitIdList.length
        ? this.prisma.unitOfMeasure.findMany({
            where: { id: { in: unitIdList } },
            select: { id: true, name: true, symbol: true },
          })
        : [],
    ]);
    return { products: mapById(products), units: mapById(units) };
  }

  private wrapPdf(
    companyId: string | null | undefined,
    branchId: string | null | undefined,
    reference: string,
    category: DocumentCategory,
    pdf: BusinessPdfModel,
  ): ResolvedBusinessPdfModel {
    return {
      companyId: companyId ?? null,
      branchId: branchId ?? null,
      reference,
      title: `${pdf.title} ${reference}`,
      fileStem: safeFileStem(`${pdf.title}-${reference}`),
      category,
      pdf,
    };
  }

  private async ensureSystemTemplate(entityType: string, companyId: string | null, userId: string) {
    const templateType = templateTypeFor(entityType);
    const templateCode = `SYSTEM_${entityType}_PDF`;
    return this.prisma.documentTemplate.upsert({
      where: { templateCode },
      create: {
        templateCode,
        companyId: null,
        name: `System ${label(entityType)} PDF`,
        templateType,
        format: DocumentTemplateFormat.PDF_READY_HTML,
        content: 'System-generated uniform PDF artifact template.',
        variables: {},
        isDefault: true,
        status: DocumentTemplateStatus.ACTIVE,
        createdById: userId,
      },
      update: {
        status: DocumentTemplateStatus.ACTIVE,
      },
    });
  }

  private async generatedDocumentNumber(entityType: string) {
    const stamp = Date.now().toString(36).toUpperCase();
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `GD-${entityType.replace(/_/g, '-')}-${stamp}-${suffix}`;
  }
}

interface ResolvedBusinessPdfModel {
  companyId: string | null;
  branchId: string | null;
  reference: string;
  title: string;
  fileStem: string;
  category: DocumentCategory;
  pdf: BusinessPdfModel;
}

function companySelect() {
  return {
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
      email: true,
      website: true,
      logoUrl: true,
      group: {
        select: { name: true, code: true, address: true, phone: true, email: true, website: true },
      },
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
  };
}

function branchSelect() {
  return { select: { id: true, name: true, code: true, address: true, phone: true } };
}

function customerSelect() {
  return {
    select: {
      name: true,
      customerCode: true,
      phone: true,
      email: true,
      address: true,
      contactPerson: true,
    },
  };
}

function supplierSelect() {
  return {
    select: {
      name: true,
      supplierCode: true,
      tin: true,
      vrn: true,
      phone: true,
      email: true,
      address: true,
      contactPerson: true,
      paymentTerms: true,
    },
  };
}

function organization(company: any, branch?: any): BusinessPdfOrganization {
  const profile = company?.profile;
  const group = company?.group;
  const groupName = value(group?.name) !== 'N/A' ? value(group?.name) : 'ITEMBA GROUP';
  const companyName =
    value(profile?.registeredName) !== 'N/A'
      ? value(profile?.registeredName)
      : value(company?.name) !== 'N/A'
        ? value(company?.name)
        : 'ITEMBA-R Group';

  return {
    groupName,
    name: companyName,
    companyName: company?.name,
    code: company?.code,
    branchName: branch?.name,
    address:
      branch?.address ?? profile?.registeredAddress ?? profile?.postalAddress ?? group?.address,
    phone: branch?.phone ?? company?.phone ?? group?.phone,
    email: company?.email ?? group?.email ?? 'info@itembagrouptz.com',
    website: company?.website ?? group?.website ?? 'itembagrouptz.com',
    tin: profile?.tin,
    vrn: profile?.vrn,
    registrationNumber: profile?.brelaRegNumber,
    logoUrl: firstPresent(company?.logoUrl, DEFAULT_ITEMBA_LOGO_URL),
  };
}

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => String(value ?? '').trim().length > 0) ?? null;
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item] as const));
}

function logoDocumentId(logoUrl?: string | null) {
  const text = String(logoUrl ?? '').trim();
  const match =
    text.match(/\/api\/backend\/documents\/([^/?#]+)\/download/) ??
    text.match(/\/documents\/([^/?#]+)\/download/);
  return match ? decodeURIComponent(match[1]) : null;
}

function defaultLogoImage(logoUrl?: string | null): BusinessPdfImage | null {
  const text = String(logoUrl ?? '').trim();
  if (text && text !== DEFAULT_ITEMBA_LOGO_URL) return null;

  const configuredPath = process.env.ITEMBA_DEFAULT_LOGO_PATH?.trim();
  const candidates = [
    configuredPath,
    path.resolve(process.cwd(), 'assets/brand/itemba-group-logo.png'),
    path.resolve(process.cwd(), '../frontend/public/brand/itemba-group-logo.png'),
    path.resolve(process.cwd(), 'frontend/public/brand/itemba-group-logo.png'),
    path.resolve(__dirname, '../assets/brand/itemba-group-logo.png'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return { data: fs.readFileSync(candidate), mimeType: 'image/png' };
      }
    } catch {
      // Continue to text fallback if the packaged default logo cannot be read.
    }
  }

  return null;
}

function hasPermission(user: AuthUser, permission: string) {
  return user.permissions.includes(permission);
}

function isBusinessPdfEntityType(value: string): value is BusinessPdfEntityType {
  return (BUSINESS_PDF_ENTITY_TYPES as readonly string[]).includes(value);
}

function permissionForBusinessPdfEntity(entityType: BusinessPdfEntityType) {
  switch (entityType) {
    case 'SALES_ORDER':
      return 'sales.view';
    case 'PURCHASE_ORDER':
      return 'purchases.view';
    case 'QUOTATION':
      return 'quotations.view';
    case 'PROFORMA_INVOICE':
      return 'proformas.view';
    case 'DELIVERY_NOTE':
      return 'delivery_notes.view';
    case 'CUSTOMER_PROFILE':
      return 'customers.view';
    case 'GOODS_RECEIVED_NOTE':
      return 'grn.view';
    case 'SUPPLIER_INVOICE':
      return 'supplier_invoices.view';
    case 'PAYSLIP':
      return 'payroll.view';
    case 'CREDIT_NOTE':
      return 'receivables.view';
    case 'CUSTOMER_PAYMENT_RECEIPT':
      return 'customer-payments.view';
    default:
      return 'documents.manage';
  }
}

function kv(labelText: string, rawValue: unknown) {
  return { label: labelText, value: value(rawValue) };
}

function customerDetails(
  customerName: string,
  customer: any,
  extra: Array<{ label: string; value: string }>,
) {
  return {
    title: 'Customer Details',
    items: [
      kv('Customer', customerName),
      kv('Customer Code', customer?.customerCode),
      kv('Phone', customer?.phone),
      kv('Email', customer?.email),
      kv('Contact Person', customer?.contactPerson),
      kv('Address', customer?.address),
      ...extra,
    ],
  };
}

function supplierDetails(
  supplierName: string,
  supplier: any,
  extra: Array<{ label: string; value: string }>,
) {
  return {
    title: 'Supplier and Order Details',
    items: [
      kv('Supplier', supplierName),
      kv('Supplier Code', supplier?.supplierCode),
      kv('TIN', supplier?.tin),
      kv('VRN', supplier?.vrn),
      kv('Phone', supplier?.phone),
      kv('Email', supplier?.email),
      kv('Contact Person', supplier?.contactPerson),
      kv('Payment Terms', supplier?.paymentTerms),
      kv('Address', supplier?.address),
      ...extra,
    ],
  };
}

function standardLineRows(lines: any[], currency: string) {
  return lines.map((line) => [
    line.description || line.product?.name || 'N/A',
    line.product?.sku ?? line.product?.productCode ?? 'N/A',
    qty(line.quantity),
    line.unit?.symbol ?? line.unit?.name ?? 'N/A',
    money(line.unitPrice, currency),
    money(line.discountAmount, currency),
    money(line.taxAmount, currency),
    money(line.lineTotal, currency),
  ]);
}

function purchaseLineRows(lines: any[], currency: string) {
  return lines.map((line) => [
    line.description || line.product?.name || 'N/A',
    line.product?.sku ?? line.product?.productCode ?? 'N/A',
    qty(line.quantity),
    line.unit?.symbol ?? line.unit?.name ?? 'N/A',
    money(line.unitCost, currency),
    money(line.discountAmount, currency),
    money(line.taxAmount, currency),
    money(line.lineTotal, currency),
  ]);
}

function lineSection(
  rows: string[][],
  _currency: string,
  totals: Array<{ label: string; value: string; emphasis?: boolean }>,
): BusinessPdfSection {
  return {
    title: 'Line Items',
    table: {
      headers: ['Item', 'SKU', 'Qty', 'Unit', 'Unit Price', 'Discount', 'Tax', 'Line Total'],
      numericColumns: [2, 4, 5, 6, 7],
      mutedColumns: [1],
      rows,
    },
    totals,
  };
}

function notesSection(notes: unknown): BusinessPdfSection | null {
  const note = value(notes);
  if (note === 'N/A') return null;
  return { title: 'Notes', paragraphs: [note] };
}

function total(labelText: string, amount: unknown, currency: string, emphasis = false) {
  return { label: labelText, value: money(amount, currency), emphasis };
}

function money(amount: unknown, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0))}`;
}

function qty(amount: unknown) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(Number(amount ?? 0));
}

function date(raw: unknown) {
  if (!raw) return 'N/A';
  const parsed = new Date(raw as string | Date);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB').format(parsed);
}

function value(raw: unknown) {
  if (raw === null || raw === undefined) return 'N/A';
  const text = String(raw).trim();
  return text ? text : 'N/A';
}

function label(raw: unknown) {
  return value(raw).replace(/_/g, ' ');
}

function truncateCell(cell: string) {
  return cell.length > TABLE_PDF_MAX_CELL_LENGTH
    ? `${cell.slice(0, TABLE_PDF_MAX_CELL_LENGTH - 3)}...`
    : cell;
}

function safeFileStem(value: string) {
  return (
    value
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 96) || 'document'
  );
}

function templateTypeFor(entityType: string): DocumentTemplateType {
  switch (entityType) {
    case 'PURCHASE_ORDER':
      return DocumentTemplateType.PURCHASE_ORDER;
    case 'QUOTATION':
      return DocumentTemplateType.QUOTATION;
    case 'PROFORMA_INVOICE':
      return DocumentTemplateType.PROFORMA_INVOICE;
    case 'DELIVERY_NOTE':
      return DocumentTemplateType.DELIVERY_NOTE;
    case 'PAYSLIP':
      return DocumentTemplateType.PAYSLIP;
    case 'CUSTOMER_PAYMENT_RECEIPT':
      return DocumentTemplateType.RECEIPT;
    default:
      return DocumentTemplateType.OTHER;
  }
}
