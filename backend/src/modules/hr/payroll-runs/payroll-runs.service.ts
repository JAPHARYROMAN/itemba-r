import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PayrollCalculatorService } from '../payroll-calculator/payroll-calculator.service';
import { PayrollPostingsService } from '../payroll-postings/payroll-postings.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { UpdatePayrollRunDto } from './dto/update-payroll-run.dto';

interface LockedPayrollRunRow {
  id: string;
  companyId: string;
  status: string;
  journalEntryId: string | null;
  hrApprovedById: string | null;
  financeApprovedById: string | null;
}

interface LockedSalaryAdvanceRow {
  id: string;
  amount: Prisma.Decimal;
  recoveredAmount: Prisma.Decimal;
}

interface LockedSalesCommissionRow {
  id: string;
  status: string;
  paidPayrollEntryId: string | null;
}

@Injectable()
export class PayrollRunsService {
  private readonly logger = new Logger(PayrollRunsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly calculator: PayrollCalculatorService,
    private readonly postings: PayrollPostingsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId, status, payrollPeriodId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    if (payrollPeriodId) where.payrollPeriodId = payrollPeriodId;
    const [data, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          payrollPeriod: { select: { id: true, name: true, startDate: true, endDate: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.payrollRun.findFirst({
      where: { id, deletedAt: null },
      include: {
        payrollPeriod: { select: { id: true, name: true, startDate: true, endDate: true } },
        company: { select: { id: true, name: true } },
        entries: {
          where: { deletedAt: null },
          include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
        },
      },
    });
    if (!record) throw new NotFoundException('Payroll run not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async create(dto: CreatePayrollRunDto, user: AuthUser) {
    if ((dto as any).companyId) {
      await this.companyScope.assertCanAccessCompany(
        user,
        (dto as any).companyId,
        AccessLevel.WRITE,
      );
    } else {
      // Pin the run to the actor's primary company when DTO omits it.
      (dto as any).companyId = user.companyId;
    }
    const record = await this.prisma.payrollRun.create({
      data: { ...dto, runDate: dto.runDate ? new Date(dto.runDate) : new Date() } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'PAYROLL_RUN_CREATE',
      entityType: 'PayrollRun',
      entityId: record.id,
      companyId: record.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdatePayrollRunDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    if ((dto as any).companyId !== undefined && (dto as any).companyId !== existing.companyId) {
      throw new BadRequestException('PayrollRun companyId is immutable');
    }
    const record = await this.prisma.payrollRun.update({
      where: { id },
      data: { ...dto, runDate: dto.runDate ? new Date(dto.runDate) : undefined } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'PAYROLL_RUN_UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      companyId: existing.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async calculate(id: string, user: any) {
    const run = await this.findOne(id, user);
    if (!['DRAFT', 'CALCULATED'].includes(run.status)) {
      throw new BadRequestException('Payroll run cannot be recalculated in its current status');
    }

    const companyId = run.companyId;

    // Get all active employees for this company
    const employees = await this.prisma.employee.findMany({
      where: { companyId, employmentStatus: 'ACTIVE', deletedAt: null },
    });

    // Get payroll period for date range
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: run.payrollPeriodId },
    });
    const periodStart = period?.startDate ? startOfDay(period.startDate) : null;
    const periodEnd = period?.endDate ? endOfDay(period.endDate) : null;
    const taxFilingPeriodIdsByTaxType = new Map<string, string>();

    // Delete existing entries for recalculation (cascade clears lines + allowances + deductions)
    await this.prisma.payrollEntry.updateMany({
      where: { payrollRunId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    // Load reference data once per region — most TZ companies are single-region.
    const regionsInRun = Array.from(new Set(employees.map((e) => e.payrollRegion)));
    const refDataByRegion = new Map<
      string,
      Awaited<ReturnType<typeof this.calculator.loadReferenceData>>
    >();
    for (const r of regionsInRun) {
      refDataByRegion.set(r, await this.calculator.loadReferenceData(r as 'MAINLAND' | 'ZANZIBAR'));
    }

    const companyEmployeeCount = employees.length;

    let totalGrossPay = 0;
    let totalDeductions = 0;
    let totalNetPay = 0;

    for (const employee of employees) {
      const fullBasePay = Number(employee.baseSalary ?? 0);

      // Attendance / overtime
      let daysWorked = 0;
      let overtimeHours = 0;
      const attendancePay = 0;
      let overtimePay = 0;
      // Unpaid-absence attendance records (weight + calendar date) for this
      // period. Collected here but combined with LWOP leave below so a day
      // covered by BOTH sources is not double-counted (ITMB-081).
      const unpaidAbsenceAttendance: Array<{ date: Date; weight: number }> = [];

      if (periodStart && periodEnd) {
        const attendance = await this.prisma.attendanceRecord.findMany({
          where: {
            employeeId: employee.id,
            companyId,
            attendanceDate: { gte: periodStart, lte: periodEnd },
            deletedAt: null,
          },
          select: {
            attendanceStatus: true,
            overtimeHours: true,
            attendanceDate: true,
          },
        });
        daysWorked = attendance.reduce(
          (sum, a) => sum + attendanceDayWeight(a.attendanceStatus),
          0,
        );
        for (const a of attendance) {
          const weight = unpaidAbsenceWeight(a.attendanceStatus);
          if (weight > 0) {
            unpaidAbsenceAttendance.push({ date: a.attendanceDate, weight });
          }
        }
        overtimeHours = attendance
          .filter((a) => attendanceDayWeight(a.attendanceStatus) > 0)
          .reduce((sum, a) => sum + Number(a.overtimeHours ?? 0), 0);
        const hourlyRate = fullBasePay / 22 / 8;
        overtimePay = overtimeHours * hourlyRate * 1.5;
      }

      // ── Leave Without Pay (LWOP) ─────────────────────────────────────────
      // Approved leave requests of an unpaid leave type that overlap the
      // period reduce gross pay. Daily rate = baseSalary / 22 (standard
      // working days for monthly-paid employees in Tanzania).
      let lwopDays = 0;
      // Distinct in-period calendar dates already counted as LWOP via approved
      // unpaid leave; used to suppress double-counting an UNPAID_ABSENT/ABSENT
      // attendance record that falls on the same day (ITMB-081).
      const lwopLeaveDates = new Set<string>();
      if (periodStart && periodEnd) {
        const lwopRequests = await this.prisma.leaveRequest.findMany({
          where: {
            companyId,
            employeeId: employee.id,
            status: 'APPROVED',
            deletedAt: null,
            leaveType: { paid: false },
            // Request overlaps the period if it starts before period end AND
            // ends on/after period start.
            startDate: { lte: periodEnd },
            endDate: { gte: periodStart },
          },
          select: {
            startDate: true,
            endDate: true,
            totalDays: true,
          },
        });
        for (const req of lwopRequests) {
          // For requests fully inside the period, use their stored totalDays.
          // For requests that straddle the period boundary, count only the
          // days that fall inside the period (calendar-day approximation).
          const reqStart = req.startDate > periodStart ? req.startDate : periodStart;
          const reqEnd = req.endDate < periodEnd ? req.endDate : periodEnd;
          const fullyInside = req.startDate >= periodStart && req.endDate <= periodEnd;
          if (fullyInside) {
            lwopDays += Number(req.totalDays);
          } else {
            const dayMs = 24 * 60 * 60 * 1000;
            const overlapDays = Math.max(
              0,
              Math.floor((reqEnd.getTime() - reqStart.getTime()) / dayMs) + 1,
            );
            lwopDays += overlapDays;
          }
          // Record every in-period calendar date this leave covers so an
          // overlapping unpaid-absence attendance record is not added again.
          for (const key of calendarDateKeys(reqStart, reqEnd)) {
            lwopLeaveDates.add(key);
          }
        }
      }
      // Add unpaid-absence attendance weight only for dates NOT already counted
      // by approved unpaid leave above (de-duplicate per distinct calendar day).
      for (const absence of unpaidAbsenceAttendance) {
        if (!lwopLeaveDates.has(calendarDateKey(absence.date))) {
          lwopDays += absence.weight;
        }
      }
      const dailyRate = fullBasePay / 22;
      const lwopDeduction = Math.min(fullBasePay, Math.round(lwopDays * dailyRate * 100) / 100);
      const basePay = Math.round((fullBasePay - lwopDeduction) * 100) / 100;

      // Active allowances
      const allowances = await this.prisma.employeeAllowance.findMany({
        where: { employeeId: employee.id, companyId, status: 'ACTIVE', deletedAt: null },
        include: { allowanceType: true },
      });
      const taxableAllowances = allowances
        .filter((a) => a.allowanceType.taxable)
        .reduce((sum, a) => sum + Number(a.amount ?? 0), 0);
      const nonTaxableAllowances = allowances
        .filter((a) => !a.allowanceType.taxable)
        .reduce((sum, a) => sum + Number(a.amount ?? 0), 0);

      // ── Sales commissions ────────────────────────────────────────────────
      // APPROVED commissions for this employee that haven't been paid via a
      // prior payroll entry. Each one becomes a taxable allowance on this
      // entry; the link is finalized on `pay()` via salesCommissionId.
      const pendingCommissions = await this.prisma.salesCommission.findMany({
        where: {
          companyId,
          employeeId: employee.id,
          status: 'APPROVED',
          paidPayrollEntryId: null,
          deletedAt: null,
        },
        include: {
          salesOrder: { select: { salesOrderNumber: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const totalCommission = pendingCommissions.reduce((s, c) => s + Number(c.amount), 0);
      // Commissions are taxable employment income — fold into the taxable bucket.
      const taxableAllowancesWithCommission = taxableAllowances + totalCommission;

      // Active deductions — KEEP non-statutory ones (e.g. salary advance recovery,
      // housing-loan repayment). Statutory ones now come from the calculator.
      const manualDeductions = await this.prisma.employeeDeduction.findMany({
        where: { employeeId: employee.id, companyId, status: 'ACTIVE', deletedAt: null },
        include: { deductionType: true },
      });
      const nonStatutoryDeductions = manualDeductions.filter((d) => !d.deductionType.statutory);
      const totalManualNonStatutory = nonStatutoryDeductions.reduce(
        (sum, d) => sum + Number(d.amount ?? 0),
        0,
      );

      // ── Statutory calculation ────────────────────────────────────────────
      const ref = refDataByRegion.get(employee.payrollRegion)!;
      const breakdown = this.calculator.compute(
        {
          employee: {
            id: employee.id,
            payrollRegion: employee.payrollRegion,
            taxResidencyStatus: employee.taxResidencyStatus,
            disabilityStatus: employee.disabilityStatus,
            heslbBorrower: employee.heslbBorrower,
            isPublicSector: !!employee.pssfNumber, // simple heuristic; replace with explicit field later
          },
          earnings: {
            basicPay: basePay,
            taxableAllowances: taxableAllowancesWithCommission,
            nonTaxableAllowances,
            overtimePay,
          },
          context: { companyEmployeeCount },
        },
        ref,
      );

      const grossPay = breakdown.grossPay;

      // ── Salary advance recovery ─────────────────────────────────────────
      // Outstanding advances for this employee — paid but not yet fully
      // recovered. Each advance contributes one installment per pay period.
      const outstandingAdvances = await this.prisma.salaryAdvance.findMany({
        where: {
          companyId,
          employeeId: employee.id,
          deletedAt: null,
          status: { in: ['PAID', 'DEDUCTING'] },
          paidAt: { not: null, ...(periodEnd ? { lte: periodEnd } : {}) },
        },
        orderBy: { paidAt: 'asc' },
      });

      // ── Deduction capping & net-pay floor (ITMB-020 / ITMB-021) ──────────
      // Withholding priority from gross pay: statutory first (mandatory), then
      // non-statutory manual deductions, then salary-advance recovery (an
      // internal receivable that must yield to actual pay availability). Net pay
      // is never persisted negative, and each advance installment is capped to
      // what can actually be withheld so syncAdvanceRecoveries credits only the
      // amount really collected.
      const totalEmployeeStatutory = breakdown.totalEmployeeStatutory;
      if (decimal(totalEmployeeStatutory).gt(decimal(grossPay))) {
        // Statutory alone exceeds gross — this cannot be silently floored to a
        // zero paycheck; surface it for correction (bad LWOP/proration, stale
        // statutory config, etc.).
        throw new BadRequestException(
          `Statutory deductions (${money(decimal(totalEmployeeStatutory)).toFixed(2)}) exceed gross pay (${money(decimal(grossPay)).toFixed(2)}) for employee ${employee.employeeCode ?? employee.id}. Review attendance/LWOP and statutory setup before recalculating.`,
        );
      }

      // Pay available for discretionary (non-statutory) withholding.
      let availableForDeductions = money(decimal(grossPay).minus(decimal(totalEmployeeStatutory)));

      // Non-statutory manual deductions are capped at available pay. Cap each
      // line sequentially (query order) so the persisted deduction line items
      // sum exactly to the capped aggregate, keeping gross = net + deductions.
      const nonStatutoryWithheld = new Map<string, number>();
      let cappedNonStatutoryDec = decimal(0);
      for (const d of nonStatutoryDeductions) {
        if (availableForDeductions.lte(0)) {
          nonStatutoryWithheld.set(d.id, 0);
          continue;
        }
        const want = decimal(d.amount ?? 0);
        let take = money(want.gt(availableForDeductions) ? availableForDeductions : want);
        if (take.lt(0)) take = decimal(0);
        nonStatutoryWithheld.set(d.id, take.toNumber());
        cappedNonStatutoryDec = cappedNonStatutoryDec.plus(take);
        availableForDeductions = money(availableForDeductions.minus(take));
      }
      const cappedNonStatutory = money(cappedNonStatutoryDec);

      const advanceRecoveries: Array<{ advanceId: string; advanceNumber: string; amount: number }> =
        [];
      for (const adv of outstandingAdvances) {
        if (availableForDeductions.lte(0)) break;
        const remaining = decimal(adv.amount).minus(decimal(adv.recoveredAmount));
        if (remaining.lte(0)) continue;
        const installment =
          adv.installmentAmount != null ? decimal(adv.installmentAmount) : decimal(adv.amount);
        // Withhold no more than the installment, the remaining balance, OR the
        // pay still available after higher-priority deductions.
        let thisPeriod = money(installment.lt(remaining) ? installment : remaining);
        if (thisPeriod.gt(availableForDeductions)) thisPeriod = money(availableForDeductions);
        if (thisPeriod.gt(0)) {
          advanceRecoveries.push({
            advanceId: adv.id,
            advanceNumber: adv.advanceNumber,
            amount: thisPeriod.toNumber(),
          });
          availableForDeductions = money(availableForDeductions.minus(thisPeriod));
        }
      }
      const totalAdvanceRecovery = advanceRecoveries.reduce((s, r) => s + r.amount, 0);

      // Keep gross = net + totalDeductions exact, and never persist negative net.
      const totalDeductionsEmployee = money(
        decimal(totalEmployeeStatutory)
          .plus(decimal(cappedNonStatutory))
          .plus(decimal(totalAdvanceRecovery)),
      ).toNumber();
      const netPay = money(decimal(grossPay).minus(decimal(totalDeductionsEmployee))).toNumber();
      const totalAllowances = taxableAllowancesWithCommission + nonTaxableAllowances;

      const entry = await this.prisma.payrollEntry.create({
        data: {
          payrollRunId: id,
          employeeId: employee.id,
          companyId,
          basePay,
          attendancePay,
          overtimePay,
          totalAllowances,
          totalDeductions: totalDeductionsEmployee,
          grossPay,
          netPay,
          daysWorked,
          overtimeHours,
          status: 'DRAFT',
          ...(lwopDays > 0
            ? {
                notes: `LWOP: ${lwopDays} day(s) deducted at TZS ${dailyRate.toFixed(2)}/day = -TZS ${lwopDeduction.toFixed(2)}`,
              }
            : {}),
        },
      });

      // Allowance line items
      for (const a of allowances) {
        await this.prisma.payrollEntryAllowance.create({
          data: {
            payrollEntryId: entry.id,
            allowanceTypeId: a.allowanceTypeId,
            amount: a.amount,
            description: a.allowanceType.name,
            taxable: a.allowanceType.taxable,
          },
        });
      }

      // Sales commission allowance line items — one per APPROVED commission.
      // Tagged with salesCommissionId so pay() can flip the source rows
      // to PAID without re-querying or parsing descriptions.
      if (pendingCommissions.length > 0) {
        const commissionAllowanceType = await this.prisma.allowanceType.findFirst({
          where: { companyId, code: 'SALES_COMMISSION', deletedAt: null },
        });
        if (commissionAllowanceType) {
          for (const c of pendingCommissions) {
            await this.prisma.payrollEntryAllowance.create({
              data: {
                payrollEntryId: entry.id,
                allowanceTypeId: commissionAllowanceType.id,
                amount: c.amount,
                description: `Sales commission — ${c.salesOrder?.salesOrderNumber ?? c.id}`,
                taxable: true,
                salesCommissionId: c.id,
              },
            });
          }
        } else {
          this.logger.warn(
            `Skipped commission payout for run ${id} — company ${companyId} has no AllowanceType with code='SALES_COMMISSION'. Re-seed.`,
          );
        }
      }

      // Non-statutory manual deductions only (statutory written as PayrollStatutoryLine).
      // Persist the actually-withheld (capped) amount so the deduction lines sum
      // to the entry's totalDeductions and never imply more than was withheld.
      for (const d of nonStatutoryDeductions) {
        await this.prisma.payrollEntryDeduction.create({
          data: {
            payrollEntryId: entry.id,
            deductionTypeId: d.deductionTypeId,
            amount: nonStatutoryWithheld.get(d.id) ?? Number(d.amount ?? 0),
            description: d.deductionType.name,
            statutory: false,
          },
        });
      }

      // Salary advance recovery deductions — one per outstanding advance.
      if (advanceRecoveries.length > 0) {
        const advanceDeductionType = await this.prisma.deductionType.findFirst({
          where: { companyId, code: 'ADVANCE', deletedAt: null },
        });
        if (advanceDeductionType) {
          for (const rec of advanceRecoveries) {
            await this.prisma.payrollEntryDeduction.create({
              data: {
                payrollEntryId: entry.id,
                deductionTypeId: advanceDeductionType.id,
                amount: rec.amount,
                description: `Advance recovery — ${rec.advanceNumber}`,
                statutory: false,
                salaryAdvanceId: rec.advanceId,
              },
            });
          }
        } else {
          this.logger.warn(
            `Skipped advance recovery for run ${id} — company ${companyId} has no DeductionType with code='ADVANCE'. Re-seed.`,
          );
        }
      }

      // Statutory breakdown
      for (const line of breakdown.lines) {
        let taxFilingPeriodId: string | undefined;
        if (periodStart && periodEnd) {
          taxFilingPeriodId = taxFilingPeriodIdsByTaxType.get(line.taxTypeId);
          if (!taxFilingPeriodId) {
            taxFilingPeriodId = await this.ensurePayrollTaxFilingPeriod(
              companyId,
              line.taxTypeId,
              periodStart,
              periodEnd,
            );
            taxFilingPeriodIdsByTaxType.set(line.taxTypeId, taxFilingPeriodId);
          }
        }
        await this.prisma.payrollStatutoryLine.create({
          data: {
            payrollEntryId: entry.id,
            taxTypeId: line.taxTypeId,
            taxFilingPeriodId,
            statutoryDeductionRuleId: line.ruleId,
            taxRateId: line.taxRateId,
            basis: line.basis,
            basisAmount: line.basisAmount,
            employeeContribution: line.employeeContribution,
            employerContribution: line.employerContribution,
            appliedRate: line.appliedRate,
            calculationDetail: line.calculationDetail
              ? (line.calculationDetail as object)
              : undefined,
            notes: line.notes,
          },
        });
      }

      totalGrossPay += grossPay;
      totalDeductions += totalDeductionsEmployee;
      totalNetPay += netPay;
    }

    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: 'CALCULATED',
        totalGrossPay,
        totalDeductions,
        totalNetPay,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { status: 'CALCULATED', totalEmployees: employees.length },
    });
    return updated;
  }

  private async ensurePayrollTaxFilingPeriod(
    companyId: string,
    taxTypeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<string> {
    const taxType = await this.prisma.taxType.findUnique({
      where: { id: taxTypeId },
      select: { taxTypeCode: true, name: true },
    });
    if (!taxType) throw new BadRequestException(`Tax type ${taxTypeId} no longer exists.`);

    const taxCode = filingCodeSegment(taxType.taxTypeCode);
    const startCode = formatDateYmd(periodStart);
    const endCode = formatDateYmd(periodEnd);
    const filingPeriodCode = `PAYROLL-${taxCode}-${startCode}-${endCode}`;

    const period = await this.prisma.taxFilingPeriod.upsert({
      where: {
        companyId_filingPeriodCode: {
          companyId,
          filingPeriodCode,
        },
      },
      create: {
        companyId,
        taxTypeId,
        filingPeriodCode,
        name: `${taxType.name} payroll ${startCode} to ${endCode}`,
        periodStart,
        periodEnd,
        filingFrequency: 'MONTHLY',
        status: 'OPEN',
        notes: 'Auto-created from payroll calculation; set statutory due date before submission.',
      },
      update: {
        taxTypeId,
        periodStart,
        periodEnd,
        deletedAt: null,
      },
      select: { id: true },
    });

    return period.id;
  }

  async submit(id: string, user: any) {
    const run = await this.findOne(id, user);
    if (run.status !== 'CALCULATED')
      throw new BadRequestException('Payroll run must be calculated before submitting');
    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedById: user.id, submittedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { status: 'SUBMITTED' },
    });
    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.lockPayrollRun(id, tx);
        if (!run) throw new NotFoundException('Payroll run not found');
        await this.companyScope.assertCanAccessCompany(user, run.companyId, AccessLevel.WRITE);
        if (run.status !== 'SUBMITTED') {
          throw new BadRequestException('Payroll run must be submitted before approving');
        }

        if (!run.hrApprovedById || !run.financeApprovedById) {
          throw new BadRequestException(
            'Payroll run requires both HR and Finance sign-off before approval',
          );
        }

        await this.postings.postRun(id, user.id, tx);

        return tx.payrollRun.update({
          where: { id },
          data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
        });
      },
      { timeout: 60_000 },
    );
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { status: 'APPROVED' },
    });
    return updated;
  }

  async approveHr(id: string, user: AuthUser) {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.lockPayrollRun(id, tx);
        if (!run) throw new NotFoundException('Payroll run not found');
        await this.companyScope.assertCanAccessCompany(user, run.companyId, AccessLevel.WRITE);
        if (run.status !== 'SUBMITTED') {
          throw new BadRequestException('Payroll run must be submitted before HR sign-off');
        }

        if (run.hrApprovedById) {
          throw new BadRequestException('HR sign-off is already recorded for this payroll run');
        }
        if (run.financeApprovedById === user.id) {
          throw new BadRequestException('The same user cannot sign off both HR and Finance');
        }

        const now = new Date();
        const stamped = await tx.payrollRun.update({
          where: { id },
          data: { hrApprovedById: user.id, hrApprovedAt: now },
        });

        if (run.financeApprovedById) {
          await this.postings.postRun(id, user.id, tx);
          return tx.payrollRun.update({
            where: { id },
            data: { status: 'APPROVED', approvedById: user.id, approvedAt: now },
          });
        }

        return stamped;
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { hrApprovedById: user.id, status: updated.status },
    });
    return updated;
  }

  async approveFinance(id: string, user: AuthUser) {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.lockPayrollRun(id, tx);
        if (!run) throw new NotFoundException('Payroll run not found');
        await this.companyScope.assertCanAccessCompany(user, run.companyId, AccessLevel.WRITE);
        if (run.status !== 'SUBMITTED') {
          throw new BadRequestException('Payroll run must be submitted before Finance sign-off');
        }

        if (run.financeApprovedById) {
          throw new BadRequestException(
            'Finance sign-off is already recorded for this payroll run',
          );
        }
        if (run.hrApprovedById === user.id) {
          throw new BadRequestException('The same user cannot sign off both HR and Finance');
        }

        const now = new Date();
        const stamped = await tx.payrollRun.update({
          where: { id },
          data: { financeApprovedById: user.id, financeApprovedAt: now },
        });

        if (run.hrApprovedById) {
          await this.postings.postRun(id, user.id, tx);
          return tx.payrollRun.update({
            where: { id },
            data: { status: 'APPROVED', approvedById: user.id, approvedAt: now },
          });
        }

        return stamped;
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { financeApprovedById: user.id, status: updated.status },
    });
    return updated;
  }

  async pay(id: string, user: AuthUser, body?: { disbursingChartOfAccountId?: string }) {
    let alreadyPaid = false;
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.lockPayrollRun(id, tx);
        if (!run) throw new NotFoundException('Payroll run not found');
        await this.companyScope.assertCanAccessCompany(user, run.companyId, AccessLevel.WRITE);
        if (run.status === 'PAID') {
          alreadyPaid = true;
          return tx.payrollRun.findUniqueOrThrow({ where: { id } });
        }
        if (run.status !== 'APPROVED') {
          throw new BadRequestException('Payroll run must be approved before paying');
        }

        if (body?.disbursingChartOfAccountId) {
          const acct = await tx.chartOfAccount.findFirst({
            where: {
              id: body.disbursingChartOfAccountId,
              companyId: run.companyId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!acct) {
            throw new BadRequestException(
              'Selected disbursing account does not belong to this company.',
            );
          }
        }

        const paidAt = new Date();
        const paid = await tx.payrollRun.update({
          where: { id },
          data: {
            status: 'PAID',
            paidById: user.id,
            paidAt,
            ...(body?.disbursingChartOfAccountId
              ? { disbursingChartOfAccountId: body.disbursingChartOfAccountId }
              : {}),
          },
        });

        await this.syncAdvanceRecoveries(id, tx);
        await this.settleSalesCommissions(id, tx);
        await this.postings.postPayment(id, user.id, tx);

        return paid;
      },
      { timeout: 60_000 },
    );
    if (!alreadyPaid) {
      await this.audit.log({
        userId: user.id,
        action: 'UPDATE',
        entityType: 'PayrollRun',
        entityId: id,
        newValue: { status: 'PAID', disbursingChartOfAccountId: body?.disbursingChartOfAccountId },
      });
    }
    return updated;
  }

  private async lockPayrollRun(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<LockedPayrollRunRow | null> {
    const rows = await tx.$queryRaw<LockedPayrollRunRow[]>`
      SELECT id, "companyId", status, "journalEntryId", "hrApprovedById", "financeApprovedById"
      FROM "payroll_runs"
      WHERE id = ${id}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async syncAdvanceRecoveries(payrollRunId: string, tx: Prisma.TransactionClient) {
    const recoveryDeductions = await tx.payrollEntryDeduction.findMany({
      where: {
        salaryAdvanceId: { not: null },
        payrollEntry: { payrollRunId, deletedAt: null },
      },
    });

    const byAdvance = new Map<string, Prisma.Decimal>();
    for (const deduction of recoveryDeductions) {
      if (!deduction.salaryAdvanceId) continue;
      byAdvance.set(
        deduction.salaryAdvanceId,
        (byAdvance.get(deduction.salaryAdvanceId) ?? decimal(0)).plus(decimal(deduction.amount)),
      );
    }

    for (const [advanceId, recoveredThisRun] of byAdvance) {
      const rows = await tx.$queryRaw<LockedSalaryAdvanceRow[]>`
        SELECT id, amount, "recoveredAmount"
        FROM "salary_advances"
        WHERE id = ${advanceId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const advance = rows[0];
      if (!advance) {
        throw new BadRequestException(`Salary advance ${advanceId} no longer exists.`);
      }

      const newRecovered = money(decimal(advance.recoveredAmount).plus(recoveredThisRun));
      const fullyRecovered = newRecovered.gte(decimal(advance.amount));
      await tx.salaryAdvance.update({
        where: { id: advanceId },
        data: {
          recoveredAmount: newRecovered,
          status: fullyRecovered ? 'SETTLED' : 'DEDUCTING',
        },
      });
    }
  }

  private async settleSalesCommissions(payrollRunId: string, tx: Prisma.TransactionClient) {
    const payoutAllowances = await tx.payrollEntryAllowance.findMany({
      where: {
        salesCommissionId: { not: null },
        payrollEntry: { payrollRunId, deletedAt: null },
      },
      select: { salesCommissionId: true, payrollEntryId: true },
    });

    for (const payout of payoutAllowances) {
      if (!payout.salesCommissionId) continue;
      const rows = await tx.$queryRaw<LockedSalesCommissionRow[]>`
        SELECT id, status, "paidPayrollEntryId"
        FROM "sales_commissions"
        WHERE id = ${payout.salesCommissionId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const commission = rows[0];
      if (!commission) {
        throw new BadRequestException(
          `Sales commission ${payout.salesCommissionId} no longer exists.`,
        );
      }
      if (
        commission.paidPayrollEntryId &&
        commission.paidPayrollEntryId !== payout.payrollEntryId
      ) {
        throw new BadRequestException(
          `Sales commission ${commission.id} has already been paid by another payroll entry.`,
        );
      }
      if (!['APPROVED', 'PAID'].includes(commission.status)) {
        throw new BadRequestException(
          `Sales commission ${commission.id} is ${commission.status} and cannot be settled by this payroll run.`,
        );
      }
      if (commission.status === 'PAID' && commission.paidPayrollEntryId === payout.payrollEntryId) {
        continue;
      }

      await tx.salesCommission.update({
        where: { id: payout.salesCommissionId },
        data: { status: 'PAID', paidPayrollEntryId: payout.payrollEntryId },
      });
    }
  }

  async cancel(id: string, reason: string | undefined, user: any) {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const run = await this.lockPayrollRun(id, tx);
        if (!run) throw new NotFoundException('Payroll run not found');
        await this.companyScope.assertCanAccessCompany(user, run.companyId, AccessLevel.WRITE);
        if (run.status === 'PAID')
          throw new BadRequestException('Cannot cancel a paid payroll run');
        if (run.status === 'CANCELLED') {
          return tx.payrollRun.update({
            where: { id },
            data: reason ? { notes: reason } : {},
          });
        }

        await this.postings.reverseAccrual(id, user.id, reason, tx);

        return tx.payrollRun.update({
          where: { id },
          data: { status: 'CANCELLED', notes: reason },
        });
      },
      { timeout: 60_000 },
    );
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: { status: 'CANCELLED', reason },
    });
    return updated;
  }

  async remove(id: string, user: any) {
    const run = await this.findOne(id, user);
    if (!['DRAFT', 'CANCELLED'].includes(run.status)) {
      throw new BadRequestException('Only draft or cancelled payroll runs can be deleted');
    }
    await this.prisma.payrollRun.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'PayrollRun',
      entityId: id,
      newValue: {},
    });
    return { message: 'Payroll run deleted' };
  }
}

type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];

function decimal(value: DecimalInput | null | undefined): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value ?? 0);
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2);
}

function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(value: Date): Date {
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function formatDateYmd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Calendar-day key (UTC YYYY-MM-DD) used to de-duplicate unpaid days counted by
// both approved unpaid leave and unpaid-absence attendance (ITMB-081).
function calendarDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Distinct calendar-day keys covered by the inclusive [start, end] range.
function calendarDateKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(calendarDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function filingCodeSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function attendanceDayWeight(status: string): number {
  if (['PRESENT', 'LATE'].includes(status)) return 1;
  if (status === 'HALF_DAY') return 0.5;
  return 0;
}

function unpaidAbsenceWeight(status: string): number {
  if (['ABSENT', 'UNPAID_ABSENT'].includes(status)) return 1;
  if (status === 'HALF_DAY') return 0.5;
  return 0;
}
