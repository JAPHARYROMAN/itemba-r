import { Injectable } from '@nestjs/common';
import {
  AccountingLockStatus,
  CustomerPriceAgreementStatus,
  CustomerStatus,
  DeliveryNoteStatus,
  FiscalPeriodStatus,
  GuestFolioStatus,
  InventoryMovementType,
  JournalEntryStatus,
  PeriodCloseStatus,
  PostingRunStatus,
  PriceListStatus,
  Prisma,
  ProductBatchStatus,
  ProductStatus,
  ProformaStatus,
  QuotationStatus,
  ReceivableStatus,
  RoomBookingStatus,
  RoomStatus,
  SalesOrderStatus,
  SalesPaymentMethod,
  StockDamageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { QueryDashboardDto } from './dto/query-dashboard.dto';

const CONFIRMED_SALES_STATUSES: SalesOrderStatus[] = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
];

const OPEN_RECEIVABLE_STATUSES: ReceivableStatus[] = [
  ReceivableStatus.OPEN,
  ReceivableStatus.PARTIALLY_PAID,
  ReceivableStatus.OVERDUE,
];

const ACTIVE_QUOTATION_STATUSES: QuotationStatus[] = [
  QuotationStatus.DRAFT,
  QuotationStatus.SENT,
  QuotationStatus.ACCEPTED,
];

const ACTIVE_PROFORMA_STATUSES: ProformaStatus[] = [
  ProformaStatus.DRAFT,
  ProformaStatus.SENT,
  ProformaStatus.ACCEPTED,
];

const OPEN_DELIVERY_STATUSES: DeliveryNoteStatus[] = [
  DeliveryNoteStatus.DRAFT,
  DeliveryNoteStatus.DISPATCHED,
  DeliveryNoteStatus.PARTIALLY_DELIVERED,
];

const LOW_STOCK_THRESHOLD = 10;
const MS_PER_DAY = 24 * 3600 * 1000;

type CloseStatus = 'READY' | 'WARN' | 'BLOCKED';
type ActionSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
type ActionCategory = 'SALES' | 'CASH' | 'CREDIT' | 'STOCK' | 'PRICING' | 'FULFILLMENT' | 'CLOSE';

interface DashboardAction {
  id: string;
  category: ActionCategory;
  severity: ActionSeverity;
  title: string;
  message: string;
  count?: number;
  amount?: number;
  suggestedAction: string;
}

interface ReadinessCheck {
  key: string;
  title: string;
  status: CloseStatus;
  score: number;
  message: string;
  details: Record<string, number | string | boolean>;
}

type CountByStatusRow<TStatus extends string> = {
  status: TStatus;
  _count: { id: number };
};

type ReorderExposureItem = {
  productId: string;
  productName: string;
  sku: string | null;
  quantityOnHand: number;
  reorderLevel: number;
  shortageQuantity: number;
  estimatedRestockValue: number;
};

@Injectable()
export class WestsidesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: QueryDashboardDto, user: AuthUser): Promise<any> {
    const commandCenter = await this.buildCommandCenter(query, user);
    if (!commandCenter) return null;

    const legacySummary = this.legacySummaryFrom(commandCenter);
    return {
      ...legacySummary,
      asOf: commandCenter.asOf,
      salesHealth: commandCenter.salesHealth,
      stockRisk: commandCenter.stockRisk,
      pricing: commandCenter.pricing,
      fulfillment: commandCenter.fulfillment,
      dailyClose: commandCenter.dailyClose,
      customerCreditRisk: commandCenter.customerCreditRisk,
      pipeline: commandCenter.pipeline,
      actions: commandCenter.actions,
    };
  }

  async cockpit(query: { companyId: string; branchId?: string }, user?: AuthUser): Promise<any> {
    return this.buildCommandCenter(query, user);
  }

  private async buildCommandCenter(
    query: { companyId: string; branchId?: string },
    user?: AuthUser,
  ): Promise<any> {
    if (!query.companyId) return null;
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, query.companyId);
    }

    const { companyId, branchId } = query;
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const yesterdayStart = new Date(todayStart.getTime() - MS_PER_DAY);
    const tomorrowStart = new Date(todayStart.getTime() + MS_PER_DAY);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const next7Days = new Date(todayStart.getTime() + 7 * MS_PER_DAY);
    const next30Days = new Date(todayStart.getTime() + 30 * MS_PER_DAY);

    const branchFilter = this.branchFilter(branchId);
    const facilityBranchFilter = branchId ? { facility: { branchId } } : {};
    const bookingBranchFilter = branchId ? { booking: { facility: { branchId } } } : {};

    const salesWhereToday: Prisma.SalesOrderWhereInput = {
      companyId,
      ...branchFilter,
      status: { in: CONFIRMED_SALES_STATUSES },
      orderDate: { gte: todayStart, lt: tomorrowStart },
      deletedAt: null,
    };
    const salesWhereYesterday: Prisma.SalesOrderWhereInput = {
      companyId,
      ...branchFilter,
      status: { in: CONFIRMED_SALES_STATUSES },
      orderDate: { gte: yesterdayStart, lt: todayStart },
      deletedAt: null,
    };
    const salesWhereMonth: Prisma.SalesOrderWhereInput = {
      companyId,
      ...branchFilter,
      status: { in: CONFIRMED_SALES_STATUSES },
      orderDate: { gte: monthStart, lt: tomorrowStart },
      deletedAt: null,
    };
    const salesWhereOpen: Prisma.SalesOrderWhereInput = {
      companyId,
      ...branchFilter,
      status: { in: CONFIRMED_SALES_STATUSES },
      deletedAt: null,
    };
    const receivableWhereOpen: Prisma.ReceivableWhereInput = {
      companyId,
      ...branchFilter,
      status: { in: OPEN_RECEIVABLE_STATUSES },
      deletedAt: null,
    };
    const activeCashWhere: Prisma.CashAccountWhereInput = {
      companyId,
      ...branchFilter,
      isActive: true,
      deletedAt: null,
    };
    const activePriceWindow: Prisma.PriceListWhereInput = {
      companyId,
      status: PriceListStatus.ACTIVE,
      deletedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    };
    const activeAgreementWindow: Prisma.CustomerPriceAgreementWhereInput = {
      companyId,
      status: CustomerPriceAgreementStatus.ACTIVE,
      deletedAt: null,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
      ...(branchId ? { customer: { branchId } } : {}),
    };

    const [
      todayAgg,
      yesterdayAgg,
      monthAgg,
      todayCogsAgg,
      monthCogsAgg,
      paymentMethodsRaw,
      salesTypesRaw,
      byDivisionRaw,
      arAll,
      arOverdue,
      lowStockCount,
      outOfStockCount,
      negativeStockCount,
      inventoryValueAgg,
      criticalSkus,
      reorderCandidates,
      expiringBatchesCount,
      expiredBatchesCount,
      expiringBatchRows,
      damageByStatusRaw,
      pendingDamageAgg,
      priceListStatusRaw,
      activePriceLists,
      activeButExpiredPriceLists,
      expiringPriceLists,
      priceListItems,
      activeProducts,
      coveredPriceProducts,
      activeAgreements,
      expiringAgreements,
      unapprovedAgreements,
      discountOrdersToday,
      deliveryStatusRaw,
      overdueDeliveries,
      deliveriesDueToday,
      deliveriesDeliveredToday,
      recentDeliveries,
      ordersAwaitingDelivery,
      activeQuotations,
      activeQuotationValue,
      expiringQuotations,
      activeProformas,
      recentSales,
      rooms,
      bookings,
      openFolios,
      recentCharges,
      topSalespersonsRaw,
      topProductsRaw,
      arCurrent,
      ar1to30,
      ar31to60,
      ar61to90,
      ar90plus,
      activeCashAccounts,
      cashAccountsAgg,
      cashAccountsByType,
      draftOrdersToday,
      nonCreditMissingCashAccount,
      mobileMoneyMissingReference,
      confirmedOrdersMissingJournal,
      failedPostingRuns,
      draftJournalsToday,
      activeAccountingLocks,
      pendingPeriodCloses,
      currentOpenPeriods,
      highRiskCreditProfiles,
      reviewCreditProfiles,
      blockedCustomers,
      customerOutstandingRaw,
      overdueCustomerRaw,
    ] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where: salesWhereToday,
        _sum: {
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
        _count: { id: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: salesWhereYesterday,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: salesWhereMonth,
        _sum: {
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
        _count: { id: true },
      }),
      this.prisma.inventoryMovement.aggregate({
        where: {
          companyId,
          ...branchFilter,
          movementType: InventoryMovementType.SALE_ISSUE,
          movementDate: { gte: todayStart, lt: tomorrowStart },
        },
        _sum: { totalCost: true },
      }),
      this.prisma.inventoryMovement.aggregate({
        where: {
          companyId,
          ...branchFilter,
          movementType: InventoryMovementType.SALE_ISSUE,
          movementDate: { gte: monthStart, lt: tomorrowStart },
        },
        _sum: { totalCost: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['paymentMethod'],
        where: salesWhereToday,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['salesType'],
        where: salesWhereToday,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['divisionId'],
        where: salesWhereToday,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.receivable.aggregate({
        where: receivableWhereOpen,
        _sum: { amount: true, outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          ...branchFilter,
          status: ReceivableStatus.OVERDUE,
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.inventoryBalance.count({
        where: { companyId, ...branchFilter, quantityOnHand: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
      }),
      this.prisma.inventoryBalance.count({
        where: { companyId, ...branchFilter, quantityOnHand: { lte: 0 } },
      }),
      this.prisma.inventoryBalance.count({
        where: { companyId, ...branchFilter, quantityOnHand: { lt: 0 } },
      }),
      this.prisma.inventoryBalance.aggregate({
        where: { companyId, ...branchFilter },
        _sum: { totalValue: true, quantityOnHand: true, quantityReserved: true },
        _count: { id: true },
      }),
      this.prisma.inventoryBalance.findMany({
        where: { companyId, ...branchFilter, quantityOnHand: { lte: LOW_STOCK_THRESHOLD } },
        orderBy: { quantityOnHand: 'asc' },
        take: 8,
        include: {
          product: {
            select: {
              name: true,
              sku: true,
              reorderLevel: true,
              minimumStockLevel: true,
              defaultPurchasePrice: true,
            },
          },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.product.findMany({
        where: {
          companyId,
          status: ProductStatus.ACTIVE,
          trackInventory: true,
          deletedAt: null,
          OR: [{ reorderLevel: { not: null } }, { minimumStockLevel: { not: null } }],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          reorderLevel: true,
          minimumStockLevel: true,
          defaultPurchasePrice: true,
          inventoryBalances: {
            where: { companyId, ...branchFilter },
            select: { quantityOnHand: true, averageCost: true },
          },
        },
      }),
      this.prisma.productBatch.count({
        where: {
          companyId,
          ...branchFilter,
          status: ProductBatchStatus.ACTIVE,
          remainingQuantity: { gt: 0 },
          expiryDate: { gte: todayStart, lte: next30Days },
          deletedAt: null,
        },
      }),
      this.prisma.productBatch.count({
        where: {
          companyId,
          ...branchFilter,
          status: ProductBatchStatus.ACTIVE,
          remainingQuantity: { gt: 0 },
          expiryDate: { lt: todayStart },
          deletedAt: null,
        },
      }),
      this.prisma.productBatch.findMany({
        where: {
          companyId,
          ...branchFilter,
          status: ProductBatchStatus.ACTIVE,
          remainingQuantity: { gt: 0 },
          expiryDate: { lte: next30Days },
          deletedAt: null,
        },
        orderBy: { expiryDate: 'asc' },
        take: 8,
        select: {
          id: true,
          batchNumber: true,
          expiryDate: true,
          remainingQuantity: true,
          unitCost: true,
          product: { select: { id: true, name: true, sku: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.stockDamage.groupBy({
        by: ['status'],
        where: { companyId, ...branchFilter, deletedAt: null },
        _sum: { estimatedValue: true, quantity: true },
        _count: { id: true },
      }),
      this.prisma.stockDamage.aggregate({
        where: {
          companyId,
          ...branchFilter,
          status: { in: [StockDamageStatus.SUBMITTED, StockDamageStatus.APPROVED] },
          deletedAt: null,
        },
        _sum: { estimatedValue: true, quantity: true },
        _count: { id: true },
      }),
      this.prisma.priceList.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.priceList.count({ where: activePriceWindow }),
      this.prisma.priceList.count({
        where: {
          companyId,
          status: PriceListStatus.ACTIVE,
          effectiveTo: { lt: now },
          deletedAt: null,
        },
      }),
      this.prisma.priceList.count({
        where: {
          companyId,
          status: PriceListStatus.ACTIVE,
          effectiveTo: { gte: now, lte: next30Days },
          deletedAt: null,
        },
      }),
      this.prisma.priceListItem.count({ where: { priceList: activePriceWindow } }),
      this.prisma.product.count({
        where: { companyId, status: ProductStatus.ACTIVE, deletedAt: null },
      }),
      this.prisma.priceListItem.findMany({
        where: { priceList: activePriceWindow },
        distinct: ['productId'],
        select: { productId: true },
      }),
      this.prisma.customerPriceAgreement.count({ where: activeAgreementWindow }),
      this.prisma.customerPriceAgreement.count({
        where: {
          ...activeAgreementWindow,
          endDate: { gte: now, lte: next30Days },
        },
      }),
      this.prisma.customerPriceAgreement.count({
        where: { ...activeAgreementWindow, approvedById: null },
      }),
      this.prisma.salesOrder.count({
        where: { ...salesWhereToday, discountAmount: { gt: 0 } },
      }),
      this.prisma.deliveryNote.groupBy({
        by: ['status'],
        where: { companyId, ...branchFilter, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.deliveryNote.count({
        where: {
          companyId,
          ...branchFilter,
          status: { in: OPEN_DELIVERY_STATUSES },
          deliveryDate: { lt: todayStart },
          deletedAt: null,
        },
      }),
      this.prisma.deliveryNote.count({
        where: {
          companyId,
          ...branchFilter,
          status: { in: OPEN_DELIVERY_STATUSES },
          deliveryDate: { gte: todayStart, lt: tomorrowStart },
          deletedAt: null,
        },
      }),
      this.prisma.deliveryNote.count({
        where: {
          companyId,
          ...branchFilter,
          status: DeliveryNoteStatus.DELIVERED,
          deliveryDate: { gte: todayStart, lt: tomorrowStart },
          deletedAt: null,
        },
      }),
      this.prisma.deliveryNote.findMany({
        where: { companyId, ...branchFilter, deletedAt: null },
        orderBy: { deliveryDate: 'desc' },
        take: 8,
        select: {
          id: true,
          deliveryNoteNumber: true,
          deliveryDate: true,
          status: true,
          customerName: true,
          customer: { select: { name: true } },
          driverName: true,
          vehicleNumber: true,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          ...salesWhereOpen,
          deliveryNotes: { none: { deletedAt: null } },
        },
      }),
      this.prisma.quotation.count({
        where: {
          companyId,
          ...branchFilter,
          status: { in: ACTIVE_QUOTATION_STATUSES },
          deletedAt: null,
        },
      }),
      this.prisma.quotation.aggregate({
        where: {
          companyId,
          ...branchFilter,
          status: { in: ACTIVE_QUOTATION_STATUSES },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.quotation.count({
        where: {
          companyId,
          ...branchFilter,
          status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] },
          validUntil: { gte: now, lte: next7Days },
          deletedAt: null,
        },
      }),
      this.prisma.proformaInvoice.count({
        where: {
          companyId,
          ...branchFilter,
          status: { in: ACTIVE_PROFORMA_STATUSES },
          deletedAt: null,
        },
      }),
      this.prisma.salesOrder.findMany({
        where: salesWhereToday,
        orderBy: { orderDate: 'desc' },
        take: 8,
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          totalAmount: true,
          paymentMethod: true,
          customer: { select: { name: true } },
          customerName: true,
          salesperson: { select: { fullName: true } },
        },
      }),
      this.prisma.room.groupBy({
        by: ['status'],
        where: { companyId, ...facilityBranchFilter, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.roomBooking.count({
        where: {
          companyId,
          ...facilityBranchFilter,
          status: RoomBookingStatus.CHECKED_IN,
          deletedAt: null,
        },
      }),
      this.prisma.guestFolio.aggregate({
        where: {
          companyId,
          ...bookingBranchFilter,
          status: GuestFolioStatus.OPEN,
          deletedAt: null,
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.folioCharge.findMany({
        where: {
          folio: {
            companyId,
            ...bookingBranchFilter,
            status: GuestFolioStatus.OPEN,
            deletedAt: null,
          },
        },
        orderBy: { postedAt: 'desc' },
        take: 8,
        include: {
          folio: { select: { folioNumber: true, guest: { select: { fullName: true } } } },
        },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['salespersonId'],
        where: { ...salesWhereToday, salespersonId: { not: null } },
        _sum: { totalAmount: true },
        _count: { id: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
        take: 5,
      }),
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: { salesOrder: salesWhereToday },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...receivableWhereOpen,
          OR: [{ dueDate: null }, { dueDate: { gte: todayStart } }],
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...receivableWhereOpen,
          dueDate: { gte: this.daysBefore(todayStart, 30), lt: todayStart },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...receivableWhereOpen,
          dueDate: { gte: this.daysBefore(todayStart, 60), lt: this.daysBefore(todayStart, 30) },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...receivableWhereOpen,
          dueDate: { gte: this.daysBefore(todayStart, 90), lt: this.daysBefore(todayStart, 60) },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...receivableWhereOpen,
          dueDate: { lt: this.daysBefore(todayStart, 90) },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.cashAccount.count({ where: activeCashWhere }),
      this.prisma.cashAccount.aggregate({
        where: activeCashWhere,
        _sum: { currentBalance: true },
      }),
      this.prisma.cashAccount.groupBy({
        by: ['accountType'],
        where: activeCashWhere,
        _sum: { currentBalance: true },
        _count: { id: true },
      }),
      this.prisma.salesOrder.count({
        where: {
          companyId,
          ...branchFilter,
          status: SalesOrderStatus.DRAFT,
          orderDate: { gte: todayStart, lt: tomorrowStart },
          deletedAt: null,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          ...salesWhereToday,
          paymentMethod: { not: SalesPaymentMethod.CREDIT },
          cashAccountId: null,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          ...salesWhereToday,
          paymentMethod: SalesPaymentMethod.MOBILE_MONEY,
          OR: [{ paymentReference: null }, { paymentReference: '' }],
        },
      }),
      this.prisma.salesOrder.count({
        where: { ...salesWhereToday, journalEntryId: null },
      }),
      this.prisma.postingRun.count({
        where: {
          companyId,
          status: { in: [PostingRunStatus.FAILED, PostingRunStatus.DRAFT] },
          deletedAt: null,
        },
      }),
      this.prisma.journalEntry.count({
        where: {
          companyId,
          ...branchFilter,
          status: JournalEntryStatus.DRAFT,
          transactionDate: { gte: todayStart, lt: tomorrowStart },
          deletedAt: null,
        },
      }),
      this.prisma.accountingLock.count({
        where: { companyId, status: AccountingLockStatus.ACTIVE, deletedAt: null },
      }),
      this.prisma.accountingPeriodClose.count({
        where: {
          companyId,
          status: { in: [PeriodCloseStatus.DRAFT, PeriodCloseStatus.REVIEWING] },
          deletedAt: null,
        },
      }),
      this.prisma.accountingPeriod.count({
        where: {
          companyId,
          status: FiscalPeriodStatus.OPEN,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      }),
      this.prisma.customerCreditProfile.count({
        where: {
          companyId,
          deletedAt: null,
          riskRating: { in: ['HIGH', 'BLOCKED'] as any },
        },
      }),
      this.prisma.customerCreditProfile.count({
        where: {
          companyId,
          deletedAt: null,
          creditStatus: { in: ['BLOCKED', 'REVIEW_REQUIRED'] as any },
        },
      }),
      this.prisma.customer.count({
        where: {
          companyId,
          ...branchFilter,
          status: CustomerStatus.BLOCKED,
          deletedAt: null,
        },
      }),
      this.prisma.receivable.groupBy({
        by: ['customerId', 'customerName'],
        where: receivableWhereOpen,
        _sum: { outstandingAmount: true },
        _count: { id: true },
        orderBy: { _sum: { outstandingAmount: 'desc' } },
      }),
      this.prisma.receivable.groupBy({
        by: ['customerId', 'customerName'],
        where: {
          companyId,
          ...branchFilter,
          status: ReceivableStatus.OVERDUE,
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
    ]);

    const [divisionById, salespersonById, productById, creditCustomerById] = await Promise.all([
      this.divisionMap(byDivisionRaw.map((d) => d.divisionId)),
      this.employeeMap(topSalespersonsRaw.map((s) => s.salespersonId)),
      this.productMap(topProductsRaw.map((p) => p.productId)),
      this.customerMap(customerOutstandingRaw.map((c) => c.customerId)),
    ]);

    const todaySales = this.toNumber(todayAgg._sum.totalAmount);
    const yesterdaySales = this.toNumber(yesterdayAgg._sum.totalAmount);
    const todaySubtotal = this.toNumber(todayAgg._sum.subtotal);
    const todayDiscount = this.toNumber(todayAgg._sum.discountAmount);
    const todayCogs = this.toNumber(todayCogsAgg._sum.totalCost);
    const todayMargin = todaySales - todayCogs;
    const monthSales = this.toNumber(monthAgg._sum.totalAmount);
    const monthCogs = this.toNumber(monthCogsAgg._sum.totalCost);
    const monthMargin = monthSales - monthCogs;
    const dayDelta =
      yesterdaySales > 0
        ? ((todaySales - yesterdaySales) / yesterdaySales) * 100
        : todaySales > 0
          ? 100
          : 0;

    const paymentMethods = paymentMethodsRaw.map((method) => ({
      paymentMethod: method.paymentMethod,
      count: method._count.id,
      totalAmount: this.toNumber(method._sum.totalAmount),
      paidAmount: this.toNumber(method._sum.paidAmount),
      outstandingAmount: this.toNumber(method._sum.outstandingAmount),
    }));
    const creditMethod = paymentMethods.find(
      (method) => method.paymentMethod === SalesPaymentMethod.CREDIT,
    );
    const nonCreditCollected = paymentMethods
      .filter((method) => method.paymentMethod !== SalesPaymentMethod.CREDIT)
      .reduce((sum, method) => sum + method.paidAmount, 0);

    const reorderExposure = this.computeReorderExposure(reorderCandidates);
    const reorderExposureValue = reorderExposure.reduce(
      (sum, item) => sum + item.estimatedRestockValue,
      0,
    );
    const pendingDamageValue = this.toNumber(pendingDamageAgg._sum.estimatedValue);
    const pendingDamageQuantity = this.toNumber(pendingDamageAgg._sum.quantity);

    const priceListCounts = this.statusCount(priceListStatusRaw);
    const coveredProducts = coveredPriceProducts.length;
    const productsMissingPrice = Math.max(0, activeProducts - coveredProducts);
    const productCoveragePct = this.percentage(coveredProducts, activeProducts);

    const deliveryCounts = this.statusCount(deliveryStatusRaw);
    const damageCounts = this.damageStatus(damageByStatusRaw);
    const roomTotal = rooms.reduce((sum, room) => sum + room._count.id, 0);
    const roomByStatus = (status: RoomStatus) =>
      rooms.find((room) => room.status === status)?._count.id ?? 0;
    const occupancyRate = this.percentage(roomByStatus(RoomStatus.OCCUPIED), roomTotal);

    const arOutstanding = this.toNumber(arAll._sum.outstandingAmount);
    const overdueAmount = this.toNumber(arOverdue._sum.outstandingAmount);
    const overdueByCustomer = new Map(
      overdueCustomerRaw.map((customer) => [
        this.creditCustomerKey(customer.customerId, customer.customerName),
        {
          amount: this.toNumber(customer._sum.outstandingAmount),
          count: customer._count.id,
        },
      ]),
    );
    const creditCustomers = customerOutstandingRaw.map((row) => {
      const customer = row.customerId ? creditCustomerById.get(row.customerId) : null;
      const outstandingAmount = this.toNumber(row._sum.outstandingAmount);
      const creditLimit = this.toNumber(customer?.creditLimit);
      const overdue = overdueByCustomer.get(
        this.creditCustomerKey(row.customerId, row.customerName),
      );
      return {
        customerId: row.customerId,
        customerName: customer?.name ?? row.customerName,
        customerCode: customer?.customerCode ?? null,
        status: customer?.status ?? null,
        receivableCount: row._count.id,
        outstandingAmount,
        overdueAmount: overdue?.amount ?? 0,
        overdueCount: overdue?.count ?? 0,
        creditLimit,
        currentBalance: this.toNumber(customer?.currentBalance),
        creditUtilizationPct: creditLimit > 0 ? this.percentage(outstandingAmount, creditLimit) : 0,
        overLimitAmount: creditLimit > 0 ? Math.max(0, outstandingAmount - creditLimit) : 0,
      };
    });
    const overLimitCustomers = creditCustomers.filter((customer) => customer.overLimitAmount > 0);

    const closeBlockers =
      nonCreditMissingCashAccount +
      confirmedOrdersMissingJournal +
      failedPostingRuns +
      activeAccountingLocks +
      (currentOpenPeriods === 0 ? 1 : 0);
    const closeWarnings =
      draftOrdersToday +
      mobileMoneyMissingReference +
      overdueDeliveries +
      pendingDamageAgg._count.id +
      pendingPeriodCloses;
    const closeScore = this.clampScore(100 - closeBlockers * 18 - closeWarnings * 4);
    const closeStatus: CloseStatus =
      closeBlockers > 0 ? 'BLOCKED' : closeWarnings > 0 ? 'WARN' : 'READY';
    const dailyCloseChecks = this.dailyCloseChecks({
      activeCashAccounts,
      nonCreditMissingCashAccount,
      mobileMoneyMissingReference,
      confirmedOrdersMissingJournal,
      failedPostingRuns,
      draftJournalsToday,
      activeAccountingLocks,
      currentOpenPeriods,
      draftOrdersToday,
      overdueDeliveries,
      pendingDamage: pendingDamageAgg._count.id,
    });

    const stockRisk = {
      inventoryValue: this.toNumber(inventoryValueAgg._sum.totalValue),
      balanceRows: inventoryValueAgg._count.id,
      quantityOnHand: this.toNumber(inventoryValueAgg._sum.quantityOnHand),
      quantityReserved: this.toNumber(inventoryValueAgg._sum.quantityReserved),
      lowStockCount,
      outOfStockCount,
      negativeStockCount,
      expiry: {
        expiringSoonCount: expiringBatchesCount,
        expiredActiveCount: expiredBatchesCount,
        next30Days: expiringBatchRows.map((batch) => ({
          id: batch.id,
          batchNumber: batch.batchNumber,
          productId: batch.product.id,
          productName: batch.product.name,
          sku: batch.product.sku,
          branchId: batch.branch?.id ?? null,
          branchName: batch.branch?.name ?? 'Unassigned branch/location',
          expiryDate: batch.expiryDate,
          remainingQuantity: this.toNumber(batch.remainingQuantity),
          unitCost: this.toNumber(batch.unitCost),
          exposureValue: this.toNumber(batch.remainingQuantity) * this.toNumber(batch.unitCost),
        })),
      },
      damage: {
        pendingCount: pendingDamageAgg._count.id,
        pendingQuantity: pendingDamageQuantity,
        pendingEstimatedValue: pendingDamageValue,
        byStatus: damageCounts,
      },
      reorder: {
        threshold: LOW_STOCK_THRESHOLD,
        exposureCount: reorderExposure.length,
        exposureValue: reorderExposureValue,
        topItems: reorderExposure.slice(0, 8),
      },
    };

    const pricing = {
      priceLists: {
        active: activePriceLists,
        inactive: priceListCounts[PriceListStatus.INACTIVE] ?? 0,
        expired: priceListCounts[PriceListStatus.EXPIRED] ?? 0,
        activeButPastEffectiveTo: activeButExpiredPriceLists,
        expiringSoon: expiringPriceLists,
        activeItems: priceListItems,
        activeProducts,
        coveredProducts,
        productsMissingPrice,
        productCoveragePct,
      },
      customerAgreements: {
        active: activeAgreements,
        expiringSoon: expiringAgreements,
        unapprovedActive: unapprovedAgreements,
      },
      discounts: {
        discountedOrdersToday: discountOrdersToday,
        discountAmountToday: todayDiscount,
        discountRateToday: this.percentage(todayDiscount, todaySubtotal),
      },
      status:
        productsMissingPrice > 0 || activeButExpiredPriceLists > 0
          ? 'REVIEW_REQUIRED'
          : expiringPriceLists > 0 || expiringAgreements > 0
            ? 'WATCH'
            : 'CURRENT',
    };

    const fulfillment = {
      ordersAwaitingDelivery,
      deliveries: {
        draft: deliveryCounts[DeliveryNoteStatus.DRAFT] ?? 0,
        dispatched: deliveryCounts[DeliveryNoteStatus.DISPATCHED] ?? 0,
        delivered: deliveryCounts[DeliveryNoteStatus.DELIVERED] ?? 0,
        partiallyDelivered: deliveryCounts[DeliveryNoteStatus.PARTIALLY_DELIVERED] ?? 0,
        cancelled: deliveryCounts[DeliveryNoteStatus.CANCELLED] ?? 0,
        overdue: overdueDeliveries,
        dueToday: deliveriesDueToday,
        deliveredToday: deliveriesDeliveredToday,
        recent: recentDeliveries.map((delivery) => ({
          id: delivery.id,
          deliveryNoteNumber: delivery.deliveryNoteNumber,
          deliveryDate: delivery.deliveryDate,
          status: delivery.status,
          customerName: delivery.customer?.name ?? delivery.customerName ?? 'Walk-in',
          driverName: delivery.driverName,
          vehicleNumber: delivery.vehicleNumber,
        })),
      },
      status:
        overdueDeliveries > 0
          ? 'DELAYED'
          : ordersAwaitingDelivery > 0 || deliveriesDueToday > 0
            ? 'ACTIVE'
            : 'CLEAR',
    };

    const customerCreditRisk = {
      outstandingAmount: arOutstanding,
      openReceivables: arAll._count.id,
      overdueAmount,
      overdueCount: arOverdue._count.id,
      overduePct: this.percentage(overdueAmount, arOutstanding),
      blockedCustomers,
      highRiskProfiles: highRiskCreditProfiles,
      reviewProfiles: reviewCreditProfiles,
      customersOverLimit: overLimitCustomers.length,
      overLimitAmount: overLimitCustomers.reduce(
        (sum, customer) => sum + customer.overLimitAmount,
        0,
      ),
      topCustomers: creditCustomers.slice(0, 8),
      status:
        overLimitCustomers.length > 0 || overdueAmount > 0 || highRiskCreditProfiles > 0
          ? 'REVIEW_REQUIRED'
          : 'HEALTHY',
    };

    const salesHealth = {
      today: {
        orders: todayAgg._count.id,
        subtotal: todaySubtotal,
        discountAmount: todayDiscount,
        taxAmount: this.toNumber(todayAgg._sum.taxAmount),
        netSales: todaySales,
        paidAmount: this.toNumber(todayAgg._sum.paidAmount),
        outstandingAmount: this.toNumber(todayAgg._sum.outstandingAmount),
        averageTicket: todayAgg._count.id > 0 ? todaySales / todayAgg._count.id : 0,
        cogs: todayCogs,
        grossMargin: todayMargin,
        grossMarginPct: this.percentage(todayMargin, todaySales),
      },
      monthToDate: {
        orders: monthAgg._count.id,
        subtotal: this.toNumber(monthAgg._sum.subtotal),
        discountAmount: this.toNumber(monthAgg._sum.discountAmount),
        taxAmount: this.toNumber(monthAgg._sum.taxAmount),
        netSales: monthSales,
        paidAmount: this.toNumber(monthAgg._sum.paidAmount),
        outstandingAmount: this.toNumber(monthAgg._sum.outstandingAmount),
        averageTicket: monthAgg._count.id > 0 ? monthSales / monthAgg._count.id : 0,
        cogs: monthCogs,
        grossMargin: monthMargin,
        grossMarginPct: this.percentage(monthMargin, monthSales),
      },
      cash: {
        collectedToday: this.toNumber(todayAgg._sum.paidAmount),
        nonCreditCollectedToday: nonCreditCollected,
        activeCashAccounts,
        totalCashAccountBalance: this.toNumber(cashAccountsAgg._sum.currentBalance),
        byAccountType: cashAccountsByType.map((account) => ({
          accountType: account.accountType,
          count: account._count.id,
          balance: this.toNumber(account._sum.currentBalance),
        })),
      },
      credit: {
        creditSalesToday: creditMethod?.totalAmount ?? 0,
        creditOrdersToday: creditMethod?.count ?? 0,
        creditOutstandingToday: creditMethod?.outstandingAmount ?? 0,
        outstandingAR: arOutstanding,
        openReceivables: arAll._count.id,
        overdueAR: overdueAmount,
        overdueCount: arOverdue._count.id,
        overduePct: this.percentage(overdueAmount, arOutstanding),
      },
      paymentMethods,
      salesTypes: salesTypesRaw.map((salesType) => ({
        salesType: salesType.salesType,
        count: salesType._count.id,
        totalAmount: this.toNumber(salesType._sum.totalAmount),
      })),
    };

    const dailyClose = {
      date: todayStart.toISOString(),
      status: closeStatus,
      score: closeScore,
      blockers: closeBlockers,
      warnings: closeWarnings,
      expected: {
        salesCount: todayAgg._count.id,
        totalSales: todaySales,
        paidAmount: this.toNumber(todayAgg._sum.paidAmount),
        outstandingAmount: this.toNumber(todayAgg._sum.outstandingAmount),
        byPaymentMethod: paymentMethods,
      },
      exceptions: {
        draftOrdersToday,
        nonCreditMissingCashAccount,
        mobileMoneyMissingReference,
        confirmedOrdersMissingJournal,
        failedPostingRuns,
        draftJournalsToday,
        activeAccountingLocks,
        pendingPeriodCloses,
        currentOpenPeriods,
      },
      checks: dailyCloseChecks,
    };

    const actions = this.buildActions({
      outOfStockCount,
      lowStockCount,
      reorderExposureCount: reorderExposure.length,
      reorderExposureValue,
      expiringBatchesCount,
      expiredBatchesCount,
      pendingDamageCount: pendingDamageAgg._count.id,
      pendingDamageValue,
      productsMissingPrice,
      activeButExpiredPriceLists,
      expiringPriceLists,
      overdueDeliveries,
      ordersAwaitingDelivery,
      dailyClose,
      overdueAmount,
      overdueCount: arOverdue._count.id,
      customersOverLimit: overLimitCustomers.length,
      overLimitAmount: customerCreditRisk.overLimitAmount,
      highRiskCreditProfiles,
    });

    const byDivision = byDivisionRaw.map((division) => ({
      divisionId: division.divisionId,
      name: division.divisionId
        ? (divisionById.get(division.divisionId)?.name ?? null)
        : 'Unassigned',
      code: division.divisionId ? (divisionById.get(division.divisionId)?.code ?? null) : null,
      count: division._count.id,
      revenue: this.toNumber(division._sum.totalAmount),
    }));

    const cockpit = {
      asOf: now.toISOString(),
      kpis: {
        todaySales,
        todayCount: todayAgg._count.id,
        avgTicket: todayAgg._count.id > 0 ? todaySales / todayAgg._count.id : 0,
        cashCollected: this.toNumber(todayAgg._sum.paidAmount),
        outstandingAR: arOutstanding,
        openFoliosCount: openFolios._count.id,
        openFoliosTotal: this.toNumber(openFolios._sum.totalAmount),
        grossMarginToday: todayMargin,
        grossMarginPctToday: this.percentage(todayMargin, todaySales),
        dailyCloseScore: closeScore,
        actionsCritical: actions.filter((action) => action.severity === 'CRITICAL').length,
      },
      yesterday: {
        sales: yesterdaySales,
        count: yesterdayAgg._count.id,
        deltaPct: dayDelta,
      },
      byDivision,
      stock: {
        outOfStock: outOfStockCount,
        lowStock: lowStockCount,
        criticalSkus: criticalSkus.map((balance) => ({
          productId: balance.productId,
          productName: balance.product.name,
          sku: balance.product.sku,
          locationName: balance.branch?.name ?? 'Unassigned branch/location',
          quantityOnHand: this.toNumber(balance.quantityOnHand),
          reorderLevel: this.toNumber(
            balance.product.reorderLevel ??
              balance.product.minimumStockLevel ??
              LOW_STOCK_THRESHOLD,
          ),
          defaultPurchasePrice: this.toNumber(balance.product.defaultPurchasePrice),
        })),
        risk: stockRisk,
      },
      rooms: {
        total: roomTotal,
        occupied: roomByStatus(RoomStatus.OCCUPIED),
        available: roomByStatus(RoomStatus.AVAILABLE),
        dirty: roomByStatus(RoomStatus.DIRTY),
        outOfOrder:
          roomByStatus(RoomStatus.OUT_OF_SERVICE) + roomByStatus(RoomStatus.UNDER_MAINTENANCE),
        occupancyRate,
        inHouseGuests: bookings,
      },
      arAging: {
        current: this.toNumber(arCurrent._sum.outstandingAmount),
        days1to30: this.toNumber(ar1to30._sum.outstandingAmount),
        days31to60: this.toNumber(ar31to60._sum.outstandingAmount),
        days61to90: this.toNumber(ar61to90._sum.outstandingAmount),
        days90plus: this.toNumber(ar90plus._sum.outstandingAmount),
        overdueCount: arOverdue._count.id,
        overdueAmount,
      },
      topSalespersons: topSalespersonsRaw.map((salesperson) => ({
        id: salesperson.salespersonId,
        name: salesperson.salespersonId
          ? (salespersonById.get(salesperson.salespersonId)?.fullName ??
            salespersonById.get(salesperson.salespersonId)?.employeeCode ??
            null)
          : null,
        count: salesperson._count.id,
        revenue: this.toNumber(salesperson._sum.totalAmount),
      })),
      topProducts: topProductsRaw.map((product) => ({
        productId: product.productId,
        name: productById.get(product.productId)?.name ?? 'Unknown',
        sku: productById.get(product.productId)?.sku ?? null,
        quantity: this.toNumber(product._sum.quantity),
        revenue: this.toNumber(product._sum.lineTotal),
      })),
      activity: {
        recentSales: recentSales.map((order) => ({
          id: order.id,
          kind: 'SALE' as const,
          when: order.orderDate,
          headline: `Sale ${order.salesOrderNumber} - ${order.customer?.name ?? order.customerName ?? 'Walk-in'}`,
          subline: `${order.salesperson?.fullName ?? 'Unassigned'} / ${order.paymentMethod}`,
          amount: this.toNumber(order.totalAmount),
        })),
        recentCharges: recentCharges.map((charge) => ({
          id: charge.id,
          kind: 'FOLIO_CHARGE' as const,
          when: charge.postedAt,
          headline: `${charge.chargeType} - ${charge.folio.guest.fullName} (${charge.folio.folioNumber})`,
          subline: charge.description,
          amount: this.toNumber(charge.amount),
        })),
      },
      summary: null as unknown,
      salesHealth,
      stockRisk,
      pricing,
      fulfillment,
      dailyClose,
      customerCreditRisk,
      pipeline: {
        activeQuotations,
        activeQuotationValue: this.toNumber(activeQuotationValue._sum.totalAmount),
        expiringQuotationsNext7Days: expiringQuotations,
        activeProformas,
      },
      actions,
    };

    return {
      ...cockpit,
      summary: this.legacySummaryFrom(cockpit),
    };
  }

  private legacySummaryFrom(commandCenter: any) {
    return {
      todaySales: commandCenter.kpis.todaySales,
      monthSales: commandCenter.salesHealth.monthToDate.netSales,
      pendingDeliveries: commandCenter.fulfillment.deliveries.dispatched,
      activeQuotations: commandCenter.pipeline.activeQuotations,
      lowStockItems: commandCenter.stock.lowStock,
      expiringBatches: commandCenter.stockRisk.expiry.expiringSoonCount,
      pendingStockDamage: commandCenter.stockRisk.damage.pendingCount,
      creditReceivables: commandCenter.customerCreditRisk.outstandingAmount,
    };
  }

  private branchFilter(branchId?: string): { branchId?: string } {
    return branchId ? { branchId } : {};
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private daysBefore(date: Date, days: number) {
    return new Date(date.getTime() - days * MS_PER_DAY);
  }

  private toNumber(value: unknown): number {
    return Number(value ?? 0);
  }

  private percentage(numerator: number, denominator: number): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
    return (numerator / denominator) * 100;
  }

  private clampScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private statusForScore(score: number): CloseStatus {
    if (score >= 90) return 'READY';
    if (score >= 70) return 'WARN';
    return 'BLOCKED';
  }

  private statusCount<TStatus extends string>(
    rows: Array<CountByStatusRow<TStatus>>,
  ): Record<TStatus, number> {
    return rows.reduce(
      (acc, row) => {
        acc[row.status] = row._count.id;
        return acc;
      },
      {} as Record<TStatus, number>,
    );
  }

  private damageStatus(
    rows: Array<{
      status: StockDamageStatus;
      _count: { id: number };
      _sum: { estimatedValue: Prisma.Decimal | null; quantity: Prisma.Decimal | null };
    }>,
  ) {
    return rows.map((row) => ({
      status: row.status,
      count: row._count.id,
      quantity: this.toNumber(row._sum.quantity),
      estimatedValue: this.toNumber(row._sum.estimatedValue),
    }));
  }

  private computeReorderExposure(
    products: Array<{
      id: string;
      name: string;
      sku: string | null;
      reorderLevel: Prisma.Decimal | null;
      minimumStockLevel: Prisma.Decimal | null;
      defaultPurchasePrice: Prisma.Decimal | null;
      inventoryBalances: Array<{
        quantityOnHand: Prisma.Decimal;
        averageCost: Prisma.Decimal;
      }>;
    }>,
  ): ReorderExposureItem[] {
    return products
      .map((product) => {
        const quantityOnHand = product.inventoryBalances.reduce(
          (sum, balance) => sum + this.toNumber(balance.quantityOnHand),
          0,
        );
        const reorderLevel = this.toNumber(product.reorderLevel ?? product.minimumStockLevel);
        const averageCost =
          product.inventoryBalances.length > 0
            ? product.inventoryBalances.reduce(
                (sum, balance) => sum + this.toNumber(balance.averageCost),
                0,
              ) / product.inventoryBalances.length
            : 0;
        const unitCost = this.toNumber(product.defaultPurchasePrice) || averageCost;
        const shortageQuantity = Math.max(0, reorderLevel - quantityOnHand);
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantityOnHand,
          reorderLevel,
          shortageQuantity,
          estimatedRestockValue: shortageQuantity * unitCost,
        };
      })
      .filter((product) => product.shortageQuantity > 0)
      .sort((a, b) => b.estimatedRestockValue - a.estimatedRestockValue);
  }

  private dailyCloseChecks(input: {
    activeCashAccounts: number;
    nonCreditMissingCashAccount: number;
    mobileMoneyMissingReference: number;
    confirmedOrdersMissingJournal: number;
    failedPostingRuns: number;
    draftJournalsToday: number;
    activeAccountingLocks: number;
    currentOpenPeriods: number;
    draftOrdersToday: number;
    overdueDeliveries: number;
    pendingDamage: number;
  }): ReadinessCheck[] {
    const paymentScore = this.clampScore(
      100 -
        input.nonCreditMissingCashAccount * 25 -
        input.mobileMoneyMissingReference * 10 -
        (input.activeCashAccounts === 0 ? 30 : 0),
    );
    const postingScore = this.clampScore(
      100 -
        input.confirmedOrdersMissingJournal * 25 -
        input.failedPostingRuns * 20 -
        input.draftJournalsToday * 5,
    );
    const controlScore = this.clampScore(
      100 - input.activeAccountingLocks * 25 - (input.currentOpenPeriods === 0 ? 35 : 0),
    );
    const operationsScore = this.clampScore(
      100 - input.draftOrdersToday * 8 - input.overdueDeliveries * 8 - input.pendingDamage * 5,
    );

    return [
      {
        key: 'payment-evidence',
        title: 'Payment evidence',
        status: this.statusForScore(paymentScore),
        score: paymentScore,
        message:
          paymentScore >= 90
            ? 'Cash, bank, card, and mobile collections have the required account evidence.'
            : 'Some non-credit payments are missing a cash account or reference.',
        details: {
          activeCashAccounts: input.activeCashAccounts,
          nonCreditMissingCashAccount: input.nonCreditMissingCashAccount,
          mobileMoneyMissingReference: input.mobileMoneyMissingReference,
        },
      },
      {
        key: 'posting-integrity',
        title: 'Posting integrity',
        status: this.statusForScore(postingScore),
        score: postingScore,
        message:
          postingScore >= 90
            ? 'Confirmed sales have matching accounting evidence.'
            : 'Confirmed sales or posting runs need accounting review.',
        details: {
          confirmedOrdersMissingJournal: input.confirmedOrdersMissingJournal,
          failedPostingRuns: input.failedPostingRuns,
          draftJournalsToday: input.draftJournalsToday,
        },
      },
      {
        key: 'finance-controls',
        title: 'Finance controls',
        status: this.statusForScore(controlScore),
        score: controlScore,
        message:
          controlScore >= 90
            ? 'Accounting period and lock state are compatible with close.'
            : 'Accounting locks or period setup may block close.',
        details: {
          activeAccountingLocks: input.activeAccountingLocks,
          currentOpenPeriods: input.currentOpenPeriods,
        },
      },
      {
        key: 'operations-exceptions',
        title: 'Operations exceptions',
        status: this.statusForScore(operationsScore),
        score: operationsScore,
        message:
          operationsScore >= 90
            ? 'No material sales, delivery, or damage backlog is blocking close.'
            : 'Operational exceptions should be cleared or acknowledged before close.',
        details: {
          draftOrdersToday: input.draftOrdersToday,
          overdueDeliveries: input.overdueDeliveries,
          pendingDamage: input.pendingDamage,
        },
      },
    ];
  }

  private buildActions(input: {
    outOfStockCount: number;
    lowStockCount: number;
    reorderExposureCount: number;
    reorderExposureValue: number;
    expiringBatchesCount: number;
    expiredBatchesCount: number;
    pendingDamageCount: number;
    pendingDamageValue: number;
    productsMissingPrice: number;
    activeButExpiredPriceLists: number;
    expiringPriceLists: number;
    overdueDeliveries: number;
    ordersAwaitingDelivery: number;
    dailyClose: { status: CloseStatus; blockers: number; warnings: number };
    overdueAmount: number;
    overdueCount: number;
    customersOverLimit: number;
    overLimitAmount: number;
    highRiskCreditProfiles: number;
  }): DashboardAction[] {
    const actions: DashboardAction[] = [];
    const push = (condition: boolean, action: DashboardAction) => {
      if (condition) actions.push(action);
    };

    push(input.outOfStockCount > 0, {
      id: 'stock-out-of-stock',
      category: 'STOCK',
      severity: 'CRITICAL',
      title: 'Out-of-stock SKUs',
      message: `${input.outOfStockCount} stock balance rows are at or below zero.`,
      count: input.outOfStockCount,
      suggestedAction: 'Review live inventory and raise replenishment or transfer actions.',
    });
    push(input.reorderExposureCount > 0 || input.lowStockCount > 0, {
      id: 'stock-reorder-exposure',
      category: 'STOCK',
      severity: input.reorderExposureCount > 0 ? 'WARNING' : 'INFO',
      title: 'Reorder exposure',
      message: `${input.reorderExposureCount} SKUs are below configured reorder levels.`,
      count: input.reorderExposureCount,
      amount: input.reorderExposureValue,
      suggestedAction: 'Prioritize purchase orders for the highest shortage value items.',
    });
    push(input.expiredBatchesCount > 0 || input.expiringBatchesCount > 0, {
      id: 'stock-expiry-risk',
      category: 'STOCK',
      severity: input.expiredBatchesCount > 0 ? 'CRITICAL' : 'WARNING',
      title: 'Batch expiry risk',
      message: `${input.expiredBatchesCount} active batches are already expired and ${input.expiringBatchesCount} expire within 30 days.`,
      count: input.expiredBatchesCount + input.expiringBatchesCount,
      suggestedAction:
        'Quarantine expired stock and accelerate sale/transfer of near-expiry batches.',
    });
    push(input.pendingDamageCount > 0, {
      id: 'stock-damage-pending',
      category: 'STOCK',
      severity: 'WARNING',
      title: 'Unposted stock damage',
      message: `${input.pendingDamageCount} damage records are submitted or approved but not fully posted.`,
      count: input.pendingDamageCount,
      amount: input.pendingDamageValue,
      suggestedAction: 'Approve or post stock damage so inventory value is accurate.',
    });
    push(input.productsMissingPrice > 0 || input.activeButExpiredPriceLists > 0, {
      id: 'pricing-coverage',
      category: 'PRICING',
      severity: 'WARNING',
      title: 'Price-list coverage gap',
      message: `${input.productsMissingPrice} active products lack an active price-list item.`,
      count: input.productsMissingPrice,
      suggestedAction: 'Refresh active price lists and cover products missing sale prices.',
    });
    push(input.expiringPriceLists > 0, {
      id: 'pricing-expiring',
      category: 'PRICING',
      severity: 'INFO',
      title: 'Price lists expiring soon',
      message: `${input.expiringPriceLists} active price lists expire within 30 days.`,
      count: input.expiringPriceLists,
      suggestedAction: 'Prepare replacement price lists before expiry.',
    });
    push(input.overdueDeliveries > 0 || input.ordersAwaitingDelivery > 0, {
      id: 'fulfillment-backlog',
      category: 'FULFILLMENT',
      severity: input.overdueDeliveries > 0 ? 'CRITICAL' : 'WARNING',
      title: 'Delivery backlog',
      message: `${input.overdueDeliveries} deliveries are overdue and ${input.ordersAwaitingDelivery} confirmed orders have no delivery note.`,
      count: input.overdueDeliveries + input.ordersAwaitingDelivery,
      suggestedAction: 'Assign vehicles/drivers or close delivery notes for completed dispatches.',
    });
    push(input.dailyClose.status !== 'READY', {
      id: 'daily-close-readiness',
      category: 'CLOSE',
      severity: input.dailyClose.status === 'BLOCKED' ? 'CRITICAL' : 'WARNING',
      title: 'Daily close not ready',
      message: `${input.dailyClose.blockers} blockers and ${input.dailyClose.warnings} warnings are open for today's close.`,
      count: input.dailyClose.blockers + input.dailyClose.warnings,
      suggestedAction: 'Clear payment, posting, lock, and operational exceptions before close.',
    });
    push(input.overdueAmount > 0 || input.customersOverLimit > 0, {
      id: 'credit-risk',
      category: 'CREDIT',
      severity: input.customersOverLimit > 0 ? 'CRITICAL' : 'WARNING',
      title: 'Customer credit risk',
      message: `${input.overdueCount} receivables are overdue and ${input.customersOverLimit} customers are over limit.`,
      count: input.overdueCount + input.customersOverLimit,
      amount: input.overdueAmount + input.overLimitAmount,
      suggestedAction: 'Follow up overdue accounts and review customers above credit limit.',
    });
    push(input.highRiskCreditProfiles > 0, {
      id: 'credit-profile-review',
      category: 'CREDIT',
      severity: 'WARNING',
      title: 'High-risk credit profiles',
      message: `${input.highRiskCreditProfiles} customer credit profiles are rated high or blocked.`,
      count: input.highRiskCreditProfiles,
      suggestedAction: 'Review credit terms before accepting additional credit sales.',
    });

    const severityRank: Record<ActionSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return actions.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        (b.amount ?? 0) - (a.amount ?? 0) ||
        (b.count ?? 0) - (a.count ?? 0),
    );
  }

  private creditCustomerKey(customerId: string | null, customerName: string) {
    return customerId ?? `name:${customerName}`;
  }

  private async divisionMap(divisionIds: Array<string | null>) {
    const ids = Array.from(new Set(divisionIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0) return new Map<string, { id: string; name: string; code: string }>();
    const divisions = await this.prisma.division.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, code: true },
    });
    return new Map(divisions.map((division) => [division.id, division]));
  }

  private async employeeMap(employeeIds: Array<string | null>) {
    const ids = Array.from(new Set(employeeIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<string, { id: string; fullName: string; employeeCode: string }>();
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, employeeCode: true },
    });
    return new Map(employees.map((employee) => [employee.id, employee]));
  }

  private async productMap(productIds: string[]) {
    const ids = Array.from(new Set(productIds.filter(Boolean)));
    if (ids.length === 0)
      return new Map<string, { id: string; name: string; sku: string | null }>();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, sku: true },
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  private async customerMap(customerIds: Array<string | null>) {
    const ids = Array.from(new Set(customerIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<
        string,
        {
          id: string;
          name: string;
          customerCode: string;
          creditLimit: Prisma.Decimal;
          currentBalance: Prisma.Decimal;
          status: CustomerStatus;
        }
      >();
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        name: true,
        customerCode: true,
        creditLimit: true,
        currentBalance: true,
        status: true,
      },
    });
    return new Map(customers.map((customer) => [customer.id, customer]));
  }
}
