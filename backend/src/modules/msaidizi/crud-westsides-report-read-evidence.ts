import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import type {
  CrudEvidenceFixturePack,
  CrudPositiveFixtureRegistration,
} from './crud-execution-evidence';

export type CrudWestsidesReportRequestKind = 'report-range' | 'daily-close';

export interface CrudWestsidesReportValueClaim {
  /** Path relative to the selected response row. */
  path: readonly string[];
  /** Runtime value created by the disposable A/B business seed. */
  binding: string;
}

export interface CrudWestsidesReportRowOracle {
  /** Path from the unwrapped response payload to the derived row collection. */
  collectionPath: readonly string[];
  /** Exact row identity emitted from the seeded business transaction. */
  match: CrudWestsidesReportValueClaim;
  /** Exact derived fields that must reconcile to that transaction. */
  fields: readonly CrudWestsidesReportValueClaim[];
}

export interface CrudWestsidesReportReadFixtureRegistration extends CrudPositiveFixtureRegistration {
  expectedPath: string;
  requestKind: CrudWestsidesReportRequestKind;
  execution: {
    companyA: 'company';
    companyB: 'group';
    foreignCompanyProbe: {
      principal: 'company';
      expectedStatus: 403;
    };
  };
  companyAOracle: CrudWestsidesReportRowOracle;
  companyBOracle: CrudWestsidesReportRowOracle;
}

export interface CrudWestsidesReportReadFixturePack extends Omit<
  CrudEvidenceFixturePack,
  'fixtures'
> {
  fixtures: readonly CrudWestsidesReportReadFixtureRegistration[];
}

interface WestsidesReportDefinition {
  capabilityId: string;
  expectedPath: string;
  requestKind?: CrudWestsidesReportRequestKind;
  collectionPath?: readonly string[];
  matchPath: readonly string[];
  matchBinding: string;
  fields: ReadonlyArray<{ path: readonly string[]; binding: string }>;
}

const row = (
  capabilityId: string,
  expectedPath: string,
  matchPath: readonly string[],
  matchBinding: string,
  fields: ReadonlyArray<{ path: readonly string[]; binding: string }>,
  options: {
    requestKind?: CrudWestsidesReportRequestKind;
    collectionPath?: readonly string[];
  } = {},
): WestsidesReportDefinition => ({
  capabilityId,
  expectedPath,
  requestKind: options.requestKind,
  collectionPath: options.collectionPath,
  matchPath,
  matchBinding,
  fields,
});

/**
 * All 24 permission-governed GET operations on WestsidesReportsController.
 *
 * Every definition is backed by two conflicting, real business transactions
 * in the disposable database. The harness executes both companies and also
 * proves that the company-A principal cannot request company B. A route is
 * never admitted merely because it returned 2xx, a non-empty array, or an
 * agent-authored scope echo.
 */
const WESTSIDES_REPORT_DEFINITIONS: readonly WestsidesReportDefinition[] = Object.freeze([
  row(
    'WestsidesReportsController.salesReport',
    'westsides/reports/sales-report',
    ['salesOrderNumber'],
    'salesOrderNumber',
    [
      { path: ['customerCode'], binding: 'customerCode' },
      { path: ['productCode'], binding: 'soldProductCode' },
      { path: ['quantity'], binding: 'salesLineQuantity' },
      { path: ['amount'], binding: 'salesLineAmount' },
    ],
    { collectionPath: ['rows'] },
  ),
  row(
    'WestsidesReportsController.salesByCustomer',
    'westsides/reports/sales-by-customer',
    ['customerCode'],
    'customerCode',
    [
      { path: ['customer'], binding: 'customerName' },
      { path: ['orders'], binding: 'salesOrderCount' },
      { path: ['totalAmount'], binding: 'salesOrderTotal' },
      { path: ['paidAmount'], binding: 'salesOrderPaid' },
      { path: ['outstandingAmount'], binding: 'salesOrderOutstanding' },
    ],
  ),
  row(
    'WestsidesReportsController.customerProductSales',
    'westsides/reports/customer-product-sales',
    ['productCode'],
    'soldProductCode',
    [
      { path: ['customerCode'], binding: 'customerCode' },
      { path: ['quantity'], binding: 'salesLineQuantity' },
      { path: ['totalAmount'], binding: 'salesLineAmount' },
      { path: ['averageUnitPrice'], binding: 'salesLineAveragePrice' },
    ],
    { collectionPath: ['rows'] },
  ),
  row(
    'WestsidesReportsController.purchaseReport',
    'westsides/reports/purchase-report',
    ['purchaseOrderNumber'],
    'purchaseOrderNumber',
    [
      { path: ['supplierCode'], binding: 'supplierCode' },
      { path: ['productCode'], binding: 'soldProductCode' },
      { path: ['quantity'], binding: 'purchaseLineQuantity' },
      { path: ['amount'], binding: 'purchaseLineAmount' },
    ],
    { collectionPath: ['rows'] },
  ),
  row(
    'WestsidesReportsController.purchasesBySupplier',
    'westsides/reports/purchases-by-supplier',
    ['supplierCode'],
    'supplierCode',
    [
      { path: ['supplier'], binding: 'supplierName' },
      { path: ['purchaseOrders'], binding: 'purchaseOrderCount' },
      { path: ['totalAmount'], binding: 'purchaseOrderTotal' },
      { path: ['paidAmount'], binding: 'purchaseOrderPaid' },
      { path: ['outstandingAmount'], binding: 'purchaseOrderOutstanding' },
    ],
  ),
  row(
    'WestsidesReportsController.supplierProductPurchases',
    'westsides/reports/supplier-product-purchases',
    ['productCode'],
    'soldProductCode',
    [
      { path: ['supplierCode'], binding: 'supplierCode' },
      { path: ['quantity'], binding: 'purchaseLineQuantity' },
      { path: ['totalAmount'], binding: 'purchaseLineAmount' },
      { path: ['averageUnitCost'], binding: 'purchaseLineUnitCost' },
    ],
    { collectionPath: ['rows'] },
  ),
  row(
    'WestsidesReportsController.customersReport',
    'westsides/reports/customers-report',
    ['customerCode'],
    'customerCode',
    [
      { path: ['customer'], binding: 'customerName' },
      { path: ['orders'], binding: 'salesOrderCount' },
      { path: ['totalSales'], binding: 'salesOrderTotal' },
      { path: ['outstandingSales'], binding: 'salesOrderOutstanding' },
    ],
  ),
  row(
    'WestsidesReportsController.suppliersReport',
    'westsides/reports/suppliers-report',
    ['supplierCode'],
    'supplierCode',
    [
      { path: ['supplier'], binding: 'supplierName' },
      { path: ['purchaseOrders'], binding: 'purchaseOrderCount' },
      { path: ['totalPurchases'], binding: 'purchaseOrderTotal' },
      { path: ['outstandingPurchases'], binding: 'purchaseOrderOutstanding' },
    ],
  ),
  row(
    'WestsidesReportsController.salesByChannel',
    'westsides/reports/sales-by-channel',
    ['salesType'],
    'salesType',
    [
      { path: ['orderCount'], binding: 'salesOrderCount' },
      { path: ['totalAmount'], binding: 'salesOrderTotal' },
    ],
  ),
  row(
    'WestsidesReportsController.salesByProduct',
    'westsides/reports/sales-by-product',
    ['productCode'],
    'soldProductCode',
    [
      { path: ['productName'], binding: 'soldProductName' },
      { path: ['quantity'], binding: 'salesLineQuantity' },
      { path: ['totalAmount'], binding: 'salesLineAmount' },
      { path: ['averageSellingPrice'], binding: 'salesLineAveragePrice' },
    ],
  ),
  row(
    'WestsidesReportsController.salesByCashier',
    'westsides/reports/sales-by-cashier',
    ['salespersonId'],
    'salespersonId',
    [
      { path: ['salesperson'], binding: 'salespersonName' },
      { path: ['orderCount'], binding: 'salesOrderCount' },
      { path: ['totalAmount'], binding: 'salesOrderTotal' },
    ],
  ),
  row(
    'WestsidesReportsController.batchStatus',
    'westsides/reports/batch-status',
    ['batchNumber'],
    'batchNumber',
    [
      { path: ['productCode'], binding: 'soldProductCode' },
      { path: ['initialQuantity'], binding: 'batchInitialQuantity' },
      { path: ['remainingQuantity'], binding: 'batchRemainingQuantity' },
      { path: ['unitCost'], binding: 'batchUnitCost' },
    ],
  ),
  row(
    'WestsidesReportsController.stockDamageReport',
    'westsides/reports/stock-damage-report',
    ['damageType'],
    'damageType',
    [
      { path: ['status'], binding: 'damageStatus' },
      { path: ['reportCount'], binding: 'damageCount' },
      { path: ['quantity'], binding: 'damageQuantity' },
      { path: ['estimatedValue'], binding: 'damageEstimatedValue' },
    ],
  ),
  row(
    'WestsidesReportsController.packageBalanceReport',
    'westsides/reports/package-balance-report',
    ['customerCode'],
    'customerCode',
    [
      { path: ['packageCode'], binding: 'packageCode' },
      { path: ['quantityOwedByCustomer'], binding: 'packageOwedByCustomer' },
      { path: ['quantityOwedToCustomer'], binding: 'packageOwedToCustomer' },
      { path: ['depositBalance'], binding: 'packageDepositBalance' },
    ],
  ),
  row(
    'WestsidesReportsController.quotationConversion',
    'westsides/reports/quotation-conversion',
    ['status'],
    'quotationStatus',
    [
      { path: ['quotationCount'], binding: 'quotationStatusCount' },
      { path: ['convertedQuotations'], binding: 'convertedQuotationCount' },
    ],
  ),
  row(
    'WestsidesReportsController.deliveryPerformance',
    'westsides/reports/delivery-performance',
    ['status'],
    'deliveryStatus',
    [{ path: ['deliveryCount'], binding: 'deliveryStatusCount' }],
  ),
  row(
    'WestsidesReportsController.priceListReport',
    'westsides/reports/price-list-report',
    ['name'],
    'priceListName',
    [
      { path: ['status'], binding: 'priceListStatus' },
      { path: ['itemCount'], binding: 'priceListItemCount' },
    ],
  ),
  row(
    'WestsidesReportsController.fastMovingItems',
    'westsides/reports/fast-moving-items',
    ['productCode'],
    'soldProductCode',
    [
      { path: ['quantity'], binding: 'salesLineQuantity' },
      { path: ['totalAmount'], binding: 'salesLineAmount' },
    ],
  ),
  row(
    'WestsidesReportsController.slowMovingItems',
    'westsides/reports/slow-moving-items',
    ['productCode'],
    'slowProductCode',
    [
      { path: ['quantityOnHand'], binding: 'slowQuantityOnHand' },
      { path: ['totalValue'], binding: 'slowTotalValue' },
    ],
  ),
  row(
    'WestsidesReportsController.productProfitability',
    'westsides/reports/product-profitability',
    ['productCode'],
    'soldProductCode',
    [
      { path: ['quantity'], binding: 'salesLineQuantity' },
      { path: ['averageUnitCost'], binding: 'batchUnitCost' },
      { path: ['totalRevenue'], binding: 'salesLineAmount' },
      { path: ['totalCost'], binding: 'profitTotalCost' },
      { path: ['grossProfit'], binding: 'profitGrossProfit' },
      { path: ['grossMargin'], binding: 'profitGrossMargin' },
    ],
  ),
  row(
    'WestsidesReportsController.creditCustomersReport',
    'westsides/reports/credit-customers-report',
    ['customerCode'],
    'customerCode',
    [
      { path: ['invoiceCount'], binding: 'receivableCount' },
      { path: ['invoicedAmount'], binding: 'receivableAmount' },
      { path: ['outstandingAmount'], binding: 'receivableOutstanding' },
    ],
  ),
  row(
    'WestsidesReportsController.dailySalesSummary',
    'westsides/reports/daily-sales-summary',
    ['date'],
    'salesDate',
    [
      { path: ['count'], binding: 'salesOrderCount' },
      { path: ['total'], binding: 'salesOrderTotal' },
      { path: ['averageOrderValue'], binding: 'salesOrderTotal' },
    ],
  ),
  row(
    'WestsidesReportsController.monthlySalesSummary',
    'westsides/reports/monthly-sales-summary',
    ['month'],
    'salesMonth',
    [
      { path: ['count'], binding: 'salesOrderCount' },
      { path: ['total'], binding: 'salesOrderTotal' },
      { path: ['averageOrderValue'], binding: 'salesOrderTotal' },
    ],
  ),
  row(
    'WestsidesReportsController.dailyClose',
    'westsides/reports/daily-close',
    ['salesOrderNumber'],
    'salesOrderNumber',
    [
      { path: ['customerName'], binding: 'customerName' },
      { path: ['totalAmount'], binding: 'salesOrderTotal' },
    ],
    { requestKind: 'daily-close', collectionPath: ['orders'] },
  ),
]);

export const CRUD_WESTSIDES_REPORT_READ_TARGETS = Object.freeze(
  WESTSIDES_REPORT_DEFINITIONS.map((definition) => definition.capabilityId),
);

export function westsidesReportReadEvidencePack(
  manifest: readonly Capability[],
): CrudWestsidesReportReadFixturePack {
  const capabilitiesById = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = WESTSIDES_REPORT_DEFINITIONS.flatMap((definition) => {
    const capability = capabilitiesById.get(definition.capabilityId);
    if (!capability || !isExactWestsidesReportContract(capability, definition)) return [];

    const companyOracle = (company: 'A' | 'B'): CrudWestsidesReportRowOracle => ({
      collectionPath: definition.collectionPath ?? [],
      match: {
        path: definition.matchPath,
        binding: `${definition.matchBinding}${company}`,
      },
      fields: definition.fields.map((field) => ({
        path: field.path,
        binding: `${field.binding}${company}`,
      })),
    });

    return [
      {
        fixtureId: `westsides-report-read-${slug(definition.capabilityId)}-${digest(definition.capabilityId).slice(0, 12)}`,
        fixtureVersion: 2,
        capabilityId: definition.capabilityId,
        controlKind: 'positive' as const,
        description: `Reconcile ${definition.capabilityId} against conflicting company-A and company-B business records.`,
        governance: { scope: 'company' as const, audit: 'not_applicable' as const },
        expectedPath: definition.expectedPath,
        requestKind: definition.requestKind ?? ('report-range' as const),
        execution: {
          companyA: 'company' as const,
          companyB: 'group' as const,
          foreignCompanyProbe: {
            principal: 'company' as const,
            expectedStatus: 403 as const,
          },
        },
        companyAOracle: companyOracle('A'),
        companyBOracle: companyOracle('B'),
      },
    ];
  });

  return Object.freeze({
    packId: 'westsides-derived-report-reads',
    packVersion: 2,
    fixtures: Object.freeze(fixtures),
  });
}

function isExactWestsidesReportContract(
  capability: Capability,
  definition: WestsidesReportDefinition,
): boolean {
  if (
    capability.agentExcluded ||
    capability.verb !== 'GET' ||
    capability.path !== definition.expectedPath ||
    capability.params.path.length > 0 ||
    !capability.permissions.includes('westsides.reports.view') ||
    capability.anyPermissions.length > 0
  ) {
    return false;
  }

  if (
    capability.params.freeFormQuery &&
    (capability.params.querySchema?.quality !== 'strict' ||
      capability.params.querySchema.schema.additionalProperties !== false)
  ) {
    return false;
  }

  const queryNames = new Set([
    ...capability.params.query,
    ...Object.keys(capability.params.querySchema?.schema.properties ?? {}),
  ]);
  const requiredNames =
    definition.requestKind === 'daily-close'
      ? ['companyId', 'branchId', 'date']
      : ['companyId', 'branchId', 'dateFrom', 'dateTo'];
  return requiredNames.every((name) => queryNames.has(name));
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
