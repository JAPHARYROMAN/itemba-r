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
      this.searchWestsidesDocuments(query, user, companyWhere, limit),
      this.searchPetroleum(query, user, companyWhere, limit),
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

  private async searchPetroleum(
    query: string,
    user: AuthUser,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<SearchBucket> {
    const tasks: Array<Promise<GlobalSearchResult[]>> = [];

    if (hasAnyPermission(user, ['fuel_tanks.view'])) {
      tasks.push(this.searchFuelTanks(query, companyWhere, limit));
    }
    if (hasAnyPermission(user, ['fuel_shifts.view'])) {
      tasks.push(this.searchFuelShifts(query, companyWhere, limit));
    }
    if (hasAnyPermission(user, ['fuel_deliveries.view'])) {
      tasks.push(this.searchFuelDeliveries(query, companyWhere, limit));
    }

    const results = (await Promise.all(tasks)).flat().slice(0, limit);
    return { key: 'petroleum', label: 'Petroleum', results };
  }

  private async searchFuelTanks(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.fuelTank.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { tankCode: contains(query) },
          { tankName: contains(query) },
          { product: { name: contains(query) } },
          { product: { productCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        tankCode: true,
        tankName: true,
        currentBookBalance: true,
        status: true,
        branch: { select: { code: true, name: true } },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'fuel-tank',
      module: 'Petroleum',
      title: `${row.tankCode} - ${row.tankName}`,
      subtitle: compactSubtitle([
        row.product?.name,
        row.branch?.code ?? row.branch?.name,
        `${row.currentBookBalance} L`,
      ]),
      href: `/petroleum/fuel-tanks?search=${encodeSearch(row.tankCode)}`,
      badge: row.status,
    }));
  }

  private async searchFuelShifts(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.fuelShift.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { shiftNumber: contains(query) },
          { branch: { name: contains(query) } },
          { branch: { code: contains(query) } },
        ],
      },
      select: {
        id: true,
        shiftNumber: true,
        shiftDate: true,
        shiftType: true,
        status: true,
        branch: { select: { code: true, name: true } },
      },
      orderBy: { shiftDate: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'fuel-shift',
      module: 'Petroleum',
      title: row.shiftNumber,
      subtitle: compactSubtitle([row.shiftType, row.branch?.code ?? row.branch?.name]),
      href: `/petroleum/fuel-shifts/${row.id}`,
      badge: row.status,
      date: dateOnly(row.shiftDate),
    }));
  }

  private async searchFuelDeliveries(
    query: string,
    companyWhere: CompanyScopedWhere,
    limit: number,
  ): Promise<GlobalSearchResult[]> {
    const rows = await this.prisma.fuelDelivery.findMany({
      where: {
        deletedAt: null,
        ...companyWhere,
        OR: [
          { deliveryNumber: contains(query) },
          { deliveryNoteNumber: contains(query) },
          { invoiceNumber: contains(query) },
          { supplier: { name: contains(query) } },
          { product: { name: contains(query) } },
          { tank: { tankCode: contains(query) } },
        ],
      },
      select: {
        id: true,
        deliveryNumber: true,
        deliveryDate: true,
        deliveredLitres: true,
        acceptedLitres: true,
        status: true,
        supplier: { select: { name: true } },
        product: { select: { name: true } },
        tank: { select: { tankCode: true } },
      },
      orderBy: { deliveryDate: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'fuel-delivery',
      module: 'Petroleum',
      title: row.deliveryNumber,
      subtitle: compactSubtitle([
        row.product?.name,
        row.supplier?.name,
        row.tank?.tankCode,
        `${row.acceptedLitres ?? row.deliveredLitres} L`,
      ]),
      href: `/petroleum/fuel-deliveries?search=${encodeSearch(row.deliveryNumber)}`,
      badge: row.status,
      date: dateOnly(row.deliveryDate),
    }));
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
