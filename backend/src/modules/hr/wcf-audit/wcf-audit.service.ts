import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../../common/services';

/**
 * WCF (Workers Compensation Fund) audit / exposure register.
 *
 * The Workers Compensation Fund Act, 2008 requires employers to keep monthly
 * records of total wage exposure per workplace (branch). The Labour Officer
 * uses this to assess WCF contributions and verify the 0.5% / 1.0% rate paid.
 *
 * This report aggregates wage exposure per branch per month from the
 * `payroll_statutory_lines` already written by the calculator (Phase 2). No
 * separate data entry is required — the report is reproducible from history.
 */

export interface WcfFilter {
  companyId: string;
  /** Inclusive start month (1-12). */
  fromMonth: number;
  /** Inclusive end month (1-12). */
  toMonth: number;
  /** Year (single year report — multi-year stitching is the operator's job). */
  year: number;
}

export interface BranchExposureRow {
  branchId: string | null;
  branchName: string;
  branchCode: string | null;
  region?: string | null;
  monthlyExposure: Array<{ month: number; gross: number; wcfAmount: number; employees: number }>;
  totalGross: number;
  totalWcf: number;
  totalEmployees: number;
}

@Injectable()
export class WcfAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async exposureRegister(filter: WcfFilter, user: AuthUser) {
    if (filter.fromMonth < 1 || filter.fromMonth > 12)
      throw new BadRequestException('fromMonth must be 1-12');
    if (filter.toMonth < 1 || filter.toMonth > 12)
      throw new BadRequestException('toMonth must be 1-12');
    if (filter.fromMonth > filter.toMonth)
      throw new BadRequestException('fromMonth must be <= toMonth');

    await this.companyScope.assertCanAccessCompany(user, filter.companyId);

    const company = await this.prisma.company.findUnique({
      where: { id: filter.companyId },
      include: { profile: { select: { tin: true } } },
    });
    if (!company) throw new NotFoundException('Company not found');

    const periodStart = new Date(Date.UTC(filter.year, filter.fromMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(filter.year, filter.toMonth, 1));

    // Fetch every WCF statutory line in the window with branch + employee.
    const lines = await this.prisma.payrollStatutoryLine.findMany({
      where: {
        taxType: { taxTypeCode: 'WCF' },
        payrollEntry: {
          deletedAt: null,
          companyId: filter.companyId,
          payrollRun: {
            payrollPeriod: {
              OR: [
                { paymentDate: { gte: periodStart, lt: periodEnd } },
                {
                  AND: [{ paymentDate: null }, { startDate: { gte: periodStart, lt: periodEnd } }],
                },
              ],
            },
          },
        },
      },
      include: {
        payrollEntry: {
          select: {
            id: true,
            employee: {
              select: {
                id: true,
                branchId: true,
                branch: { select: { id: true, name: true, code: true, location: true } },
              },
            },
            payrollRun: {
              select: {
                payrollPeriod: { select: { paymentDate: true, startDate: true } },
              },
            },
          },
        },
      },
    });

    // Group by branch → month.
    const byBranch = new Map<string, BranchExposureRow>();
    for (const l of lines) {
      const branch = l.payrollEntry.employee.branch;
      const branchKey = branch?.id ?? 'unassigned';
      const period = l.payrollEntry.payrollRun.payrollPeriod;
      const dt = period?.paymentDate ?? period?.startDate ?? new Date();
      const month = new Date(dt).getUTCMonth() + 1;

      const row = byBranch.get(branchKey) ?? {
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? 'Unassigned (no branch)',
        branchCode: branch?.code ?? null,
        region: branch?.location ?? null,
        monthlyExposure: [],
        totalGross: 0,
        totalWcf: 0,
        totalEmployees: 0,
      };
      let monthBucket = row.monthlyExposure.find((m) => m.month === month);
      if (!monthBucket) {
        monthBucket = { month, gross: 0, wcfAmount: 0, employees: 0 };
        row.monthlyExposure.push(monthBucket);
      }
      monthBucket.gross += Number(l.basisAmount);
      monthBucket.wcfAmount += Number(l.employerContribution);
      monthBucket.employees += 1; // distinct employee count is computed at the end

      row.totalGross += Number(l.basisAmount);
      row.totalWcf += Number(l.employerContribution);
      byBranch.set(branchKey, row);
    }

    // Re-compute distinct-employee counts per month per branch
    // (the running count above is just the line count — fix it).
    const employeeIdsByBranchMonth = new Map<string, Set<string>>();
    const employeeIdsByBranchTotal = new Map<string, Set<string>>();
    for (const l of lines) {
      const branch = l.payrollEntry.employee.branch;
      const branchKey = branch?.id ?? 'unassigned';
      const period = l.payrollEntry.payrollRun.payrollPeriod;
      const dt = period?.paymentDate ?? period?.startDate ?? new Date();
      const month = new Date(dt).getUTCMonth() + 1;
      const monthKey = `${branchKey}:${month}`;

      if (!employeeIdsByBranchMonth.has(monthKey))
        employeeIdsByBranchMonth.set(monthKey, new Set());
      employeeIdsByBranchMonth.get(monthKey)!.add(l.payrollEntry.employee.id);

      if (!employeeIdsByBranchTotal.has(branchKey))
        employeeIdsByBranchTotal.set(branchKey, new Set());
      employeeIdsByBranchTotal.get(branchKey)!.add(l.payrollEntry.employee.id);
    }
    for (const [branchKey, row] of byBranch) {
      for (const m of row.monthlyExposure) {
        m.employees = employeeIdsByBranchMonth.get(`${branchKey}:${m.month}`)?.size ?? 0;
      }
      row.totalEmployees = employeeIdsByBranchTotal.get(branchKey)?.size ?? 0;
    }

    // Sort by branch name; sort each branch's months ascending.
    const branches = Array.from(byBranch.values()).sort((a, b) =>
      a.branchName.localeCompare(b.branchName),
    );
    for (const b of branches) b.monthlyExposure.sort((a, b) => a.month - b.month);

    const grandGross = branches.reduce((s, b) => s + b.totalGross, 0);
    const grandWcf = branches.reduce((s, b) => s + b.totalWcf, 0);

    return {
      header: {
        companyId: company.id,
        companyName: company.name,
        companyTin: company.profile?.tin ?? null,
        year: filter.year,
        fromMonth: filter.fromMonth,
        toMonth: filter.toMonth,
        periodLabel: `${monthName(filter.fromMonth)} – ${monthName(filter.toMonth)} ${filter.year}`,
      },
      summary: {
        branchCount: branches.length,
        totalGross: round2(grandGross),
        totalWcf: round2(grandWcf),
        effectiveRate: grandGross > 0 ? round4(grandWcf / grandGross) : 0,
      },
      branches: branches.map((b) => ({
        ...b,
        totalGross: round2(b.totalGross),
        totalWcf: round2(b.totalWcf),
        monthlyExposure: b.monthlyExposure.map((m) => ({
          ...m,
          gross: round2(m.gross),
          wcfAmount: round2(m.wcfAmount),
        })),
      })),
    };
  }
}

function monthName(m: number): string {
  return new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
