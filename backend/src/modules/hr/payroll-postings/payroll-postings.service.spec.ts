import { Prisma } from '@prisma/client';
import { PayrollPostingsService } from './payroll-postings.service';

/**
 * COA codes the accrual may resolve. Any code queried by postRun must appear
 * here (id === code for easy assertion).
 */
const COA_CODES = [
  '2210', // PAYE Payable
  '2220', // NSSF Payable
  '2225', // PSSSF Payable
  '2230', // WCF Payable
  '2240', // SDL Payable
  '2250', // NHIF Payable
  '2260', // HESLB Payable
  '2270', // Salaries Payable (Net)
  '2280', // Other Payroll Deductions Payable
  '1110', // Employee Receivable
  '6000', // Salaries Expense
  '6040', // NSSF Employer Contribution
  '6045', // PSSSF Employer Contribution
  '6050', // WCF Expense
  '6060', // SDL Expense
  '6070', // NHIF Employer Contribution
];

type StatLine = {
  taxTypeCode: string;
  employeeContribution: string;
  employerContribution: string;
};
type Deduction = { amount: string; statutory: boolean; salaryAdvanceId: string | null };
type Entry = {
  grossPay: string;
  netPay: string;
  statutoryLines: StatLine[];
  deductions: Deduction[];
};

function makeService(entries: Entry[], coa: string[] = COA_CODES) {
  let createdJe: any = null;
  const prisma: any = {
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'run-1',
        companyId: 'company-1',
        journalEntryId: null,
        payrollRunNumber: 'PR-001',
        runDate: new Date('2026-06-30'),
        company: { id: 'company-1', name: 'Acme' },
        payrollPeriod: {
          paymentDate: new Date('2026-06-30'),
          endDate: new Date('2026-06-30'),
          name: 'June 2026',
        },
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    journalEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        createdJe = {
          ...data,
          lines: (data.lines?.create ?? []).map((l: any) => ({ ...l })),
        };
        return { id: 'je-1', ...createdJe };
      }),
    },
    payrollEntry: {
      findMany: jest.fn().mockImplementation(async () =>
        entries.map((e) => ({
          grossPay: new Prisma.Decimal(e.grossPay),
          netPay: new Prisma.Decimal(e.netPay),
          statutoryLines: e.statutoryLines.map((s) => ({
            employeeContribution: new Prisma.Decimal(s.employeeContribution),
            employerContribution: new Prisma.Decimal(s.employerContribution),
            taxType: { taxTypeCode: s.taxTypeCode },
          })),
          deductions: e.deductions.map((d) => ({
            amount: new Prisma.Decimal(d.amount),
            statutory: d.statutory,
            salaryAdvanceId: d.salaryAdvanceId,
          })),
        })),
      ),
    },
    chartOfAccount: {
      findMany: jest
        .fn()
        .mockImplementation(async ({ where }: any) =>
          coa
            .filter((c) => where.accountCode.in.includes(c))
            .map((c) => ({ id: c, accountCode: c })),
        ),
    },
  };
  const codes: any = { next: jest.fn().mockResolvedValue('JE-0001') };
  const service = new PayrollPostingsService(prisma, codes);
  return { service, prisma, getJe: () => createdJe };
}

function lineFor(je: any, accountId: string) {
  return je.lines.find((l: any) => l.accountId === accountId);
}
function sum(je: any, key: 'debit' | 'credit') {
  return je.lines.reduce(
    (s: Prisma.Decimal, l: any) => s.plus(new Prisma.Decimal(l[key])),
    new Prisma.Decimal(0),
  );
}

describe('PayrollPostingsService.postRun — accrual balance', () => {
  it('balances with statutory only', async () => {
    const { service, getJe } = makeService([
      {
        grossPay: '1000000',
        netPay: '900000', // gross - 100000 PAYE
        statutoryLines: [
          { taxTypeCode: 'PAYE_MAINLAND', employeeContribution: '100000', employerContribution: '0' },
        ],
        deductions: [],
      },
    ]);
    await service.postRun('run-1', 'user-1');
    const je = getJe();
    expect(sum(je, 'debit').equals(sum(je, 'credit'))).toBe(true);
    expect(new Prisma.Decimal(je.totalDebit).equals(new Prisma.Decimal(je.totalCredit))).toBe(true);
  });

  it('balances when a non-statutory deduction (e.g. housing loan) is withheld', async () => {
    // gross 1,000,000; PAYE 0; non-statutory 50,000 => net 950,000
    const { service, getJe } = makeService([
      {
        grossPay: '1000000',
        netPay: '950000',
        statutoryLines: [],
        deductions: [{ amount: '50000', statutory: false, salaryAdvanceId: null }],
      },
    ]);
    await service.postRun('run-1', 'user-1');
    const je = getJe();
    expect(sum(je, 'debit').equals(sum(je, 'credit'))).toBe(true);
    // Other Payroll Deductions Payable (2280) credited for the withheld amount.
    const other = lineFor(je, '2280');
    expect(other).toBeDefined();
    expect(new Prisma.Decimal(other.credit).equals(new Prisma.Decimal('50000'))).toBe(true);
  });

  it('balances and credits Employee Receivable (1110) when an advance is recovered', async () => {
    // gross 1,000,000; advance recovery 50,000 => net 950,000
    const { service, getJe } = makeService([
      {
        grossPay: '1000000',
        netPay: '950000',
        statutoryLines: [],
        deductions: [{ amount: '50000', statutory: false, salaryAdvanceId: 'adv-1' }],
      },
    ]);
    await service.postRun('run-1', 'user-1');
    const je = getJe();
    expect(sum(je, 'debit').equals(sum(je, 'credit'))).toBe(true);
    // Advance recovery credits 1110 to relieve the receivable asset.
    const recv = lineFor(je, '1110');
    expect(recv).toBeDefined();
    expect(new Prisma.Decimal(recv.credit).equals(new Prisma.Decimal('50000'))).toBe(true);
    // Not miscategorised as an other-deductions payable.
    expect(lineFor(je, '2280')).toBeUndefined();
  });

  it('balances with the full mix: statutory + non-statutory + advance recovery', async () => {
    // gross 1,000,000
    //  - PAYE (ee) 120,000
    //  - NSSF ee 100,000 / er 100,000
    //  - non-statutory 30,000
    //  - advance recovery 40,000
    // net = 1,000,000 - 120,000 - 100,000 - 30,000 - 40,000 = 710,000
    const { service, getJe } = makeService([
      {
        grossPay: '1000000',
        netPay: '710000',
        statutoryLines: [
          { taxTypeCode: 'PAYE_MAINLAND', employeeContribution: '120000', employerContribution: '0' },
          { taxTypeCode: 'NSSF', employeeContribution: '100000', employerContribution: '100000' },
        ],
        deductions: [
          { amount: '30000', statutory: false, salaryAdvanceId: null },
          { amount: '40000', statutory: false, salaryAdvanceId: 'adv-1' },
        ],
      },
    ]);
    await service.postRun('run-1', 'user-1');
    const je = getJe();
    expect(sum(je, 'debit').equals(sum(je, 'credit'))).toBe(true);

    // Debits: gross 1,000,000 + NSSF employer 100,000 = 1,100,000
    expect(sum(je, 'debit').equals(new Prisma.Decimal('1100000'))).toBe(true);
    // Credit buckets.
    expect(new Prisma.Decimal(lineFor(je, '2210').credit).equals(new Prisma.Decimal('120000'))).toBe(
      true,
    );
    expect(new Prisma.Decimal(lineFor(je, '2220').credit).equals(new Prisma.Decimal('200000'))).toBe(
      true,
    );
    expect(new Prisma.Decimal(lineFor(je, '2280').credit).equals(new Prisma.Decimal('30000'))).toBe(
      true,
    );
    expect(new Prisma.Decimal(lineFor(je, '1110').credit).equals(new Prisma.Decimal('40000'))).toBe(
      true,
    );
    expect(new Prisma.Decimal(lineFor(je, '2270').credit).equals(new Prisma.Decimal('710000'))).toBe(
      true,
    );
  });

  it('throws a clear error if the advance-recovery bucket needs 1110 but it is unseeded', async () => {
    const coaWithout1110 = COA_CODES.filter((c) => c !== '1110');
    const { service } = makeService(
      [
        {
          grossPay: '1000000',
          netPay: '950000',
          statutoryLines: [],
          deductions: [{ amount: '50000', statutory: false, salaryAdvanceId: 'adv-1' }],
        },
      ],
      coaWithout1110,
    );
    await expect(service.postRun('run-1', 'user-1')).rejects.toThrow(/1110/);
  });
});
