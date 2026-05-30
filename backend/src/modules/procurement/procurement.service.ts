import { Injectable } from '@nestjs/common';
import {
  BidComparisonStatus,
  GRNStatus,
  ProcurementPlanStatus,
  PurchaseOrderStatus,
  RequisitionStatus,
  RFQStatus,
  SupplierInvoiceStatus,
  SupplierQuotationStatus,
  SupplierStatus,
  ThreeWayMatchStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;
type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface ProcurementReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const where = await this.procurementWhere(user, companyId);

    const todayStart = startOfDay(new Date());

    const [
      openRequisitions,
      urgentRequisitions,
      overdueRequisitions,
      pendingRfqs,
      overdueRfqs,
      openPurchaseOrders,
      overduePurchaseOrders,
      pendingGrns,
      pendingInvoices,
      disputedInvoices,
      activeProcurementPlans,
      requisitionPipeline,
      purchaseOrderPipeline,
      invoicePipeline,
      requisitionStatusRows,
      requisitionPriorityRows,
      rfqStatusRows,
      purchaseOrderStatusRows,
      grnStatusRows,
      supplierInvoiceStatusRows,
      recentRequisitions,
      recentRfqs,
      recentPurchaseOrders,
      recentGrns,
      recentSupplierInvoices,
      threeWayMatchVariances,
      readiness,
    ] = await Promise.all([
      this.prisma.purchaseRequisition.count({
        where: {
          ...where,
          status: { in: [RequisitionStatus.DRAFT, RequisitionStatus.SUBMITTED] },
        },
      }),
      this.prisma.purchaseRequisition.count({
        where: {
          ...where,
          priority: 'URGENT',
          status: { in: [RequisitionStatus.DRAFT, RequisitionStatus.SUBMITTED] },
        },
      }),
      this.prisma.purchaseRequisition.count({
        where: {
          ...where,
          neededByDate: { lt: todayStart },
          status: { in: [RequisitionStatus.DRAFT, RequisitionStatus.SUBMITTED] },
        },
      }),
      this.prisma.requestForQuotation.count({
        where: { ...where, status: { in: [RFQStatus.DRAFT, RFQStatus.SENT] } },
      }),
      this.prisma.requestForQuotation.count({
        where: {
          ...where,
          closingDate: { lt: todayStart },
          status: { in: [RFQStatus.DRAFT, RFQStatus.SENT] },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...where,
          status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...where,
          expectedDate: { lt: todayStart },
          status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.goodsReceivedNote.count({
        where: {
          ...where,
          status: { in: [GRNStatus.DRAFT, GRNStatus.RECEIVED, GRNStatus.INSPECTED] },
        },
      }),
      this.prisma.supplierInvoice.count({
        where: {
          ...where,
          status: {
            in: [
              SupplierInvoiceStatus.DRAFT,
              SupplierInvoiceStatus.RECEIVED,
              SupplierInvoiceStatus.MATCHED,
              SupplierInvoiceStatus.APPROVED,
            ],
          },
        },
      }),
      this.prisma.supplierInvoice.count({
        where: { ...where, status: SupplierInvoiceStatus.DISPUTED },
      }),
      this.prisma.procurementPlan.count({
        where: {
          ...where,
          status: { in: [ProcurementPlanStatus.APPROVED, ProcurementPlanStatus.ACTIVE] },
        },
      }),
      this.prisma.purchaseRequisition.aggregate({
        where: {
          ...where,
          status: { in: [RequisitionStatus.SUBMITTED, RequisitionStatus.APPROVED] },
        },
        _sum: { totalEstimatedAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          ...where,
          status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
        _sum: { totalAmount: true, outstandingAmount: true },
      }),
      this.prisma.supplierInvoice.aggregate({
        where: {
          ...where,
          status: {
            in: [
              SupplierInvoiceStatus.APPROVED,
              SupplierInvoiceStatus.PARTIALLY_PAID,
              SupplierInvoiceStatus.DISPUTED,
            ],
          },
        },
        _sum: { totalAmount: true, outstandingAmount: true },
      }),
      this.prisma.purchaseRequisition.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.purchaseRequisition.groupBy({
        by: ['priority'],
        where,
        _count: { _all: true },
      }),
      this.prisma.requestForQuotation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.goodsReceivedNote.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.supplierInvoice.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.purchaseRequisition.findMany({
        where,
        select: {
          id: true,
          requisitionNumber: true,
          purpose: true,
          priority: true,
          status: true,
          neededByDate: true,
          totalEstimatedAmount: true,
          requestDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.requestForQuotation.findMany({
        where,
        select: {
          id: true,
          rfqNumber: true,
          title: true,
          status: true,
          closingDate: true,
          rfqDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          purchaseOrderNumber: true,
          supplierName: true,
          supplierId: true,
          status: true,
          totalAmount: true,
          outstandingAmount: true,
          orderDate: true,
          expectedDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.goodsReceivedNote.findMany({
        where,
        select: {
          id: true,
          grnNumber: true,
          supplierId: true,
          status: true,
          receivedDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.supplierInvoice.findMany({
        where,
        select: {
          id: true,
          supplierInvoiceNumber: true,
          supplierId: true,
          invoiceReference: true,
          status: true,
          totalAmount: true,
          outstandingAmount: true,
          invoiceDate: true,
          dueDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.threeWayMatch.count({
        where: {
          ...where,
          matchStatus: {
            in: [
              ThreeWayMatchStatus.PARTIAL_MATCH,
              ThreeWayMatchStatus.VARIANCE,
              ThreeWayMatchStatus.FAILED,
            ],
          },
        },
      }),
      this.getReadiness(query, user),
    ]);

    return {
      openRequisitions,
      pendingRfqs,
      pendingGrns,
      pendingInvoices,
      requisitions: {
        open: openRequisitions,
        urgent: urgentRequisitions,
        overdue: overdueRequisitions,
        pipelineAmount: toNumber(requisitionPipeline._sum.totalEstimatedAmount),
      },
      rfqs: {
        pending: pendingRfqs,
        overdue: overdueRfqs,
      },
      purchaseOrders: {
        open: openPurchaseOrders,
        overdue: overduePurchaseOrders,
        committedAmount: toNumber(purchaseOrderPipeline._sum.totalAmount),
        outstandingAmount: toNumber(purchaseOrderPipeline._sum.outstandingAmount),
      },
      receiving: {
        pendingGrns,
        threeWayMatchVariances,
      },
      invoices: {
        pending: pendingInvoices,
        disputed: disputedInvoices,
        approvedOrDisputedAmount: toNumber(invoicePipeline._sum.totalAmount),
        outstandingAmount: toNumber(invoicePipeline._sum.outstandingAmount),
      },
      activeProcurementPlans,
      requisitionStatusBreakdown: countBy(requisitionStatusRows as GroupCount[], 'status'),
      requisitionPriorityBreakdown: countBy(requisitionPriorityRows as GroupCount[], 'priority'),
      rfqStatusBreakdown: countBy(rfqStatusRows as GroupCount[], 'status'),
      purchaseOrderStatusBreakdown: countBy(purchaseOrderStatusRows as GroupCount[], 'status'),
      grnStatusBreakdown: countBy(grnStatusRows as GroupCount[], 'status'),
      supplierInvoiceStatusBreakdown: countBy(supplierInvoiceStatusRows as GroupCount[], 'status'),
      recentRequisitions,
      recentRfqs,
      recentPurchaseOrders,
      recentGrns,
      recentSupplierInvoices,
      readiness,
    };
  }

  async getReadiness(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const where = await this.procurementWhere(user, companyId);
    const todayStart = startOfDay(new Date());

    const [
      activeSuppliers,
      activeProcurementPlans,
      draftProcurementPlans,
      openRequisitions,
      overdueSubmittedRequisitions,
      invalidRequisitionLines,
      pendingRfqs,
      overdueRfqs,
      supplierQuotationsInPlay,
      bidComparisonsAwaitingApproval,
      openPurchaseOrders,
      overduePurchaseOrders,
      pendingGrns,
      approvedUnpostedGrns,
      pendingInvoices,
      disputedInvoices,
      threeWayMatchVariances,
      approvedInvoicesMissingPayable,
    ] = await Promise.all([
      this.prisma.supplier.count({
        where: { ...where, status: SupplierStatus.ACTIVE },
      }),
      this.prisma.procurementPlan.count({
        where: {
          ...where,
          status: { in: [ProcurementPlanStatus.APPROVED, ProcurementPlanStatus.ACTIVE] },
        },
      }),
      this.prisma.procurementPlan.count({
        where: {
          ...where,
          status: { in: [ProcurementPlanStatus.DRAFT, ProcurementPlanStatus.SUBMITTED] },
        },
      }),
      this.prisma.purchaseRequisition.count({
        where: {
          ...where,
          status: { in: [RequisitionStatus.DRAFT, RequisitionStatus.SUBMITTED] },
        },
      }),
      this.prisma.purchaseRequisition.count({
        where: {
          ...where,
          neededByDate: { lt: todayStart },
          status: RequisitionStatus.SUBMITTED,
        },
      }),
      this.prisma.purchaseRequisitionLine.count({
        where: {
          purchaseRequisition: where,
          OR: [{ quantity: { lte: 0 } }, { description: '' }],
        },
      }),
      this.prisma.requestForQuotation.count({
        where: { ...where, status: { in: [RFQStatus.DRAFT, RFQStatus.SENT] } },
      }),
      this.prisma.requestForQuotation.count({
        where: {
          ...where,
          closingDate: { lt: todayStart },
          status: { in: [RFQStatus.DRAFT, RFQStatus.SENT] },
        },
      }),
      this.prisma.supplierQuotation.count({
        where: {
          ...where,
          status: {
            in: [
              SupplierQuotationStatus.RECEIVED,
              SupplierQuotationStatus.EVALUATED,
              SupplierQuotationStatus.ACCEPTED,
            ],
          },
        },
      }),
      this.prisma.bidComparison.count({
        where: {
          ...where,
          status: { in: [BidComparisonStatus.DRAFT, BidComparisonStatus.REVIEWED] },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...where,
          status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...where,
          expectedDate: { lt: todayStart },
          status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      }),
      this.prisma.goodsReceivedNote.count({
        where: {
          ...where,
          status: { in: [GRNStatus.DRAFT, GRNStatus.RECEIVED, GRNStatus.INSPECTED] },
        },
      }),
      this.prisma.goodsReceivedNote.count({
        where: { ...where, status: GRNStatus.APPROVED, postedAt: null },
      }),
      this.prisma.supplierInvoice.count({
        where: {
          ...where,
          status: {
            in: [
              SupplierInvoiceStatus.DRAFT,
              SupplierInvoiceStatus.RECEIVED,
              SupplierInvoiceStatus.MATCHED,
              SupplierInvoiceStatus.APPROVED,
            ],
          },
        },
      }),
      this.prisma.supplierInvoice.count({
        where: { ...where, status: SupplierInvoiceStatus.DISPUTED },
      }),
      this.prisma.threeWayMatch.count({
        where: {
          ...where,
          matchStatus: {
            in: [
              ThreeWayMatchStatus.PARTIAL_MATCH,
              ThreeWayMatchStatus.VARIANCE,
              ThreeWayMatchStatus.FAILED,
            ],
          },
        },
      }),
      this.prisma.supplierInvoice.count({
        where: {
          ...where,
          payableId: null,
          status: {
            in: [
              SupplierInvoiceStatus.APPROVED,
              SupplierInvoiceStatus.PARTIALLY_PAID,
              SupplierInvoiceStatus.PAID,
            ],
          },
        },
      }),
    ]);

    const checks: ProcurementReadinessCheck[] = [
      this.buildSupplierPlanCheck(activeSuppliers, activeProcurementPlans, draftProcurementPlans),
      this.buildRequisitionCheck(
        openRequisitions,
        overdueSubmittedRequisitions,
        invalidRequisitionLines,
      ),
      this.buildSourcingCheck(
        pendingRfqs,
        overdueRfqs,
        supplierQuotationsInPlay,
        bidComparisonsAwaitingApproval,
      ),
      this.buildReceivingCheck(
        openPurchaseOrders,
        overduePurchaseOrders,
        pendingGrns,
        approvedUnpostedGrns,
      ),
      this.buildInvoiceMatchingCheck(pendingInvoices, disputedInvoices, threeWayMatchVariances),
      this.buildFinanceBridgeCheck(approvedInvoicesMissingPayable),
    ];

    const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
    const status: ReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
      ? 'CRITICAL'
      : score >= 90
        ? 'READY'
        : 'WARNING';

    return {
      score,
      target: 90,
      status,
      maturity:
        status === 'READY'
          ? 'Production-ready procurement controls'
          : status === 'WARNING'
            ? 'Operational with procurement control warnings'
            : 'Procurement setup blockers require action',
      updatedAt: new Date().toISOString(),
      indicators: {
        activeSuppliers,
        activeProcurementPlans,
        draftProcurementPlans,
        openRequisitions,
        overdueSubmittedRequisitions,
        invalidRequisitionLines,
        pendingRfqs,
        overdueRfqs,
        supplierQuotationsInPlay,
        bidComparisonsAwaitingApproval,
        openPurchaseOrders,
        overduePurchaseOrders,
        pendingGrns,
        approvedUnpostedGrns,
        pendingInvoices,
        disputedInvoices,
        threeWayMatchVariances,
        approvedInvoicesMissingPayable,
      },
      checks,
    };
  }

  private async procurementWhere(user: AuthUser, companyId?: string) {
    return {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };
  }

  private buildSupplierPlanCheck(
    activeSuppliers: number,
    activeProcurementPlans: number,
    draftProcurementPlans: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus =
      activeSuppliers === 0 ? 'CRITICAL' : activeProcurementPlans === 0 ? 'WARNING' : 'READY';
    return {
      key: 'supplier-plan-foundation',
      title: 'Supplier and planning foundation',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'Active suppliers and approved/active procurement plans are available.'
          : status === 'WARNING'
            ? 'Suppliers exist, but procurement plans still need approval or activation.'
            : 'No active suppliers are available for procurement workflows.',
      details: { activeSuppliers, activeProcurementPlans, draftProcurementPlans },
    };
  }

  private buildRequisitionCheck(
    openRequisitions: number,
    overdueSubmittedRequisitions: number,
    invalidRequisitionLines: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus =
      invalidRequisitionLines > 0
        ? 'CRITICAL'
        : overdueSubmittedRequisitions > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'requisition-control',
      title: 'Requisition control',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 50,
      message:
        status === 'READY'
          ? 'Requisition backlog is clean and line validation is intact.'
          : status === 'WARNING'
            ? 'Submitted requisitions are past their needed-by date.'
            : 'Requisition lines with invalid quantity or description must be corrected.',
      details: { openRequisitions, overdueSubmittedRequisitions, invalidRequisitionLines },
    };
  }

  private buildSourcingCheck(
    pendingRfqs: number,
    overdueRfqs: number,
    supplierQuotationsInPlay: number,
    bidComparisonsAwaitingApproval: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus = overdueRfqs > 0 ? 'WARNING' : 'READY';
    return {
      key: 'sourcing-competition',
      title: 'RFQ, quotation, and bid comparison flow',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Sourcing flow is visible from RFQs through quotations and bid comparisons.'
          : 'Some open RFQs are past their closing date and need sourcing follow-up.',
      details: {
        pendingRfqs,
        overdueRfqs,
        supplierQuotationsInPlay,
        bidComparisonsAwaitingApproval,
      },
    };
  }

  private buildReceivingCheck(
    openPurchaseOrders: number,
    overduePurchaseOrders: number,
    pendingGrns: number,
    approvedUnpostedGrns: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus =
      approvedUnpostedGrns > 0 ? 'CRITICAL' : overduePurchaseOrders > 0 ? 'WARNING' : 'READY';
    return {
      key: 'po-receiving-control',
      title: 'Purchase order and receiving control',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 55,
      message:
        status === 'READY'
          ? 'Open purchase orders and receiving queues have no posting blockers.'
          : status === 'WARNING'
            ? 'Some confirmed purchase orders are overdue for expected receipt.'
            : 'Approved GRNs remain unposted and may block inventory/finance accuracy.',
      details: { openPurchaseOrders, overduePurchaseOrders, pendingGrns, approvedUnpostedGrns },
    };
  }

  private buildInvoiceMatchingCheck(
    pendingInvoices: number,
    disputedInvoices: number,
    threeWayMatchVariances: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus =
      disputedInvoices > 0 || threeWayMatchVariances > 0 ? 'WARNING' : 'READY';
    return {
      key: 'invoice-matching',
      title: 'Invoice and three-way matching',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Supplier invoices and three-way match controls have no active variances.'
          : 'Invoice disputes or three-way match variances need procurement/AP review.',
      details: { pendingInvoices, disputedInvoices, threeWayMatchVariances },
    };
  }

  private buildFinanceBridgeCheck(
    approvedInvoicesMissingPayable: number,
  ): ProcurementReadinessCheck {
    const status: ReadinessStatus = approvedInvoicesMissingPayable > 0 ? 'CRITICAL' : 'READY';
    return {
      key: 'finance-bridge',
      title: 'Payables finance bridge',
      status,
      score: status === 'READY' ? 100 : 45,
      message:
        status === 'READY'
          ? 'Approved supplier invoices are bridged cleanly into payables.'
          : 'Approved/paid supplier invoices exist without linked payables.',
      details: { approvedInvoicesMissingPayable },
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
