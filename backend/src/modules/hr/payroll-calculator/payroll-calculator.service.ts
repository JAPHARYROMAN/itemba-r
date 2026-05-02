/**
 * Tanzanian payroll orchestrator. Loads reference data from the DB once per
 * payroll run and computes the per-employee statutory breakdown by chaining
 * the pure calculator functions in dependency order.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  calculateHeslb,
  calculateNhif,
  calculatePayeNonResident,
  calculatePayeResident,
  calculatePension,
  calculateSdl,
  calculateWcf,
  round2,
} from './calculators';
import type {
  CalculatorInput,
  CalculatorOutput,
  PayeBracket,
  ReferenceData,
  StatutoryLine,
  StatutoryRule,
} from './types';

@Injectable()
export class PayrollCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load all reference data the calculator needs for a given employee region.
   * Cache this once per run; calling it per-employee is wasteful.
   */
  async loadReferenceData(region: 'MAINLAND' | 'ZANZIBAR'): Promise<ReferenceData> {
    const payeTaxTypeCode = region === 'ZANZIBAR' ? 'PAYE_ZANZIBAR' : 'PAYE_MAINLAND';

    const [
      payeTaxType,
      nssfRule,
      pssfRule,
      wcfPrivateRule,
      wcfPublicRule,
      sdlRule,
      nhifRule,
      heslbRule,
    ] = await Promise.all([
      this.prisma.taxType.findUnique({
        where: { taxTypeCode: payeTaxTypeCode },
        include: {
          taxRates: {
            where: { calculationMethod: 'TIERED', status: 'ACTIVE' },
            include: { brackets: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
      }),
      this.loadRule('NSSF_PRIVATE'),
      this.loadRule('PSSSF_PUBLIC'),
      this.loadRule('WCF_PRIVATE'),
      this.loadRule('WCF_PUBLIC'),
      this.loadRule('SDL'),
      this.loadRule('NHIF_DEFAULT'),
      this.loadRule('HESLB'),
    ]);

    if (!payeTaxType || payeTaxType.taxRates.length === 0) {
      throw new Error(
        `No active PAYE rate found for ${payeTaxTypeCode}. Seed Tanzania reference data first.`,
      );
    }
    const rate = payeTaxType.taxRates[0];

    const payeBrackets: PayeBracket[] = rate.brackets
      .map((b) => ({
        tierOrder: b.tierOrder,
        fromAmount: Number(b.fromAmount),
        toAmount: b.toAmount === null ? null : Number(b.toAmount),
        marginalRate: Number(b.marginalRate),
        fixedAmount: Number(b.fixedAmount),
      }))
      .sort((a, b) => a.tierOrder - b.tierOrder);

    return {
      payeBrackets,
      payeTaxTypeId: payeTaxType.id,
      payeTaxRateId: rate.id,
      nssfRule,
      pssfRule,
      wcfPrivateRule,
      wcfPublicRule,
      sdlRule,
      nhifRule,
      heslbRule,
    };
  }

  private async loadRule(ruleCode: string): Promise<StatutoryRule | undefined> {
    const r = await this.prisma.statutoryDeductionRule.findUnique({
      where: { ruleCode },
      include: { taxType: true },
    });
    if (!r || r.status !== 'ACTIVE') return undefined;
    if (!r.taxType) return undefined;
    return {
      id: r.id,
      ruleCode: r.ruleCode,
      taxTypeCode: r.taxType.taxTypeCode,
      taxTypeId: r.taxType.id,
      calculationMethod: r.calculationMethod,
      employeeRate: Number(r.employeeContributionRate ?? 0),
      employerRate: Number(r.employerContributionRate ?? 0),
      fixedAmount: r.amount === null ? undefined : Number(r.amount),
    };
  }

  /**
   * Run the full calculation pipeline for one employee.
   *
   * Chain:
   *   1. Gross = basic + taxable allowances + non-taxable allowances + overtime
   *   2. Pension (NSSF or PSSSF) on gross pensionable
   *   3. Taxable income = gross − non-taxable allowances − employee pension contribution
   *   4. PAYE on taxable income (PWD relief if applicable; flat 15% if non-resident)
   *   5. HESLB on basic (if borrower)
   *   6. NHIF on gross
   *   7. WCF (employer-only) on gross
   *   8. SDL (employer-only) on gross IF company has ≥ 10 employees
   *
   * Output is a pure data structure — caller decides what to persist.
   */
  compute(input: CalculatorInput, ref: ReferenceData): CalculatorOutput {
    const { employee, earnings, context } = input;
    const { basicPay, taxableAllowances, nonTaxableAllowances, overtimePay } = earnings;

    const grossPay = round2(basicPay + taxableAllowances + nonTaxableAllowances + overtimePay);
    const lines: StatutoryLine[] = [];

    // ── 1. Pension (NSSF for private, PSSSF for public) ────────────────────
    const pensionRule = employee.isPublicSector ? ref.pssfRule : ref.nssfRule;
    let pensionEmployeeContribution = 0;
    if (pensionRule) {
      const pensionLine = calculatePension(grossPay, pensionRule);
      lines.push(pensionLine);
      pensionEmployeeContribution = pensionLine.employeeContribution;
    }

    // ── 2. PAYE ─────────────────────────────────────────────────────────────
    // Taxable income = gross − non-taxable allowances − employee pension contribution
    const taxableIncome = round2(
      Math.max(0, grossPay - nonTaxableAllowances - pensionEmployeeContribution),
    );

    const payeResult =
      employee.taxResidencyStatus === 'NON_RESIDENT'
        ? calculatePayeNonResident(taxableIncome)
        : calculatePayeResident(taxableIncome, ref.payeBrackets, employee);

    lines.push({
      taxTypeCode:
        employee.payrollRegion === 'ZANZIBAR' ? 'PAYE_ZANZIBAR' : 'PAYE_MAINLAND',
      taxTypeId: ref.payeTaxTypeId,
      taxRateId: ref.payeTaxRateId,
      basis: 'TAXABLE_INCOME',
      basisAmount: taxableIncome,
      employeeContribution: payeResult.paye,
      employerContribution: 0,
      appliedRate: payeResult.appliedRate,
      calculationDetail: {
        rawPaye: payeResult.rawPaye,
        pwdRelief: payeResult.pwdRelief,
        steps: payeResult.steps,
        residency: employee.taxResidencyStatus,
      },
      notes:
        employee.taxResidencyStatus === 'NON_RESIDENT'
          ? 'Non-resident flat 15% PAYE rate.'
          : payeResult.pwdRelief > 0
            ? `Tiered PAYE with TZS ${payeResult.pwdRelief} PWD relief applied.`
            : 'Tiered PAYE.',
    });

    // ── 3. HESLB (15% of basic for active borrowers) ───────────────────────
    if (ref.heslbRule) {
      const heslbLine = calculateHeslb(basicPay, employee, ref.heslbRule);
      if (heslbLine) lines.push(heslbLine);
    }

    // ── 4. NHIF ─────────────────────────────────────────────────────────────
    if (ref.nhifRule) {
      const nhifLine = calculateNhif(grossPay, ref.nhifRule);
      // Only push if it actually contributes (rate > 0). A future feature flag
      // per company can disable NHIF entirely.
      if (nhifLine.employeeContribution > 0 || nhifLine.employerContribution > 0) {
        lines.push(nhifLine);
      }
    }

    // ── 5. WCF (employer-only) ──────────────────────────────────────────────
    const wcfRule = employee.isPublicSector ? ref.wcfPublicRule : ref.wcfPrivateRule;
    if (wcfRule) {
      lines.push(calculateWcf(grossPay, wcfRule));
    }

    // ── 6. SDL (employer-only, threshold ≥ 10 employees) ───────────────────
    if (ref.sdlRule) {
      const sdlLine = calculateSdl(grossPay, context, ref.sdlRule);
      if (sdlLine) lines.push(sdlLine);
    }

    const totalEmployeeStatutory = round2(
      lines.reduce((s, l) => s + l.employeeContribution, 0),
    );
    const totalEmployerStatutory = round2(
      lines.reduce((s, l) => s + l.employerContribution, 0),
    );

    return {
      grossPay,
      taxableIncome,
      totalEmployeeStatutory,
      totalEmployerStatutory,
      netPay: round2(grossPay - totalEmployeeStatutory),
      lines,
    };
  }
}
