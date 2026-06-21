import { Injectable } from '@nestjs/common';
import {
  ApprovalRequestStatus,
  AuditSeverity,
  ComplianceObligationStatus,
  EmploymentStatus,
  ExpenseStatus,
  FuelNozzleReadingStatus,
  FuelShiftStatus,
  PayableStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  ReceivableStatus,
  RequisitionStatus,
  RFQStatus,
  SalesOrderStatus,
  StockAdjustmentStatus,
  SupplierInvoiceStatus,
  TaxReturnStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopedWhere, CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getExecutiveSummary(user: AuthUser, companyId?: string) {
    const scope = await this.companyScope.companyWhereFor(user, companyId);
    const companyWhere = companyEntityWhere(scope, { deletedAt: null });
    const branchWhere = branchEntityWhere(scope, { deletedAt: null });
    const scopedDeletedWhere = scopedWhere(scope, { deletedAt: null });
    const now = new Date();
    const today = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30 = new Date(now);
    in30.setDate(now.getDate() + 30);
    const in60 = new Date(now);
    in60.setDate(now.getDate() + 60);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const openReceivableWhere = scopedWhere(scope, {
      deletedAt: null,
      status: {
        in: [ReceivableStatus.OPEN, ReceivableStatus.PARTIALLY_PAID, ReceivableStatus.OVERDUE],
      },
    });
    const openPayableWhere = scopedWhere(scope, {
      deletedAt: null,
      status: {
        in: [PayableStatus.OPEN, PayableStatus.PARTIALLY_PAID, PayableStatus.OVERDUE],
      },
    });
    const activeSalesWhere = scopedWhere(scope, {
      deletedAt: null,
      status: { notIn: [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED] },
    });
    const activePurchaseWhere = scopedWhere(scope, {
      deletedAt: null,
      status: { notIn: [PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.VOIDED] },
    });

    const [
      // Overview
      companyCount,
      divisionCount,
      branchCount,
      activeUserCount,

      // Group control
      bankAccountTotal,
      bankAccountActive,
      activeLoans,
      activeLoansBalance,
      overdueLoans,
      outstandingDebts,
      outstandingDebtTotal,
      activeContracts,
      expiringIn30,
      expiringIn60,
      pendingApprovalContracts,
      activeAssets,
      assetTotalValue,
      assetsAsCollateral,
      uninsuredAssets,
      disposedAssets,
      totalDocuments,
      sensitiveDocuments,
      expiringDocuments,
      auditLogs24h,
      criticalAudit24h,
      recentActivity,
      companies,
      alertContracts,
      alertLoans,
      alertDocuments,
      alertHighRiskLoans,

      // Finance
      openReceivables,
      receivableOutstanding,
      overdueReceivables,
      overdueReceivableOutstanding,
      receivableExceptions,
      openPayables,
      payableOutstanding,
      overduePayables,
      overduePayableOutstanding,
      payableExceptions,
      activeCashAccounts,
      cashAccountBalance,
      pendingExpenses,
      paidExpensesThisMonth,

      // Operations
      salesOrderTotal,
      draftSalesOrders,
      confirmedSalesOrders,
      unpaidSalesOrders,
      salesOrdersToday,
      salesTodayTotal,
      salesMonthTotal,
      recentSalesOrders,
      purchaseOrderTotal,
      draftPurchaseOrders,
      confirmedPurchaseOrders,
      receivedPurchaseOrders,
      purchaseOrdersOutstanding,
      purchasesMonthTotal,
      recentPurchaseOrders,
      productCount,
      inventoryBalanceCount,
      inventoryTotalValue,
      zeroStockBalances,
      negativeStockBalances,
      negativeStockItems,
      stockAdjustmentDraft,
      stockAdjustmentPending,
      stockAdjustmentApproved,
      stockAdjustmentPosted,
      unpostedAdjustments,

      // Workflow / people / procurement
      pendingApprovals,
      escalatedApprovals,
      approvalsDueSoon,
      approvalExceptions,
      activeEmployees,
      employeesOnLeave,
      employeesSuspended,
      pendingRequisitions,
      approvedRequisitions,
      activeRfqs,
      supplierInvoicesPending,
      supplierInvoicesDisputed,
      supplierInvoicesOutstanding,

      // Compliance / petroleum
      overdueCompliance,
      complianceDueSoon,
      pendingTaxReturns,
      taxReturnsOutstanding,
      openFuelShifts,
      fuelExpectedToday,
      fuelCollectionsToday,
    ] = await Promise.all([
      // Overview
      this.prisma.company.count({ where: companyWhere }),
      this.prisma.division.count({ where: scopedDeletedWhere }),
      this.prisma.branch.count({ where: branchWhere }),
      this.prisma.user.count({ where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }) }),

      // Group control
      this.prisma.bankAccount.count({ where: scopedDeletedWhere }),
      this.prisma.bankAccount.count({
        where: scopedWhere(scope, { deletedAt: null, isActive: true }),
      }),
      this.prisma.loan.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
      }),
      this.prisma.loan.aggregate({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
        _sum: { outstandingBalance: true },
      }),
      this.prisma.loan.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          maturityDate: { lt: now },
        }),
      }),
      this.prisma.debt.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'OUTSTANDING' }),
      }),
      this.prisma.debt.aggregate({
        where: scopedWhere(scope, { deletedAt: null, status: 'OUTSTANDING' }),
        _sum: { amount: true },
      }),
      this.prisma.contract.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
      }),
      this.prisma.contract.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          endDate: { gte: now, lte: in30 },
        }),
      }),
      this.prisma.contract.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          endDate: { gte: now, lte: in60 },
        }),
      }),
      this.prisma.contract.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'PENDING_APPROVAL' }),
      }),
      this.prisma.fixedAsset.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
      }),
      this.prisma.fixedAsset.aggregate({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
        _sum: { currentBookValue: true },
      }),
      this.prisma.fixedAsset.count({
        where: scopedWhere(scope, { deletedAt: null, collateralStatus: 'USED_AS_COLLATERAL' }),
      }),
      this.prisma.fixedAsset.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          insuranceStatus: 'NOT_INSURED',
        }),
      }),
      this.prisma.fixedAsset.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'DISPOSED' }),
      }),
      this.prisma.document.count({ where: scopedDeletedWhere }),
      this.prisma.document.count({
        where: scopedWhere(scope, { deletedAt: null, isConfidential: true }),
      }),
      this.prisma.document.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          expiryDate: { gte: now, lte: in60 },
          status: { not: 'ARCHIVED' },
        }),
      }),
      this.prisma.auditLog.count({ where: scopedWhere(scope, { createdAt: { gte: yesterday } }) }),
      this.prisma.auditLog.count({
        where: scopedWhere(scope, {
          createdAt: { gte: yesterday },
          severity: AuditSeverity.CRITICAL,
        }),
      }),
      this.prisma.auditLog.findMany({
        where: scopedWhere(scope, {
          severity: { in: [AuditSeverity.CRITICAL, AuditSeverity.HIGH] },
        }),
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          company: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.company.findMany({
        where: companyWhere,
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          industryType: true,
          divisions: {
            where: { deletedAt: null },
            select: { id: true, name: true, code: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.contract.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          endDate: { gte: now, lte: in60 },
        }),
        select: {
          id: true,
          title: true,
          endDate: true,
          counterpartyName: true,
          contractType: true,
        },
        orderBy: { endDate: 'asc' },
        take: 10,
      }),
      this.prisma.loan.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: 'ACTIVE',
          maturityDate: { gte: now, lte: in60 },
        }),
        select: {
          id: true,
          lenderName: true,
          maturityDate: true,
          outstandingBalance: true,
          currency: true,
        },
        orderBy: { maturityDate: 'asc' },
        take: 10,
      }),
      this.prisma.document.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { not: 'ARCHIVED' },
          expiryDate: { gte: now, lte: in60 },
        }),
        select: { id: true, title: true, category: true, expiryDate: true },
        orderBy: { expiryDate: 'asc' },
        take: 10,
      }),
      this.prisma.loan.findMany({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE', riskLevel: 'HIGH' }),
        select: {
          id: true,
          lenderName: true,
          riskLevel: true,
          outstandingBalance: true,
          currency: true,
          maturityDate: true,
        },
        orderBy: { outstandingBalance: 'desc' },
        take: 5,
      }),

      // Finance
      this.prisma.receivable.count({ where: openReceivableWhere }),
      this.prisma.receivable.aggregate({
        where: openReceivableWhere,
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: ReceivableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
      }),
      this.prisma.receivable.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: ReceivableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: ReceivableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
        select: {
          id: true,
          receivableNumber: true,
          customerName: true,
          outstandingAmount: true,
          dueDate: true,
          status: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 6,
      }),
      this.prisma.payable.count({ where: openPayableWhere }),
      this.prisma.payable.aggregate({
        where: openPayableWhere,
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: PayableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
      }),
      this.prisma.payable.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: PayableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          outstandingAmount: { gt: 0 },
          OR: [{ status: PayableStatus.OVERDUE }, { dueDate: { lt: today } }],
        }),
        select: {
          id: true,
          payableNumber: true,
          supplierName: true,
          outstandingAmount: true,
          dueDate: true,
          status: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 6,
      }),
      this.prisma.cashAccount.count({
        where: scopedWhere(scope, { deletedAt: null, isActive: true }),
      }),
      this.prisma.cashAccount.aggregate({
        where: scopedWhere(scope, { deletedAt: null, isActive: true }),
        _sum: { currentBalance: true },
      }),
      this.prisma.expense.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [ExpenseStatus.DRAFT, ExpenseStatus.PENDING_APPROVAL, ExpenseStatus.APPROVED] },
        }),
      }),
      this.prisma.expense.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: ExpenseStatus.PAID,
          expenseDate: { gte: monthStart },
        }),
        _sum: { amount: true },
      }),

      // Operations
      this.prisma.salesOrder.count({ where: activeSalesWhere }),
      this.prisma.salesOrder.count({
        where: scopedWhere(scope, { deletedAt: null, status: SalesOrderStatus.DRAFT }),
      }),
      this.prisma.salesOrder.count({
        where: scopedWhere(scope, { deletedAt: null, status: SalesOrderStatus.CONFIRMED }),
      }),
      this.prisma.salesOrder.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { notIn: [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED] },
          paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID] },
        }),
      }),
      this.prisma.salesOrder.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          orderDate: { gte: today },
          status: { notIn: [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED] },
        }),
      }),
      this.prisma.salesOrder.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          orderDate: { gte: today },
          status: { notIn: [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED] },
        }),
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          orderDate: { gte: monthStart },
          status: { notIn: [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED] },
        }),
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.findMany({
        where: activeSalesWhere,
        select: {
          id: true,
          salesOrderNumber: true,
          customerName: true,
          totalAmount: true,
          outstandingAmount: true,
          status: true,
          paymentStatus: true,
          orderDate: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.purchaseOrder.count({ where: activePurchaseWhere }),
      this.prisma.purchaseOrder.count({
        where: scopedWhere(scope, { deletedAt: null, status: PurchaseOrderStatus.DRAFT }),
      }),
      this.prisma.purchaseOrder.count({
        where: scopedWhere(scope, { deletedAt: null, status: PurchaseOrderStatus.CONFIRMED }),
      }),
      this.prisma.purchaseOrder.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        }),
      }),
      this.prisma.purchaseOrder.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { notIn: [PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.VOIDED] },
          paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID] },
        }),
        _sum: { outstandingAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          orderDate: { gte: monthStart },
          status: { notIn: [PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.VOIDED] },
        }),
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: activePurchaseWhere,
        select: {
          id: true,
          purchaseOrderNumber: true,
          supplierName: true,
          totalAmount: true,
          outstandingAmount: true,
          status: true,
          paymentStatus: true,
          orderDate: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.product.count({
        where: scopedWhere(scope, { deletedAt: null, status: 'ACTIVE' }),
      }),
      this.prisma.inventoryBalance.count({ where: scopedWhere(scope, {}) }),
      this.prisma.inventoryBalance.aggregate({
        where: scopedWhere(scope, {}),
        _sum: { totalValue: true, quantityOnHand: true },
      }),
      this.prisma.inventoryBalance.count({
        where: scopedWhere(scope, { quantityOnHand: { lte: 0 } }),
      }),
      this.prisma.inventoryBalance.count({
        where: scopedWhere(scope, { quantityOnHand: { lt: 0 } }),
      }),
      this.prisma.inventoryBalance.findMany({
        where: scopedWhere(scope, { quantityOnHand: { lt: 0 } }),
        select: {
          id: true,
          quantityOnHand: true,
          totalValue: true,
          product: { select: { id: true, name: true, productCode: true } },
          branch: { select: { name: true, code: true } },
        },
        orderBy: { quantityOnHand: 'asc' },
        take: 6,
      }),
      this.prisma.stockAdjustment.count({
        where: scopedWhere(scope, { deletedAt: null, status: StockAdjustmentStatus.DRAFT }),
      }),
      this.prisma.stockAdjustment.count({
        where: scopedWhere(scope, { deletedAt: null, status: StockAdjustmentStatus.PENDING_APPROVAL }),
      }),
      this.prisma.stockAdjustment.count({
        where: scopedWhere(scope, { deletedAt: null, status: StockAdjustmentStatus.APPROVED }),
      }),
      this.prisma.stockAdjustment.count({
        where: scopedWhere(scope, { deletedAt: null, status: StockAdjustmentStatus.POSTED }),
      }),
      this.prisma.stockAdjustment.findMany({
        where: scopedWhere(scope, { deletedAt: null, status: StockAdjustmentStatus.APPROVED }),
        select: {
          id: true,
          adjustmentNumber: true,
          reason: true,
          createdAt: true,
          branch: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),

      // Workflow / people / procurement
      this.prisma.approvalRequest.count({
        where: scopedWhere(scope, { deletedAt: null, status: ApprovalRequestStatus.PENDING }),
      }),
      this.prisma.approvalRequest.count({
        where: scopedWhere(scope, { deletedAt: null, status: ApprovalRequestStatus.ESCALATED }),
      }),
      this.prisma.approvalRequest.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [ApprovalRequestStatus.PENDING, ApprovalRequestStatus.ESCALATED] },
          dueAt: { gte: now, lte: in30 },
        }),
      }),
      this.prisma.approvalRequest.findMany({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [ApprovalRequestStatus.PENDING, ApprovalRequestStatus.ESCALATED] },
        }),
        select: {
          id: true,
          approvalRequestNumber: true,
          requestTitle: true,
          entityType: true,
          amount: true,
          currency: true,
          riskLevel: true,
          dueAt: true,
          status: true,
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: 6,
      }),
      this.prisma.employee.count({
        where: scopedWhere(scope, { deletedAt: null, employmentStatus: EmploymentStatus.ACTIVE }),
      }),
      this.prisma.employee.count({
        where: scopedWhere(scope, { deletedAt: null, employmentStatus: EmploymentStatus.ON_LEAVE }),
      }),
      this.prisma.employee.count({
        where: scopedWhere(scope, { deletedAt: null, employmentStatus: EmploymentStatus.SUSPENDED }),
      }),
      this.prisma.purchaseRequisition.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [RequisitionStatus.SUBMITTED, RequisitionStatus.DRAFT] },
        }),
      }),
      this.prisma.purchaseRequisition.count({
        where: scopedWhere(scope, { deletedAt: null, status: RequisitionStatus.APPROVED }),
      }),
      this.prisma.requestForQuotation.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [RFQStatus.SENT, RFQStatus.RESPONSES_RECEIVED, RFQStatus.EVALUATED] },
        }),
      }),
      this.prisma.supplierInvoice.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { in: [SupplierInvoiceStatus.RECEIVED, SupplierInvoiceStatus.MATCHED, SupplierInvoiceStatus.APPROVED] },
        }),
      }),
      this.prisma.supplierInvoice.count({
        where: scopedWhere(scope, { deletedAt: null, status: SupplierInvoiceStatus.DISPUTED }),
      }),
      this.prisma.supplierInvoice.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: {
            in: [
              SupplierInvoiceStatus.RECEIVED,
              SupplierInvoiceStatus.MATCHED,
              SupplierInvoiceStatus.APPROVED,
              SupplierInvoiceStatus.PARTIALLY_PAID,
              SupplierInvoiceStatus.DISPUTED,
            ],
          },
        }),
        _sum: { outstandingAmount: true },
      }),

      // Compliance / petroleum
      this.prisma.complianceObligation.count({
        where: scopedWhere(scope, { deletedAt: null, status: ComplianceObligationStatus.OVERDUE }),
      }),
      this.prisma.complianceObligation.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: {
            in: [ComplianceObligationStatus.UPCOMING, ComplianceObligationStatus.IN_PROGRESS],
          },
          dueDate: { gte: now, lte: in30 },
        }),
      }),
      this.prisma.taxReturn.count({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: {
            in: [
              TaxReturnStatus.DRAFT,
              TaxReturnStatus.PREPARED,
              TaxReturnStatus.REVIEWED,
              TaxReturnStatus.APPROVED,
              TaxReturnStatus.SUBMITTED,
            ],
          },
        }),
      }),
      this.prisma.taxReturn.aggregate({
        where: scopedWhere(scope, {
          deletedAt: null,
          status: { notIn: [TaxReturnStatus.PAID, TaxReturnStatus.CLOSED, TaxReturnStatus.CANCELLED] },
          outstandingAmount: { gt: 0 },
        }),
        _sum: { outstandingAmount: true },
      }),
      this.prisma.fuelShift.count({
        where: scopedWhere(scope, { deletedAt: null, status: FuelShiftStatus.OPEN }),
      }),
      this.prisma.fuelNozzleReading.aggregate({
        where: scopedWhere(scope, {
          createdAt: { gte: today },
          status: { not: FuelNozzleReadingStatus.VOIDED },
        }),
        _sum: { litresSold: true, expectedAmount: true },
      }),
      this.prisma.fuelShiftCollection.aggregate({
        where: scopedWhere(scope, { createdAt: { gte: today } }),
        _sum: { amount: true },
      }),
    ]);

    const daysUntil = (d: Date | null) => {
      if (!d) return null;
      return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
    };

    const finance = {
      receivables: {
        open: openReceivables,
        outstanding: sum(receivableOutstanding, 'outstandingAmount'),
        overdue: overdueReceivables,
        overdueOutstanding: sum(overdueReceivableOutstanding, 'outstandingAmount'),
      },
      payables: {
        open: openPayables,
        outstanding: sum(payableOutstanding, 'outstandingAmount'),
        overdue: overduePayables,
        overdueOutstanding: sum(overduePayableOutstanding, 'outstandingAmount'),
      },
      cashAccounts: {
        active: activeCashAccounts,
        balance: sum(cashAccountBalance, 'currentBalance'),
      },
      expenses: {
        pending: pendingExpenses,
        paidThisMonth: sum(paidExpensesThisMonth, 'amount'),
      },
    };

    const operations = {
      salesOrders: {
        total: salesOrderTotal,
        draft: draftSalesOrders,
        confirmed: confirmedSalesOrders,
        unpaid: unpaidSalesOrders,
        todayCount: salesOrdersToday,
        todayRevenue: sum(salesTodayTotal, 'totalAmount'),
        monthRevenue: sum(salesMonthTotal, 'totalAmount'),
      },
      purchaseOrders: {
        total: purchaseOrderTotal,
        draft: draftPurchaseOrders,
        confirmed: confirmedPurchaseOrders,
        received: receivedPurchaseOrders,
        outstanding: sum(purchaseOrdersOutstanding, 'outstandingAmount'),
        monthSpend: sum(purchasesMonthTotal, 'totalAmount'),
      },
      inventory: {
        activeProducts: productCount,
        balanceRows: inventoryBalanceCount,
        quantityOnHand: sum(inventoryTotalValue, 'quantityOnHand'),
        stockValue: sum(inventoryTotalValue, 'totalValue'),
        zeroOrBelow: zeroStockBalances,
        negative: negativeStockBalances,
      },
      stockAdjustments: {
        draft: stockAdjustmentDraft,
        pending: stockAdjustmentPending,
        approvedUnposted: stockAdjustmentApproved,
        posted: stockAdjustmentPosted,
      },
    };

    const workflow = {
      approvals: {
        pending: pendingApprovals,
        escalated: escalatedApprovals,
        dueSoon: approvalsDueSoon,
      },
    };

    const procurement = {
      requisitions: {
        pending: pendingRequisitions,
        approved: approvedRequisitions,
      },
      rfqs: { active: activeRfqs },
      supplierInvoices: {
        pending: supplierInvoicesPending,
        disputed: supplierInvoicesDisputed,
        outstanding: sum(supplierInvoicesOutstanding, 'outstandingAmount'),
      },
    };

    const people = {
      employees: {
        active: activeEmployees,
        onLeave: employeesOnLeave,
        suspended: employeesSuspended,
      },
    };

    const compliance = {
      obligations: {
        overdue: overdueCompliance,
        dueSoon: complianceDueSoon,
      },
      taxReturns: {
        pending: pendingTaxReturns,
        outstanding: sum(taxReturnsOutstanding, 'outstandingAmount'),
      },
    };

    const petroleum = {
      openShifts: openFuelShifts,
      litresSoldToday: sum(fuelExpectedToday, 'litresSold'),
      expectedCollectionsToday: sum(fuelExpectedToday, 'expectedAmount'),
      recordedCollectionsToday: sum(fuelCollectionsToday, 'amount'),
      varianceToday:
        sum(fuelCollectionsToday, 'amount') - sum(fuelExpectedToday, 'expectedAmount'),
    };

    return {
      generatedAt: now,
      overview: {
        companies: companyCount,
        divisions: divisionCount,
        branches: branchCount,
        activeUsers: activeUserCount,
      },
      finance,
      operations,
      procurement,
      workflow,
      people,
      compliance,
      petroleum,
      exceptions: [
        ...receivableExceptions.map((r) => ({
          id: `receivable-${r.id}`,
          type: 'Receivable',
          severity: 'HIGH',
          title: `${r.customerName} is overdue`,
          description: `${r.receivableNumber} has TZS ${money(r.outstandingAmount)} outstanding`,
          dueDate: r.dueDate,
          href: `/finance/receivables?search=${encodeURIComponent(r.receivableNumber)}`,
        })),
        ...payableExceptions.map((p) => ({
          id: `payable-${p.id}`,
          type: 'Payable',
          severity: 'HIGH',
          title: `${p.supplierName} is overdue`,
          description: `${p.payableNumber} has TZS ${money(p.outstandingAmount)} outstanding`,
          dueDate: p.dueDate,
          href: `/finance/payables?search=${encodeURIComponent(p.payableNumber)}`,
        })),
        ...negativeStockItems.map((b) => ({
          id: `stock-${b.id}`,
          type: 'Inventory',
          severity: 'CRITICAL',
          title: `${b.product.productCode} has negative stock`,
          description: `${b.product.name} at ${b.branch?.code ?? 'unassigned'} is ${Number(b.quantityOnHand).toLocaleString()} units`,
          dueDate: null,
          href: `/operations/products?search=${encodeURIComponent(b.product.productCode)}`,
        })),
        ...unpostedAdjustments.map((a) => ({
          id: `adjustment-${a.id}`,
          type: 'Stock adjustment',
          severity: 'NORMAL',
          title: `${a.adjustmentNumber} is approved but not posted`,
          description: `${a.branch?.code ?? 'All branches'} · ${a.reason}`,
          dueDate: a.createdAt,
          href: '/operations/stock-adjustments',
        })),
        ...approvalExceptions.map((a) => ({
          id: `approval-${a.id}`,
          type: 'Approval',
          severity: a.status === ApprovalRequestStatus.ESCALATED ? 'CRITICAL' : 'NORMAL',
          title: a.requestTitle,
          description: `${a.entityType.replace(/_/g, ' ')} · ${a.approvalRequestNumber}`,
          dueDate: a.dueAt,
          href: '/approvals/requests',
        })),
      ].slice(0, 18),
      recentTransactions: {
        salesOrders: recentSalesOrders,
        purchaseOrders: recentPurchaseOrders,
      },
      groupControl: {
        bankAccounts: { total: bankAccountTotal, active: bankAccountActive },
        loans: {
          active: activeLoans,
          outstanding: sum(activeLoansBalance, 'outstandingBalance'),
          overdue: overdueLoans,
        },
        debts: {
          outstanding: outstandingDebts,
          totalAmount: sum(outstandingDebtTotal, 'amount'),
        },
        contracts: {
          active: activeContracts,
          expiringIn30,
          expiringIn60,
          pendingApproval: pendingApprovalContracts,
        },
        fixedAssets: {
          total: activeAssets,
          totalValue: sum(assetTotalValue, 'currentBookValue'),
          collateral: assetsAsCollateral,
          uninsured: uninsuredAssets,
          disposed: disposedAssets,
        },
        documents: {
          total: totalDocuments,
          sensitive: sensitiveDocuments,
          expiring: expiringDocuments,
        },
        audit: {
          events24h: auditLogs24h,
          critical24h: criticalAudit24h,
        },
      },
      companies,
      alerts: {
        expiringContracts: alertContracts.map((c) => ({
          ...c,
          daysLeft: daysUntil(c.endDate ? new Date(c.endDate) : null),
        })),
        upcomingMaturities: alertLoans,
        expiringDocuments: alertDocuments.map((d) => ({
          ...d,
          daysLeft: daysUntil(d.expiryDate ? new Date(d.expiryDate) : null),
        })),
        highRiskLoans: alertHighRiskLoans,
      },
      recentActivity,
    };
  }
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-TZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function sum(aggregate: { _sum?: Record<string, unknown> }, field: string) {
  return Number(aggregate._sum?.[field] ?? 0);
}

function scopedWhere(scope: CompanyScopedWhere, where: Record<string, unknown> = {}) {
  return { ...where, ...scope };
}

function companyEntityWhere(scope: CompanyScopedWhere, where: Record<string, unknown> = {}) {
  if (scope.companyId !== undefined) {
    return { ...where, id: scope.companyId };
  }
  return scopedWhere(scope, where);
}

function branchEntityWhere(scope: CompanyScopedWhere, where: Record<string, unknown> = {}) {
  if (scope.companyId !== undefined) {
    return { ...where, division: { companyId: scope.companyId } };
  }
  return scopedWhere(scope, where);
}
