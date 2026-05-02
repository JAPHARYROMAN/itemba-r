import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * TaxAnomalyDetectionService — Sprint C4.
 *
 * Read-only scanner that surfaces actionable tax/compliance signals across
 * the system. No DB writes. Designed for the C5 cockpit's "what needs
 * attention" panel and for ad-hoc compliance reviews.
 *
 * Each anomaly is a `{ severity, category, code, message, entityType?,
 * entityId?, suggestedAction? }` so the cockpit can render them as a
 * triage queue and link directly to the offending row.
 *
 * Severity bands:
 *   - CRITICAL: filing already overdue, or a posted payroll without statutory
 *               deductions — likely an immediate compliance breach.
 *   - HIGH:     filing due within 7 days; party setup gap that will distort
 *               a return on the next compute.
 *   - MEDIUM:   confirmed orders with zero tax that may indicate misclassified
 *               supplies; missing C2 ledger entries.
 *   - LOW:      hygiene reminders that aren't time-pressured.
 *
 * The scanner is deliberately conservative: a check that would take >1s on
 * a moderate dataset is split into a separate method that callers can opt
 * into. The default `scan()` runs the cheap checks only.
 */
@Injectable()
export class TaxAnomalyDetectionService {
  private readonly logger = new Logger(TaxAnomalyDetectionService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run the cheap-tier anomaly scan. Pass `companyId` to scope the scan to
   * one company (recommended); omit to scan the whole group.
   */
  async scan(query: {
    companyId?: string;
    severities?: Severity[];
    categories?: string[];
  } = {}, user: any = undefined as unknown as AuthUser): Promise<AnomalyScanResult> {
    const checks = await Promise.all([
      this.checkPartyHygiene(query.companyId, user),
      this.checkOverdueFilings(query.companyId, user),
      this.checkUpcomingFilings(query.companyId, user),
      this.checkPostedPayrollWithoutStatutoryLines(query.companyId, user),
      this.checkConfirmedOrdersWithZeroTax(query.companyId, user),
      this.checkMissingTaxLedgerEntries(query.companyId, user),
      this.checkLockedReturnsStillDraft(query.companyId, user),
    ]);

    let anomalies = checks.flat();
    if (query.severities?.length) {
      const allowed = new Set(query.severities);
      anomalies = anomalies.filter((a) => allowed.has(a.severity));
    }
    if (query.categories?.length) {
      const allowed = new Set(query.categories);
      anomalies = anomalies.filter((a) => allowed.has(a.category));
    }

    const bySeverity: Record<Severity, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    for (const a of anomalies) bySeverity[a.severity] += 1;

    return {
      asOf: new Date().toISOString(),
      total: anomalies.length,
      bySeverity,
      anomalies,
    };
  }

  // ── A1 — Party hygiene ───────────────────────────────────────────────────
  // VAT-registered company => suppliers and customers should carry TIN at
  // minimum. Missing VRN is a softer signal (not every party is VAT-registered).
  private async checkPartyHygiene(companyId?: string, user?: any): Promise<Anomaly[]> {
    const out: Anomaly[] = [];
    const where: any = { deletedAt: null, status: 'ACTIVE' };
    applyCompanyScopeWhere(where, user, companyId);

    const [customersMissingTin, suppliersMissingTin] = await Promise.all([
      this.prisma.customer.findMany({
        where: { ...where, OR: [{ tin: null }, { tin: '' }] },
        select: { id: true, customerCode: true, name: true, companyId: true },
        take: 100,
      }),
      this.prisma.supplier.findMany({
        where: { ...where, OR: [{ tin: null }, { tin: '' }] },
        select: { id: true, supplierCode: true, name: true, companyId: true },
        take: 100,
      }),
    ]);

    for (const c of customersMissingTin) {
      out.push({
        severity: 'LOW',
        category: 'PARTY_HYGIENE',
        code: 'CUSTOMER_MISSING_TIN',
        message: `Customer "${c.name}" (${c.customerCode}) has no TIN on file.`,
        entityType: 'Customer',
        entityId: c.id,
        companyId: c.companyId,
        suggestedAction: 'Add the TRA TIN under Customers → edit. Required for B2B invoicing.',
      });
    }
    for (const s of suppliersMissingTin) {
      out.push({
        severity: 'MEDIUM',
        category: 'PARTY_HYGIENE',
        code: 'SUPPLIER_MISSING_TIN',
        message: `Supplier "${s.name}" (${s.supplierCode}) has no TIN — WHT reporting will lack their TIN.`,
        entityType: 'Supplier',
        entityId: s.id,
        companyId: s.companyId,
        suggestedAction: 'Add TIN under Suppliers → edit before the next WHT filing.',
      });
    }
    return out;
  }

  // ── A2 — Overdue filings ─────────────────────────────────────────────────
  private async checkOverdueFilings(companyId?: string, user?: any): Promise<Anomaly[]> {
    const where: any = {
      deletedAt: null,
      status: 'OPEN',
      dueDate: { lt: new Date() },
    };
    applyCompanyScopeWhere(where, user, companyId);
    const periods = await this.prisma.taxFilingPeriod.findMany({
      where,
      include: { taxType: { select: { taxTypeCode: true, name: true } } },
      take: 100,
      orderBy: { dueDate: 'asc' },
    });
    return periods.map((p) => ({
      severity: 'CRITICAL' as const,
      category: 'FILING',
      code: 'FILING_OVERDUE',
      message: `${p.taxType.name} for ${p.name} was due ${p.dueDate?.toISOString().slice(0, 10)} — still OPEN.`,
      entityType: 'TaxFilingPeriod',
      entityId: p.id,
      companyId: p.companyId,
      suggestedAction:
        'Run the filing engine to compute, then submit. Late filings attract TRA penalties + interest.',
    }));
  }

  // ── A3 — Upcoming filings (next 7 days) ──────────────────────────────────
  private async checkUpcomingFilings(companyId?: string, user?: any): Promise<Anomaly[]> {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const where: any = {
      deletedAt: null,
      status: 'OPEN',
      dueDate: { gte: now, lt: in7 },
    };
    applyCompanyScopeWhere(where, user, companyId);
    const periods = await this.prisma.taxFilingPeriod.findMany({
      where,
      include: { taxType: { select: { name: true } } },
      take: 50,
      orderBy: { dueDate: 'asc' },
    });
    return periods.map((p) => ({
      severity: 'HIGH' as const,
      category: 'FILING',
      code: 'FILING_UPCOMING',
      message: `${p.taxType.name} (${p.name}) due ${p.dueDate?.toISOString().slice(0, 10)}.`,
      entityType: 'TaxFilingPeriod',
      entityId: p.id,
      companyId: p.companyId,
      suggestedAction: 'Run the filing engine to draft the return; review and submit before due date.',
    }));
  }

  // ── A4 — Posted payroll with no statutory lines ──────────────────────────
  // A POSTED payroll run that produced zero PayrollStatutoryLine entries is
  // almost always a misconfiguration — at least PAYE/NSSF should have fired.
  private async checkPostedPayrollWithoutStatutoryLines(companyId?: string, user?: any): Promise<Anomaly[]> {
    const where: any = { deletedAt: null, status: 'POSTED' };
    applyCompanyScopeWhere(where, user, companyId);

    const runs = await this.prisma.payrollRun.findMany({
      where,
      select: {
        id: true,
        payrollRunNumber: true,
        runDate: true,
        companyId: true,
        entries: {
          select: { id: true, statutoryLines: { select: { id: true }, take: 1 } },
          take: 5,
        },
      },
      take: 100,
      orderBy: { runDate: 'desc' },
    });

    const out: Anomaly[] = [];
    for (const r of runs) {
      if (r.entries.length === 0) continue; // empty run is its own concern
      const anyStatutoryLines = r.entries.some((e) => e.statutoryLines.length > 0);
      if (!anyStatutoryLines) {
        out.push({
          severity: 'CRITICAL',
          category: 'PAYROLL',
          code: 'PAYROLL_NO_STATUTORY_LINES',
          message: `Payroll run ${r.payrollRunNumber} (${r.runDate.toISOString().slice(0, 10)}) is POSTED but has no PayrollStatutoryLine entries — PAYE/NSSF were not computed.`,
          entityType: 'PayrollRun',
          entityId: r.id,
          companyId: r.companyId,
          suggestedAction:
            'Reverse the run, verify StatutoryDeductionRule rows are ACTIVE, then re-run payroll.',
        });
      }
    }
    return out;
  }

  // ── A5 — Confirmed orders with zero tax ──────────────────────────────────
  // Heuristic: any confirmed sales order this month whose total `taxAmount`
  // is zero. Flagged MEDIUM because zero tax is sometimes legitimate
  // (zero-rated exports, exempt supplies). Operator should confirm.
  private async checkConfirmedOrdersWithZeroTax(companyId?: string, user?: any): Promise<Anomaly[]> {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const where: any = {
      deletedAt: null,
      status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as any },
      orderDate: { gte: monthStart },
      taxAmount: 0,
      // Only flag orders large enough to matter — under 100k TZS isn't worth the noise.
      subtotal: { gte: 100_000 },
    };
    applyCompanyScopeWhere(where, user, companyId);

    const orders = await this.prisma.salesOrder.findMany({
      where,
      select: {
        id: true,
        salesOrderNumber: true,
        companyId: true,
        subtotal: true,
        customerName: true,
      },
      take: 50,
      orderBy: { orderDate: 'desc' },
    });
    return orders.map((o) => ({
      severity: 'MEDIUM' as const,
      category: 'TRANSACTION',
      code: 'SALES_ORDER_ZERO_TAX',
      message: `${o.salesOrderNumber} — subtotal ${Number(o.subtotal).toLocaleString()} TZS to ${o.customerName ?? 'walk-in'} has zero tax. Verify exemption or zero-rating.`,
      entityType: 'SalesOrder',
      entityId: o.id,
      companyId: o.companyId,
      suggestedAction:
        'Open the order and confirm whether the supply is zero-rated (export) or exempt. Otherwise add the VAT line.',
    }));
  }

  // ── A6 — Missing tax-ledger entries (C2 backfill candidates) ─────────────
  // Sales orders confirmed this month with non-zero taxAmount but no
  // TaxTransaction rows. Either C2 is disabled or the order was confirmed
  // before the auto-apply landed.
  private async checkMissingTaxLedgerEntries(companyId?: string, user?: any): Promise<Anomaly[]> {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const where: any = {
      deletedAt: null,
      status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as any },
      orderDate: { gte: monthStart },
      taxAmount: { gt: 0 },
    };
    applyCompanyScopeWhere(where, user, companyId);

    const orders = await this.prisma.salesOrder.findMany({
      where,
      select: { id: true, salesOrderNumber: true, companyId: true, taxAmount: true },
      take: 100,
      orderBy: { orderDate: 'desc' },
    });

    if (orders.length === 0) return [];

    // Bulk-check which of these have at least one TaxTransaction.
    const coveredIds = new Set<string>();
    const txs = await this.prisma.taxTransaction.findMany({
      where: {
        sourceType: 'SALES_ORDER' as any,
        sourceId: { in: orders.map((o) => o.id) },
        deletedAt: null,
      },
      select: { sourceId: true },
    });
    for (const t of txs) if (t.sourceId) coveredIds.add(t.sourceId);

    return orders
      .filter((o) => !coveredIds.has(o.id))
      .map((o) => ({
        severity: 'MEDIUM' as const,
        category: 'LEDGER',
        code: 'MISSING_TAX_TRANSACTION',
        message: `${o.salesOrderNumber} has tax of ${Number(o.taxAmount).toLocaleString()} TZS but no TaxTransaction ledger entry.`,
        entityType: 'SalesOrder',
        entityId: o.id,
        companyId: o.companyId,
        suggestedAction:
          'POST /tax-auto-apply/sales-order/:id to backfill, or enable TAX_AUTO_APPLY=true so future confirmations capture automatically.',
      }));
  }

  // ── A7 — Filing periods past due with returns still in DRAFT ─────────────
  private async checkLockedReturnsStillDraft(companyId?: string, user?: any): Promise<Anomaly[]> {
    const where: any = {
      deletedAt: null,
      status: 'DRAFT',
      taxFilingPeriod: { dueDate: { lt: new Date() }, deletedAt: null },
    };
    applyCompanyScopeWhere(where, user, companyId);

    const returns = await this.prisma.taxReturn.findMany({
      where,
      include: {
        taxType: { select: { name: true } },
        taxFilingPeriod: { select: { name: true, dueDate: true } },
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    return returns.map((r) => ({
      severity: 'HIGH' as const,
      category: 'FILING',
      code: 'RETURN_DRAFT_PAST_DUE',
      message: `${r.taxType.name} return ${r.taxReturnNumber} for ${r.taxFilingPeriod.name} still DRAFT — due was ${r.taxFilingPeriod.dueDate?.toISOString().slice(0, 10)}.`,
      entityType: 'TaxReturn',
      entityId: r.id,
      companyId: r.companyId,
      suggestedAction: 'Review, approve, and submit the return. Penalties accrue from the original due date.',
    }));
  }
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Anomaly {
  severity: Severity;
  category: string;
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
  companyId?: string;
  suggestedAction?: string;
}

export interface AnomalyScanResult {
  asOf: string;
  total: number;
  bySeverity: Record<Severity, number>;
  anomalies: Anomaly[];
}
