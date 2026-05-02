/**
 * Pure types for the Tanzanian payroll calculation engine.
 *
 * Calculator functions consume `CalculatorInput` + `ReferenceData` and emit
 * `StatutoryLine` rows that the orchestrator persists as `PayrollStatutoryLine`.
 *
 * No Prisma imports here — the types reference Prisma enums by string union to
 * keep the module pure and unit-testable without a DB.
 */

import type {
  DisabilityStatus,
  EmployeeTaxResidency,
  HolidayRegion,
  PayrollStatutoryBasis,
} from '@prisma/client';

/** What we know about a single employee for one payroll period. */
export interface CalculatorEmployee {
  id: string;
  payrollRegion: HolidayRegion; // MAINLAND vs ZANZIBAR — picks the PAYE table
  taxResidencyStatus: EmployeeTaxResidency;
  disabilityStatus: DisabilityStatus;
  heslbBorrower: boolean;
  /**
   * If true, NSSF/WCF rules for the **public sector** are used (PSSSF / 1.0% WCF).
   * Otherwise the private-sector rules are used (NSSF / 0.5% WCF).
   */
  isPublicSector?: boolean;
}

/** Per-employee monetary inputs for the period. */
export interface CalculatorEarnings {
  basicPay: number;
  /** Sum of allowances flagged `taxable: true` on `AllowanceType`. */
  taxableAllowances: number;
  /** Sum of allowances flagged `taxable: false` on `AllowanceType`. */
  nonTaxableAllowances: number;
  overtimePay: number;
}

/** Context the orchestrator gathers once per payroll run. */
export interface CalculatorContext {
  /** Number of active employees on the company — used for the SDL ≥ 10 threshold. */
  companyEmployeeCount: number;
}

export interface CalculatorInput {
  employee: CalculatorEmployee;
  earnings: CalculatorEarnings;
  context: CalculatorContext;
}

// ─── Reference data, fetched from the DB by the orchestrator ─────────────────

export interface PayeBracket {
  tierOrder: number;
  fromAmount: number;
  /** null = top tier, open-ended */
  toAmount: number | null;
  marginalRate: number;
  fixedAmount: number;
}

export interface StatutoryRule {
  id: string;
  ruleCode: string;
  taxTypeCode: string;
  taxTypeId: string;
  /** Maps to `StatutoryDeductionCalcMethod` from Prisma. Used for routing. */
  calculationMethod: 'PERCENTAGE_OF_GROSS' | 'PERCENTAGE_OF_BASIC' | 'FIXED_AMOUNT' | 'TIERED' | 'MANUAL';
  employeeRate: number;
  employerRate: number;
  fixedAmount?: number;
}

export interface ReferenceData {
  /** PAYE brackets for the employee's region, ordered by tierOrder ascending. */
  payeBrackets: PayeBracket[];
  payeTaxTypeId: string;
  payeTaxRateId: string;

  nssfRule?: StatutoryRule;
  pssfRule?: StatutoryRule;
  wcfPrivateRule?: StatutoryRule;
  wcfPublicRule?: StatutoryRule;
  sdlRule?: StatutoryRule;
  nhifRule?: StatutoryRule;
  heslbRule?: StatutoryRule;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface StatutoryLine {
  taxTypeCode: string;
  taxTypeId: string;
  ruleCode?: string;
  ruleId?: string;
  taxRateId?: string;
  basis: PayrollStatutoryBasis;
  basisAmount: number;
  employeeContribution: number;
  employerContribution: number;
  appliedRate?: number;
  /** Trace data — bracket steps for PAYE, threshold checks, etc. */
  calculationDetail?: Record<string, unknown>;
  notes?: string;
}

export interface CalculatorOutput {
  // Components
  grossPay: number;
  taxableIncome: number;

  // Contributions / deductions (employee side reduces net pay)
  totalEmployeeStatutory: number;
  totalEmployerStatutory: number;

  netPay: number;
  lines: StatutoryLine[];
}
