import { Injectable } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getExecutiveSummary() {
    const now = new Date();
    const in30 = new Date(now); in30.setDate(now.getDate() + 30);
    const in60 = new Date(now); in60.setDate(now.getDate() + 60);
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);

    const [
      // ── Overview ──────────────────────────────────────────────────────
      companyCount,
      divisionCount,
      branchCount,
      activeUserCount,

      // ── Bank accounts ─────────────────────────────────────────────────
      bankAccountTotal,
      bankAccountActive,

      // ── Loans ─────────────────────────────────────────────────────────
      activeLoans,
      activeLoansBalance,
      overdueLoans,

      // ── Debts ─────────────────────────────────────────────────────────
      outstandingDebts,
      outstandingDebtTotal,

      // ── Contracts ─────────────────────────────────────────────────────
      activeContracts,
      expiringIn30,
      expiringIn60,
      pendingApprovalContracts,

      // ── Fixed assets ──────────────────────────────────────────────────
      activeAssets,
      assetTotalValue,
      assetsAsCollateral,
      uninsuredAssets,
      disposedAssets,

      // ── Documents ─────────────────────────────────────────────────────
      totalDocuments,
      sensitiveDocuments,
      expiringDocuments,

      // ── Audit ─────────────────────────────────────────────────────────
      auditLogs24h,
      criticalAudit24h,
      recentActivity,

      // ── Companies (with divisions) ────────────────────────────────────
      companies,

      // ── Alerts ────────────────────────────────────────────────────────
      alertContracts,
      alertLoans,
      alertDocuments,
      alertHighRiskLoans,
    ] = await Promise.all([
      // Overview
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.division.count({ where: { deletedAt: null } }),
      this.prisma.branch.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),

      // Bank accounts
      this.prisma.bankAccount.count({ where: { deletedAt: null } }),
      this.prisma.bankAccount.count({ where: { deletedAt: null, isActive: true } }),

      // Loans
      this.prisma.loan.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.loan.aggregate({
        where: { deletedAt: null, status: 'ACTIVE' },
        _sum: { outstandingBalance: true },
      }),
      this.prisma.loan.count({
        where: { deletedAt: null, status: 'ACTIVE', maturityDate: { lt: now } },
      }),

      // Debts
      this.prisma.debt.count({ where: { deletedAt: null, status: 'OUTSTANDING' } }),
      this.prisma.debt.aggregate({
        where: { deletedAt: null, status: 'OUTSTANDING' },
        _sum: { amount: true },
      }),

      // Contracts
      this.prisma.contract.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.contract.count({
        where: { deletedAt: null, status: 'ACTIVE', endDate: { gte: now, lte: in30 } },
      }),
      this.prisma.contract.count({
        where: { deletedAt: null, status: 'ACTIVE', endDate: { gte: now, lte: in60 } },
      }),
      this.prisma.contract.count({ where: { deletedAt: null, status: 'PENDING_APPROVAL' } }),

      // Fixed assets
      this.prisma.fixedAsset.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.fixedAsset.aggregate({
        where: { deletedAt: null, status: 'ACTIVE' },
        _sum: { currentBookValue: true },
      }),
      this.prisma.fixedAsset.count({
        where: { deletedAt: null, collateralStatus: 'USED_AS_COLLATERAL' },
      }),
      this.prisma.fixedAsset.count({
        where: { deletedAt: null, status: 'ACTIVE', insuranceStatus: 'NOT_INSURED' },
      }),
      this.prisma.fixedAsset.count({
        where: { deletedAt: null, status: 'DISPOSED' },
      }),

      // Documents
      this.prisma.document.count({ where: { deletedAt: null } }),
      this.prisma.document.count({ where: { deletedAt: null, isConfidential: true } }),
      this.prisma.document.count({
        where: {
          deletedAt: null,
          expiryDate: { gte: now, lte: in60 },
          status: { not: 'ARCHIVED' },
        },
      }),

      // Audit logs
      this.prisma.auditLog.count({ where: { createdAt: { gte: yesterday } } }),
      this.prisma.auditLog.count({
        where: { createdAt: { gte: yesterday }, severity: AuditSeverity.CRITICAL },
      }),
      this.prisma.auditLog.findMany({
        where: { severity: { in: [AuditSeverity.CRITICAL, AuditSeverity.HIGH] } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          company: { select: { id: true, name: true, code: true } },
        },
      }),

      // Companies with divisions
      this.prisma.company.findMany({
        where: { deletedAt: null },
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

      // Alerts: contracts expiring in 60 days
      this.prisma.contract.findMany({
        where: { deletedAt: null, status: 'ACTIVE', endDate: { gte: now, lte: in60 } },
        select: { id: true, title: true, endDate: true, counterpartyName: true, contractType: true },
        orderBy: { endDate: 'asc' },
        take: 10,
      }),

      // Alerts: loans maturing within 60 days
      this.prisma.loan.findMany({
        where: { deletedAt: null, status: 'ACTIVE', maturityDate: { gte: now, lte: in60 } },
        select: {
          id: true, lenderName: true, maturityDate: true,
          outstandingBalance: true, currency: true,
        },
        orderBy: { maturityDate: 'asc' },
        take: 10,
      }),

      // Alerts: expiring documents in 60 days
      this.prisma.document.findMany({
        where: {
          deletedAt: null, status: { not: 'ARCHIVED' },
          expiryDate: { gte: now, lte: in60 },
        },
        select: { id: true, title: true, category: true, expiryDate: true },
        orderBy: { expiryDate: 'asc' },
        take: 10,
      }),

      // Alerts: high-risk loans
      this.prisma.loan.findMany({
        where: { deletedAt: null, status: 'ACTIVE', riskLevel: 'HIGH' },
        select: {
          id: true, lenderName: true, riskLevel: true,
          outstandingBalance: true, currency: true, maturityDate: true,
        },
        orderBy: { outstandingBalance: 'desc' },
        take: 5,
      }),
    ]);

    const daysUntil = (d: Date | null) => {
      if (!d) return null;
      return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
    };

    return {
      overview: {
        companies: companyCount,
        divisions: divisionCount,
        branches: branchCount,
        activeUsers: activeUserCount,
      },
      groupControl: {
        bankAccounts: { total: bankAccountTotal, active: bankAccountActive },
        loans: {
          active: activeLoans,
          outstanding: Number(activeLoansBalance._sum.outstandingBalance ?? 0),
          overdue: overdueLoans,
        },
        debts: {
          outstanding: outstandingDebts,
          totalAmount: Number(outstandingDebtTotal._sum.amount ?? 0),
        },
        contracts: {
          active: activeContracts,
          expiringIn30,
          expiringIn60,
          pendingApproval: pendingApprovalContracts,
        },
        fixedAssets: {
          total: activeAssets,
          totalValue: Number(assetTotalValue._sum.currentBookValue ?? 0),
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
        expiringContracts: alertContracts.map(c => ({
          ...c,
          daysLeft: daysUntil(c.endDate ? new Date(c.endDate) : null),
        })),
        upcomingMaturities: alertLoans,
        expiringDocuments: alertDocuments.map(d => ({
          ...d,
          daysLeft: daysUntil(d.expiryDate ? new Date(d.expiryDate) : null),
        })),
        highRiskLoans: alertHighRiskLoans,
      },
      recentActivity,
    };
  }
}
