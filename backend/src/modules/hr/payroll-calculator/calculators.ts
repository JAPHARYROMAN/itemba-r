/**
 * Pure calculator functions for Tanzanian payroll.
 *
 * Each function takes the inputs it needs and returns a `StatutoryLine` (or
 * null when the employee is not subject to that contribution). No DB access,
 * no side effects — fully unit-testable.
 *
 * Calculation order follows TRA practice:
 *   1. NSSF/PSSSF on pensionable income (typically gross). Employee
 *      contribution is **deductible against PAYE**.
 *   2. PAYE on (gross − NSSF employee − non-taxable allowances), with PWD
 *      relief applied to the resulting tax liability.
 *   3. HESLB on basic salary (15%) for active borrowers.
 *   4. NHIF (placeholder rate; sectoral schemes vary).
 *   5. WCF and SDL — employer-only, on gross.
 */

import type {
  CalculatorEmployee,
  CalculatorContext,
  PayeBracket,
  StatutoryLine,
  StatutoryRule,
} from './types';

/** TRA PWD relief: TZS 180,000/year = TZS 15,000/month, deducted from PAYE liability. */
export const PWD_MONTHLY_RELIEF = 15_000;

/** Below ten employees, SDL doesn't apply. */
export const SDL_EMPLOYEE_COUNT_THRESHOLD = 10;

/** Tanzanian non-resident employees pay a flat 15% PAYE on emoluments. */
export const NON_RESIDENT_PAYE_RATE = 0.15;

/** Round to 2 decimal places — TZS official precision. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── PAYE ────────────────────────────────────────────────────────────────────

export interface PayeStep {
  tier: number;
  fromAmount: number;
  toAmount: number | null;
  taxedInTier: number;
  marginalRate: number;
  taxFromTier: number;
}

export interface PayeResult {
  paye: number;
  rawPaye: number; // before PWD relief
  pwdRelief: number;
  steps: PayeStep[];
  appliedRate?: number; // for non-resident flat rate; undefined for tiered
}

/**
 * Compute PAYE for a resident employee using the tiered band table.
 * Bands are interpreted as monthly thresholds.
 *
 * For a salary in tier N:
 *   PAYE = bracket.fixedAmount + (income − bracket.fromAmount) × bracket.marginalRate
 *
 * If the employee is PWD-certified, deduct TZS 15,000/month from the resulting
 * PAYE liability (floored at zero).
 */
export function calculatePayeResident(
  taxableIncome: number,
  brackets: PayeBracket[],
  employee: Pick<CalculatorEmployee, 'disabilityStatus'>,
): PayeResult {
  // Find the bracket the income falls into.
  const ordered = [...brackets].sort((a, b) => a.tierOrder - b.tierOrder);
  const steps: PayeStep[] = [];
  let raw = 0;

  for (const b of ordered) {
    const inTier =
      b.toAmount === null
        ? Math.max(0, taxableIncome - b.fromAmount)
        : Math.max(0, Math.min(taxableIncome, b.toAmount) - b.fromAmount);

    if (inTier <= 0 && taxableIncome <= b.fromAmount) {
      // No income reaches this tier — earlier tiers already covered everything.
      // Don't push step for this tier.
      continue;
    }

    // The PAYE table is encoded so that hitting a tier means
    // "fixedAmount + marginal * (income − fromAmount)" — we use the LAST tier
    // that fits. So we'll override `raw` rather than accumulate.
    if (taxableIncome > b.fromAmount) {
      const taxFromTier = b.fixedAmount + Math.max(0, taxableIncome - b.fromAmount) * b.marginalRate;
      raw = taxFromTier;
      steps.push({
        tier: b.tierOrder,
        fromAmount: b.fromAmount,
        toAmount: b.toAmount,
        taxedInTier: Math.max(0, taxableIncome - b.fromAmount),
        marginalRate: b.marginalRate,
        taxFromTier: round2(taxFromTier),
      });
    }
  }

  let pwdRelief = 0;
  if (employee.disabilityStatus === 'REGISTERED_PWD_CERTIFIED' && raw > 0) {
    pwdRelief = Math.min(PWD_MONTHLY_RELIEF, raw);
  }

  const paye = Math.max(0, raw - pwdRelief);
  return { paye: round2(paye), rawPaye: round2(raw), pwdRelief: round2(pwdRelief), steps };
}

/**
 * Non-resident PAYE — flat 15% on emoluments. PWD relief does not apply
 * (relief is reserved for resident PWD-certified employees).
 */
export function calculatePayeNonResident(taxableIncome: number): PayeResult {
  const paye = round2(taxableIncome * NON_RESIDENT_PAYE_RATE);
  return {
    paye,
    rawPaye: paye,
    pwdRelief: 0,
    steps: [],
    appliedRate: NON_RESIDENT_PAYE_RATE,
  };
}

// ─── NSSF / PSSSF (pension contributions) ───────────────────────────────────

/**
 * Pension contribution. Tanzania uses the same 10% + 10% structure for both
 * NSSF (private sector) and PSSSF (public sector); the rule passed in
 * determines which fund.
 *
 * Basis: pensionable income — in TZ practice this is typically gross pay
 * (basic + all allowances, before PAYE), with no upper cap.
 */
export function calculatePension(
  pensionableIncome: number,
  rule: StatutoryRule,
): StatutoryLine {
  const employeeContribution = round2(pensionableIncome * rule.employeeRate);
  const employerContribution = round2(pensionableIncome * rule.employerRate);
  return {
    taxTypeCode: rule.taxTypeCode,
    taxTypeId: rule.taxTypeId,
    ruleCode: rule.ruleCode,
    ruleId: rule.id,
    basis: 'PENSIONABLE',
    basisAmount: round2(pensionableIncome),
    employeeContribution,
    employerContribution,
    appliedRate: rule.employeeRate + rule.employerRate,
    calculationDetail: {
      employeeRate: rule.employeeRate,
      employerRate: rule.employerRate,
    },
  };
}

// ─── WCF (Workers Compensation Fund) — employer only ────────────────────────

export function calculateWcf(grossPay: number, rule: StatutoryRule): StatutoryLine {
  const employerContribution = round2(grossPay * rule.employerRate);
  return {
    taxTypeCode: rule.taxTypeCode,
    taxTypeId: rule.taxTypeId,
    ruleCode: rule.ruleCode,
    ruleId: rule.id,
    basis: 'GROSS',
    basisAmount: round2(grossPay),
    employeeContribution: 0,
    employerContribution,
    appliedRate: rule.employerRate,
    notes: 'Employer-only contribution — no impact on net pay.',
  };
}

// ─── SDL (Skills Development Levy) — employer only, ≥ 10 employees ─────────

/**
 * Returns null if the company has fewer than 10 employees (SDL exemption).
 */
export function calculateSdl(
  grossPay: number,
  context: CalculatorContext,
  rule: StatutoryRule,
): StatutoryLine | null {
  if (context.companyEmployeeCount < SDL_EMPLOYEE_COUNT_THRESHOLD) return null;

  const employerContribution = round2(grossPay * rule.employerRate);
  return {
    taxTypeCode: rule.taxTypeCode,
    taxTypeId: rule.taxTypeId,
    ruleCode: rule.ruleCode,
    ruleId: rule.id,
    basis: 'GROSS',
    basisAmount: round2(grossPay),
    employeeContribution: 0,
    employerContribution,
    appliedRate: rule.employerRate,
    notes: `Employer-only. Threshold met (${context.companyEmployeeCount} ≥ ${SDL_EMPLOYEE_COUNT_THRESHOLD} employees).`,
  };
}

// ─── NHIF — placeholder ─────────────────────────────────────────────────────

export function calculateNhif(grossPay: number, rule: StatutoryRule): StatutoryLine {
  const employeeContribution = round2(grossPay * rule.employeeRate);
  const employerContribution = round2(grossPay * rule.employerRate);
  return {
    taxTypeCode: rule.taxTypeCode,
    taxTypeId: rule.taxTypeId,
    ruleCode: rule.ruleCode,
    ruleId: rule.id,
    basis: 'GROSS',
    basisAmount: round2(grossPay),
    employeeContribution,
    employerContribution,
    appliedRate: rule.employeeRate + rule.employerRate,
    notes: 'NHIF — adjust per scheme. Universal Health Insurance Act, 2023.',
  };
}

// ─── HESLB — graduate loan repayment ────────────────────────────────────────

/**
 * Returns null if the employee is not flagged as an active HESLB borrower.
 * Otherwise: 15% of basic pay (per HESLB regulations).
 */
export function calculateHeslb(
  basicPay: number,
  employee: Pick<CalculatorEmployee, 'heslbBorrower'>,
  rule: StatutoryRule,
): StatutoryLine | null {
  if (!employee.heslbBorrower) return null;
  const employeeContribution = round2(basicPay * rule.employeeRate);
  return {
    taxTypeCode: rule.taxTypeCode,
    taxTypeId: rule.taxTypeId,
    ruleCode: rule.ruleCode,
    ruleId: rule.id,
    basis: 'BASIC',
    basisAmount: round2(basicPay),
    employeeContribution,
    employerContribution: 0,
    appliedRate: rule.employeeRate,
    notes: 'Active HESLB borrower — 15% of basic pay.',
  };
}
