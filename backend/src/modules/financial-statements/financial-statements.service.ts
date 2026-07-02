import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, FinancialStatementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { FinancialReportsService } from '../financial-reports/financial-reports.service';

@Injectable()
export class FinancialStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly financialReports: FinancialReportsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    const [items, total] = await Promise.all([
      this.prisma.financialStatementRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.financialStatementRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.financialStatementRun.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Financial statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId);
    return item;
  }

  /**
   * Generate a financial statement and persist the run.
   *
   * The requested `statementType` now DRIVES the shape of the computed result:
   * we delegate to the matching computation in FinancialReportsService (which
   * already classifies accounts by accountType and honours the shared
   * REPORTABLE_JE_STATUS_FILTER, so reversed journal entries net to zero rather
   * than being double-counted). Previously generate() always emitted a raw
   * debit/credit trial balance regardless of the requested type, so a run
   * labelled BALANCE_SHEET / PROFIT_AND_LOSS / CASH_FLOW carried the wrong data.
   *
   * Types without a dedicated computation (EQUITY_STATEMENT, GENERAL_LEDGER,
   * CUSTOM) return an explicit `notSupported` result instead of silently
   * masquerading as a trial balance; the run is still persisted (status FAILED)
   * so the request is auditable.
   */
  async generate(dto: any, user: any) {
    const { companyId, periodStart, periodEnd } = dto;
    const statementType: FinancialStatementType = dto.statementType ?? FinancialStatementType.TRIAL_BALANCE;
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);

    const dateFrom = periodStart ? new Date(periodStart) : undefined;
    const dateTo = periodEnd ? new Date(periodEnd) : undefined;
    const dateFromIso = dateFrom?.toISOString();
    const dateToIso = dateTo?.toISOString();

    const { result, supported } = await this.computeStatement(
      statementType,
      companyId,
      dateFromIso,
      dateToIso,
      user,
    );

    const run = await this.prisma.financialStatementRun.create({
      data: {
        statementRunNumber: `FSR-${Date.now()}`,
        companyId: companyId ?? undefined,
        statementType,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        resultSummary: result as any,
        errorMessage: supported ? undefined : `Statement type ${statementType} is not supported`,
        generatedById: user.id,
        generatedAt: new Date(),
        status: supported ? 'GENERATED' : 'FAILED',
      },
    });

    await this.auditLogs.log({ action: 'GENERATE', entityType: 'FinancialStatementRun', entityId: run.id, userId: user.id, companyId });
    return { run, statementType, supported, result };
  }

  /**
   * Route the requested statement type to the existing FinancialReportsService
   * computation. Returns `{ supported: false, result }` for types we do not
   * compute so the caller can persist a clear notSupported outcome.
   */
  private async computeStatement(
    statementType: FinancialStatementType,
    companyId: string,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    user: AuthUser,
  ): Promise<{ result: any; supported: boolean }> {
    switch (statementType) {
      case FinancialStatementType.TRIAL_BALANCE: {
        const result = await this.financialReports.getTrialBalance(
          companyId,
          undefined,
          dateFrom,
          dateTo,
          user,
        );
        return { result, supported: true };
      }
      case FinancialStatementType.PROFIT_AND_LOSS: {
        const result = await this.financialReports.getProfitAndLoss(
          companyId,
          dateFrom,
          dateTo,
          user,
        );
        return { result, supported: true };
      }
      case FinancialStatementType.BALANCE_SHEET: {
        // A balance sheet is a point-in-time snapshot; use period end as the
        // as-of date (falls back to "now" inside getBalanceSheet when absent).
        const result = await this.financialReports.getBalanceSheet(companyId, dateTo, user);
        return { result, supported: true };
      }
      case FinancialStatementType.CASH_FLOW: {
        if (!dateFrom || !dateTo) {
          return {
            result: {
              statementType,
              notSupported: true,
              reason: 'CASH_FLOW requires both periodStart and periodEnd',
            },
            supported: false,
          };
        }
        const result = await this.financialReports.getCashFlow(companyId, dateFrom, dateTo, user);
        return { result, supported: true };
      }
      default: {
        // EQUITY_STATEMENT, GENERAL_LEDGER, CUSTOM — no dedicated computation.
        return {
          result: {
            statementType,
            notSupported: true,
            reason: `Statement type ${statementType} is not yet supported for generation`,
          },
          supported: false,
        };
      }
    }
  }
}
