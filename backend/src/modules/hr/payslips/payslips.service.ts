import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/**
 * Aggregates everything a printable Tanzanian payslip needs. Pure read service —
 * data comes from `payroll_entries`, `payroll_entry_allowances`,
 * `payroll_entry_deductions`, `payroll_statutory_lines`, plus the employee's
 * snapshot (employee code, TIN, NSSF #, etc.) at time of payment.
 *
 * Bilingual labels live in the frontend renderer; this service is purely the
 * structured payload.
 */
@Injectable()
export class PayslipsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPayslip(payrollEntryId: string, user: AuthUser) {
    const where: any = { id: payrollEntryId, deletedAt: null };
    // Company-scoped: a payroll.view holder must not read another company's
    // payslip by id. Mirrors generated-documents.service.ts's payslipPdf builder.
    applyCompanyScopeWhere(where, user);
    const entry = await this.prisma.payrollEntry.findFirst({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            middleName: true,
            lastName: true,
            fullName: true,
            email: true,
            phone: true,
            nidaNumber: true,
            tin: true,
            nssfNumber: true,
            nhifNumber: true,
            pssfNumber: true,
            wcfRegistrationNumber: true,
            heslbNumber: true,
            heslbBorrower: true,
            taxResidencyStatus: true,
            disabilityStatus: true,
            payrollRegion: true,
            bankName: true,
            bankAccountName: true,
            bankAccountNumber: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, title: true } },
            branch: { select: { id: true, name: true, code: true } },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            profile: {
              select: {
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        payrollRun: {
          select: {
            id: true,
            payrollRunNumber: true,
            runDate: true,
            payrollPeriod: { select: { id: true, name: true, startDate: true, endDate: true, paymentDate: true } },
          },
        },
        allowances: {
          include: { allowanceType: { select: { id: true, name: true, code: true, taxable: true } } },
          orderBy: { createdAt: 'asc' },
        },
        deductions: {
          include: { deductionType: { select: { id: true, name: true, code: true, statutory: true } } },
          orderBy: { createdAt: 'asc' },
        },
        statutoryLines: {
          include: {
            taxType: { select: { id: true, taxTypeCode: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!entry) throw new NotFoundException('Payroll entry not found');

    // Group statutory lines by class
    const employeeStatutory = entry.statutoryLines.filter((l) => Number(l.employeeContribution) > 0);
    const employerStatutory = entry.statutoryLines.filter((l) => Number(l.employerContribution) > 0);

    const employeeStatutoryTotal = employeeStatutory.reduce((s, l) => s + Number(l.employeeContribution), 0);
    const employerStatutoryTotal = employerStatutory.reduce((s, l) => s + Number(l.employerContribution), 0);
    const manualDeductionsTotal = entry.deductions.reduce((s, d) => s + Number(d.amount), 0);

    return {
      entry: {
        id: entry.id,
        basePay: Number(entry.basePay),
        attendancePay: Number(entry.attendancePay),
        overtimePay: Number(entry.overtimePay),
        totalAllowances: Number(entry.totalAllowances),
        grossPay: Number(entry.grossPay),
        totalDeductions: Number(entry.totalDeductions),
        netPay: Number(entry.netPay),
        daysWorked: entry.daysWorked != null ? Number(entry.daysWorked) : null,
        overtimeHours: entry.overtimeHours != null ? Number(entry.overtimeHours) : null,
        status: entry.status,
      },
      employee: entry.employee,
      company: entry.company,
      payrollRun: entry.payrollRun,
      allowances: entry.allowances.map((a) => ({
        id: a.id,
        name: a.allowanceType?.name ?? a.description,
        code: a.allowanceType?.code,
        taxable: a.taxable,
        amount: Number(a.amount),
      })),
      manualDeductions: entry.deductions.map((d) => ({
        id: d.id,
        name: d.deductionType?.name ?? d.description,
        code: d.deductionType?.code,
        statutory: d.statutory,
        amount: Number(d.amount),
      })),
      statutoryLines: entry.statutoryLines.map((l) => ({
        id: l.id,
        taxTypeCode: l.taxType?.taxTypeCode,
        taxTypeName: l.taxType?.name,
        basis: l.basis,
        basisAmount: Number(l.basisAmount),
        employeeContribution: Number(l.employeeContribution),
        employerContribution: Number(l.employerContribution),
        appliedRate: l.appliedRate != null ? Number(l.appliedRate) : null,
        notes: l.notes,
      })),
      totals: {
        employeeStatutory: round2(employeeStatutoryTotal),
        employerStatutory: round2(employerStatutoryTotal),
        manualDeductions: round2(manualDeductionsTotal),
      },
    };
  }

  async getPayslipsForRun(payrollRunId: string, user: AuthUser) {
    const where: any = { payrollRunId, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const entries = await this.prisma.payrollEntry.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(entries.map((e) => this.getPayslip(e.id, user)));
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
