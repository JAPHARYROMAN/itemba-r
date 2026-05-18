import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Allocates payroll cost to construction projects via the existing
 * `EmployeeAssignment.assignmentContextType = 'CONSTRUCTION_PROJECT'` link.
 *
 * For each project assignment that overlaps the requested period:
 *   - find the employee's payroll entries paid in the period
 *   - allocate the entry's gross + employer-side statutory cost in proportion
 *     to the days of the assignment that overlap the period (out of the
 *     period's total days)
 *
 * Returns per-project totals + per-employee breakdown so cost engineers can
 * audit allocations.
 */

export interface LabourCostFilter {
  companyId: string;
  /** Inclusive start (ISO date YYYY-MM-DD). */
  periodStart: string;
  /** Inclusive end (ISO date YYYY-MM-DD). */
  periodEnd: string;
  /** Optional — limit to a specific project. */
  projectId?: string;
}

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ConstructionLabourCostService {
  private readonly logger = new Logger(ConstructionLabourCostService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist `ProjectCostAllocation` rows for every (payrollEntry, project)
   * pair in a paid payroll run. Idempotent on the schema's
   * `@@unique([payrollEntryId, projectId])` — re-running upserts cleanly.
   *
   * Allocation rule: same as `report()` — overlap days of each employee's
   * `EmployeeAssignment(assignmentContextType=CONSTRUCTION_PROJECT)` against
   * the payroll period drive the gross + employer-statutory split.
   */
  async allocateForRun(
    payrollRunId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ allocated: number; skipped: number }> {
    const db: DbClient = tx ?? this.prisma;
    const run = await db.payrollRun.findFirst({
      where: { id: payrollRunId, deletedAt: null },
      include: { payrollPeriod: { select: { startDate: true, endDate: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const period = run.payrollPeriod;
    if (!period?.startDate || !period?.endDate) {
      throw new BadRequestException('Payroll run has no period dates — cannot allocate');
    }

    const periodStart = new Date(period.startDate);
    const periodEnd = new Date(period.endDate);

    const entries = await db.payrollEntry.findMany({
      where: { payrollRunId, deletedAt: null },
      include: { statutoryLines: { select: { employerContribution: true } } },
    });
    if (entries.length === 0) return { allocated: 0, skipped: 0 };

    const employeeIds = Array.from(new Set(entries.map((e) => e.employeeId)));
    const assignments = await db.employeeAssignment.findMany({
      where: {
        companyId: run.companyId,
        employeeId: { in: employeeIds },
        assignmentContextType: 'CONSTRUCTION_PROJECT',
        deletedAt: null,
        OR: [
          { endDate: null, startDate: { lte: periodEnd } },
          { AND: [{ startDate: { lte: periodEnd } }, { endDate: { gte: periodStart } }] },
        ],
      },
    });

    let allocated = 0;
    let skipped = 0;
    for (const entry of entries) {
      const empAssignments = assignments.filter((a) => a.employeeId === entry.employeeId);
      const overlaps = new Map<string, number>();
      for (const a of empAssignments) {
        if (!a.assignmentContextId) continue;
        const aStart = a.startDate ? new Date(a.startDate) : new Date(0);
        const aEnd = a.endDate ? new Date(a.endDate) : new Date('2099-12-31');
        const oStart = aStart > periodStart ? aStart : periodStart;
        const oEnd = aEnd < periodEnd ? aEnd : periodEnd;
        const days = Math.max(0, daysBetween(oStart, oEnd));
        if (days > 0) {
          overlaps.set(a.assignmentContextId, (overlaps.get(a.assignmentContextId) ?? 0) + days);
        }
      }

      const totalOverlapDays = Array.from(overlaps.values()).reduce((s, d) => s + d, 0);
      if (totalOverlapDays === 0) {
        skipped++;
        continue;
      }

      const employerStatutory = entry.statutoryLines.reduce(
        (s, l) => s + Number(l.employerContribution),
        0,
      );
      const gross = Number(entry.grossPay);
      const grossPlusEr = gross + employerStatutory;

      // Tanzania-only deployment — TZS is the only payroll currency the system
      // supports today. Stored on each row so a future multi-currency rollout
      // can re-derive without backfilling.
      const currency = 'TZS';

      for (const [projectId, days] of overlaps) {
        const fraction = days / totalOverlapDays;
        const allocatedGross = round2(gross * fraction);
        const allocatedEr = round2(employerStatutory * fraction);
        const allocatedTotal = round2(grossPlusEr * fraction);

        await db.projectCostAllocation.upsert({
          where: { payrollEntryId_projectId: { payrollEntryId: entry.id, projectId } },
          create: {
            companyId: run.companyId,
            projectId,
            payrollEntryId: entry.id,
            payrollRunId: run.id,
            employeeId: entry.employeeId,
            days,
            allocatedGross,
            allocatedEmployerStatutory: allocatedEr,
            allocatedTotalCost: allocatedTotal,
            currency,
          },
          update: {
            days,
            allocatedGross,
            allocatedEmployerStatutory: allocatedEr,
            allocatedTotalCost: allocatedTotal,
            currency,
          },
        });
        allocated++;
      }
    }

    this.logger.log(
      `Allocated payroll run ${run.payrollRunNumber}: ${allocated} project rows, ${skipped} entries with no project assignments`,
    );
    return { allocated, skipped };
  }

  async reverseForRun(
    payrollRunId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversed: number }> {
    const db: DbClient = tx ?? this.prisma;
    const result = await db.projectCostAllocation.deleteMany({
      where: { payrollRunId },
    });
    return { reversed: result.count };
  }

  async report(filter: LabourCostFilter) {
    if (!filter.companyId) throw new BadRequestException('companyId is required');
    const periodStart = new Date(filter.periodStart);
    const periodEnd = new Date(filter.periodEnd);
    periodEnd.setUTCHours(23, 59, 59, 999);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid period dates');
    }
    if (periodStart > periodEnd) throw new BadRequestException('periodStart must be ≤ periodEnd');

    // Pull all active project assignments overlapping the period.
    const assignments = await this.prisma.employeeAssignment.findMany({
      where: {
        companyId: filter.companyId,
        assignmentContextType: 'CONSTRUCTION_PROJECT',
        ...(filter.projectId ? { assignmentContextId: filter.projectId } : {}),
        deletedAt: null,
        OR: [
          { endDate: null, startDate: { lte: periodEnd } },
          { AND: [{ startDate: { lte: periodEnd } }, { endDate: { gte: periodStart } }] },
        ],
      },
      include: {
        employee: {
          select: { id: true, employeeCode: true, fullName: true, firstName: true, lastName: true },
        },
      },
    });

    if (assignments.length === 0) {
      return {
        period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
        projects: [],
        totals: { totalAssigned: 0, totalGross: 0, totalEmployerStatutory: 0, totalCost: 0 },
      };
    }

    // Resolve project metadata.
    const projectIds = Array.from(
      new Set(assignments.map((a) => a.assignmentContextId).filter(Boolean) as string[]),
    );
    const projectsRaw = await this.prisma.constructionProject.findMany({
      where: { id: { in: projectIds }, deletedAt: null },
      select: { id: true, projectCode: true, projectName: true, status: true },
    });
    const projectMap = new Map<
      string,
      { id: string; projectCode: string; name: string; status: string }
    >(
      projectsRaw.map((p) => [
        p.id,
        { id: p.id, projectCode: p.projectCode, name: p.projectName, status: p.status },
      ]),
    );

    // Pull payroll entries paid in the period for these employees.
    const employeeIds = Array.from(new Set(assignments.map((a) => a.employeeId)));
    const entries = await this.prisma.payrollEntry.findMany({
      where: {
        companyId: filter.companyId,
        employeeId: { in: employeeIds },
        deletedAt: null,
        payrollRun: {
          payrollPeriod: {
            OR: [
              { paymentDate: { gte: periodStart, lte: periodEnd } },
              { AND: [{ paymentDate: null }, { startDate: { gte: periodStart, lte: periodEnd } }] },
            ],
          },
        },
      },
      include: {
        statutoryLines: {
          select: { employerContribution: true },
        },
        payrollRun: {
          select: {
            payrollPeriod: { select: { startDate: true, endDate: true, paymentDate: true } },
          },
        },
      },
    });

    // For each (project, employee), find overlapping assignment, allocate by days.
    interface ProjectRow {
      project: { id: string; projectCode: string; name: string; status: string } | null;
      projectId: string;
      employeeRows: Array<{
        employeeId: string;
        employeeCode: string;
        fullName: string;
        days: number;
        gross: number;
        employerStatutory: number;
        totalCost: number;
      }>;
      totals: { days: number; gross: number; employerStatutory: number; totalCost: number };
    }
    const projectRows = new Map<string, ProjectRow>();

    for (const entry of entries) {
      const period = entry.payrollRun.payrollPeriod;
      if (!period?.startDate || !period?.endDate) continue;
      const periodStartDate = new Date(period.startDate);
      const periodEndDate = new Date(period.endDate);
      const periodDays = daysBetween(periodStartDate, periodEndDate);

      const employerStatutory = entry.statutoryLines.reduce(
        (s, l) => s + Number(l.employerContribution),
        0,
      );
      const grossPlusEr = Number(entry.grossPay) + employerStatutory;

      // Find every project assignment overlapping the period for this employee.
      const employeeAssignments = assignments.filter((a) => a.employeeId === entry.employeeId);
      const projectOverlaps = new Map<string, number>();
      for (const a of employeeAssignments) {
        const aStart = a.startDate ? new Date(a.startDate) : new Date(0);
        const aEnd = a.endDate ? new Date(a.endDate) : new Date('2099-12-31');
        const overlapStart = aStart > periodStartDate ? aStart : periodStartDate;
        const overlapEnd = aEnd < periodEndDate ? aEnd : periodEndDate;
        const overlapDays = Math.max(0, daysBetween(overlapStart, overlapEnd));
        if (overlapDays > 0 && a.assignmentContextId) {
          projectOverlaps.set(
            a.assignmentContextId,
            (projectOverlaps.get(a.assignmentContextId) ?? 0) + overlapDays,
          );
        }
      }
      const totalOverlapDays = Array.from(projectOverlaps.values()).reduce((s, d) => s + d, 0);
      if (totalOverlapDays === 0) continue;

      // Allocate.
      for (const [projectId, days] of projectOverlaps) {
        const fraction = days / totalOverlapDays;
        const allocatedGross = Number(entry.grossPay) * fraction;
        const allocatedEr = employerStatutory * fraction;
        const allocatedTotal = grossPlusEr * fraction;

        let row = projectRows.get(projectId);
        if (!row) {
          row = {
            project: projectMap.get(projectId) ?? null,
            projectId,
            employeeRows: [],
            totals: { days: 0, gross: 0, employerStatutory: 0, totalCost: 0 },
          };
        }
        const existingEmpRow = row.employeeRows.find((r) => r.employeeId === entry.employeeId);
        if (existingEmpRow) {
          existingEmpRow.days += days;
          existingEmpRow.gross += allocatedGross;
          existingEmpRow.employerStatutory += allocatedEr;
          existingEmpRow.totalCost += allocatedTotal;
        } else {
          // Fetch employee meta from any matching assignment.
          const emp = employeeAssignments[0]?.employee;
          const fallback = `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
          row.employeeRows.push({
            employeeId: entry.employeeId,
            employeeCode: emp?.employeeCode ?? '—',
            fullName: emp?.fullName ?? (fallback || '—'),
            days,
            gross: allocatedGross,
            employerStatutory: allocatedEr,
            totalCost: allocatedTotal,
          });
        }
        row.totals.days += days;
        row.totals.gross += allocatedGross;
        row.totals.employerStatutory += allocatedEr;
        row.totals.totalCost += allocatedTotal;
        // Suppress unused warning for periodDays — kept for future fractional-day refinements.
        void periodDays;
        projectRows.set(projectId, row);
      }
    }

    // Round at the boundary.
    const rounded = Array.from(projectRows.values())
      .map((r) => ({
        ...r,
        employeeRows: r.employeeRows
          .sort((a, b) => b.totalCost - a.totalCost)
          .map((er) => ({
            ...er,
            gross: round2(er.gross),
            employerStatutory: round2(er.employerStatutory),
            totalCost: round2(er.totalCost),
          })),
        totals: {
          days: r.totals.days,
          gross: round2(r.totals.gross),
          employerStatutory: round2(r.totals.employerStatutory),
          totalCost: round2(r.totals.totalCost),
        },
      }))
      .sort((a, b) => b.totals.totalCost - a.totals.totalCost);

    const totals = rounded.reduce(
      (acc, p) => ({
        totalAssigned: acc.totalAssigned + p.employeeRows.length,
        totalGross: acc.totalGross + p.totals.gross,
        totalEmployerStatutory: acc.totalEmployerStatutory + p.totals.employerStatutory,
        totalCost: acc.totalCost + p.totals.totalCost,
      }),
      { totalAssigned: 0, totalGross: 0, totalEmployerStatutory: 0, totalCost: 0 },
    );

    return {
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      projects: rounded,
      totals: {
        totalAssigned: totals.totalAssigned,
        totalGross: round2(totals.totalGross),
        totalEmployerStatutory: round2(totals.totalEmployerStatutory),
        totalCost: round2(totals.totalCost),
      },
    };
  }

  /**
   * List persisted `ProjectCostAllocation` rows for a project, newest first.
   * Used by the frontend project P&L view to show what payroll runs have
   * already booked labour cost against the project.
   */
  async listAllocations(projectId: string, query: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Number(query.limit ?? 100), 500);
    const offset = Number(query.offset ?? 0);
    const [items, total, agg] = await Promise.all([
      this.prisma.projectCostAllocation.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true } },
          payrollRun: { select: { id: true, payrollRunNumber: true, paidAt: true } },
        },
      }),
      this.prisma.projectCostAllocation.count({ where: { projectId } }),
      this.prisma.projectCostAllocation.aggregate({
        where: { projectId },
        _sum: {
          allocatedGross: true,
          allocatedEmployerStatutory: true,
          allocatedTotalCost: true,
        },
      }),
    ]);
    return {
      items,
      total,
      limit,
      offset,
      summary: {
        gross: Number(agg._sum.allocatedGross ?? 0),
        employerStatutory: Number(agg._sum.allocatedEmployerStatutory ?? 0),
        totalCost: Number(agg._sum.allocatedTotalCost ?? 0),
      },
    };
  }

  async getProject(projectId: string) {
    const project = await this.prisma.constructionProject.findFirst({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Construction project not found');
    return project;
  }
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
