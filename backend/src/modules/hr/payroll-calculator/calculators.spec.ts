/**
 * Reference scenarios for the Tanzanian payroll calculator. Each test pins a
 * specific gross/scenario to a hand-calculated expected outcome — if any
 * calculator function drifts, these break loudly.
 *
 * Sources:
 *   - PAYE Mainland 2024/25 monthly bands (TRA Income Tax Act, First Schedule)
 *   - NSSF Act, Cap. 105 (10% + 10%)
 *   - Workers Compensation Act, 2008 (0.5% private sector)
 *   - Skills Development Levy (3.5%, ≥ 10 employees)
 *   - HESLB Act (15% of basic for active borrowers)
 */

import {
  PayeBracket,
  StatutoryRule,
  CalculatorEmployee,
  CalculatorContext,
} from './types';
import {
  calculatePayeResident,
  calculatePayeNonResident,
  calculatePension,
  calculateWcf,
  calculateSdl,
  calculateHeslb,
  PWD_MONTHLY_RELIEF,
  SDL_EMPLOYEE_COUNT_THRESHOLD,
} from './calculators';

const PAYE_BRACKETS: PayeBracket[] = [
  { tierOrder: 1, fromAmount: 0, toAmount: 270_000, marginalRate: 0, fixedAmount: 0 },
  { tierOrder: 2, fromAmount: 270_000, toAmount: 520_000, marginalRate: 0.08, fixedAmount: 0 },
  { tierOrder: 3, fromAmount: 520_000, toAmount: 760_000, marginalRate: 0.2, fixedAmount: 20_000 },
  { tierOrder: 4, fromAmount: 760_000, toAmount: 1_000_000, marginalRate: 0.25, fixedAmount: 68_000 },
  { tierOrder: 5, fromAmount: 1_000_000, toAmount: null, marginalRate: 0.3, fixedAmount: 128_000 },
];

const NSSF_RULE: StatutoryRule = {
  id: 'rule-nssf',
  ruleCode: 'NSSF_PRIVATE',
  taxTypeCode: 'NSSF',
  taxTypeId: 'tt-nssf',
  calculationMethod: 'PERCENTAGE_OF_GROSS',
  employeeRate: 0.1,
  employerRate: 0.1,
};

const WCF_RULE: StatutoryRule = {
  id: 'rule-wcf',
  ruleCode: 'WCF_PRIVATE',
  taxTypeCode: 'WCF',
  taxTypeId: 'tt-wcf',
  calculationMethod: 'PERCENTAGE_OF_GROSS',
  employeeRate: 0,
  employerRate: 0.005,
};

const SDL_RULE: StatutoryRule = {
  id: 'rule-sdl',
  ruleCode: 'SDL',
  taxTypeCode: 'SDL',
  taxTypeId: 'tt-sdl',
  calculationMethod: 'PERCENTAGE_OF_GROSS',
  employeeRate: 0,
  employerRate: 0.035,
};

const HESLB_RULE: StatutoryRule = {
  id: 'rule-heslb',
  ruleCode: 'HESLB',
  taxTypeCode: 'HESLB',
  taxTypeId: 'tt-heslb',
  calculationMethod: 'PERCENTAGE_OF_BASIC',
  employeeRate: 0.15,
  employerRate: 0,
};

const baseEmployee: CalculatorEmployee = {
  id: 'emp-1',
  payrollRegion: 'MAINLAND' as const,
  taxResidencyStatus: 'RESIDENT' as const,
  disabilityStatus: 'NONE' as const,
  heslbBorrower: false,
};

describe('PAYE — resident, tiered bands', () => {
  it('zero PAYE on income under TZS 270,000', () => {
    const r = calculatePayeResident(250_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(0);
    expect(r.rawPaye).toBe(0);
  });

  it('boundary at TZS 270,000 — still tax-free', () => {
    const r = calculatePayeResident(270_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(0);
  });

  it('TZS 400,000 → tier 2 → 8% × (400k − 270k) = 10,400', () => {
    const r = calculatePayeResident(400_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(10_400);
  });

  it('TZS 600,000 → tier 3 → 20,000 + 20% × (600k − 520k) = 36,000', () => {
    const r = calculatePayeResident(600_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(36_000);
  });

  it('TZS 850,000 → tier 4 → 68,000 + 25% × (850k − 760k) = 90,500', () => {
    const r = calculatePayeResident(850_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(90_500);
  });

  it('TZS 1,500,000 → tier 5 → 128,000 + 30% × (1.5M − 1M) = 278,000', () => {
    const r = calculatePayeResident(1_500_000, PAYE_BRACKETS, baseEmployee);
    expect(r.paye).toBe(278_000);
  });

  it('PWD-certified employee gets TZS 15,000 monthly relief', () => {
    const employeeWithPWD = {
      ...baseEmployee,
      disabilityStatus: 'REGISTERED_PWD_CERTIFIED' as const,
    };
    const r = calculatePayeResident(850_000, PAYE_BRACKETS, employeeWithPWD);
    expect(r.rawPaye).toBe(90_500);
    expect(r.pwdRelief).toBe(PWD_MONTHLY_RELIEF);
    expect(r.paye).toBe(75_500);
  });

  it('PWD relief floors at zero — never refundable', () => {
    const employeeWithPWD = {
      ...baseEmployee,
      disabilityStatus: 'REGISTERED_PWD_CERTIFIED' as const,
    };
    const r = calculatePayeResident(280_000, PAYE_BRACKETS, employeeWithPWD); // tax = 800
    expect(r.rawPaye).toBe(800);
    expect(r.pwdRelief).toBe(800); // capped at the raw PAYE
    expect(r.paye).toBe(0);
  });
});

describe('PAYE — non-resident flat 15%', () => {
  it('TZS 850,000 → 850,000 × 15% = 127,500', () => {
    const r = calculatePayeNonResident(850_000);
    expect(r.paye).toBe(127_500);
    expect(r.appliedRate).toBe(0.15);
    expect(r.pwdRelief).toBe(0);
  });
});

describe('NSSF / pension', () => {
  it('TZS 1,000,000 → 10% employee + 10% employer = 100k each', () => {
    const line = calculatePension(1_000_000, NSSF_RULE);
    expect(line.employeeContribution).toBe(100_000);
    expect(line.employerContribution).toBe(100_000);
    expect(line.basis).toBe('PENSIONABLE');
  });
});

describe('WCF', () => {
  it('Private sector 0.5% employer-only on TZS 1,000,000 = 5,000', () => {
    const line = calculateWcf(1_000_000, WCF_RULE);
    expect(line.employerContribution).toBe(5_000);
    expect(line.employeeContribution).toBe(0);
  });
});

describe('SDL', () => {
  const ctxAbove: CalculatorContext = { companyEmployeeCount: 50 };
  const ctxBelow: CalculatorContext = { companyEmployeeCount: 9 };

  it('exempt below 10-employee threshold', () => {
    expect(calculateSdl(1_000_000, ctxBelow, SDL_RULE)).toBeNull();
  });

  it('boundary: exactly 10 employees triggers SDL', () => {
    const line = calculateSdl(1_000_000, { companyEmployeeCount: SDL_EMPLOYEE_COUNT_THRESHOLD }, SDL_RULE);
    expect(line).not.toBeNull();
    expect(line!.employerContribution).toBe(35_000);
  });

  it('3.5% employer-only on TZS 1,000,000 = 35,000 (>= 10 employees)', () => {
    const line = calculateSdl(1_000_000, ctxAbove, SDL_RULE);
    expect(line!.employerContribution).toBe(35_000);
    expect(line!.employeeContribution).toBe(0);
  });
});

describe('HESLB', () => {
  it('skipped if employee is not an active borrower', () => {
    expect(calculateHeslb(800_000, baseEmployee, HESLB_RULE)).toBeNull();
  });

  it('15% of basic for active borrower (TZS 800,000 → 120,000)', () => {
    const line = calculateHeslb(800_000, { heslbBorrower: true }, HESLB_RULE);
    expect(line).not.toBeNull();
    expect(line!.employeeContribution).toBe(120_000);
    expect(line!.basis).toBe('BASIC');
  });
});
