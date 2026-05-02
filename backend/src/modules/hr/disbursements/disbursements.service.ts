import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Generates payroll disbursement files for a payroll run. Each Tanzanian bank
 * accepts a slightly different upload format on its corporate portal, so the
 * service emits **multiple files** keyed by destination:
 *
 *  - `bank_<BANKNAME>.csv` — one CSV per distinct bank present in the run.
 *    Generic columns (account #, name, amount, reference) that all major TZ
 *    bank portals (CRDB iBanking Corporate, NMB, NBC, Stanbic) accept.
 *  - `mobilemoney_<PROVIDER>.csv` — one CSV per mobile-money provider used in
 *    the run. Columns: msisdn, name, amount, reference. Suitable for upload
 *    to M-Pesa B2C bulk, Tigo Pesa Pro, Airtel Money batch.
 *  - `unmapped.csv` — employees with no bank or mobile-money preference set.
 *    Operator must finalise their payment method before the run can be marked
 *    PAID.
 *
 * The function does NOT call provider APIs — that's a future Phase 4.5 with
 * proper credentials, idempotency keys, and webhook handling. File generation
 * matches what TZ payroll teams do today: download, sign-off, upload to the
 * portal manually.
 */
@Injectable()
export class DisbursementsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForRun(payrollRunId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: payrollRunId, deletedAt: null },
      include: { company: { select: { id: true, code: true, name: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!['CALCULATED', 'APPROVED', 'PAID'].includes(run.status)) {
      throw new BadRequestException(
        'Disbursement files can only be generated for CALCULATED, APPROVED, or PAID runs.',
      );
    }

    const entries = await this.prisma.payrollEntry.findMany({
      where: { payrollRunId, deletedAt: null },
      include: {
        employee: {
          include: {
            mobileMoneyAccounts: {
              where: { deletedAt: null, status: 'ACTIVE' },
              orderBy: { isPrimary: 'desc' },
            },
          },
        },
      },
      orderBy: { employee: { fullName: 'asc' } },
    });

    interface PayLine {
      employeeId: string;
      employeeCode: string;
      fullName: string;
      netPay: number;
      reference: string;
    }

    const bankBuckets = new Map<string, PayLine[]>();
    const mmBuckets = new Map<string, PayLine[]>();
    const unmapped: PayLine[] = [];

    for (const entry of entries) {
      const e = entry.employee;
      const line: PayLine = {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName ?? `${e.firstName} ${e.lastName}`,
        netPay: round2(Number(entry.netPay)),
        reference: `${run.payrollRunNumber} ${e.employeeCode}`.slice(0, 50),
      };

      // Skip zero / negative net (no money to send).
      if (line.netPay <= 0) continue;

      // Preference: bank account first, then primary mobile money. Operators can
      // override by clearing one or the other on the employee record.
      if (e.bankAccountNumber && e.bankName) {
        const key = e.bankName.trim();
        if (!bankBuckets.has(key)) bankBuckets.set(key, []);
        bankBuckets.get(key)!.push(line);
      } else if (e.mobileMoneyAccounts.length > 0) {
        const primary = e.mobileMoneyAccounts[0];
        const key = primary.provider;
        if (!mmBuckets.has(key)) mmBuckets.set(key, []);
        mmBuckets.get(key)!.push({ ...line, reference: `${line.reference} ${primary.msisdn}` });
      } else {
        unmapped.push(line);
      }
    }

    // ── Build files ─────────────────────────────────────────────────────────
    const files: Array<{ filename: string; mimeType: string; rowCount: number; total: number; content: string }> = [];

    for (const [bankName, lines] of bankBuckets) {
      // Need each line's bank account number — re-look from entries because
      // PayLine doesn't carry it.
      const enriched = entries
        .filter((e) => lines.some((l) => l.employeeId === e.employeeId))
        .map((e) => {
          const line = lines.find((l) => l.employeeId === e.employeeId)!;
          return {
            employeeCode: line.employeeCode,
            fullName: line.fullName,
            accountName: e.employee.bankAccountName ?? line.fullName,
            accountNumber: e.employee.bankAccountNumber!,
            netPay: line.netPay,
            reference: line.reference,
          };
        });
      files.push(buildBankFile(run.company.code, run.payrollRunNumber, bankName, enriched));
    }

    for (const [provider, lines] of mmBuckets) {
      const enriched = entries
        .filter((e) => lines.some((l) => l.employeeId === e.employeeId))
        .map((e) => {
          const line = lines.find((l) => l.employeeId === e.employeeId)!;
          const primary = e.employee.mobileMoneyAccounts[0];
          return {
            employeeCode: line.employeeCode,
            fullName: line.fullName,
            accountName: primary.accountName ?? line.fullName,
            msisdn: primary.msisdn,
            netPay: line.netPay,
            reference: line.reference,
          };
        });
      files.push(buildMobileMoneyFile(run.company.code, run.payrollRunNumber, provider, enriched));
    }

    if (unmapped.length > 0) {
      files.push(buildUnmappedFile(run.payrollRunNumber, unmapped));
    }

    return {
      runNumber: run.payrollRunNumber,
      companyName: run.company.name,
      generatedAt: new Date().toISOString(),
      summary: {
        totalEmployees: entries.length,
        viaBank: Array.from(bankBuckets.values()).reduce((s, l) => s + l.length, 0),
        viaMobileMoney: Array.from(mmBuckets.values()).reduce((s, l) => s + l.length, 0),
        unmapped: unmapped.length,
      },
      files,
    };
  }
}

interface BankRow {
  employeeCode: string;
  fullName: string;
  accountName: string;
  accountNumber: string;
  netPay: number;
  reference: string;
}

function buildBankFile(companyCode: string, runNumber: string, bankName: string, rows: BankRow[]) {
  const safeBank = bankName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const filename = `bank_${safeBank}_${companyCode}_${runNumber}.csv`;
  const header = 'EmployeeCode,FullName,AccountName,AccountNumber,Amount,Reference';
  const body = rows.map((r) =>
    [
      csvField(r.employeeCode),
      csvField(r.fullName),
      csvField(r.accountName),
      csvField(r.accountNumber),
      r.netPay.toFixed(2),
      csvField(r.reference),
    ].join(','),
  );
  const total = rows.reduce((s, r) => s + r.netPay, 0);
  body.push(['TOTAL', '', '', '', total.toFixed(2), `${rows.length} payments`].join(','));
  return {
    filename,
    mimeType: 'text/csv',
    rowCount: rows.length,
    total: round2(total),
    content: [header, ...body].join('\n'),
  };
}

interface MmRow {
  employeeCode: string;
  fullName: string;
  accountName: string;
  msisdn: string;
  netPay: number;
  reference: string;
}

function buildMobileMoneyFile(companyCode: string, runNumber: string, provider: string, rows: MmRow[]) {
  const safeProvider = provider.toUpperCase();
  const filename = `mobilemoney_${safeProvider}_${companyCode}_${runNumber}.csv`;
  const header = 'EmployeeCode,FullName,AccountName,MSISDN,Amount,Reference';
  const body = rows.map((r) =>
    [
      csvField(r.employeeCode),
      csvField(r.fullName),
      csvField(r.accountName),
      csvField(r.msisdn),
      r.netPay.toFixed(2),
      csvField(r.reference),
    ].join(','),
  );
  const total = rows.reduce((s, r) => s + r.netPay, 0);
  body.push(['TOTAL', '', '', '', total.toFixed(2), `${rows.length} payments`].join(','));
  return {
    filename,
    mimeType: 'text/csv',
    rowCount: rows.length,
    total: round2(total),
    content: [header, ...body].join('\n'),
  };
}

function buildUnmappedFile(runNumber: string, rows: { employeeCode: string; fullName: string; netPay: number; reference: string }[]) {
  const filename = `unmapped_${runNumber}.csv`;
  const header = 'EmployeeCode,FullName,Amount,Reference,Reason';
  const body = rows.map((r) =>
    [
      csvField(r.employeeCode),
      csvField(r.fullName),
      r.netPay.toFixed(2),
      csvField(r.reference),
      'No bank or active mobile money account on file',
    ].join(','),
  );
  const total = rows.reduce((s, r) => s + r.netPay, 0);
  return {
    filename,
    mimeType: 'text/csv',
    rowCount: rows.length,
    total: round2(total),
    content: [header, ...body].join('\n'),
  };
}

/** RFC 4180 — wrap fields containing commas, quotes, or newlines; double internal quotes. */
function csvField(s: string): string {
  if (s == null) return '';
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
