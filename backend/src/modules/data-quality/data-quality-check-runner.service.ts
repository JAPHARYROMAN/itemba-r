import { Injectable } from '@nestjs/common';
import {
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
  DataQualityIssueType,
  JournalEntryStatus,
  ReportRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type IssueCandidate = {
  companyId?: string | null;
  entityType: string;
  entityId: string;
  issueType: DataQualityIssueType;
  title: string;
  description?: string;
  severity: DataQualityIssueSeverity;
  metadata?: Record<string, unknown>;
};

type CheckResult = {
  checkKey: string;
  checkedCount: number;
  existingOpenCount: number;
  createdCount: number;
};

@Injectable()
export class DataQualityCheckRunnerService {
  constructor(private readonly prisma: PrismaService) {}

  async runAll(user: { companyId?: string | null }) {
    const companyFilter = user.companyId ? { companyId: user.companyId } : {};
    const results: CheckResult[] = [];
    const issues: unknown[] = [];

    await this.runCheck(results, issues, 'negative_inventory_balance', async () => {
      const records = await this.prisma.inventoryBalance.findMany({
        where: { quantityOnHand: { lt: 0 }, ...companyFilter },
        take: 100,
      });
      return {
        checkedCount: records.length,
        candidates: records.map((record) => ({
          companyId: (record as any).companyId,
          entityType: 'InventoryBalance',
          entityId: record.id,
          issueType: DataQualityIssueType.NEGATIVE_BALANCE,
          title: 'Negative inventory balance detected',
          description: `Inventory balance is below zero: ${record.quantityOnHand}`,
          severity: DataQualityIssueSeverity.HIGH,
          metadata: {
            quantityOnHand: String(record.quantityOnHand),
            productId: (record as any).productId,
            branchId: (record as any).branchId,
          },
        })),
      };
    });

    await this.runCheck(results, issues, 'company_without_bank_account', async () => {
      const companies = await this.prisma.company.findMany({
        where: { deletedAt: null, ...(user.companyId ? { id: user.companyId } : {}) },
        include: { bankAccounts: { where: { deletedAt: null }, take: 1 } },
        take: 100,
      });
      return {
        checkedCount: companies.length,
        candidates: companies
          .filter((company) => (company as any).bankAccounts.length === 0)
          .map((company) => ({
            companyId: company.id,
            entityType: 'Company',
            entityId: company.id,
            issueType: DataQualityIssueType.MISSING_REQUIRED_FIELD,
            title: 'Company has no bank accounts',
            severity: DataQualityIssueSeverity.MEDIUM,
            metadata: { companyCode: (company as any).code, companyName: (company as any).name },
          })),
      };
    });

    await this.runCheck(results, issues, 'stale_draft_journal_entry', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const records = await this.prisma.journalEntry.findMany({
        where: {
          status: JournalEntryStatus.DRAFT,
          createdAt: { lt: sevenDaysAgo },
          deletedAt: null,
          ...companyFilter,
        },
        take: 100,
      });
      return {
        checkedCount: records.length,
        candidates: records.map((record) => ({
          companyId: (record as any).companyId,
          entityType: 'JournalEntry',
          entityId: record.id,
          issueType: DataQualityIssueType.UNPOSTED_TRANSACTION,
          title: 'Journal entry in DRAFT for over 7 days',
          severity: DataQualityIssueSeverity.MEDIUM,
          metadata: { journalNumber: (record as any).journalNumber },
        })),
      };
    });

    await this.runCheck(results, issues, 'overdue_receivable', async () => {
      const records = await this.prisma.receivable.findMany({
        where: {
          dueDate: { lt: new Date() },
          status: { not: 'PAID' as any },
          deletedAt: null,
          ...companyFilter,
        },
        take: 100,
      });
      return {
        checkedCount: records.length,
        candidates: records.map((record) => ({
          companyId: (record as any).companyId,
          entityType: 'Receivable',
          entityId: record.id,
          issueType: DataQualityIssueType.UNRECONCILED_RECORD,
          title: 'Overdue receivable not reconciled',
          severity: DataQualityIssueSeverity.HIGH,
          metadata: {
            dueDate: (record as any).dueDate?.toISOString?.(),
            status: (record as any).status,
          },
        })),
      };
    });

    await this.runCheck(results, issues, 'stale_report_run', async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const records = await this.prisma.reportRun.findMany({
        where: {
          status: { in: [ReportRunStatus.REQUESTED, ReportRunStatus.RUNNING] },
          createdAt: { lt: thirtyMinutesAgo },
          ...companyFilter,
        },
        take: 100,
      });
      return {
        checkedCount: records.length,
        candidates: records.map((record) => ({
          companyId: (record as any).companyId,
          entityType: 'ReportRun',
          entityId: record.id,
          issueType: DataQualityIssueType.INCONSISTENT_STATUS,
          title: 'Report run has not completed within 30 minutes',
          severity: DataQualityIssueSeverity.MEDIUM,
          metadata: {
            reportRunNumber: (record as any).reportRunNumber,
            status: (record as any).status,
          },
        })),
      };
    });

    await this.runCheck(results, issues, 'unposted_fuel_daily_reconciliation', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const records = await this.prisma.fuelDailyReconciliation.findMany({
        where: {
          status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] as any[] },
          reconciliationDate: { lt: twoDaysAgo },
          deletedAt: null,
          ...companyFilter,
        },
        take: 100,
      });
      return {
        checkedCount: records.length,
        candidates: records.map((record) => ({
          companyId: (record as any).companyId,
          entityType: 'FuelDailyReconciliation',
          entityId: record.id,
          issueType: DataQualityIssueType.UNRECONCILED_RECORD,
          title: 'Fuel daily reconciliation is not posted',
          severity: DataQualityIssueSeverity.HIGH,
          metadata: {
            reconciliationNumber: (record as any).reconciliationNumber,
            reconciliationDate: (record as any).reconciliationDate?.toISOString?.(),
            status: (record as any).status,
          },
        })),
      };
    });

    return {
      message: 'Data quality checks completed',
      checkedCount: results.reduce((sum, result) => sum + result.checkedCount, 0),
      existingOpenCount: results.reduce((sum, result) => sum + result.existingOpenCount, 0),
      issuesFound: issues.length,
      issues,
      checks: results,
    };
  }

  private async runCheck(
    results: CheckResult[],
    issues: unknown[],
    checkKey: string,
    build: () => Promise<{ checkedCount: number; candidates: IssueCandidate[] }>,
  ) {
    const { checkedCount, candidates } = await build();
    let existingOpenCount = 0;
    let createdCount = 0;

    for (const candidate of candidates) {
      const existing = await this.prisma.dataQualityIssue.findFirst({
        where: {
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          issueType: candidate.issueType,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
        },
      });

      if (existing) {
        existingOpenCount += 1;
        continue;
      }

      const issue = await this.prisma.dataQualityIssue.create({
        data: {
          issueNumber: `DQ-${Date.now()}-${createdCount}-${candidate.entityId}`,
          companyId: candidate.companyId ?? undefined,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          issueType: candidate.issueType,
          title: candidate.title,
          description: candidate.description,
          severity: candidate.severity,
          metadata: { checkKey, ...(candidate.metadata ?? {}) } as any,
        },
      });
      createdCount += 1;
      issues.push(issue);
    }

    results.push({ checkKey, checkedCount, existingOpenCount, createdCount });
  }
}
