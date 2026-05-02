import { Injectable } from '@nestjs/common';
import {
  GRNStatus,
  PurchaseOrderStatus,
  RequisitionStatus,
  RFQStatus,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const where: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };

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
        where: { ...where, status: { in: ['APPROVED', 'ACTIVE'] } },
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
          matchStatus: { in: ['PARTIAL_MATCH', 'VARIANCE', 'FAILED'] },
        },
      }),
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
