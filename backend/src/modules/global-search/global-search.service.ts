import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, CompanyScopedWhere } from '../../common/services';

type SearchInput = {
  q?: string;
  limit?: string;
  companyId?: string;
};

export type GlobalSearchResult = {
  id: string;
  type: string;
  module: string;
  title: string;
  subtitle?: string;
  href: string;
  badge?: string;
  date?: string;
};

type SearchBucket = {
  key: string;
  label: string;
  results: GlobalSearchResult[];
};

type SearchResponse = {
  query: string;
  total: number;
  groups: SearchBucket[];
};

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 5;

function asLimit(value?: string) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function contains(value: string) {
  return { contains: value, mode: 'insensitive' as const };
}

function hasAnyPermission(user: AuthUser, permissions: string[]) {
  return permissions.some((permission) => user.permissions.includes(permission));
}

function compactSubtitle(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .join(' - ');
}

function encodeSearch(value: string) {
  return encodeURIComponent(value);
}

function dateOnly(value?: Date | string | null) {
  if (!value) return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

@Injectable()
export class GlobalSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async search(input: SearchInput, user: AuthUser): Promise<SearchResponse> {
    const query = input.q?.trim() ?? '';
    if (query.length < 2) {
      return { query, total: 0, groups: [] };
    }

    const limit = asLimit(input.limit);
    const companyWhere = await this.companyScope.companyWhereFor(user, input.companyId);
    const groups = await Promise.all([
      this.searchCompanies(query, user, limit),
      this.searchCustomers(query, user, companyWhere, limit),
      this.searchSuppliers(query, user, companyWhere, limit),
      this.searchProducts(query, user, companyWhere, limit),
      this.searchSalesOrders(query, user, companyWhere, limit),
      this.searchPurchaseOrders(query, user, companyWhere, limit),
      this.searchReceivables(query, user, companyWhere, limit),
      this.searchPayables(query, user, companyWhere, limit),
      this.searchJournalEntries(query, user, companyWhere, limit),
      this.searchCashAccounts(query, user, companyWhere, limit),
      this.searchEmployees(query, user, companyWhere, limit),
      this.searchWestsidesDocuments(query, user, companyWhere, limit),
      this.searchRecordBook(query, user, companyWhere, limit),
      this.searchReports(query, user, limit),
    ]);

    const populated = groups.filter((group) => group.results.length > 0);
    return {
      query,
      total: populated.reduce((sum, group) => sum + group.results.length, 0),
      groups: populated,
    };
  }

  private async searchCompanies(
    query: string,
    user: AuthUser,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['companies.read'])) return this.empty('companies', 'Companies');

    const companyIds = await this.companyScope.accessibleCompanyIds(user);
    if (companyIds.length === 0) return this.empty('companies', 'Companies');

    const rows = await this.prisma.company.findMany({
      where: {
        id: { in: companyIds },
        deletedAt: null,
        OR: [
          { name: contains(query) },
          { code: contains(query) },
          { industryType: contains(query) },
        ],
      },
      select: { id: true, name: true, code: true, industryType: true, status: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return {
      key: 'companies',
      label: 'Companies',
      results: rows.map((row) => ({
        id: row.id,
        type: 'company',
        module: 'Registry',
        title: row.name,
        subtitle: compactSubtitle([row.code, row.industryType]),
        href: `/companies?search=${encodeSearch(row.code)}`,
        badge: row.status,
      })),
    };
  }

  private async searchCustomers(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['customers.view'])) return this.empty('customers', 'Customers');

    const rows = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { name: contains(query) },
          { customerCode: contains(query) },
          { phone: contains(query) },
          { email: contains(query) },
          { tin: contains(query) },
        ],
      },
      select: {
        id: true,
        name: true,
        customerCode: true,
        phone: true,
        email: true,
        status: true,
        company: { select: { code: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      key: 'customers',
      label: 'Customers',
      results: rows.map((row) => ({
        id: row.id,
        type: 'customer',
        module: 'Operations',
        title: row.name,
        subtitle: compactSubtitle([
          row.customerCode,
          row.company?.code,
          row.branch?.code ?? row.branch?.name,
        ]),
        href: `/westsides/customers/${row.id}`,
        badge: row.status,
      })),
    };
  }

  private async searchSuppliers(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['suppliers.view'])) return this.empty('suppliers', 'Suppliers');

    const rows = await this.prisma.supplier.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { name: contains(query) },
          { supplierCode: contains(query) },
          { phone: contains(query) },
          { email: contains(query) },
          { tin: contains(query) },
        ],
      },
      select: {
        id: true,
        name: true,
        supplierCode: true,
        status: true,
        supplierType: true,
        company: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      key: 'suppliers',
      label: 'Suppliers',
      results: rows.map((row) => ({
        id: row.id,
        type: 'supplier',
        module: 'Operations',
        title: row.name,
        subtitle: compactSubtitle([row.supplierCode, row.supplierType, row.company?.code]),
        href: `/operations/suppliers?search=${encodeSearch(row.supplierCode)}`,
        badge: row.status,
      })),
    };
  }

  private async searchProducts(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (
      !hasAnyPermission(user, [
        'products.view',
        'sales.create',
        'purchases.create',
        'inventory.view',
        'inventory.adjustments.create',
        'operations.dashboard.view',
      ])
    ) {
      return this.empty('products', 'Products');
    }

    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { name: contains(query) },
          { productCode: contains(query) },
          { sku: contains(query) },
          { barcode: contains(query) },
          { variantName: contains(query) },
          { productFamily: { name: contains(query) } },
        ],
      },
      select: {
        id: true,
        name: true,
        productCode: true,
        sku: true,
        barcode: true,
        status: true,
        productType: true,
        company: { select: { code: true } },
        productFamily: { select: { name: true, brand: true } },
      },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return {
      key: 'products',
      label: 'Products',
      results: rows.map((row) => ({
        id: row.id,
        type: 'product',
        module: 'Operations',
        title: row.name,
        subtitle: compactSubtitle([
          row.productCode,
          row.sku,
          row.productFamily?.brand,
          row.productFamily?.name,
          row.company?.code,
        ]),
        href: `/operations/products?search=${encodeSearch(row.productCode)}`,
        badge: row.status,
      })),
    };
  }

  private async searchSalesOrders(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['sales.view'])) return this.empty('sales-orders', 'Sales Orders');

    const rows = await this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { salesOrderNumber: contains(query) },
          { customerName: contains(query) },
          { customer: { name: contains(query) } },
          { customer: { customerCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        salesOrderNumber: true,
        customerName: true,
        totalAmount: true,
        currency: true,
        status: true,
        paymentStatus: true,
        orderDate: true,
        customer: { select: { name: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: limit,
    });

    return {
      key: 'sales-orders',
      label: 'Sales Orders',
      results: rows.map((row) => ({
        id: row.id,
        type: 'sales-order',
        module: 'Sales',
        title: row.salesOrderNumber,
        subtitle: compactSubtitle([
          row.customer?.name ?? row.customerName,
          `${row.currency} ${row.totalAmount}`,
          row.paymentStatus,
        ]),
        href: `/operations/sales-orders/${row.id}/print`,
        badge: row.status,
        date: dateOnly(row.orderDate),
      })),
    };
  }

  private async searchPurchaseOrders(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['purchases.view'])) {
      return this.empty('purchase-orders', 'Purchase Orders');
    }

    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { purchaseOrderNumber: contains(query) },
          { supplierName: contains(query) },
          { supplier: { name: contains(query) } },
          { supplier: { supplierCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        purchaseOrderNumber: true,
        supplierName: true,
        totalAmount: true,
        currency: true,
        status: true,
        paymentStatus: true,
        orderDate: true,
        supplier: { select: { name: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: limit,
    });

    return {
      key: 'purchase-orders',
      label: 'Purchase Orders',
      results: rows.map((row) => ({
        id: row.id,
        type: 'purchase-order',
        module: 'Purchases',
        title: row.purchaseOrderNumber,
        subtitle: compactSubtitle([
          row.supplier?.name ?? row.supplierName,
          `${row.currency} ${row.totalAmount}`,
          row.paymentStatus,
        ]),
        href: `/operations/purchase-orders/${row.id}/print`,
        badge: row.status,
        date: dateOnly(row.orderDate),
      })),
    };
  }

  private async searchReceivables(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['receivables.view'])) {
      return this.empty('receivables', 'Receivables');
    }

    const rows = await this.prisma.receivable.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { receivableNumber: contains(query) },
          { customerName: contains(query) },
          { sourceType: contains(query) },
          { notes: contains(query) },
        ],
      },
      select: {
        id: true,
        receivableNumber: true,
        customerName: true,
        outstandingAmount: true,
        currency: true,
        status: true,
        sourceType: true,
        issueDate: true,
        dueDate: true,
        company: { select: { code: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { issueDate: 'desc' },
      take: limit,
    });

    return {
      key: 'receivables',
      label: 'Receivables',
      results: rows.map((row) => ({
        id: row.id,
        type: 'receivable',
        module: 'Finance',
        title: row.receivableNumber,
        subtitle: compactSubtitle([
          row.customerName,
          row.sourceType,
          `${row.currency} ${row.outstandingAmount} outstanding`,
          row.company?.code,
          row.branch?.code ?? row.branch?.name,
        ]),
        href: `/finance/receivables?search=${encodeSearch(row.receivableNumber)}`,
        badge: row.status,
        date: dateOnly(row.dueDate ?? row.issueDate),
      })),
    };
  }

  private async searchPayables(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['payables.view'])) {
      return this.empty('payables', 'Payables');
    }

    const rows = await this.prisma.payable.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { payableNumber: contains(query) },
          { supplierName: contains(query) },
          { sourceType: contains(query) },
          { notes: contains(query) },
        ],
      },
      select: {
        id: true,
        payableNumber: true,
        supplierName: true,
        outstandingAmount: true,
        currency: true,
        status: true,
        sourceType: true,
        issueDate: true,
        dueDate: true,
        company: { select: { code: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { issueDate: 'desc' },
      take: limit,
    });

    return {
      key: 'payables',
      label: 'Payables',
      results: rows.map((row) => ({
        id: row.id,
        type: 'payable',
        module: 'Finance',
        title: row.payableNumber,
        subtitle: compactSubtitle([
          row.supplierName,
          row.sourceType,
          `${row.currency} ${row.outstandingAmount} outstanding`,
          row.company?.code,
          row.branch?.code ?? row.branch?.name,
        ]),
        href: `/finance/payables?search=${encodeSearch(row.payableNumber)}`,
        badge: row.status,
        date: dateOnly(row.dueDate ?? row.issueDate),
      })),
    };
  }

  private async searchJournalEntries(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['journal_entries.view'])) {
      return this.empty('journal-entries', 'Journal Entries');
    }

    const rows = await this.prisma.journalEntry.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { journalNumber: contains(query) },
          { description: contains(query) },
          { referenceType: contains(query) },
        ],
      },
      select: {
        id: true,
        journalNumber: true,
        description: true,
        referenceType: true,
        status: true,
        totalDebit: true,
        totalCredit: true,
        transactionDate: true,
        company: { select: { code: true } },
      },
      orderBy: { transactionDate: 'desc' },
      take: limit,
    });

    return {
      key: 'journal-entries',
      label: 'Journal Entries',
      results: rows.map((row) => ({
        id: row.id,
        type: 'journal-entry',
        module: 'Finance',
        title: row.journalNumber,
        subtitle: compactSubtitle([
          row.description,
          row.referenceType,
          `DR ${row.totalDebit} / CR ${row.totalCredit}`,
          row.company?.code,
        ]),
        href: `/finance/journal-entries?search=${encodeSearch(row.journalNumber)}`,
        badge: row.status,
        date: dateOnly(row.transactionDate),
      })),
    };
  }

  private async searchCashAccounts(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['cash_accounts.view'])) {
      return this.empty('cash-accounts', 'Cash Accounts');
    }

    const rows = await this.prisma.cashAccount.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { accountName: contains(query) },
          { notes: contains(query) },
          { linkedBank: { accountName: contains(query) } },
          { linkedBank: { bankName: contains(query) } },
        ],
      },
      select: {
        id: true,
        accountName: true,
        accountType: true,
        currency: true,
        currentBalance: true,
        isActive: true,
        company: { select: { code: true } },
        branch: { select: { code: true, name: true } },
        linkedBank: { select: { bankName: true, accountName: true } },
      },
      orderBy: { accountName: 'asc' },
      take: limit,
    });

    return {
      key: 'cash-accounts',
      label: 'Cash Accounts',
      results: rows.map((row) => ({
        id: row.id,
        type: 'cash-account',
        module: 'Finance',
        title: row.accountName,
        subtitle: compactSubtitle([
          row.accountType,
          row.linkedBank?.bankName ?? row.linkedBank?.accountName,
          `${row.currency} ${row.currentBalance}`,
          row.company?.code,
          row.branch?.code ?? row.branch?.name,
        ]),
        href: `/finance/cash-accounts?search=${encodeSearch(row.accountName)}`,
        badge: row.isActive ? 'ACTIVE' : 'INACTIVE',
      })),
    };
  }

  private async searchEmployees(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['hr.employees.view'])) {
      return this.empty('employees', 'Employees');
    }

    const rows = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { employeeCode: contains(query) },
          { fullName: contains(query) },
          { firstName: contains(query) },
          { lastName: contains(query) },
          { phone: contains(query) },
          { email: contains(query) },
          { tin: contains(query) },
          { nidaNumber: contains(query) },
        ],
      },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        phone: true,
        email: true,
        employmentStatus: true,
        company: { select: { code: true } },
        department: { select: { name: true } },
        position: { select: { title: true } },
      },
      orderBy: { fullName: 'asc' },
      take: limit,
    });

    return {
      key: 'employees',
      label: 'Employees',
      results: rows.map((row) => ({
        id: row.id,
        type: 'employee',
        module: 'HR',
        title: row.fullName,
        subtitle: compactSubtitle([
          row.employeeCode,
          row.position?.title,
          row.department?.name,
          row.phone ?? row.email,
          row.company?.code,
        ]),
        href: `/hr/employees/${row.id}`,
        badge: row.employmentStatus,
      })),
    };
  }

  private async searchWestsidesDocuments(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    const tasks: Array<Promise<GlobalSearchResult[]>> = [];

    if (hasAnyPermission(user, ['quotations.view'])) {
      tasks.push(this.searchQuotations(query, companyWhere, limit));
    }
    if (hasAnyPermission(user, ['proformas.view'])) {
      tasks.push(this.searchProformas(query, companyWhere, limit));
    }
    if (hasAnyPermission(user, ['delivery_notes.view'])) {
      tasks.push(this.searchDeliveryNotes(query, companyWhere, limit));
    }

    const results = (await Promise.all(tasks)).flat().slice(0, limit);
    return { key: 'westsides-documents', label: 'Westsides Documents', results };
  }

  private async searchQuotations(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.quotation.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { quotationNumber: contains(query) },
          { customerName: contains(query) },
          { customer: { name: contains(query) } },
          { customer: { customerCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        quotationNumber: true,
        customerName: true,
        totalAmount: true,
        currency: true,
        status: true,
        quotationDate: true,
        customer: { select: { name: true } },
      },
      orderBy: { quotationDate: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'quotation',
      module: 'Westsides',
      title: row.quotationNumber,
      subtitle: compactSubtitle([
        row.customer?.name ?? row.customerName,
        `${row.currency} ${row.totalAmount}`,
      ]),
      href: `/westsides/quotations/${row.id}/print`,
      badge: row.status,
      date: dateOnly(row.quotationDate),
    }));
  }

  private async searchProformas(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.proformaInvoice.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { proformaNumber: contains(query) },
          { customerName: contains(query) },
          { customer: { name: contains(query) } },
          { customer: { customerCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        proformaNumber: true,
        customerName: true,
        totalAmount: true,
        currency: true,
        status: true,
        proformaDate: true,
        customer: { select: { name: true } },
      },
      orderBy: { proformaDate: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'proforma',
      module: 'Westsides',
      title: row.proformaNumber,
      subtitle: compactSubtitle([
        row.customer?.name ?? row.customerName,
        `${row.currency} ${row.totalAmount}`,
      ]),
      href: `/westsides/proforma-invoices/${row.id}/print`,
      badge: row.status,
      date: dateOnly(row.proformaDate),
    }));
  }

  private async searchDeliveryNotes(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.deliveryNote.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { deliveryNoteNumber: contains(query) },
          { customerName: contains(query) },
          { customer: { name: contains(query) } },
          { customer: { customerCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        deliveryNoteNumber: true,
        customerName: true,
        status: true,
        deliveryDate: true,
        customer: { select: { name: true } },
      },
      orderBy: { deliveryDate: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'delivery-note',
      module: 'Westsides',
      title: row.deliveryNoteNumber,
      subtitle: row.customer?.name ?? row.customerName ?? undefined,
      href: `/westsides/delivery-notes/${row.id}/print`,
      badge: row.status,
      date: dateOnly(row.deliveryDate),
    }));
  }

  private async searchRecordBook(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    if (!hasAnyPermission(user, ['record_book.view'])) {
      return this.empty('record-book', 'Records Book');
    }

    const [sales, expenses] = await Promise.all([
      this.prisma.recordBookDailySale.findMany({
        where: {
          deletedAt: null,
          ...companyWhere,
          OR: [
            { notes: contains(query) },
            { receipts: { some: { label: contains(query) } } },
            { receipts: { some: { reference: contains(query) } } },
          ],
        },
        select: {
          id: true,
          recordDate: true,
          totalSalesAmount: true,
          currency: true,
          status: true,
          company: { select: { name: true, code: true } },
          branch: { select: { name: true, code: true } },
        },
        orderBy: { recordDate: 'desc' },
        take: limit,
      }),
      this.prisma.recordBookExpense.findMany({
        where: {
          deletedAt: null,
          ...companyWhere,
          OR: [
            { description: contains(query) },
            { paidTo: contains(query) },
            { paymentLabel: contains(query) },
            { reference: contains(query) },
            { notes: contains(query) },
            { expenseCategory: { name: contains(query) } },
          ],
        },
        select: {
          id: true,
          recordDate: true,
          amount: true,
          currency: true,
          status: true,
          description: true,
          paidTo: true,
          company: { select: { name: true, code: true } },
          branch: { select: { name: true, code: true } },
          expenseCategory: { select: { name: true } },
        },
        orderBy: { recordDate: 'desc' },
        take: limit,
      }),
    ]);

    const results: GlobalSearchResult[] = [
      ...sales.map((row) => ({
        id: row.id,
        type: 'record-book-sale',
        module: 'Records Book',
        title: `Daily sales - ${row.currency} ${row.totalSalesAmount}`,
        subtitle: compactSubtitle([row.company.code, row.branch?.code, dateOnly(row.recordDate)]),
        href: '/record-book/daily-sales',
        badge: row.status,
        date: dateOnly(row.recordDate),
      })),
      ...expenses.map((row) => ({
        id: row.id,
        type: 'record-book-expense',
        module: 'Records Book',
        title: row.description,
        subtitle: compactSubtitle([
          row.expenseCategory.name,
          row.paidTo,
          `${row.currency} ${row.amount}`,
          dateOnly(row.recordDate),
        ]),
        href: '/record-book/expenses',
        badge: row.status,
        date: dateOnly(row.recordDate),
      })),
    ]
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, limit);

    return { key: 'record-book', label: 'Records Book', results };
  }

  private async searchReports(query: string, user: AuthUser, limit: number): Promise<SearchBucket> {
    if (
      !hasAnyPermission(user, [
        'report_definitions.view',
        'finance.reports.view',
        'operations.reports.view',
      ])
    ) {
      return this.empty('reports', 'Reports');
    }

    const rows = await this.prisma.reportDefinition.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { name: contains(query) },
          { reportCode: contains(query) },
          { description: contains(query) },
          { datasetKey: contains(query) },
        ],
      },
      select: {
        id: true,
        reportCode: true,
        name: true,
        description: true,
        reportCategory: true,
        requiredPermission: true,
        isSystemReport: true,
      },
      orderBy: [{ isSystemReport: 'desc' }, { name: 'asc' }],
      take: limit,
    });

    return {
      key: 'reports',
      label: 'Reports',
      results: rows
        .filter(
          (row) => !row.requiredPermission || user.permissions.includes(row.requiredPermission),
        )
        .map((row) => ({
          id: row.id,
          type: 'report-definition',
          module: 'Reports',
          title: row.name,
          subtitle: compactSubtitle([row.reportCode, row.reportCategory, row.description]),
          href: `/bi/report-builder?definitionId=${row.id}`,
          badge: row.isSystemReport ? 'SYSTEM' : 'CUSTOM',
        })),
    };
  }

  private empty(key: string, label: string): SearchBucket {
    return { key, label, results: [] };
  }
}
