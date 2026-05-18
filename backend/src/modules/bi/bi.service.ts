import { Injectable } from '@nestjs/common';
import {
  ApprovalRequestStatus,
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
  InsightStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { pagination } from '../../common/utils/pagination';

@Injectable()
export class BiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getExecutiveSummary(user: any) {
    const [recentInsights, openIssues, pendingApprovals] = await Promise.all([
      this.prisma.executiveInsight.findMany({
        where: {
          status: InsightStatus.OPEN,
          deletedAt: null,
          ...(user.companyId ? { companyId: user.companyId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          status: {
            in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED],
          },
          severity: {
            in: [DataQualityIssueSeverity.HIGH, DataQualityIssueSeverity.CRITICAL],
          },
          ...(user.companyId ? { companyId: user.companyId } : {}),
        },
      }),
      this.prisma.approvalRequest.count({
        where: {
          status: ApprovalRequestStatus.PENDING,
          ...(user.companyId ? { companyId: user.companyId } : {}),
        },
      }),
    ]);
    return { recentInsights, openIssuesCount: openIssues, pendingApprovalsCount: pendingApprovals };
  }

  async getGroupSummary(user: any) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null, ...(user.companyId ? { id: user.companyId } : {}) },
      select: { id: true, name: true, code: true },
    });
    const latestSnapshots = await this.prisma.kPISnapshot.findMany({
      where: { companyId: { in: companies.map((co) => co.id) } },
      orderBy: { createdAt: 'desc' },
      take: Math.max(companies.length * 5, 5),
    });
    const snapshotsByCompany = latestSnapshots.reduce<Record<string, typeof latestSnapshots>>(
      (acc, snapshot) => {
        if (!snapshot.companyId) return acc;
        acc[snapshot.companyId] = acc[snapshot.companyId] ?? [];
        if (acc[snapshot.companyId].length < 5) acc[snapshot.companyId].push(snapshot);
        return acc;
      },
      {},
    );
    const companiesWithKpis = companies.map((co) => ({
      ...co,
      latestSnapshots: snapshotsByCompany[co.id] ?? [],
    }));
    return { companies: companiesWithKpis };
  }

  async queryDataset(datasetKey: string, body: any, user: any) {
    const companyId = body.companyId ?? user.companyId;
    const companyFilter = companyId ? { companyId } : {};

    switch (datasetKey) {
      case 'cash_position': {
        const data = await this.prisma.cashAccount.findMany({
          where: { deletedAt: null, ...companyFilter },
          select: {
            id: true,
            accountName: true,
            currentBalance: true,
            currency: true,
            companyId: true,
          },
        });
        return { datasetKey, data };
      }
      case 'inventory_summary': {
        const paging = pagination({ page: body.page, limit: body.limit, maxLimit: 200 });
        const data = await this.prisma.inventoryBalance.findMany({
          where: { ...(companyId ? { companyId } : {}) },
          orderBy: { updatedAt: 'desc' },
          skip: paging.skip,
          take: paging.limit,
        });
        return { datasetKey, data, page: paging.page, limit: paging.limit };
      }
      case 'asset_summary': {
        const data = await this.prisma.fixedAsset.findMany({
          where: { deletedAt: null, ...companyFilter },
          select: { id: true, name: true, category: true, currentBookValue: true, companyId: true },
          take: 100,
        });
        return { datasetKey, data };
      }
      case 'receivables_aging': {
        const today = new Date();
        const d30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const d60 = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
        const d90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        const [current, days30, days60, days90, over90] = await Promise.all([
          this.prisma.receivable.count({
            where: {
              dueDate: { gte: today },
              status: { not: 'PAID' },
              deletedAt: null,
              ...companyFilter,
            },
          }),
          this.prisma.receivable.count({
            where: {
              dueDate: { gte: d30, lt: today },
              status: { not: 'PAID' },
              deletedAt: null,
              ...companyFilter,
            },
          }),
          this.prisma.receivable.count({
            where: {
              dueDate: { gte: d60, lt: d30 },
              status: { not: 'PAID' },
              deletedAt: null,
              ...companyFilter,
            },
          }),
          this.prisma.receivable.count({
            where: {
              dueDate: { gte: d90, lt: d60 },
              status: { not: 'PAID' },
              deletedAt: null,
              ...companyFilter,
            },
          }),
          this.prisma.receivable.count({
            where: {
              dueDate: { lt: d90 },
              status: { not: 'PAID' },
              deletedAt: null,
              ...companyFilter,
            },
          }),
        ]);
        return {
          datasetKey,
          data: {
            current,
            '1-30days': days30,
            '31-60days': days60,
            '61-90days': days90,
            over90days: over90,
          },
        };
      }
      case 'company_comparison': {
        const companies = await this.prisma.company.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, code: true },
        });
        return { datasetKey, data: companies };
      }
      default:
        return {
          datasetKey,
          status: 'available',
          data: [],
          message: 'Query ready — filters supported',
        };
    }
  }
}
