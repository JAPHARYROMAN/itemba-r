import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TaxCategory, TaxReturnStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

/**
 * TaxFilingEngineService — Sprint C3.
 *
 * Aggregates underlying source data (TaxTransaction ledger from C2,
 * PayrollStatutoryLine for payroll taxes, GL postings for corporate income
 * tax) into filing-ready totals on a draft TaxReturn row.
 *
 * Engine is **dispatch by TaxType.taxCategory**:
 *   - VAT             → output (sales) – input (purchases)
 *   - WITHHOLDING_TAX → sum of WITHHELD direction tax transactions
 *   - PAYROLL_TAX     → sum employee + employer PayrollStatutoryLine for the
 *                       payroll runs whose periods fall within the window
 *   - INCOME_TAX      → P&L (income – cogs – expenses) × 30%; this is a
 *                       *baseline* — supervisory accountants overlay add-backs,
 *                       capital allowances, and deductions before submission.
 *   - SERVICE_LEVY    → 0.3% of confirmed sales (turnover) for City Service Levy
 *   - everything else → returns NOT_SUPPORTED so callers can fall back to
 *                       manual entry rather than booking a wrong figure.
 *
 * Idempotent on draft returns — re-running on the same period overwrites the
 * draft. **Refuses** to recompute a TaxReturn that's already SUBMITTED, PAID,
 * APPROVED or CLOSED. The supervisory accountant should reverse to DRAFT
 * first if a re-compute is genuinely needed.
 *
 * Returns are honestly named: `taxableAmount`, `taxPayable` (output side),
 * `taxRecoverable` (input/credit side), `netTaxDue` (the bottom line).
 */
@Injectable()
export class TaxFilingEngineService {
  private readonly logger = new Logger(TaxFilingEngineService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  /** Compute and persist a draft TaxReturn for the given filing period. */
  async computeReturn(periodId: string, userId: string): Promise<TaxReturnComputeResult> {
    const figures = await this.computeFigures(periodId);
    if (figures.notSupported) return figures;

    // Find or create the draft return for this period+type.
    const existing = await this.prisma.taxReturn.findFirst({
      where: {
        taxFilingPeriodId: periodId,
        taxTypeId: figures.taxTypeId,
        deletedAt: null,
      },
    });

    if (existing && this.isLocked(existing.status)) {
      throw new BadRequestException(
        `TaxReturn ${existing.taxReturnNumber} is in status ${existing.status} — reverse to DRAFT before recomputing.`,
      );
    }

    const data: Prisma.TaxReturnUpdateInput | Prisma.TaxReturnUncheckedCreateInput = {
      grossAmount: figures.grossAmount,
      taxableAmount: figures.taxableAmount,
      taxPayable: figures.taxPayable,
      taxRecoverable: figures.taxRecoverable,
      netTaxDue: figures.netTaxDue,
      totalDue: figures.netTaxDue, // penalties + interest are operator-entered
      outstandingAmount: figures.netTaxDue,
      currency: 'TZS',
      preparedById: userId,
      notes: this.buildNotes(figures),
      status: TaxReturnStatus.DRAFT,
    };

    const saved = existing
      ? await this.prisma.taxReturn.update({ where: { id: existing.id }, data })
      : await this.prisma.taxReturn.create({
          data: {
            ...(data as Prisma.TaxReturnUncheckedCreateInput),
            taxReturnNumber: await this.codes.next({ entityType: 'TaxReturn', companyId: figures.companyId }),
            companyId: figures.companyId,
            taxFilingPeriodId: periodId,
            taxTypeId: figures.taxTypeId,
          },
        });

    return { ...figures, taxReturnId: saved.id, taxReturnNumber: saved.taxReturnNumber };
  }

  /** Compute figures without persisting — for "what would this period look like?" previews. */
  async previewReturn(periodId: string): Promise<TaxReturnComputeResult> {
    return this.computeFigures(periodId);
  }

  // ── Core dispatch ────────────────────────────────────────────────────────
  private async computeFigures(periodId: string): Promise<TaxReturnComputeResult> {
    const period = await this.prisma.taxFilingPeriod.findUnique({
      where: { id: periodId },
      include: { taxType: true },
    });
    if (!period || period.deletedAt) throw new NotFoundException(`TaxFilingPeriod ${periodId} not found`);

    const base: TaxReturnComputeBase = {
      companyId: period.companyId,
      taxTypeId: period.taxTypeId,
      taxTypeCode: period.taxType.taxTypeCode,
      taxCategory: period.taxType.taxCategory,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      lines: [],
      grossAmount: 0,
      taxableAmount: 0,
      taxPayable: 0,
      taxRecoverable: 0,
      netTaxDue: 0,
    };

    switch (period.taxType.taxCategory) {
      case TaxCategory.VAT:
        return this.computeVat(base);
      case TaxCategory.WITHHOLDING_TAX:
        return this.computeWht(base);
      case TaxCategory.PAYROLL_TAX:
        return this.computePayroll(base);
      case TaxCategory.INCOME_TAX:
        return this.computeCit(base);
      case TaxCategory.SERVICE_LEVY:
        return this.computeServiceLevy(base);
      default:
        return { ...base, notSupported: true, reason: `taxCategory=${period.taxType.taxCategory} not yet supported by the engine` };
    }
  }

  // ── VAT ──────────────────────────────────────────────────────────────────
  private async computeVat(base: TaxReturnComputeBase): Promise<TaxReturnComputeResult> {
    const where = {
      companyId: base.companyId,
      transactionDate: { gte: base.periodStart, lte: base.periodEnd },
      taxType: { taxCategory: TaxCategory.VAT },
      deletedAt: null,
    };

    const [output, input] = await Promise.all([
      this.prisma.taxTransaction.aggregate({
        where: { ...where, direction: 'OUTPUT' },
        _sum: { taxableAmount: true, taxAmount: true },
      }),
      this.prisma.taxTransaction.aggregate({
        where: { ...where, direction: 'INPUT' },
        _sum: { taxableAmount: true, taxAmount: true },
      }),
    ]);

    const outputTaxable = Number(output._sum.taxableAmount ?? 0);
    const outputTax = Number(output._sum.taxAmount ?? 0);
    const inputTaxable = Number(input._sum.taxableAmount ?? 0);
    const inputTax = Number(input._sum.taxAmount ?? 0);

    return {
      ...base,
      grossAmount: round2(outputTaxable + outputTax),
      taxableAmount: round2(outputTaxable),
      taxPayable: round2(outputTax),
      taxRecoverable: round2(inputTax),
      netTaxDue: round2(outputTax - inputTax),
      lines: [
        { label: 'Output VAT (sales)', amount: round2(outputTax), basis: round2(outputTaxable) },
        { label: 'Input VAT (purchases)', amount: round2(inputTax), basis: round2(inputTaxable) },
        { label: 'Net VAT payable', amount: round2(outputTax - inputTax) },
      ],
    };
  }

  // ── Withholding tax ──────────────────────────────────────────────────────
  private async computeWht(base: TaxReturnComputeBase): Promise<TaxReturnComputeResult> {
    const wht = await this.prisma.taxTransaction.aggregate({
      where: {
        companyId: base.companyId,
        taxTypeId: base.taxTypeId,
        transactionDate: { gte: base.periodStart, lte: base.periodEnd },
        deletedAt: null,
      },
      _sum: { taxableAmount: true, taxAmount: true },
    });
    const taxableAmount = Number(wht._sum.taxableAmount ?? 0);
    const withheld = Number(wht._sum.taxAmount ?? 0);
    return {
      ...base,
      grossAmount: round2(taxableAmount + withheld),
      taxableAmount: round2(taxableAmount),
      taxPayable: round2(withheld),
      taxRecoverable: 0,
      netTaxDue: round2(withheld),
      lines: [
        { label: `WHT withheld (${base.taxTypeCode})`, amount: round2(withheld), basis: round2(taxableAmount) },
      ],
    };
  }

  // ── Payroll taxes (PAYE, NSSF, PSSSF, WCF, SDL, NHIF, HESLB) ─────────────
  private async computePayroll(base: TaxReturnComputeBase): Promise<TaxReturnComputeResult> {
    // Payroll lines link to PayrollEntry → PayrollRun → PayrollPeriod. The
    // window we filter on is `payrollEntry.payrollRun.payrollPeriod.startDate`
    // falling within [periodStart, periodEnd] — i.e. the payroll period the
    // statutory line was earned in, not the date it was posted.
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: {
        taxTypeId: base.taxTypeId,
        payrollEntry: {
          deletedAt: null,
          payrollRun: {
            deletedAt: null,
            companyId: base.companyId,
            payrollPeriod: {
              startDate: { gte: base.periodStart, lte: base.periodEnd },
            },
          },
        },
      },
      select: { basisAmount: true, employeeContribution: true, employerContribution: true },
    });

    let basisAmount = 0;
    let employee = 0;
    let employer = 0;
    for (const l of lines) {
      basisAmount += Number(l.basisAmount);
      employee += Number(l.employeeContribution);
      employer += Number(l.employerContribution);
    }
    const total = employee + employer;

    return {
      ...base,
      grossAmount: round2(basisAmount),
      taxableAmount: round2(basisAmount),
      taxPayable: round2(total),
      taxRecoverable: 0,
      netTaxDue: round2(total),
      lines: [
        { label: 'Employee contribution', amount: round2(employee), basis: round2(basisAmount) },
        { label: 'Employer contribution', amount: round2(employer), basis: round2(basisAmount) },
        { label: `Total ${base.taxTypeCode} payable`, amount: round2(total) },
      ],
    };
  }

  // ── Corporate Income Tax (annual baseline) ───────────────────────────────
  private async computeCit(base: TaxReturnComputeBase): Promise<TaxReturnComputeResult> {
    // Income/expense/COGS aggregation off posted journal entry lines —
    // matches the pattern in financial-reports.getProfitAndLoss.
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        companyId: base.companyId,
        journalEntry: {
          companyId: base.companyId,
          status: 'POSTED',
          deletedAt: null,
          transactionDate: { gte: base.periodStart, lte: base.periodEnd },
        },
      },
      include: { account: { select: { accountType: true } } },
    });

    let income = 0;
    let expenses = 0;
    let cogs = 0;
    for (const line of lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      switch (line.account.accountType) {
        case 'INCOME':
          income += credit - debit;
          break;
        case 'EXPENSE':
          expenses += debit - credit;
          break;
        case 'COST_OF_GOODS_SOLD':
          cogs += debit - credit;
          break;
      }
    }

    const profitBeforeTax = income - expenses - cogs;
    // Apply the chargeable tax rate from the most-recent active rate row for
    // this taxType. Falls back to 30% if no rate is configured.
    const rateRow = await this.prisma.taxRate.findFirst({
      where: {
        taxTypeId: base.taxTypeId,
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: base.periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: base.periodStart } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const ratePct = rateRow ? Number(rateRow.rate) : 30;
    const taxPayable = Math.max(round2((profitBeforeTax * ratePct) / 100), 0);

    return {
      ...base,
      grossAmount: round2(income),
      taxableAmount: round2(profitBeforeTax),
      taxPayable,
      taxRecoverable: 0,
      netTaxDue: taxPayable,
      lines: [
        { label: 'Income', amount: round2(income) },
        { label: 'Cost of goods sold', amount: round2(cogs) },
        { label: 'Operating expenses', amount: round2(expenses) },
        { label: 'Profit before tax', amount: round2(profitBeforeTax) },
        { label: `CIT @ ${ratePct}%`, amount: taxPayable },
      ],
      assumptions: [
        'Baseline: profit-before-tax × statutory rate. Add-backs (depreciation tax disallowed, fines, donations beyond limits), capital allowances, and prior-year losses are NOT applied — supervisory accountants must overlay these before submission.',
        rateRow
          ? `Rate ${ratePct}% sourced from TaxRate ${rateRow.rateName}.`
          : `No active TaxRate found — defaulted to 30% (TZ standard).`,
      ],
    };
  }

  // ── City Service Levy ────────────────────────────────────────────────────
  private async computeServiceLevy(base: TaxReturnComputeBase): Promise<TaxReturnComputeResult> {
    // 0.3% of confirmed sales turnover for the period. Reads SalesOrder
    // directly (status ∈ confirmed/paid) rather than going through TaxTransaction
    // so it works even before C2 auto-apply is enabled.
    const sales = await this.prisma.salesOrder.aggregate({
      where: {
        companyId: base.companyId,
        deletedAt: null,
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as any },
        orderDate: { gte: base.periodStart, lte: base.periodEnd },
      },
      _sum: { subtotal: true, totalAmount: true },
    });

    const turnover = Number(sales._sum.subtotal ?? 0);
    const rateRow = await this.prisma.taxRate.findFirst({
      where: {
        taxTypeId: base.taxTypeId,
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: base.periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: base.periodStart } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const ratePct = rateRow ? Number(rateRow.rate) : 0.3;
    const taxPayable = round2((turnover * ratePct) / 100);

    return {
      ...base,
      grossAmount: round2(turnover),
      taxableAmount: round2(turnover),
      taxPayable,
      taxRecoverable: 0,
      netTaxDue: taxPayable,
      lines: [
        { label: 'Turnover (subtotal of confirmed sales)', amount: round2(turnover) },
        { label: `City Service Levy @ ${ratePct}%`, amount: taxPayable },
      ],
      assumptions: [
        'Turnover = subtotal of SalesOrder (excludes tax + discount). Some councils assess on totalAmount including tax — verify with your local LGA notice.',
      ],
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private isLocked(status: string): boolean {
    return ['SUBMITTED', 'PAID', 'APPROVED', 'CLOSED'].includes(status);
  }

  private buildNotes(figures: TaxReturnComputeResult): string {
    const parts = [`Auto-computed by tax-filing-engine on ${new Date().toISOString()}.`];
    if (figures.assumptions) parts.push(...figures.assumptions);
    return parts.join('\n');
  }

}

export interface TaxReturnLine {
  label: string;
  amount: number;
  basis?: number;
}

interface TaxReturnComputeBase {
  companyId: string;
  taxTypeId: string;
  taxTypeCode: string;
  taxCategory: TaxCategory;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  taxableAmount: number;
  taxPayable: number;
  taxRecoverable: number;
  netTaxDue: number;
  lines: TaxReturnLine[];
  assumptions?: string[];
}

export interface TaxReturnComputeResult extends TaxReturnComputeBase {
  taxReturnId?: string;
  taxReturnNumber?: string;
  notSupported?: boolean;
  reason?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
