import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';

/**
 * Generates a `JournalEntry` from a CALCULATED or APPROVED payroll run.
 *
 * **Accrual JE structure (debits = credits):**
 *
 *   Dr Salaries Expense                 (gross of all employees)
 *   Dr NSSF/PSSSF Employer Contribution (employer pension)
 *   Dr WCF Expense                      (WCF total)
 *   Dr SDL Expense                      (SDL total)
 *   Dr NHIF Employer Contribution       (employer NHIF, if any)
 *      Cr PAYE Payable                  (employee PAYE)
 *      Cr NSSF Payable                  (employee + employer NSSF)
 *      Cr PSSSF Payable                 (employee + employer PSSSF)
 *      Cr WCF Payable                   (WCF total)
 *      Cr SDL Payable                   (SDL total)
 *      Cr NHIF Payable                  (employee + employer NHIF)
 *      Cr HESLB Payable                 (HESLB total)
 *      Cr Salaries Payable (Net)        (sum of net pay)
 *
 * Account lookup is by `accountCode` (TZ payroll accounts seeded in
 * `seedFinance` default COA). If a code doesn't exist on the company, the
 * service raises a clear error rather than silently posting to a wrong
 * account.
 */

const ACCOUNT_CODES = {
  // Liabilities
  PAYE_PAYABLE: '2210',
  NSSF_PAYABLE: '2220',
  PSSSF_PAYABLE: '2225',
  WCF_PAYABLE: '2230',
  SDL_PAYABLE: '2240',
  NHIF_PAYABLE: '2250',
  HESLB_PAYABLE: '2260',
  SALARIES_PAYABLE: '2270',
  // Expenses
  SALARIES_EXPENSE: '6000',
  NSSF_EMPLOYER_EXPENSE: '6040',
  PSSSF_EMPLOYER_EXPENSE: '6045',
  WCF_EXPENSE: '6050',
  SDL_EXPENSE: '6060',
  NHIF_EMPLOYER_EXPENSE: '6070',
} as const;

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PayrollPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  /**
   * Build (and persist) the accrual JE for a payroll run.
   * Idempotent: if the run already has a journalEntryId, returns the existing
   * entry without creating a duplicate.
   */
  async postRun(payrollRunId: string, userId: string, tx?: Prisma.TransactionClient) {
    const db: DbClient = tx ?? this.prisma;
    const run = await db.payrollRun.findFirst({
      where: { id: payrollRunId, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        payrollPeriod: { select: { paymentDate: true, endDate: true, name: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.journalEntryId) {
      // Already posted — return existing JE.
      return db.journalEntry.findUnique({
        where: { id: run.journalEntryId },
        include: { lines: true },
      });
    }

    // Sum the entries.
    const entries = await db.payrollEntry.findMany({
      where: { payrollRunId, deletedAt: null },
      include: {
        statutoryLines: {
          include: { taxType: { select: { taxTypeCode: true } } },
        },
      },
    });
    if (entries.length === 0) {
      throw new BadRequestException('Run has no payroll entries — calculate it first.');
    }

    const totals = {
      grossPay: 0,
      netPay: 0,
      // Employee-side (credit payables)
      paye: 0,
      nssfEmployee: 0,
      psssfEmployee: 0,
      wcfEmployee: 0,
      sdlEmployee: 0,
      nhifEmployee: 0,
      heslb: 0,
      // Employer-side (debit expenses, credit payables)
      nssfEmployer: 0,
      psssfEmployer: 0,
      wcfEmployer: 0,
      sdlEmployer: 0,
      nhifEmployer: 0,
    };

    for (const e of entries) {
      totals.grossPay += Number(e.grossPay);
      totals.netPay += Number(e.netPay);
      for (const l of e.statutoryLines) {
        const code = l.taxType.taxTypeCode;
        const ee = Number(l.employeeContribution);
        const er = Number(l.employerContribution);
        switch (code) {
          case 'PAYE_MAINLAND':
          case 'PAYE_ZANZIBAR':
            totals.paye += ee;
            break;
          case 'NSSF':
            totals.nssfEmployee += ee;
            totals.nssfEmployer += er;
            break;
          case 'PSSSF':
            totals.psssfEmployee += ee;
            totals.psssfEmployer += er;
            break;
          case 'WCF':
            totals.wcfEmployer += er;
            break;
          case 'SDL':
            totals.sdlEmployer += er;
            break;
          case 'NHIF':
            totals.nhifEmployee += ee;
            totals.nhifEmployer += er;
            break;
          case 'HESLB':
            totals.heslb += ee;
            break;
        }
      }
    }

    // Resolve all required account ids on the company.
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId: run.companyId, deletedAt: null, accountCode: { in: Object.values(ACCOUNT_CODES) } },
      select: { id: true, accountCode: true },
    });
    const accountId = (code: string) => {
      const a = accounts.find((x) => x.accountCode === code);
      if (!a) {
        throw new BadRequestException(
          `Chart of accounts is missing code ${code}. Re-run the seed or add it manually.`,
        );
      }
      return a.id;
    };

    // Build lines — only include rows with non-zero amounts to keep the JE tidy.
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    const dr = (code: keyof typeof ACCOUNT_CODES, amount: number, description: string) => {
      if (amount > 0) lines.push({ accountId: accountId(ACCOUNT_CODES[code]), debit: round2(amount), credit: 0, description });
    };
    const cr = (code: keyof typeof ACCOUNT_CODES, amount: number, description: string) => {
      if (amount > 0) lines.push({ accountId: accountId(ACCOUNT_CODES[code]), debit: 0, credit: round2(amount), description });
    };

    // ── Debits ──────────────────────────────────────────────────────────────
    dr('SALARIES_EXPENSE', totals.grossPay, 'Gross wages — period accrual');
    dr('NSSF_EMPLOYER_EXPENSE', totals.nssfEmployer, 'NSSF employer contribution');
    dr('PSSSF_EMPLOYER_EXPENSE', totals.psssfEmployer, 'PSSSF employer contribution');
    dr('WCF_EXPENSE', totals.wcfEmployer, 'WCF — employer-only');
    dr('SDL_EXPENSE', totals.sdlEmployer, 'SDL — employer-only (≥ 10 employees)');
    dr('NHIF_EMPLOYER_EXPENSE', totals.nhifEmployer, 'NHIF employer contribution');

    // ── Credits ─────────────────────────────────────────────────────────────
    cr('PAYE_PAYABLE', totals.paye, 'PAYE withheld — to TRA');
    cr('NSSF_PAYABLE', totals.nssfEmployee + totals.nssfEmployer, 'NSSF (employee + employer)');
    cr('PSSSF_PAYABLE', totals.psssfEmployee + totals.psssfEmployer, 'PSSSF (employee + employer)');
    cr('WCF_PAYABLE', totals.wcfEmployer, 'WCF payable');
    cr('SDL_PAYABLE', totals.sdlEmployer, 'SDL payable — to TRA');
    cr('NHIF_PAYABLE', totals.nhifEmployee + totals.nhifEmployer, 'NHIF (employee + employer)');
    cr('HESLB_PAYABLE', totals.heslb, 'HESLB — to Loans Board');
    cr('SALARIES_PAYABLE', totals.netPay, 'Net pay accrued — to be disbursed');

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Journal entry would not balance: Dr ${totalDebit} vs Cr ${totalCredit}. Aborting post.`,
      );
    }

    // Create the JE.
    const txDate = run.payrollPeriod?.paymentDate ?? run.payrollPeriod?.endDate ?? run.runDate;
    const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: run.companyId, tx });
    const je = await db.journalEntry.create({
      data: {
        journalNumber,
        companyId: run.companyId,
        transactionDate: txDate,
        description: `Payroll accrual — ${run.payrollRunNumber}${run.payrollPeriod?.name ? ` (${run.payrollPeriod.name})` : ''}`,
        referenceType: 'PayrollRun',
        referenceId: run.id,
        status: 'DRAFT',
        totalDebit,
        totalCredit,
        createdById: userId,
        lines: {
          create: lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            companyId: run.companyId,
          })),
        },
      },
      include: { lines: true },
    });

    // Link the JE back to the payroll run for audit traceability.
    await db.payrollRun.update({
      where: { id: run.id },
      data: { journalEntryId: je.id },
    });

    return je;
  }

  /**
   * Post the **payment-side** journal entry — closes the loop opened by
   * `postRun()` (the accrual JE). Posted on `PATCH /payroll-runs/:id/pay`.
   *
   *   Dr Salaries Payable (Net)         (sum of net pay)
   *      Cr <disbursing account>        (sum of net pay)
   *
   * The credit side resolves to `run.disbursingChartOfAccountId` if the operator
   * specified one when paying (e.g. NMB Operating, M-Pesa Float, Petty Cash);
   * otherwise it falls back to the generic Bank account (1010). The JE is
   * linked back to the run via `payrollRun.paymentJournalEntryId`.
   *
   * Idempotent — checks for an existing payment JE referencing this run.
   */
  async postPayment(payrollRunId: string, userId: string, tx?: Prisma.TransactionClient) {
    const db: DbClient = tx ?? this.prisma;
    const run = await db.payrollRun.findFirst({
      where: { id: payrollRunId, deletedAt: null },
      include: {
        company: { select: { id: true } },
        payrollPeriod: { select: { paymentDate: true, name: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    // Idempotency — find any existing payment JE for this run.
    const existing = await db.journalEntry.findFirst({
      where: {
        companyId: run.companyId,
        referenceType: 'PayrollRunPayment',
        referenceId: run.id,
        deletedAt: null,
      },
      include: { lines: true },
    });
    if (existing) return existing;

    // Sum net pay across entries.
    const entriesAgg = await db.payrollEntry.aggregate({
      where: { payrollRunId, deletedAt: null },
      _sum: { netPay: true },
    });
    const totalNet = round2(Number(entriesAgg._sum.netPay ?? 0));
    if (totalNet <= 0) {
      throw new BadRequestException('Run has no net pay to disburse — calculate it first.');
    }

    // Resolve the disbursing (credit) account: prefer the run's specified
    // account, fall back to the generic Bank account (1010) if not set.
    let creditAccountId: string | undefined;
    let creditAccountLabel = 'bank transfer';
    if (run.disbursingChartOfAccountId) {
      const acct = await db.chartOfAccount.findFirst({
        where: { id: run.disbursingChartOfAccountId, companyId: run.companyId, deletedAt: null },
        select: { id: true, accountCode: true, accountName: true },
      });
      if (!acct) {
        throw new BadRequestException(
          'Selected disbursing account does not belong to this company or has been deleted.',
        );
      }
      creditAccountId = acct.id;
      creditAccountLabel = `${acct.accountCode} — ${acct.accountName}`;
    }

    // Resolve required accounts (Salaries Payable always; Bank only if needed as fallback).
    const codesToFetch = creditAccountId
      ? [ACCOUNT_CODES.SALARIES_PAYABLE]
      : [ACCOUNT_CODES.SALARIES_PAYABLE, '1010'];
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId: run.companyId, deletedAt: null, accountCode: { in: codesToFetch } },
      select: { id: true, accountCode: true },
    });
    const salariesPayableId = accounts.find((a) => a.accountCode === ACCOUNT_CODES.SALARIES_PAYABLE)?.id;
    if (!salariesPayableId) {
      throw new BadRequestException(
        'Missing chart of accounts entry — Salaries Payable (2270). Re-run the seed.',
      );
    }
    if (!creditAccountId) {
      creditAccountId = accounts.find((a) => a.accountCode === '1010')?.id;
      if (!creditAccountId) {
        throw new BadRequestException(
          'No disbursing account specified and fallback Bank (1010) is missing. Re-run the seed or pick an account.',
        );
      }
    }

    const txDate = run.payrollPeriod?.paymentDate ?? new Date();
    const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: run.companyId, tx });
    const je = await db.journalEntry.create({
      data: {
        journalNumber,
        companyId: run.companyId,
        transactionDate: txDate,
        description: `Payroll payment — ${run.payrollRunNumber}${run.payrollPeriod?.name ? ` (${run.payrollPeriod.name})` : ''}`,
        referenceType: 'PayrollRunPayment',
        referenceId: run.id,
        status: 'DRAFT',
        totalDebit: totalNet,
        totalCredit: totalNet,
        createdById: userId,
        lines: {
          create: [
            {
              accountId: salariesPayableId,
              description: 'Net pay disbursed — clear payable',
              debit: totalNet,
              credit: 0,
              companyId: run.companyId,
            },
            {
              accountId: creditAccountId,
              description: `Net pay disbursed via ${creditAccountLabel}`,
              debit: 0,
              credit: totalNet,
              companyId: run.companyId,
            },
          ],
        },
      },
      include: { lines: true },
    });

    // Link the payment JE back to the run for audit traceability.
    await db.payrollRun.update({
      where: { id: run.id },
      data: { paymentJournalEntryId: je.id },
    });

    return je;
  }

  /**
   * Post a journal entry for a salary advance disbursement:
   *
   *   Dr Employee Receivable (1110)     (advance amount)
   *      Cr Cash on Hand (1000)          (advance amount)
   *
   * The advance becomes an asset (receivable) until it is recovered through
   * payroll deductions, at which point payroll's accrual JE (which debits
   * Salaries Expense) implicitly reduces what the employee receives in cash —
   * the recovery effectively transfers from the advance receivable to net pay
   * via PayrollEntryDeduction.
   *
   * Idempotent — keyed on `advance.paymentJournalEntryId`.
   */
  async postAdvancePayment(advanceId: string, userId: string, tx?: Prisma.TransactionClient) {
    const db: DbClient = tx ?? this.prisma;
    const advance = await db.salaryAdvance.findFirst({
      where: { id: advanceId, deletedAt: null },
      include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
    });
    if (!advance) throw new NotFoundException('Salary advance not found');
    if (advance.paymentJournalEntryId) {
      return db.journalEntry.findUnique({
        where: { id: advance.paymentJournalEntryId },
        include: { lines: true },
      });
    }

    const amount = round2(Number(advance.amount));
    if (amount <= 0) throw new BadRequestException('Advance has no amount to post');

    const accounts = await db.chartOfAccount.findMany({
      where: { companyId: advance.companyId, deletedAt: null, accountCode: { in: ['1110', '1000'] } },
      select: { id: true, accountCode: true },
    });
    const receivableId = accounts.find((a) => a.accountCode === '1110')?.id;
    const cashId = accounts.find((a) => a.accountCode === '1000')?.id;
    if (!receivableId || !cashId) {
      throw new BadRequestException(
        'Missing chart of accounts entries — Employee Receivable (1110) and/or Cash on Hand (1000). Re-run the seed.',
      );
    }

    const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: advance.companyId, tx });
    const je = await db.journalEntry.create({
      data: {
        journalNumber,
        companyId: advance.companyId,
        transactionDate: advance.paidAt ?? new Date(),
        description: `Salary advance ${advance.advanceNumber} — ${advance.employee.fullName ?? advance.employee.employeeCode}`,
        referenceType: 'SalaryAdvance',
        referenceId: advance.id,
        status: 'DRAFT',
        totalDebit: amount,
        totalCredit: amount,
        createdById: userId,
        lines: {
          create: [
            { accountId: receivableId, description: `Advance to ${advance.employee.employeeCode}`, debit: amount, credit: 0, companyId: advance.companyId },
            { accountId: cashId, description: 'Cash disbursed for salary advance', debit: 0, credit: amount, companyId: advance.companyId },
          ],
        },
      },
      include: { lines: true },
    });

    await db.salaryAdvance.update({
      where: { id: advance.id },
      data: { paymentJournalEntryId: je.id },
    });

    return je;
  }

  /**
   * Post a re-classification JE that moves the project-allocated portion of
   * a payroll run's salaries from generic Salaries Expense (6000) into
   * Direct Project Labour Cost (5100). Reads the persisted
   * `ProjectCostAllocation` rows produced by `ConstructionLabourCostService.allocateForRun()`.
   *
   *   Dr Direct Project Labour Cost (5100)   (sum of allocatedTotalCost)
   *      Cr Salaries Expense (6000)          (sum of allocatedTotalCost)
   *
   * Net P&L impact is zero — this is a presentation reclassification so the
   * income statement breaks out construction labour from general salaries.
   *
   * Idempotent — keyed on `referenceType='PayrollRunLabourReclass'` + run.id.
   * No-ops when there are no allocations (e.g. the company has no project
   * employees this period).
   */
  async postLabourReclass(payrollRunId: string, userId: string, tx?: Prisma.TransactionClient) {
    const db: DbClient = tx ?? this.prisma;
    const run = await db.payrollRun.findFirst({
      where: { id: payrollRunId, deletedAt: null },
      include: { payrollPeriod: { select: { paymentDate: true, name: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    const existing = await db.journalEntry.findFirst({
      where: {
        companyId: run.companyId,
        referenceType: 'PayrollRunLabourReclass',
        referenceId: run.id,
        deletedAt: null,
      },
      include: { lines: true },
    });
    if (existing) return existing;

    const agg = await db.projectCostAllocation.aggregate({
      where: { payrollRunId },
      _sum: { allocatedTotalCost: true },
    });
    const reclassTotal = round2(Number(agg._sum.allocatedTotalCost ?? 0));
    if (reclassTotal <= 0) {
      // Nothing to reclassify — every entry was non-project (corporate office).
      return null;
    }

    const accounts = await db.chartOfAccount.findMany({
      where: { companyId: run.companyId, deletedAt: null, accountCode: { in: ['5100', ACCOUNT_CODES.SALARIES_EXPENSE] } },
      select: { id: true, accountCode: true },
    });
    const projectLabourId = accounts.find((a) => a.accountCode === '5100')?.id;
    const salariesExpenseId = accounts.find((a) => a.accountCode === ACCOUNT_CODES.SALARIES_EXPENSE)?.id;
    if (!projectLabourId || !salariesExpenseId) {
      throw new BadRequestException(
        'Missing chart of accounts entries — Direct Project Labour Cost (5100) and/or Salaries Expense (6000). Re-run the seed.',
      );
    }

    const txDate = run.payrollPeriod?.paymentDate ?? new Date();
    const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: run.companyId, tx });
    const je = await db.journalEntry.create({
      data: {
        journalNumber,
        companyId: run.companyId,
        transactionDate: txDate,
        description: `Project labour reclass — ${run.payrollRunNumber}${run.payrollPeriod?.name ? ` (${run.payrollPeriod.name})` : ''}`,
        referenceType: 'PayrollRunLabourReclass',
        referenceId: run.id,
        status: 'DRAFT',
        totalDebit: reclassTotal,
        totalCredit: reclassTotal,
        createdById: userId,
        lines: {
          create: [
            {
              accountId: projectLabourId,
              description: 'Project-allocated labour cost',
              debit: reclassTotal,
              credit: 0,
              companyId: run.companyId,
            },
            {
              accountId: salariesExpenseId,
              description: 'Reclassified out of generic salaries expense',
              debit: 0,
              credit: reclassTotal,
              companyId: run.companyId,
            },
          ],
        },
      },
      include: { lines: true },
    });

    return je;
  }

}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
