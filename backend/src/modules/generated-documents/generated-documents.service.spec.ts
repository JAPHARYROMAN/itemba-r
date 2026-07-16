import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GeneratedDocumentsService } from './generated-documents.service';
import { GenerateTablePdfDto } from './dto/generate-table-pdf.dto';
import { BusinessPdfEntityType } from './dto/generate-business-pdf.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import * as pdfBuilder from './pdf-builder';

/**
 * Fully-mocked unit tests. No Postgres / real Prisma client needed — the
 * delegates used by generateTablePdf are stubbed on the mock `prisma` object.
 */

function makeService() {
  const prisma = {
    company: { findFirst: jest.fn(async () => null) },
    documentTemplate: {
      upsert: jest.fn(async ({ where }: any) => ({
        id: 'template-1',
        templateCode: where.templateCode,
      })),
    },
    generatedDocument: {
      create: jest.fn(async ({ data }: any) => ({ id: 'generated-1', ...data })),
    },
    goodsReceivedNote: { findFirst: jest.fn(async () => null) },
    supplierInvoice: { findFirst: jest.fn(async () => null) },
    payrollEntry: { findFirst: jest.fn(async () => null) },
    creditNote: { findFirst: jest.fn(async () => null) },
    customer: { findFirst: jest.fn(async () => null) },
    customerPayment: { findFirst: jest.fn(async () => null) },
    receivable: { findMany: jest.fn(async () => []) },
    journalEntry: { findMany: jest.fn(async () => []) },
    supplier: { findFirst: jest.fn(async () => null) },
    purchaseOrder: { findFirst: jest.fn(async () => null) },
    product: { findMany: jest.fn(async () => []) },
    unitOfMeasure: { findMany: jest.fn(async () => []) },
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const documents = {
    createFromBuffer: jest.fn(async () => ({ id: 'doc-1' })),
    readFileBuffer: jest.fn(),
    download: jest.fn(),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new GeneratedDocumentsService(prisma, auditLogs, documents, companyScope);
  return { service, prisma, auditLogs, documents, companyScope };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    roles: ['STAFF'],
    permissions: [],
    companyId: 'company-1',
    ...overrides,
  };
}

function dto(overrides: Partial<GenerateTablePdfDto> = {}): GenerateTablePdfDto {
  return {
    title: 'Products Export',
    columns: ['Name', 'Qty'],
    rows: [
      ['Widget', '2'],
      ['Gadget', '5'],
    ],
    ...overrides,
  } as GenerateTablePdfDto;
}

describe('GeneratedDocumentsService.generateTablePdf', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns a PDF buffer and a dated file name', async () => {
    const { service } = makeService();

    const result = await service.generateTablePdf(dto(), user());

    expect(result.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(result.fileName).toMatch(/^Products-Export-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.generatedDocumentId).toBe('generated-1');
  });

  it('asserts READ access on the requested company', async () => {
    const { service, prisma, companyScope } = makeService();
    const actor = user();

    await service.generateTablePdf(dto({ companyId: 'company-2' }), actor);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      actor,
      'company-2',
      AccessLevel.READ,
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-2', deletedAt: null } }),
    );
  });

  it('skips the access check without companyId and falls back to the user company', async () => {
    const { service, prisma, companyScope } = makeService();

    await service.generateTablePdf(dto(), user({ companyId: 'company-1' }));

    expect(companyScope.assertCanAccessCompany).not.toHaveBeenCalled();
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-1', deletedAt: null } }),
    );
  });

  it('persists a TABLE_EXPORT bookkeeping row with no stored file', async () => {
    const { service, prisma, documents } = makeService();

    await service.generateTablePdf(dto(), user());

    expect(prisma.generatedDocument.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.generatedDocument.create.mock.calls[0][0];
    expect(data.entityType).toBe('TABLE_EXPORT');
    expect(data.documentId).toBeNull();
    expect(data.outputFormat).toBe('PDF');
    expect(data.companyId).toBe('company-1');
    expect(data.metadata).toEqual(
      expect.objectContaining({ rowCount: 2, columnCount: 2, companyId: 'company-1' }),
    );
    // Deliberate: no Document/file persisted for arbitrary table exports.
    expect(documents.createFromBuffer).not.toHaveBeenCalled();
  });

  it('writes an audit log entry', async () => {
    const { service, auditLogs } = makeService();

    await service.generateTablePdf(dto(), user(), '127.0.0.1');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GENERATED_DOCUMENT_CREATE',
        entityType: 'GeneratedDocument',
        entityId: 'generated-1',
        userId: 'user-1',
        companyId: 'company-1',
        ipAddress: '127.0.0.1',
      }),
    );
  });

  it('truncates cells longer than 300 characters', async () => {
    const { service } = makeService();
    const buildSpy = jest
      .spyOn(pdfBuilder, 'buildBusinessPdf')
      .mockReturnValue(Buffer.from('%PDF-stub'));
    const longCell = 'x'.repeat(400);

    await service.generateTablePdf(dto({ columns: ['Notes'], rows: [[longCell]] }), user());

    const model = buildSpy.mock.calls[0][0];
    const cell = model.sections[0].table!.rows[0][0];
    expect(cell).toHaveLength(300);
    expect(cell.endsWith('...')).toBe(true);
  });
});

describe('GeneratedDocumentsService.generateBusinessPdf (document-type builders)', () => {
  afterEach(() => jest.restoreAllMocks());

  /** Runs generateBusinessPdf with the real query mocks and captures the PDF model. */
  async function generateModel(
    service: GeneratedDocumentsService,
    entityType: BusinessPdfEntityType,
    entityId: string,
    actor: AuthUser,
  ) {
    const buildSpy = jest
      .spyOn(pdfBuilder, 'buildBusinessPdf')
      .mockReturnValue(Buffer.from('%PDF-stub'));
    await service.generateBusinessPdf({ entityType, entityId }, actor);
    const model = buildSpy.mock.calls[0][0];
    buildSpy.mockRestore();
    return model;
  }

  function sectionByTitle(model: pdfBuilder.BusinessPdfModel, title: string) {
    const section = model.sections.find((s) => s.title === title);
    expect(section).toBeDefined();
    return section!;
  }

  const grnRecord = () => ({
    id: 'grn-1',
    grnNumber: 'GRN-001',
    companyId: 'company-1',
    branchId: null,
    purchaseOrderId: 'po-1',
    supplierId: 'supplier-1',
    receivedDate: new Date('2026-06-01'),
    status: 'POSTED',
    postedAt: new Date('2026-06-02'),
    notes: 'Received complete',
    company: null,
    branch: null,
    receivedBy: { fullName: 'Asha Mwakyusa' },
    approvedBy: { fullName: 'Baraka Juma' },
    lines: [
      {
        productId: 'prod-1',
        unitId: 'unit-1',
        orderedQuantity: 10,
        receivedQuantity: 10,
        acceptedQuantity: 9,
        rejectedQuantity: 1,
        unitCost: 100,
      },
    ],
  });

  it('GOODS_RECEIVED_NOTE: resolves supplier/product/unit via secondary lookups', async () => {
    const { service, prisma } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue(grnRecord());
    prisma.supplier.findFirst.mockResolvedValue({ name: 'Acme Supplies', supplierCode: 'SUP-01' });
    prisma.purchaseOrder.findFirst.mockResolvedValue({ purchaseOrderNumber: 'PO-001' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', name: 'Cement Bag', sku: 'CEM-50', productCode: 'P-CEM' },
    ]);
    prisma.unitOfMeasure.findMany.mockResolvedValue([{ id: 'unit-1', name: 'Bag', symbol: 'bag' }]);

    const model = await generateModel(
      service,
      'GOODS_RECEIVED_NOTE',
      'grn-1',
      user({ permissions: ['grn.view'] }),
    );

    expect(model.title).toBe('Goods Received Note');
    expect(model.reference).toBe('GRN-001');
    expect(model.meta).toContainEqual({ label: 'Purchase Order', value: 'PO-001' });
    // No supplier/product/unit relations on the GRN — verify the id->name lookups.
    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'supplier-1' } }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-1'] } } }),
    );
    expect(prisma.unitOfMeasure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['unit-1'] } } }),
    );

    const supplierSection = sectionByTitle(model, 'Supplier and Order Details');
    expect(supplierSection.items).toContainEqual({ label: 'Supplier', value: 'Acme Supplies' });

    const lineSection = sectionByTitle(model, 'Line Items');
    expect(lineSection.table!.rows[0][0]).toBe('Cement Bag');
    expect(lineSection.table!.rows[0][6]).toBe('bag');
    expect(lineSection.totals).toContainEqual({
      label: 'Total Value',
      value: 'TZS 900.00',
      emphasis: true,
    });
    sectionByTitle(model, 'Acknowledgement');
  });

  it('SUPPLIER_INVOICE: builds the invoice model with lookups and totals', async () => {
    const { service, prisma } = makeService();
    prisma.supplierInvoice.findFirst.mockResolvedValue({
      id: 'si-1',
      supplierInvoiceNumber: 'SINV-001',
      companyId: 'company-1',
      branchId: null,
      supplierId: 'supplier-1',
      goodsReceivedNoteId: 'grn-1',
      invoiceDate: new Date('2026-06-03'),
      dueDate: new Date('2026-07-03'),
      invoiceReference: 'REF-9',
      subtotal: 1000,
      taxAmount: 180,
      discountAmount: 0,
      totalAmount: 1180,
      paidAmount: 0,
      outstandingAmount: 1180,
      currency: 'TZS',
      status: 'APPROVED',
      approvedAt: new Date('2026-06-04'),
      notes: null,
      company: null,
      branch: null,
      goodsReceivedNote: { grnNumber: 'GRN-001' },
      createdBy: { fullName: 'Clerk One' },
      approvedBy: { fullName: 'Manager Two' },
      lines: [
        {
          productId: 'prod-1',
          unitId: 'unit-1',
          description: 'Cement 50kg',
          quantity: 10,
          unitPrice: 100,
          taxAmount: 180,
          discountAmount: 0,
          lineTotal: 1180,
        },
      ],
    });
    prisma.supplier.findFirst.mockResolvedValue({ name: 'Acme Supplies', supplierCode: 'SUP-01' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'prod-1', name: 'Cement Bag', sku: 'CEM-50', productCode: 'P-CEM' },
    ]);
    prisma.unitOfMeasure.findMany.mockResolvedValue([{ id: 'unit-1', name: 'Bag', symbol: 'bag' }]);

    const model = await generateModel(
      service,
      'SUPPLIER_INVOICE',
      'si-1',
      user({ permissions: ['supplier_invoices.view'] }),
    );

    expect(model.title).toBe('Supplier Invoice');
    expect(model.subtitle).toBe('Acme Supplies');
    expect(model.meta).toContainEqual({ label: 'Supplier Reference', value: 'REF-9' });
    const supplierSection = sectionByTitle(model, 'Supplier and Order Details');
    expect(supplierSection.items).toContainEqual({
      label: 'Goods Received Note',
      value: 'GRN-001',
    });
    const lineSection = sectionByTitle(model, 'Line Items');
    expect(lineSection.table!.rows[0][0]).toBe('Cement 50kg');
    expect(lineSection.table!.rows[0][1]).toBe('CEM-50');
    expect(lineSection.totals).toContainEqual({
      label: 'Outstanding',
      value: 'TZS 1,180.00',
      emphasis: true,
    });
  });

  it('PAYSLIP: builds earnings/deductions/employer sections and scopes by company', async () => {
    const { service, prisma } = makeService();
    prisma.payrollEntry.findFirst.mockResolvedValue({
      id: 'entry-1',
      companyId: 'company-1',
      status: 'APPROVED',
      notes: null,
      basePay: 1000000,
      attendancePay: 0,
      overtimePay: 50000,
      totalAllowances: 100000,
      grossPay: 1150000,
      totalDeductions: 250000,
      netPay: 900000,
      company: null,
      employee: {
        fullName: 'Neha Kapoor',
        employeeCode: 'EMP-7',
        tin: '111-222-333',
        nssfNumber: 'NS-1',
        nhifNumber: null,
        bankName: 'CRDB',
        bankAccountNumber: '0150999',
        department: { name: 'Operations' },
        position: { title: 'Officer' },
        branch: null,
      },
      payrollRun: {
        payrollRunNumber: 'RUN-2026-06',
        runDate: new Date('2026-06-25'),
        payrollPeriod: {
          name: 'June 2026',
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-30'),
          paymentDate: new Date('2026-06-28'),
        },
      },
      allowances: [
        { description: null, amount: 100000, allowanceType: { name: 'Transport', code: 'TRP' } },
      ],
      deductions: [
        {
          description: null,
          amount: 20000,
          deductionType: { name: 'Salary Advance', code: 'ADV' },
        },
      ],
      statutoryLines: [
        {
          employeeContribution: 115000,
          employerContribution: 115000,
          taxType: { name: 'NSSF', taxTypeCode: 'NSSF' },
        },
        {
          employeeContribution: 115000,
          employerContribution: 0,
          taxType: { name: 'PAYE', taxTypeCode: 'PAYE' },
        },
      ],
    });

    const model = await generateModel(
      service,
      'PAYSLIP',
      'entry-1',
      user({ permissions: ['payroll.view'] }),
    );

    // The hr/payslips read query lacks company scoping — this builder must not.
    expect(prisma.payrollEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'entry-1',
          deletedAt: null,
          companyId: { in: ['company-1'] },
        }),
      }),
    );

    expect(model.title).toBe('Payslip');
    expect(model.reference).toBe('RUN-2026-06-EMP-7');
    expect(model.subtitle).toBe('Neha Kapoor');

    const details = sectionByTitle(model, 'Employee Details');
    expect(details.items).toContainEqual({ label: 'Employee Code', value: 'EMP-7' });

    const earnings = sectionByTitle(model, 'Earnings');
    expect(earnings.table!.rows).toContainEqual(['Transport', 'TZS 100,000.00']);
    expect(earnings.totals).toContainEqual({
      label: 'Gross Pay',
      value: 'TZS 1,150,000.00',
      emphasis: true,
    });

    const deductions = sectionByTitle(model, 'Deductions');
    expect(deductions.table!.rows).toContainEqual(['PAYE', 'TZS 115,000.00']);
    expect(deductions.table!.rows).toContainEqual(['Salary Advance', 'TZS 20,000.00']);
    expect(deductions.totals).toContainEqual({
      label: 'Net Pay',
      value: 'TZS 900,000.00',
      emphasis: true,
    });

    const employer = sectionByTitle(model, 'Employer Contributions');
    expect(employer.table!.rows).toEqual([['NSSF', 'TZS 115,000.00']]);
  });

  it('CREDIT_NOTE: includes applied/unapplied totals and related documents', async () => {
    const { service, prisma } = makeService();
    prisma.creditNote.findFirst.mockResolvedValue({
      id: 'cn-1',
      creditNoteNumber: 'CN-001',
      companyId: 'company-1',
      branchId: null,
      customerId: 'cust-1',
      customerName: 'Fallback Name',
      reason: 'Goods returned',
      subtotal: 500,
      taxAmount: 90,
      totalAmount: 590,
      appliedAmount: 200,
      currency: 'TZS',
      issueDate: new Date('2026-06-10'),
      status: 'ISSUED',
      notes: null,
      company: null,
      branch: null,
      customer: { name: 'Mega Mart', customerCode: 'C-1' },
      salesOrder: { salesOrderNumber: 'SO-9' },
      receivable: { receivableNumber: 'RCV-77' },
      createdBy: { fullName: 'Clerk One' },
      lines: [
        {
          description: 'Returned soda crates',
          quantity: 5,
          unitPrice: 100,
          taxAmount: 90,
          lineTotal: 590,
          product: { name: 'Soda Crate', sku: 'SOD-24', productCode: null },
          unit: { name: 'Crate', symbol: 'cr' },
        },
      ],
    });

    const model = await generateModel(
      service,
      'CREDIT_NOTE',
      'cn-1',
      user({ permissions: ['receivables.view'] }),
    );

    expect(model.title).toBe('Credit Note');
    expect(model.meta).toContainEqual({ label: 'Receivable', value: 'RCV-77' });
    const customerSection = sectionByTitle(model, 'Customer Details');
    expect(customerSection.items).toContainEqual({ label: 'Customer', value: 'Mega Mart' });
    const lineSection = sectionByTitle(model, 'Line Items');
    expect(lineSection.table!.rows[0][0]).toBe('Returned soda crates');
    expect(lineSection.totals).toContainEqual({
      label: 'Applied',
      value: 'TZS 200.00',
      emphasis: false,
    });
    expect(lineSection.totals).toContainEqual({
      label: 'Unapplied',
      value: 'TZS 390.00',
      emphasis: true,
    });
  });

  it('CUSTOMER_PAYMENT_RECEIPT: lists receivable allocations by receivableNumber', async () => {
    const { service, prisma } = makeService();
    prisma.customerPayment.findFirst.mockResolvedValue({
      id: 'pay-1',
      paymentNumber: 'RCPT-001',
      companyId: 'company-1',
      branchId: null,
      amount: 1000,
      appliedAmount: 800,
      unappliedAmount: 200,
      currency: 'TZS',
      method: 'BANK_TRANSFER',
      reference: 'TXN-5',
      paymentDate: new Date('2026-06-15'),
      status: 'COMPLETED',
      notes: null,
      company: null,
      branch: null,
      customer: { name: 'Mega Mart', customerCode: 'C-1' },
      cashAccount: { accountName: 'CRDB Main' },
      createdBy: { fullName: 'Cashier One' },
      allocations: [
        {
          amount: 800,
          receivable: {
            receivableNumber: 'RCV-77',
            dueDate: new Date('2026-06-30'),
            status: 'OPEN',
          },
        },
      ],
    });

    const model = await generateModel(
      service,
      'CUSTOMER_PAYMENT_RECEIPT',
      'pay-1',
      user({ permissions: ['customer-payments.view'] }),
    );

    expect(model.title).toBe('Payment Receipt');
    expect(model.reference).toBe('RCPT-001');
    expect(model.meta).toContainEqual({ label: 'Payment Method', value: 'BANK TRANSFER' });
    const allocations = sectionByTitle(model, 'Receivable Allocations');
    expect(allocations.table!.rows[0][0]).toBe('RCV-77');
    expect(allocations.table!.rows[0][3]).toBe('TZS 800.00');
    expect(allocations.totals).toContainEqual({
      label: 'Amount Received',
      value: 'TZS 1,000.00',
      emphasis: true,
    });
    expect(allocations.totals).toContainEqual({
      label: 'Unapplied (On Account)',
      value: 'TZS 200.00',
      emphasis: true,
    });
  });

  it('CUSTOMER_DEBT_STATEMENT: consolidates all active debts with products and payments', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.company.findFirst.mockResolvedValue({
      id: 'company-1',
      name: 'Westsides Company Ltd',
      code: 'WEST',
      phone: '+255 700 000 000',
      email: 'accounts@example.com',
      website: 'example.com',
      logoUrl: null,
      group: null,
      profile: null,
    });
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      customerCode: 'CUST-001',
      name: 'Alpha Traders Ltd',
      legalName: 'Alpha Traders Limited',
      customerType: 'BUSINESS',
      tin: '123-456-789',
      vrn: '40-123456-A',
      phone: '+255 755 100 200',
      email: 'finance@alpha.example',
      address: 'Mbeya, Tanzania',
      contactPerson: 'Amina Salim',
      creditLimit: 2000000,
      paymentTerms: 'Net 30',
      status: 'ACTIVE',
    });
    prisma.receivable.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        receivableNumber: 'REC-2026-000101',
        companyId: 'company-1',
        customerId: 'cust-1',
        customerName: 'Alpha Traders Ltd',
        sourceType: 'SALES_ORDER',
        sourceId: 'so-1',
        amount: 500000,
        paidAmount: 100000,
        outstandingAmount: 350000,
        currency: 'TZS',
        issueDate: new Date('2026-06-01'),
        dueDate: new Date('2026-06-30'),
        status: 'PARTIALLY_PAID',
        notes: 'First delivery',
        branch: { id: 'branch-1', code: 'TDM-001', name: 'Kisimani Main Branch' },
        salesOrders: [
          {
            id: 'so-1',
            salesOrderNumber: 'SO-2026-000101',
            customerName: 'Alpha Traders Ltd',
            orderDate: new Date('2026-06-01'),
            dueDate: new Date('2026-06-30'),
            salesType: 'CREDIT_SALE',
            paymentMethod: 'CREDIT',
            paymentReference: null,
            subtotal: 500000,
            discountAmount: 0,
            documentDiscount: 0,
            taxAmount: 0,
            totalAmount: 500000,
            notes: null,
            lines: [
              {
                id: 'line-1',
                description: 'Coral Hi-Gloss Paint Black 4L',
                quantity: 5,
                unitPrice: 100000,
                discountAmount: 0,
                taxAmount: 0,
                lineTotal: 500000,
                product: {
                  name: 'Coral Hi-Gloss Paint Black 4L',
                  sku: 'PAINT-4L',
                  productCode: 'P-1',
                },
                unit: { name: 'Tin', symbol: 'tin' },
              },
            ],
          },
        ],
        fuelCreditSales: [],
        projectBillings: [],
        trips: [],
        paymentAllocations: [
          {
            amount: 100000,
            createdAt: new Date('2026-06-15'),
            customerPayment: {
              paymentNumber: 'CP-2026-000011',
              paymentDate: new Date('2026-06-15'),
              amount: 150000,
              method: 'BANK_TRANSFER',
              reference: 'CRDB-7788',
              status: 'COMPLETED',
              notes: null,
            },
          },
        ],
        creditNotes: [
          {
            creditNoteNumber: 'CN-2026-000003',
            issueDate: new Date('2026-06-20'),
            reason: 'Returned damaged tin',
            totalAmount: 50000,
            appliedAmount: 50000,
          },
        ],
      },
      {
        id: 'rec-2',
        receivableNumber: 'REC-2026-000119',
        companyId: 'company-1',
        customerId: 'cust-1',
        customerName: 'Alpha Traders Ltd',
        sourceType: 'SALES_ORDER',
        sourceId: 'so-2',
        amount: 300000,
        paidAmount: 0,
        outstandingAmount: 300000,
        currency: 'TZS',
        issueDate: new Date('2026-07-01'),
        dueDate: new Date('2026-07-31'),
        status: 'OPEN',
        notes: null,
        branch: { id: 'branch-1', code: 'TDM-001', name: 'Kisimani Main Branch' },
        salesOrders: [
          {
            id: 'so-2',
            salesOrderNumber: 'SO-2026-000119',
            customerName: 'Alpha Traders Ltd',
            orderDate: new Date('2026-07-01'),
            dueDate: new Date('2026-07-31'),
            salesType: 'CREDIT_SALE',
            paymentMethod: 'CREDIT',
            paymentReference: null,
            subtotal: 300000,
            discountAmount: 0,
            documentDiscount: 0,
            taxAmount: 0,
            totalAmount: 300000,
            notes: null,
            lines: [
              {
                id: 'line-2',
                description: 'Roofing sheets',
                quantity: 10,
                unitPrice: 30000,
                discountAmount: 0,
                taxAmount: 0,
                lineTotal: 300000,
                product: { name: 'Roofing sheets', sku: 'ROOF-01', productCode: 'P-2' },
                unit: { name: 'Piece', symbol: 'pcs' },
              },
            ],
          },
        ],
        fuelCreditSales: [],
        projectBillings: [],
        trips: [],
        paymentAllocations: [],
        creditNotes: [],
      },
    ]);

    const actor = user({ permissions: ['receivables.view'] });
    const model = await generateModel(
      service,
      'CUSTOMER_DEBT_STATEMENT',
      'CUSTOMER:company-1:cust-1:TZS',
      actor,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      actor,
      'company-1',
      AccessLevel.READ,
    );
    expect(model.title).toBe('Customer Debt Statement');
    expect(model.orientation).toBeUndefined();
    expect(model.subtitle).toContain('Alpha Traders Ltd');

    const summary = sectionByTitle(model, 'Balance Summary');
    expect(summary.totals).toEqual(
      expect.arrayContaining([
        { label: 'Original Debt', value: 'TZS 800,000.00', emphasis: false },
        { label: 'Payments Received', value: 'TZS 100,000.00', emphasis: false },
        { label: 'Credits / Adjustments', value: 'TZS 50,000.00', emphasis: false },
        { label: 'Current Outstanding', value: 'TZS 650,000.00', emphasis: true },
      ]),
    );
    expect(sectionByTitle(model, 'Consolidated Debt Schedule').table!.rows).toHaveLength(2);
    expect(sectionByTitle(model, 'Products and Charges - REC-2026-000101').table!.rows[0]).toEqual(
      expect.arrayContaining(['SO-2026-000101', 'Coral Hi-Gloss Paint Black 4L', 'PAINT-4L']),
    );
    const settlements = sectionByTitle(model, 'Payments and Adjustments - REC-2026-000101').table!
      .rows;
    expect(settlements[0]).toEqual(
      expect.arrayContaining([
        'CP-2026-000011',
        'Payment - BANK TRANSFER',
        'CRDB-7788',
        'TZS 150,000.00',
        'TZS 100,000.00',
      ]),
    );
    expect(settlements[1]).toEqual(
      expect.arrayContaining([
        'CN-2026-000003',
        'Credit note',
        'Returned damaged tin',
        'TZS 50,000.00',
      ]),
    );
  });

  it('CUSTOMER_DEBT_STATEMENT: rejects users without receivables access', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.generateBusinessPdf(
        {
          entityType: 'CUSTOMER_DEBT_STATEMENT',
          entityId: 'CUSTOMER:company-1:cust-1:TZS',
        },
        user({ permissions: ['generated_documents.view'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.receivable.findMany).not.toHaveBeenCalled();
  });

  it('persists the Document with READ access so view-only users can generate PDFs', async () => {
    const { service, prisma, documents } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue(grnRecord());
    jest.spyOn(pdfBuilder, 'buildBusinessPdf').mockReturnValue(Buffer.from('%PDF-stub'));
    const actor = user({ permissions: ['grn.view'] });

    const result = await service.generateBusinessPdf(
      { entityType: 'GOODS_RECEIVED_NOTE', entityId: 'grn-1' },
      actor,
    );

    expect(result.document).toEqual({ id: 'doc-1' });
    expect(documents.createFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/pdf' }),
      actor,
      undefined,
      AccessLevel.READ,
    );
  });

  const NOT_FOUND_CASES: Array<[BusinessPdfEntityType, string, string]> = [
    ['GOODS_RECEIVED_NOTE', 'grn.view', 'goodsReceivedNote'],
    ['SUPPLIER_INVOICE', 'supplier_invoices.view', 'supplierInvoice'],
    ['PAYSLIP', 'payroll.view', 'payrollEntry'],
    ['CREDIT_NOTE', 'receivables.view', 'creditNote'],
    ['CUSTOMER_PAYMENT_RECEIPT', 'customer-payments.view', 'customerPayment'],
  ];

  it.each(NOT_FOUND_CASES)(
    '%s: throws NotFoundException when the record is missing or out of scope',
    async (entityType, permission, delegate) => {
      const { service, prisma } = makeService();
      prisma[delegate].findFirst.mockResolvedValue(null);

      await expect(
        service.generateBusinessPdf(
          { entityType, entityId: 'missing-1' },
          user({ permissions: [permission] }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it.each(NOT_FOUND_CASES)(
    '%s: throws ForbiddenException without the %s permission',
    async (entityType, _permission, delegate) => {
      const { service, prisma } = makeService();

      await expect(
        service.generateBusinessPdf(
          { entityType, entityId: 'any-1' },
          user({ permissions: ['generated_documents.view'] }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma[delegate].findFirst).not.toHaveBeenCalled();
    },
  );
});

describe('GenerateTablePdfDto validation', () => {
  it('accepts a well-formed payload', async () => {
    const instance = plainToInstance(GenerateTablePdfDto, {
      title: 'Products',
      columns: ['Name', 'Qty'],
      rows: [['Widget', '2']],
      meta: [{ label: 'Filter', value: 'Active only' }],
      numericColumns: [1],
    });
    expect(await validate(instance)).toHaveLength(0);
  });

  it('rejects rows whose width does not match columns', async () => {
    const instance = plainToInstance(GenerateTablePdfDto, {
      title: 'Products',
      columns: ['Name', 'Qty'],
      rows: [['Widget']],
    });
    const errors = await validate(instance);
    expect(errors.some((error) => error.property === 'rows')).toBe(true);
  });

  it('rejects non-string cells', async () => {
    const instance = plainToInstance(GenerateTablePdfDto, {
      title: 'Products',
      columns: ['Name'],
      rows: [[42]],
    });
    const errors = await validate(instance);
    expect(errors.some((error) => error.property === 'rows')).toBe(true);
  });

  it('rejects numericColumns with more entries than the column cap', async () => {
    const instance = plainToInstance(GenerateTablePdfDto, {
      title: 'Products',
      columns: ['Name'],
      rows: [['Widget']],
      numericColumns: Array.from({ length: 41 }, (_, i) => i),
    });
    const errors = await validate(instance);
    expect(errors.some((error) => error.property === 'numericColumns')).toBe(true);
  });
});
