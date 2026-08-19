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
  CurrencyCode,
  DocumentCategory,
  DocumentOwnerType,
  DocumentTemplateFormat,
  DocumentTemplateStatus,
  DocumentTemplateType,
  GeneratedDocumentFormat,
  GeneratedDocumentStatus,
  ReceivableStatus,
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
const ITEMBA_DOCUMENT_LETTERHEAD = Object.freeze({
  groupName: 'ITEMBA GROUP',
  address: 'Kisimani Area, Tunduma Town Centre',
  telephone: '+255758793511',
  phone: '+255764601358',
  email: 'info@itembagrouptz.com',
  website: 'itembagrouptz.com',
  tin: '136-065-580',
  vrn: '40-030602-Q',
  registrationNumber: '135764',
});

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
    const sections: BusinessPdfSection[] = [];

    if (dto.summary?.length) {
      sections.push({
        title: 'Report Summary',
        items: dto.summary.map((entry) => kv(entry.label, entry.value)),
      });
    }

    sections.push({
      title: dto.sectionTitle ?? 'Report Detail',
      table: {
        headers,
        rows,
        numericColumns: dto.numericColumns,
        columnWeights: dto.columnWeights,
        stripedRows: dto.stripedRows,
      },
    });

    if (dto.note) {
      sections.push({ title: 'Report Note', paragraphs: [dto.note] });
    }

    const buffer = buildBusinessPdf({
      title: dto.title,
      subtitle: dto.subtitle,
      status: dto.status,
      orientation: dto.orientation,
      reference: generatedNumber,
      organization: org,
      generatedAt,
      meta: (dto.meta ?? []).map((entry) => kv(entry.label, entry.value)),
      sections,
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

  /**
   * Additive shared letterhead renderer for modules that stream their own
   * branded PDFs (e.g. Mobile POS Lite receipts) without persisting a
   * GeneratedDocument/Document pair. Sources the organization block exactly
   * like every business PDF in this module (company profile + branch with the
   * ITEMBA letterhead fallbacks), attaches the logo image, and returns the
   * rendered bytes. Callers own persistence, auditing, and response headers.
   */
  async renderLetterheadPdf(
    source: { companyId?: string | null; branchId?: string | null },
    pdf: Omit<BusinessPdfModel, 'organization'>,
    user: AuthUser,
  ): Promise<Buffer> {
    if (source.companyId) {
      // Same guard as generateTablePdf: letterhead content (TIN, VRN, address,
      // logo) must never leak across companies the caller cannot read.
      await this.companyScope.assertCanAccessCompany(user, source.companyId, AccessLevel.READ);
    }
    const [company, branch] = await Promise.all([
      source.companyId
        ? this.prisma.company.findFirst({
            where: { id: source.companyId, deletedAt: null },
            select: companySelect().select,
          })
        : null,
      source.branchId
        ? this.prisma.branch.findFirst({
            where: { id: source.branchId, deletedAt: null },
            select: branchSelect().select,
          })
        : null,
    ]);
    const org = organization(company, branch);
    await this.attachLogoImage(org, user);
    return buildBusinessPdf({ ...pdf, organization: org });
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
      case 'SUPPLIER_ORDER_DRAFT':
        return this.supplierOrderDraftPdf(entityId, user);
      case 'QUOTATION':
        return this.quotationPdf(entityId, user);
      case 'PROFORMA_INVOICE':
        return this.proformaPdf(entityId, user);
      case 'DELIVERY_NOTE':
        return this.deliveryNotePdf(entityId, user);
      case 'CUSTOMER_PROFILE':
        return this.customerProfilePdf(entityId, user);
      case 'CUSTOMER_DEBT_STATEMENT':
        return this.customerDebtStatementPdf(entityId, user);
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
      case 'EXPENSE_VOUCHER':
        return this.expenseVoucherPdf(entityId, user);
      default:
        throw new BadRequestException('Unsupported document entity type');
    }
  }

  private async expenseVoucherPdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.expense.findFirst({
      where,
      include: {
        company: companySelect(),
        expenseCategory: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        paidBy: { select: { fullName: true } },
        journalEntry: { select: { journalNumber: true } },
      },
    });
    if (!record) throw new NotFoundException('Expense not found');

    const reference = record.expenseNumber ?? record.id.slice(0, 8);
    const authorizationItems = [
      kv('Prepared By', record.createdBy?.fullName),
      kv('Approved By', record.approvedBy?.fullName),
      kv('Payment Processed By', record.paidBy?.fullName),
    ];
    const accountingSection = record.journalEntry?.journalNumber
      ? [
          {
            title: 'Accounting Reference',
            items: [kv('Journal Entry', record.journalEntry.journalNumber)],
          },
        ]
      : [];

    return this.wrapPdf(record.companyId, record.branchId, reference, DocumentCategory.AUDIT_FILE, {
      title: 'Expense Voucher',
      subtitle: record.vendorName || 'Company Expense',
      reference,
      status: label(record.status),
      organization: organization(record.company),
      generatedAt: new Date(),
      meta: [
        kv('Voucher Date', date(record.expenseDate)),
        kv('Category', record.expenseCategory?.name),
        kv('Currency', record.currency),
      ],
      sections: [
        {
          title: 'Expense Details',
          items: [
            kv('Paid To / Payee', record.vendorName || 'Not specified'),
            kv(
              'Payment Method',
              record.paymentMethod ? label(record.paymentMethod) : 'Not recorded',
            ),
            kv('Purpose', record.description),
          ],
        },
        {
          title: 'Amount',
          paragraphs: [amountInWords(record.amount, record.currency)],
          totals: [total('Total Expense', record.amount, record.currency, true)],
        },
        ...accountingSection,
        {
          title: 'Authorization',
          items: authorizationItems,
          signatures: ['Prepared By / Date', 'Approved By / Date', 'Received By / Date'],
        },
      ],
    });
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
        supplierInvoices: {
          where: { deletedAt: null },
          select: { supplierInvoiceNumber: true, invoiceDate: true },
          orderBy: { invoiceDate: 'desc' },
        },
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
    const supplierInvoiceNumber = record.supplierInvoices.length
      ? record.supplierInvoices.map((invoice) => invoice.supplierInvoiceNumber).join(', ')
      : record.supplierInvoiceNumber;
    const supplierInvoiceDate =
      record.supplierInvoices[0]?.invoiceDate ?? record.supplierInvoiceDate;
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
        kv('Supplier Invoice #', value(supplierInvoiceNumber)),
        kv('Invoice Date', date(supplierInvoiceDate)),
        kv('Payment Status', label(record.paymentStatus)),
      ],
      sections: [
        supplierDetails(supplierName, record.supplier, [
          kv('Purchase Type', label(record.purchaseType)),
          kv(
            'Invoice Source',
            supplierInvoiceNumber
              ? record.supplierInvoices.length
                ? 'Linked Procurement Invoice'
                : 'Purchase Reference'
              : 'Missing',
          ),
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

  private async supplierOrderDraftPdf(
    id: string,
    user: AuthUser,
  ): Promise<ResolvedBusinessPdfModel> {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const record = await this.prisma.supplierOrderDraft.findFirst({
      where,
      include: {
        company: companySelect(),
        branch: branchSelect(),
        createdBy: { select: { fullName: true } },
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!record) throw new NotFoundException('Supplier order draft not found');

    const supplierDetails = [
      record.supplierContact ? `Contact: ${record.supplierContact}` : null,
      record.supplierAddress ? `Address: ${record.supplierAddress}` : null,
      record.supplierPhone ? `Phone: ${record.supplierPhone}` : null,
      record.supplierEmail ? `Email: ${record.supplierEmail}` : null,
      [
        record.supplierTin ? `TIN: ${record.supplierTin}` : null,
        record.supplierVrn ? `VRN: ${record.supplierVrn}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    ].filter((item): item is string => Boolean(item));

    const pricingNote = record.hasUnpricedLines
      ? 'One or more item prices are still to be confirmed. The amount shown is a partial total for priced lines only.'
      : null;

    return this.wrapPdf(
      record.companyId,
      record.branchId,
      record.draftNumber,
      DocumentCategory.OTHER,
      {
        title: 'Supplier Order Draft',
        subtitle: record.title ?? undefined,
        reference: record.draftNumber,
        status: label(record.status),
        orientation: 'portrait',
        organization: organization(record.company, record.branch),
        generatedAt: new Date(),
        meta: [],
        compactPartyHeader: {
          partyLabel: 'Supplier',
          partyName: record.supplierName,
          partyDetails: supplierDetails,
          documentDetails: [
            kv('Draft date', date(record.draftDate)),
            kv('Needed by', date(record.neededBy)),
            kv('Currency', record.currency),
          ],
        },
        sections: [
          {
            title: record.title || 'Requested Items',
            ...(pricingNote && { paragraphs: [pricingNote] }),
            table: {
              headers: [
                '#',
                'Description',
                'Item Code',
                'Qty',
                'Unit',
                'Unit Price',
                'Discount',
                'Tax',
                'Amount',
              ],
              rows: record.lines.map((line) => [
                String(line.lineNumber),
                line.description,
                value(line.itemCode),
                qty(line.quantity),
                line.unitLabel,
                line.unitPrice === null
                  ? 'Price to be confirmed'
                  : money(line.unitPrice, record.currency),
                line.unitPrice === null ? '-' : money(line.discountAmount, record.currency),
                line.unitPrice === null ? '-' : money(line.taxAmount, record.currency),
                line.lineTotal === null
                  ? 'Price to be confirmed'
                  : money(line.lineTotal, record.currency),
              ]),
              numericColumns: [0, 3, 5, 6, 7, 8],
              columnWeights: [0.35, 2.6, 0.8, 0.55, 0.55, 1.1, 0.85, 0.75, 1.15],
              stripedRows: true,
              mutedColumns: [0, 2],
            },
            totals: [
              total('Priced subtotal', record.subtotal, record.currency),
              total('Discount', record.discountAmount, record.currency),
              total('Tax', record.taxAmount, record.currency),
              total(
                record.hasUnpricedLines ? 'Partial total' : 'Total',
                record.totalAmount,
                record.currency,
                true,
              ),
            ],
          },
          {
            title: 'Supplier Contact Record',
            items: [
              kv('Supplier', record.supplierName),
              kv('Contact', record.supplierContact),
              kv('Phone', record.supplierPhone),
              kv('Email', record.supplierEmail),
              kv('Address', record.supplierAddress),
              kv('TIN', record.supplierTin),
              kv('VRN', record.supplierVrn),
            ],
          },
          record.deliveryInstructions
            ? { title: 'Delivery Instructions', paragraphs: [record.deliveryInstructions] }
            : null,
          record.terms ? { title: 'Terms', paragraphs: [record.terms] } : null,
          notesSection(record.notes),
          {
            title: 'Acknowledgement',
            items: [
              kv('Prepared By', record.createdBy?.fullName),
              kv('Document Status', label(record.status)),
            ],
            signatures: ['Prepared By', 'Supplier Acknowledgement'],
          },
        ].filter(Boolean) as BusinessPdfSection[],
      },
    );
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

  /**
   * Customer-facing consolidated debt statement for the account rows exposed
   * by Finance > Receivables. `accountKey` is generated server-side by the
   * receivables account workbench and identifies one company/customer/currency
   * account (or one named unlinked account). Only active debts are included;
   * paid, written-off and cancelled documents are deliberately excluded.
   */
  private async customerDebtStatementPdf(
    accountKey: string,
    user: AuthUser,
  ): Promise<ResolvedBusinessPdfModel> {
    const selector = parseReceivableAccountKey(accountKey);
    await this.companyScope.assertCanAccessCompany(user, selector.companyId, AccessLevel.READ);

    const [company, customer] = await Promise.all([
      this.prisma.company.findFirst({
        where: { id: selector.companyId, deletedAt: null },
        select: companySelect().select,
      }),
      selector.kind === 'customer'
        ? this.prisma.customer.findFirst({
            where: {
              id: selector.customerId,
              companyId: selector.companyId,
              deletedAt: null,
            },
            select: {
              id: true,
              customerCode: true,
              name: true,
              legalName: true,
              customerType: true,
              tin: true,
              vrn: true,
              phone: true,
              email: true,
              address: true,
              contactPerson: true,
              creditLimit: true,
              paymentTerms: true,
              status: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!company) throw new NotFoundException('Company not found');
    if (selector.kind === 'customer' && !customer) {
      throw new NotFoundException('Customer account not found');
    }

    const activeStatuses: ReceivableStatus[] = [
      ReceivableStatus.OPEN,
      ReceivableStatus.PARTIALLY_PAID,
      ReceivableStatus.OVERDUE,
    ];
    let receivables = await this.prisma.receivable.findMany({
      where: {
        companyId: selector.companyId,
        currency: selector.currency,
        deletedAt: null,
        outstandingAmount: { gt: 0 },
        status: { in: activeStatuses },
        customerId: selector.kind === 'customer' ? selector.customerId : null,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        salesOrders: {
          where: { deletedAt: null },
          orderBy: { orderDate: 'asc' },
          select: {
            id: true,
            salesOrderNumber: true,
            customerName: true,
            orderDate: true,
            dueDate: true,
            salesType: true,
            paymentMethod: true,
            paymentReference: true,
            subtotal: true,
            discountAmount: true,
            documentDiscount: true,
            taxAmount: true,
            totalAmount: true,
            notes: true,
            lines: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                description: true,
                quantity: true,
                unitPrice: true,
                discountAmount: true,
                taxAmount: true,
                lineTotal: true,
                product: { select: { name: true, sku: true, productCode: true } },
                unit: { select: { name: true, symbol: true } },
              },
            },
          },
        },
        fuelCreditSales: {
          where: { deletedAt: null },
          orderBy: { saleDate: 'asc' },
          select: {
            creditSaleNumber: true,
            saleDate: true,
            litres: true,
            pricePerLitre: true,
            totalAmount: true,
            vehicleNumber: true,
            driverName: true,
            product: { select: { name: true, sku: true, productCode: true } },
          },
        },
        projectBillings: {
          where: { deletedAt: null },
          orderBy: { billingDate: 'asc' },
          select: {
            billingNumber: true,
            billingDate: true,
            description: true,
            amount: true,
            status: true,
          },
        },
        trips: {
          where: { deletedAt: null },
          orderBy: { tripDate: 'asc' },
          select: {
            tripNumber: true,
            tripDate: true,
            origin: true,
            destination: true,
            revenueAmount: true,
            status: true,
          },
        },
        paymentAllocations: {
          orderBy: { createdAt: 'asc' },
          include: {
            customerPayment: {
              select: {
                paymentNumber: true,
                paymentDate: true,
                amount: true,
                method: true,
                reference: true,
                status: true,
                notes: true,
              },
            },
          },
        },
        creditNotes: {
          where: { deletedAt: null, status: 'ISSUED' },
          orderBy: { issueDate: 'asc' },
          select: {
            creditNoteNumber: true,
            issueDate: true,
            reason: true,
            totalAmount: true,
            appliedAmount: true,
          },
        },
      },
      orderBy: [{ issueDate: 'asc' }, { receivableNumber: 'asc' }],
    });

    if (selector.kind === 'unlinked') {
      receivables = receivables.filter((record) => {
        const sourceName = record.salesOrders.find((order) =>
          order.customerName?.trim(),
        )?.customerName;
        return normaliseAccountName(sourceName ?? record.customerName) === selector.accountName;
      });
    }

    if (receivables.length === 0) {
      throw new NotFoundException('No active debts were found for this customer account');
    }

    const settlementEntries = await this.prisma.journalEntry.findMany({
      where: {
        companyId: selector.companyId,
        referenceType: 'Receivable',
        referenceId: { in: receivables.map((record) => record.id) },
        description: { startsWith: 'Receivable settlement' },
        status: 'POSTED',
        deletedAt: null,
      },
      select: {
        journalNumber: true,
        referenceId: true,
        transactionDate: true,
        totalDebit: true,
        description: true,
      },
      orderBy: { transactionDate: 'asc' },
    });

    const generatedAt = new Date();
    const asOf = startOfDay(generatedAt);
    const customerName =
      customer?.name ??
      receivables
        .find((record) => record.salesOrders.some((order) => order.customerName?.trim()))
        ?.salesOrders.find((order) => order.customerName?.trim())?.customerName ??
      receivables[0].customerName;
    const originalDebt = sumNumbers(receivables.map((record) => record.amount));
    const paid = sumNumbers(receivables.map((record) => record.paidAmount));
    const outstanding = sumNumbers(receivables.map((record) => record.outstandingAmount));
    const adjustments = Math.max(0, originalDebt - paid - outstanding);
    const overdue = sumNumbers(
      receivables
        .filter((record) => daysPastDue(record.dueDate, asOf) > 0)
        .map((record) => record.outstandingAmount),
    );
    const aging = debtAging(receivables, asOf);
    const reference = `DEBT-${safeFileStem(customer?.customerCode ?? customerName).slice(0, 30)}-${isoDate(generatedAt).replace(/-/g, '')}`;

    const sections: BusinessPdfSection[] = [
      {
        title: 'Customer Account',
        items: [
          kv('Customer', customerName),
          kv('Customer Code', customer?.customerCode),
          kv('Legal Name', customer?.legalName),
          kv('Customer Type', customer?.customerType),
          kv('Contact Person', customer?.contactPerson),
          kv('Phone', customer?.phone),
          kv('Email', customer?.email),
          kv('Address', customer?.address),
          kv('TIN', customer?.tin),
          kv('VRN', customer?.vrn),
          kv('Payment Terms', customer?.paymentTerms),
          kv('Currency', selector.currency),
        ],
      },
      {
        title: 'Balance Summary',
        items: [
          kv('Active Debt Documents', receivables.length),
          kv(
            'Overdue Documents',
            receivables.filter((r) => daysPastDue(r.dueDate, asOf) > 0).length,
          ),
          kv('Oldest Debt Date', date(receivables[0].issueDate)),
          kv('Statement Date', date(generatedAt)),
        ],
        totals: [
          total('Original Debt', originalDebt, selector.currency),
          total('Payments Received', paid, selector.currency),
          total('Credits / Adjustments', adjustments, selector.currency),
          total('Current Outstanding', outstanding, selector.currency, true),
          total('Amount Overdue', overdue, selector.currency, true),
        ],
      },
      {
        title: 'Outstanding Aging',
        table: {
          headers: ['Age Band', 'Outstanding'],
          rows: [
            ['Current / Not Yet Due', money(aging.current, selector.currency)],
            ['1-30 Days Overdue', money(aging.days1To30, selector.currency)],
            ['31-60 Days Overdue', money(aging.days31To60, selector.currency)],
            ['61-90 Days Overdue', money(aging.days61To90, selector.currency)],
            ['Over 90 Days', money(aging.over90, selector.currency)],
          ],
          numericColumns: [1],
          columnWeights: [2, 1],
          stripedRows: true,
        },
        totals: [total('Total Outstanding', outstanding, selector.currency, true)],
      },
      {
        title: 'Consolidated Debt Schedule',
        table: {
          headers: [
            'Debt No.',
            'Source',
            'Issue Date',
            'Due Date',
            'Age',
            'Original',
            'Paid',
            'Adjustments',
            'Balance',
          ],
          rows: receivables.map((record) => {
            const recordAmount = Number(record.amount);
            const recordPaid = Number(record.paidAmount);
            const recordOutstanding = Number(record.outstandingAmount);
            const recordAdjustments = Math.max(0, recordAmount - recordPaid - recordOutstanding);
            const overdueDays = daysPastDue(record.dueDate, asOf);
            return [
              record.receivableNumber,
              receivableSourceReference(record),
              date(record.issueDate),
              date(record.dueDate),
              overdueDays > 0 ? `${overdueDays} days` : 'Current',
              money(recordAmount, selector.currency),
              money(recordPaid, selector.currency),
              money(recordAdjustments, selector.currency),
              money(recordOutstanding, selector.currency),
            ];
          }),
          numericColumns: [5, 6, 7, 8],
          columnWeights: [1.25, 1.25, 0.85, 0.85, 0.7, 1, 1, 1, 1],
          mutedColumns: [1],
          stripedRows: true,
        },
      },
    ];

    for (const record of receivables) {
      const recordAmount = Number(record.amount);
      const recordPaid = Number(record.paidAmount);
      const recordOutstanding = Number(record.outstandingAmount);
      const recordAdjustments = Math.max(0, recordAmount - recordPaid - recordOutstanding);
      const overdueDays = daysPastDue(record.dueDate, asOf);
      const salesOrderRefs = record.salesOrders.map((order) => order.salesOrderNumber).join(', ');

      sections.push({
        title: `Debt Detail - ${record.receivableNumber}`,
        pageBreakBefore: true,
        items: [
          kv('Debt Number', record.receivableNumber),
          kv('Source Type', label(record.sourceType)),
          kv('Source Reference', receivableSourceReference(record)),
          kv('Sales Order', salesOrderRefs || null),
          kv('Branch', record.branch ? `${record.branch.code} - ${record.branch.name}` : null),
          kv('Issue Date', date(record.issueDate)),
          kv('Due Date', date(record.dueDate)),
          kv('Days Overdue', overdueDays > 0 ? overdueDays : 0),
          kv('Status', overdueDays > 0 ? 'OVERDUE' : label(record.status)),
          kv('Notes', record.notes),
        ],
        totals: [
          total('Original Amount', recordAmount, selector.currency),
          total('Paid to Date', recordPaid, selector.currency),
          total('Credits / Adjustments', recordAdjustments, selector.currency),
          total('Outstanding Balance', recordOutstanding, selector.currency, true),
        ],
      });

      const orderLineRows = record.salesOrders.flatMap((order) =>
        order.lines.map((line) => [
          order.salesOrderNumber,
          line.description || line.product?.name || 'N/A',
          line.product?.sku ?? line.product?.productCode ?? 'N/A',
          qty(line.quantity),
          line.unit?.symbol ?? line.unit?.name ?? 'N/A',
          money(line.unitPrice, selector.currency),
          money(line.discountAmount, selector.currency),
          money(line.taxAmount, selector.currency),
          money(line.lineTotal, selector.currency),
        ]),
      );
      if (orderLineRows.length) {
        sections.push({
          title: `Products and Charges - ${record.receivableNumber}`,
          table: {
            headers: [
              'Sales Order',
              'Product / Description',
              'Code / SKU',
              'Qty',
              'Unit',
              'Unit Price',
              'Discount',
              'Tax',
              'Line Total',
            ],
            rows: orderLineRows,
            numericColumns: [3, 5, 6, 7, 8],
            columnWeights: [1.1, 1.8, 1, 0.65, 0.65, 1, 0.9, 0.9, 1],
            mutedColumns: [0, 2],
            stripedRows: true,
          },
        });
      }

      const otherSourceRows = [
        ...record.fuelCreditSales.map((sale) => [
          sale.creditSaleNumber,
          'Fuel credit sale',
          sale.product?.name ?? 'Fuel',
          `${qty(sale.litres)} L`,
          sale.vehicleNumber ?? sale.driverName ?? 'N/A',
          money(sale.totalAmount, selector.currency),
        ]),
        ...record.projectBillings.map((billing) => [
          billing.billingNumber,
          'Project billing',
          billing.description ?? 'Project billing',
          date(billing.billingDate),
          label(billing.status),
          money(billing.amount, selector.currency),
        ]),
        ...record.trips.map((trip) => [
          trip.tripNumber,
          'Trip',
          `${trip.origin} to ${trip.destination}`,
          date(trip.tripDate),
          label(trip.status),
          money(trip.revenueAmount, selector.currency),
        ]),
      ];
      if (otherSourceRows.length) {
        sections.push({
          title: `Other Source Detail - ${record.receivableNumber}`,
          table: {
            headers: ['Reference', 'Source', 'Description', 'Quantity / Date', 'Detail', 'Amount'],
            rows: otherSourceRows,
            numericColumns: [5],
            columnWeights: [1.1, 1, 1.8, 1, 1.2, 1],
            stripedRows: true,
          },
        });
      }

      const allocationPayments = record.paymentAllocations
        .filter((allocation) => allocation.customerPayment.status === 'COMPLETED')
        .map((allocation) => ({
          date: allocation.customerPayment.paymentDate,
          number: allocation.customerPayment.paymentNumber,
          method: label(allocation.customerPayment.method),
          reference: allocation.customerPayment.reference ?? 'N/A',
          documentAmount: Number(allocation.customerPayment.amount),
          amount: Number(allocation.amount),
        }));
      const legacyPayments = settlementEntries
        .filter((entry) => entry.referenceId === record.id)
        .map((entry) => ({
          date: entry.transactionDate,
          number: entry.journalNumber,
          method: 'Recorded payment',
          reference: entry.description,
          documentAmount: Number(entry.totalDebit),
          amount: Number(entry.totalDebit),
        }));
      const settlementRows = [...allocationPayments, ...legacyPayments]
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((payment) => [
          date(payment.date),
          payment.number,
          `Payment - ${payment.method}`,
          payment.reference,
          money(payment.documentAmount, selector.currency),
          money(payment.amount, selector.currency),
        ]);
      const itemizedPayments = sumNumbers([
        ...allocationPayments.map((payment) => payment.amount),
        ...legacyPayments.map((payment) => payment.amount),
      ]);
      if (recordPaid - itemizedPayments > 0.005) {
        settlementRows.push([
          'N/A',
          'Brought forward',
          'Payment - Historical',
          'Payment detail predates itemized receipts',
          money(recordPaid - itemizedPayments, selector.currency),
          money(recordPaid - itemizedPayments, selector.currency),
        ]);
      }
      settlementRows.push(
        ...record.creditNotes.map((creditNote) => [
          date(creditNote.issueDate),
          creditNote.creditNoteNumber,
          'Credit note',
          creditNote.reason ?? 'Customer credit adjustment',
          money(creditNote.totalAmount, selector.currency),
          money(creditNote.appliedAmount, selector.currency),
        ]),
      );
      if (settlementRows.length) {
        sections.push({
          title: `Payments and Adjustments - ${record.receivableNumber}`,
          table: {
            headers: [
              'Date',
              'Receipt / Credit Note',
              'Activity',
              'Reference / Reason',
              'Document Total',
              'Applied to Debt',
            ],
            rows: settlementRows,
            numericColumns: [4, 5],
            columnWeights: [0.75, 1.05, 1, 1.7, 1, 1],
            stripedRows: true,
          },
          totals: [
            total('Paid to Date', recordPaid, selector.currency),
            total('Credits / Adjustments', recordAdjustments, selector.currency, true),
          ],
        });
      }
    }

    sections.push(
      {
        title: 'Statement Note',
        paragraphs: [
          `This statement consolidates every active debt currently recorded for ${customerName} in ${selector.currency}. Fully paid, cancelled and written-off documents are excluded. Please quote the debt number or source reference when making payment or raising a query.`,
        ],
      },
      { title: 'Acknowledgement', signatures: ['Prepared By', 'Customer / Authorized Signatory'] },
    );

    return this.wrapPdf(selector.companyId, null, reference, DocumentCategory.DEBT_DOCUMENT, {
      title: 'Customer Debt Statement',
      subtitle: `${customerName} - consolidated active debts`,
      reference,
      status: overdue > 0 ? 'OVERDUE' : 'OUTSTANDING',
      organization: organization(company),
      generatedAt,
      meta: [
        kv('Statement Date', date(generatedAt)),
        kv('Customer', customerName),
        kv('Currency', selector.currency),
        kv('Active Debts', receivables.length),
      ],
      sections,
    });
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

  private async supplierInvoicePdf(id: string, user: AuthUser): Promise<ResolvedBusinessPdfModel> {
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
  const groupName = ITEMBA_DOCUMENT_LETTERHEAD.groupName;
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
    address: firstPresent(
      profile?.registeredAddress,
      profile?.postalAddress,
      branch?.address,
      group?.address,
      ITEMBA_DOCUMENT_LETTERHEAD.address,
    ),
    telephone: firstPresent(company?.phone, group?.phone, ITEMBA_DOCUMENT_LETTERHEAD.telephone),
    phone: firstPresent(branch?.phone, ITEMBA_DOCUMENT_LETTERHEAD.phone),
    email: firstPresent(company?.email, group?.email, ITEMBA_DOCUMENT_LETTERHEAD.email),
    website: firstPresent(company?.website, group?.website, ITEMBA_DOCUMENT_LETTERHEAD.website),
    tin: firstPresent(profile?.tin, ITEMBA_DOCUMENT_LETTERHEAD.tin),
    vrn: firstPresent(profile?.vrn, ITEMBA_DOCUMENT_LETTERHEAD.vrn),
    registrationNumber: firstPresent(
      profile?.brelaRegNumber,
      ITEMBA_DOCUMENT_LETTERHEAD.registrationNumber,
    ),
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

type ReceivableAccountSelector =
  | {
      kind: 'customer';
      companyId: string;
      customerId: string;
      currency: CurrencyCode;
    }
  | {
      kind: 'unlinked';
      companyId: string;
      accountName: string;
      currency: CurrencyCode;
    };

function parseReceivableAccountKey(accountKey: string): ReceivableAccountSelector {
  const parts = String(accountKey ?? '').split(':');
  const kind = parts.shift()?.trim().toUpperCase();
  const companyId = parts.shift()?.trim();
  const currencyValue = parts.pop()?.trim().toUpperCase();

  if (
    !companyId ||
    !currencyValue ||
    !Object.values(CurrencyCode).includes(currencyValue as CurrencyCode)
  ) {
    throw new BadRequestException('Invalid receivable account key');
  }

  if (kind === 'CUSTOMER') {
    const customerId = parts.join(':').trim();
    if (!customerId) throw new BadRequestException('Invalid customer account key');
    return {
      kind: 'customer',
      companyId,
      customerId,
      currency: currencyValue as CurrencyCode,
    };
  }

  if (kind === 'UNLINKED') {
    const accountName = normaliseAccountName(parts.join(':'));
    if (!accountName) throw new BadRequestException('Invalid unlinked customer account key');
    return {
      kind: 'unlinked',
      companyId,
      accountName,
      currency: currencyValue as CurrencyCode,
    };
  }

  throw new BadRequestException('Invalid receivable account key');
}

function normaliseAccountName(raw: unknown) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function startOfDay(raw: Date) {
  const value = new Date(raw);
  value.setHours(0, 0, 0, 0);
  return value;
}

function isoDate(raw: Date) {
  const year = raw.getFullYear();
  const month = String(raw.getMonth() + 1).padStart(2, '0');
  const day = String(raw.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysPastDue(rawDueDate: Date | null | undefined, asOf: Date) {
  if (!rawDueDate) return 0;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    0,
    Math.floor(
      (startOfDay(asOf).getTime() - startOfDay(rawDueDate).getTime()) / millisecondsPerDay,
    ),
  );
}

function sumNumbers(values: unknown[]) {
  const sum = values.reduce<number>((total, raw) => {
    const parsed = Number(raw ?? 0);
    return total + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

function debtAging(
  records: Array<{ dueDate: Date | null; outstandingAmount: unknown }>,
  asOf: Date,
) {
  const buckets = {
    current: 0,
    days1To30: 0,
    days31To60: 0,
    days61To90: 0,
    over90: 0,
  };

  for (const record of records) {
    const amount = Number(record.outstandingAmount ?? 0);
    const overdueDays = daysPastDue(record.dueDate, asOf);
    if (overdueDays <= 0) buckets.current += amount;
    else if (overdueDays <= 30) buckets.days1To30 += amount;
    else if (overdueDays <= 60) buckets.days31To60 += amount;
    else if (overdueDays <= 90) buckets.days61To90 += amount;
    else buckets.over90 += amount;
  }

  return buckets;
}

function receivableSourceReference(record: any) {
  const references = [
    ...(record.salesOrders ?? []).map((item: any) => item.salesOrderNumber),
    ...(record.fuelCreditSales ?? []).map((item: any) => item.creditSaleNumber),
    ...(record.projectBillings ?? []).map((item: any) => item.billingNumber),
    ...(record.trips ?? []).map((item: any) => item.tripNumber),
  ].filter(Boolean);

  if (references.length) return Array.from(new Set(references)).join(', ');
  if (record.sourceType && record.sourceId) return `${label(record.sourceType)} ${record.sourceId}`;
  if (record.sourceType) return label(record.sourceType);
  return 'Manual receivable';
}

function permissionForBusinessPdfEntity(entityType: BusinessPdfEntityType) {
  switch (entityType) {
    case 'SALES_ORDER':
      return 'sales.view';
    case 'PURCHASE_ORDER':
      return 'purchases.view';
    case 'SUPPLIER_ORDER_DRAFT':
      return 'supplier_order_drafts.export';
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
    case 'CUSTOMER_DEBT_STATEMENT':
      return 'receivables.view';
    case 'CUSTOMER_PAYMENT_RECEIPT':
      return 'customer-payments.view';
    case 'EXPENSE_VOUCHER':
      return 'expenses.view';
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

const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  TZS: ['Tanzanian Shilling', 'Tanzanian Shillings', 'Cent', 'Cents'],
  USD: ['US Dollar', 'US Dollars', 'Cent', 'Cents'],
  EUR: ['Euro', 'Euros', 'Cent', 'Cents'],
  KES: ['Kenyan Shilling', 'Kenyan Shillings', 'Cent', 'Cents'],
  UGX: ['Ugandan Shilling', 'Ugandan Shillings', 'Cent', 'Cents'],
  GBP: ['British Pound', 'British Pounds', 'Penny', 'Pence'],
};

function amountInWords(rawAmount: unknown, rawCurrency: unknown) {
  const amount = Number(rawAmount ?? 0);
  const currency = value(rawCurrency).toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.floor(amount))) {
    return `Amount in words: ${money(rawAmount, currency)}.`;
  }

  const minorUnits = Math.round(amount * 100);
  const whole = Math.floor(minorUnits / 100);
  const fraction = minorUnits % 100;
  const labels = CURRENCY_WORDS[currency] ?? [currency, currency, 'Cent', 'Cents'];
  const majorLabel = whole === 1 ? labels[0] : labels[1];
  const fractionText = fraction
    ? ` and ${capitalizeWords(integerToEnglishWords(fraction))} ${fraction === 1 ? labels[2] : labels[3]}`
    : '';

  return `Amount in words: ${capitalizeWords(integerToEnglishWords(whole))} ${majorLabel}${fractionText} Only.`;
}

function integerToEnglishWords(value: number): string {
  if (value === 0) return 'zero';

  const scales: Array<[number, string]> = [
    [1_000_000_000_000, 'trillion'],
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ];
  const parts: string[] = [];
  let remaining = value;

  for (const [size, name] of scales) {
    if (remaining < size) continue;
    const count = Math.floor(remaining / size);
    parts.push(`${integerToEnglishWords(count)} ${name}`);
    remaining %= size;
  }
  if (remaining) parts.push(numberBelowOneThousandInWords(remaining));
  return parts.join(' ');
}

function numberBelowOneThousandInWords(value: number) {
  const small = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];
  const parts: string[] = [];
  let remaining = value;

  if (remaining >= 100) {
    parts.push(`${small[Math.floor(remaining / 100)]} hundred`);
    remaining %= 100;
  }
  if (remaining >= 20) {
    parts.push(tens[Math.floor(remaining / 10)]);
    if (remaining % 10) parts.push(small[remaining % 10]);
  } else if (remaining > 0) {
    parts.push(small[remaining]);
  }
  return parts.join(' ');
}

function capitalizeWords(text: string) {
  return text.replace(/\b[a-z]/g, (character) => character.toUpperCase());
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
    case 'SUPPLIER_ORDER_DRAFT':
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
