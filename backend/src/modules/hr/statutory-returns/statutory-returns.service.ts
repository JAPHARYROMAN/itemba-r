import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/**
 * Generates monthly Tanzanian statutory returns from data already persisted on
 * `payroll_statutory_lines` by the Phase 2 calculator. Each return:
 *   - Aggregates per-employee figures for the picked period
 *   - Returns structured rows + summary totals
 *   - Embeds an inline CSV the operator downloads and uploads to the relevant
 *     portal (TRA, NSSF, PSSSF, WCF, NHIF, HESLB)
 *
 * Files are NOT persisted. Returns are reproducible from the underlying lines,
 * so operators can regenerate any month at any time.
 */

export interface ReturnFilter {
  companyId: string;
  /** Calendar year (e.g. 2026). */
  year: number;
  /** Calendar month, 1-12. */
  month: number;
}

export interface CsvFile {
  filename: string;
  mimeType: string;
  rowCount: number;
  content: string;
}

export interface ReturnHeader {
  companyId: string;
  companyName: string;
  companyTin?: string | null;
  companyVrn?: string | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  taxType: string;
}

export interface PayeRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  tin?: string | null;
  nidaNumber?: string | null;
  taxableIncome: number;
  payeAmount: number;
}

export interface PensionRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  memberNumber: string | null | undefined;
  pensionableSalary: number;
  employeeContribution: number;
  employerContribution: number;
  totalContribution: number;
}

export interface WcfRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  wcfNumber: string | null | undefined;
  gross: number;
  rate: number | null;
  wcfAmount: number;
}

export interface SdlEmployeeRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  gross: number;
  sdlAmount: number;
}

export interface NhifRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  nhifNumber: string | null | undefined;
  employeeContribution: number;
  employerContribution: number;
}

export interface HeslbRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  heslbNumber: string | null | undefined;
  basicSalary: number;
  deduction: number;
}

@Injectable()
export class StatutoryReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  // ─── PAYE (TRA, ITX 215.01.E) ──────────────────────────────────────────
  async payeReturn(user: AuthUser, filter: ReturnFilter) {
    const ctx = await this.context(user, filter, 'PAYE');
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, ['PAYE_MAINLAND', 'PAYE_ZANZIBAR']),
      include: this.lineInclude(),
    });

    const byEmployee = new Map<string, PayeRow>();
    for (const l of lines) {
      const emp = l.payrollEntry.employee;
      const key = emp.id;
      const cur = byEmployee.get(key) ?? {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        fullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
        tin: emp.tin,
        nidaNumber: emp.nidaNumber,
        taxableIncome: 0,
        payeAmount: 0,
      };
      cur.taxableIncome += Number(l.basisAmount);
      cur.payeAmount += Number(l.employeeContribution);
      byEmployee.set(key, cur);
    }
    const rows = Array.from(byEmployee.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const totalPaye = rows.reduce((s, r) => s + r.payeAmount, 0);
    const totalTaxable = rows.reduce((s, r) => s + r.taxableIncome, 0);

    const csv = csvBuild(
      ['EmployerTIN', 'PeriodMonth', 'PeriodYear', 'EmployeeCode', 'EmployeeName', 'EmployeeTIN', 'NIDA', 'TaxableIncome', 'PAYE'],
      rows.map(r => [
        ctx.companyTin ?? '',
        String(filter.month).padStart(2, '0'),
        String(filter.year),
        r.employeeCode,
        r.fullName,
        r.tin ?? '',
        r.nidaNumber ?? '',
        r.taxableIncome.toFixed(2),
        r.payeAmount.toFixed(2),
      ]),
      ['', '', '', 'TOTAL', `${rows.length} employees`, '', '', totalTaxable.toFixed(2), totalPaye.toFixed(2)],
    );
    return {
      header: ctx,
      formCode: 'ITX 215.01.E',
      formName: 'PAYE — Monthly Withholding Return',
      summary: { employees: rows.length, totalTaxable: round2(totalTaxable), totalPaye: round2(totalPaye) },
      rows,
      file: csvFile(`paye_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, rows.length),
    };
  }

  // ─── NSSF (Form NSSF/CON-1) ────────────────────────────────────────────
  async nssfReturn(user: AuthUser, filter: ReturnFilter) {
    return this.pensionReturn(user, filter, 'NSSF', 'NSSF/CON-1', 'NSSF — Monthly Contributions Return', 'nssf');
  }

  // ─── PSSSF ─────────────────────────────────────────────────────────────
  async psssfReturn(user: AuthUser, filter: ReturnFilter) {
    return this.pensionReturn(user, filter, 'PSSSF', 'PSSSF/MMC-1', 'PSSSF — Monthly Member Contributions', 'pssf');
  }

  private async pensionReturn(user: AuthUser, filter: ReturnFilter, taxTypeCode: 'NSSF' | 'PSSSF', formCode: string, formName: string, idField: 'nssf' | 'pssf') {
    const ctx = await this.context(user, filter, taxTypeCode);
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, [taxTypeCode]),
      include: this.lineInclude(),
    });

    const byEmployee = new Map<string, PensionRow>();
    for (const l of lines) {
      const emp = l.payrollEntry.employee;
      const key = emp.id;
      const memberNumber = idField === 'nssf' ? emp.nssfNumber : emp.pssfNumber;
      const cur = byEmployee.get(key) ?? {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        fullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
        memberNumber,
        pensionableSalary: 0,
        employeeContribution: 0,
        employerContribution: 0,
        totalContribution: 0,
      };
      cur.pensionableSalary += Number(l.basisAmount);
      cur.employeeContribution += Number(l.employeeContribution);
      cur.employerContribution += Number(l.employerContribution);
      cur.totalContribution = cur.employeeContribution + cur.employerContribution;
      byEmployee.set(key, cur);
    }
    const rows = Array.from(byEmployee.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const totalEmployee = rows.reduce((s, r) => s + r.employeeContribution, 0);
    const totalEmployer = rows.reduce((s, r) => s + r.employerContribution, 0);

    const csv = csvBuild(
      ['EmployerCode', 'PeriodMonth', 'PeriodYear', 'MemberNumber', 'EmployeeName', 'PensionableSalary', 'EmployeeContribution', 'EmployerContribution', 'Total'],
      rows.map(r => [
        ctx.companyName,
        pad(filter.month),
        String(filter.year),
        r.memberNumber ?? '',
        r.fullName,
        r.pensionableSalary.toFixed(2),
        r.employeeContribution.toFixed(2),
        r.employerContribution.toFixed(2),
        r.totalContribution.toFixed(2),
      ]),
      ['', '', '', 'TOTAL', `${rows.length} employees`, '', totalEmployee.toFixed(2), totalEmployer.toFixed(2), (totalEmployee + totalEmployer).toFixed(2)],
    );
    return {
      header: ctx,
      formCode,
      formName,
      summary: {
        employees: rows.length,
        totalEmployee: round2(totalEmployee),
        totalEmployer: round2(totalEmployer),
        totalContribution: round2(totalEmployee + totalEmployer),
        membersWithoutNumber: rows.filter(r => !r.memberNumber).length,
      },
      rows,
      file: csvFile(`${taxTypeCode.toLowerCase()}_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, rows.length),
    };
  }

  // ─── WCF (Workers Compensation Fund) ──────────────────────────────────
  async wcfReturn(user: AuthUser, filter: ReturnFilter) {
    const ctx = await this.context(user, filter, 'WCF');
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, ['WCF']),
      include: this.lineInclude(),
    });

    const rows = lines.map(l => {
      const emp = l.payrollEntry.employee;
      return {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        fullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
        wcfNumber: emp.wcfRegistrationNumber,
        gross: Number(l.basisAmount),
        rate: l.appliedRate != null ? Number(l.appliedRate) : null,
        wcfAmount: Number(l.employerContribution),
      };
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));

    const totalGross = rows.reduce((s, r) => s + r.gross, 0);
    const totalWcf = rows.reduce((s, r) => s + r.wcfAmount, 0);

    const csv = csvBuild(
      ['EmployerCode', 'PeriodMonth', 'PeriodYear', 'WCFNumber', 'EmployeeName', 'GrossEmoluments', 'Rate', 'WCFContribution'],
      rows.map(r => [
        ctx.companyName,
        pad(filter.month), String(filter.year),
        r.wcfNumber ?? '',
        r.fullName,
        r.gross.toFixed(2),
        r.rate != null ? (r.rate * 100).toFixed(2) + '%' : '',
        r.wcfAmount.toFixed(2),
      ]),
      ['', '', '', 'TOTAL', `${rows.length} employees`, totalGross.toFixed(2), '', totalWcf.toFixed(2)],
    );
    return {
      header: ctx,
      formCode: 'WCF/CR-001',
      formName: 'WCF — Monthly Contribution Return',
      summary: { employees: rows.length, totalGross: round2(totalGross), totalWcf: round2(totalWcf) },
      rows,
      file: csvFile(`wcf_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, rows.length),
    };
  }

  // ─── SDL (Skills Development Levy — bundled with PAYE) ─────────────────
  async sdlReturn(user: AuthUser, filter: ReturnFilter) {
    const ctx = await this.context(user, filter, 'SDL');
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, ['SDL']),
      include: this.lineInclude(),
    });

    const totalGross = lines.reduce((s, l) => s + Number(l.basisAmount), 0);
    const totalSdl = lines.reduce((s, l) => s + Number(l.employerContribution), 0);
    const employeeCount = new Set(lines.map(l => l.payrollEntry.employee.id)).size;

    const csv = csvBuild(
      ['EmployerTIN', 'PeriodMonth', 'PeriodYear', 'TotalEmoluments', 'EmployeeCount', 'Rate', 'SDLAmount'],
      [[
        ctx.companyTin ?? '',
        pad(filter.month), String(filter.year),
        totalGross.toFixed(2),
        String(employeeCount),
        '3.50%',
        totalSdl.toFixed(2),
      ]],
    );
    return {
      header: ctx,
      formCode: 'SDL (with ITX 215.01.E)',
      formName: 'SDL — Monthly Levy Return (filed with PAYE)',
      summary: {
        employees: employeeCount,
        totalGross: round2(totalGross),
        totalSdl: round2(totalSdl),
        thresholdMet: employeeCount >= 10,
      },
      rows: lines.map(l => ({
        employeeId: l.payrollEntry.employee.id,
        employeeCode: l.payrollEntry.employee.employeeCode,
        fullName: l.payrollEntry.employee.fullName ?? `${l.payrollEntry.employee.firstName} ${l.payrollEntry.employee.lastName}`,
        gross: Number(l.basisAmount),
        sdlAmount: Number(l.employerContribution),
      })),
      file: csvFile(`sdl_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, 1),
    };
  }

  // ─── NHIF ───────────────────────────────────────────────────────────────
  async nhifReturn(user: AuthUser, filter: ReturnFilter) {
    const ctx = await this.context(user, filter, 'NHIF');
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, ['NHIF']),
      include: this.lineInclude(),
    });

    const byEmployee = new Map<string, NhifRow>();
    for (const l of lines) {
      const emp = l.payrollEntry.employee;
      const cur = byEmployee.get(emp.id) ?? {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        fullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
        nhifNumber: emp.nhifNumber,
        employeeContribution: 0,
        employerContribution: 0,
      };
      cur.employeeContribution += Number(l.employeeContribution);
      cur.employerContribution += Number(l.employerContribution);
      byEmployee.set(emp.id, cur);
    }
    const rows = Array.from(byEmployee.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const totalEmployee = rows.reduce((s, r) => s + r.employeeContribution, 0);
    const totalEmployer = rows.reduce((s, r) => s + r.employerContribution, 0);

    const csv = csvBuild(
      ['EmployerCode', 'PeriodMonth', 'PeriodYear', 'NHIFNumber', 'EmployeeName', 'EmployeeContribution', 'EmployerContribution', 'Total'],
      rows.map(r => [
        ctx.companyName, pad(filter.month), String(filter.year),
        r.nhifNumber ?? '',
        r.fullName,
        r.employeeContribution.toFixed(2),
        r.employerContribution.toFixed(2),
        (r.employeeContribution + r.employerContribution).toFixed(2),
      ]),
      ['', '', '', 'TOTAL', `${rows.length} members`, totalEmployee.toFixed(2), totalEmployer.toFixed(2), (totalEmployee + totalEmployer).toFixed(2)],
    );
    return {
      header: ctx,
      formCode: 'NHIF/MR-001',
      formName: 'NHIF — Monthly Members Return',
      summary: {
        employees: rows.length,
        totalEmployee: round2(totalEmployee),
        totalEmployer: round2(totalEmployer),
        totalContribution: round2(totalEmployee + totalEmployer),
        membersWithoutNumber: rows.filter(r => !r.nhifNumber).length,
      },
      rows,
      file: csvFile(`nhif_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, rows.length),
    };
  }

  // ─── HESLB (Higher Education Students Loans Board) ────────────────────
  async heslbReturn(user: AuthUser, filter: ReturnFilter) {
    const ctx = await this.context(user, filter, 'HESLB');
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: this.lineWhere(filter, ['HESLB']),
      include: this.lineInclude(),
    });

    const rows = lines
      .filter(l => Number(l.employeeContribution) > 0)
      .map(l => {
        const emp = l.payrollEntry.employee;
        return {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          fullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
          heslbNumber: emp.heslbNumber,
          basicSalary: Number(l.basisAmount),
          deduction: Number(l.employeeContribution),
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const totalDeduction = rows.reduce((s, r) => s + r.deduction, 0);
    const totalBasic = rows.reduce((s, r) => s + r.basicSalary, 0);

    const csv = csvBuild(
      ['EmployerCode', 'PeriodMonth', 'PeriodYear', 'HESLBNumber', 'EmployeeName', 'BasicSalary', 'DeductionAmount'],
      rows.map(r => [
        ctx.companyName, pad(filter.month), String(filter.year),
        r.heslbNumber ?? '',
        r.fullName,
        r.basicSalary.toFixed(2),
        r.deduction.toFixed(2),
      ]),
      ['', '', '', 'TOTAL', `${rows.length} borrowers`, totalBasic.toFixed(2), totalDeduction.toFixed(2)],
    );
    return {
      header: ctx,
      formCode: 'HESLB/RR-001',
      formName: 'HESLB — Monthly Loan Repayment Remittance',
      summary: {
        employees: rows.length,
        totalBasic: round2(totalBasic),
        totalDeduction: round2(totalDeduction),
        membersWithoutNumber: rows.filter(r => !r.heslbNumber).length,
      },
      rows,
      file: csvFile(`heslb_${ctx.companyName.replace(/\W+/g, '_')}_${filter.year}-${pad(filter.month)}.csv`, csv, rows.length),
    };
  }

  // ─── Combined manifest — generate everything for the period ────────────
  async generateAll(user: AuthUser, filter: ReturnFilter) {
    const [paye, nssf, psssf, wcf, sdl, nhif, heslb] = await Promise.all([
      this.payeReturn(user, filter),
      this.nssfReturn(user, filter),
      this.psssfReturn(user, filter),
      this.wcfReturn(user, filter),
      this.sdlReturn(user, filter),
      this.nhifReturn(user, filter),
      this.heslbReturn(user, filter),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      period: { year: filter.year, month: filter.month, label: paye.header.periodLabel },
      company: { id: paye.header.companyId, name: paye.header.companyName, tin: paye.header.companyTin },
      returns: { paye, nssf, psssf, wcf, sdl, nhif, heslb },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async context(user: AuthUser, filter: ReturnFilter, taxType: string): Promise<ReturnHeader> {
    if (filter.month < 1 || filter.month > 12) {
      throw new BadRequestException('month must be between 1 and 12');
    }
    if (filter.year < 2000 || filter.year > 2100) {
      throw new BadRequestException('year is out of range');
    }
    if (!filter.companyId) {
      throw new BadRequestException('companyId is required');
    }
    // Multi-tenant guard: reject callers requesting a company they cannot access
    // before any employee PII (TIN/NIDA/member numbers/salaries) is queried.
    await this.companyScope.assertCanAccessCompany(user, filter.companyId, AccessLevel.READ);
    const company = await this.prisma.company.findUnique({
      where: { id: filter.companyId },
      include: { profile: { select: { tin: true, vrn: true } } },
    });
    if (!company) throw new NotFoundException('Company not found');

    const periodStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
    const periodEnd = new Date(Date.UTC(filter.year, filter.month, 0, 23, 59, 59));
    const periodLabel = periodStart.toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });
    return {
      companyId: company.id,
      companyName: company.name,
      companyTin: company.profile?.tin,
      companyVrn: company.profile?.vrn,
      periodLabel,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      taxType,
    };
  }

  private lineWhere(filter: ReturnFilter, taxTypeCodes: string[]) {
    const periodStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
    const periodEnd = new Date(Date.UTC(filter.year, filter.month, 1));
    return {
      taxType: { taxTypeCode: { in: taxTypeCodes } },
      payrollEntry: {
        deletedAt: null,
        companyId: filter.companyId,
        payrollRun: {
          // Include runs whose payment date falls in the period. Falls back
          // to runDate if the period has no paymentDate set.
          payrollPeriod: {
            OR: [
              { paymentDate: { gte: periodStart, lt: periodEnd } },
              { AND: [{ paymentDate: null }, { startDate: { gte: periodStart, lt: periodEnd } }] },
            ],
          },
        },
      },
    };
  }

  private lineInclude() {
    return {
      taxType: { select: { taxTypeCode: true, name: true } },
      payrollEntry: {
        select: {
          id: true,
          payrollRunId: true,
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              fullName: true,
              tin: true,
              nidaNumber: true,
              nssfNumber: true,
              pssfNumber: true,
              nhifNumber: true,
              wcfRegistrationNumber: true,
              heslbNumber: true,
            },
          },
        },
      },
    };
  }
}

// ─── CSV utilities ───────────────────────────────────────────────────────

function csvBuild(header: string[], rows: string[][], total?: string[]): string {
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) lines.push(r.map(csvField).join(','));
  if (total) lines.push(total.map(csvField).join(','));
  return lines.join('\n');
}

function csvFile(filename: string, content: string, rowCount: number): CsvFile {
  return { filename, mimeType: 'text/csv', rowCount, content };
}

function csvField(s: string): string {
  if (s == null) return '';
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
