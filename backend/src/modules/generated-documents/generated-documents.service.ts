import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
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
import { applyCompanyScopeWhere } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from '../documents/documents.service';
import { BusinessPdfEntityType, GenerateBusinessPdfDto } from './dto/generate-business-pdf.dto';
import {
  BusinessPdfModel,
  BusinessPdfOrganization,
  BusinessPdfSection,
  buildBusinessPdf,
} from './pdf-builder';

@Injectable()
export class GeneratedDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly documents: DocumentsService,
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

  private async attachLogoImage(organization: BusinessPdfOrganization, user: AuthUser) {
    const documentId = logoDocumentId(organization.logoUrl);
    if (!documentId) return;

    try {
      const file = await this.documents.readFileBuffer(documentId, user);
      const mimeType = file.mimeType.toLowerCase();
      organization.logoImage = { data: file.buffer, mimeType };
    } catch {
      organization.logoImage = null;
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

  private async ensureSystemTemplate(
    entityType: BusinessPdfEntityType,
    companyId: string | null,
    userId: string,
  ) {
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

  private async generatedDocumentNumber(entityType: BusinessPdfEntityType) {
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
    logoUrl: company?.logoUrl,
  };
}

function logoDocumentId(logoUrl?: string | null) {
  const text = String(logoUrl ?? '').trim();
  const match =
    text.match(/\/api\/backend\/documents\/([^/?#]+)\/download/) ??
    text.match(/\/documents\/([^/?#]+)\/download/);
  return match ? decodeURIComponent(match[1]) : null;
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

function templateTypeFor(entityType: BusinessPdfEntityType): DocumentTemplateType {
  switch (entityType) {
    case 'PURCHASE_ORDER':
      return DocumentTemplateType.PURCHASE_ORDER;
    case 'QUOTATION':
      return DocumentTemplateType.QUOTATION;
    case 'PROFORMA_INVOICE':
      return DocumentTemplateType.PROFORMA_INVOICE;
    case 'DELIVERY_NOTE':
      return DocumentTemplateType.DELIVERY_NOTE;
    default:
      return DocumentTemplateType.OTHER;
  }
}
