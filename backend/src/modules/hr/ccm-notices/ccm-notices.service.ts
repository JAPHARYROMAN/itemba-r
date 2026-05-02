import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * CCM (Commission for Mediation & Arbitration) form payload assembly.
 *
 * **Form 1** — Notice of Termination of Employment, given to the employee.
 *   Required by Tanzania's Employment & Labour Relations Act, 2004 §41.
 *
 * **Form CMA-F1** — Referral of Dispute to CMA. Filed by either party (within
 *   30 days for unfair dismissal disputes) when internal mediation fails.
 *
 * This service produces structured payloads — the frontend renders them as
 * bilingual A4 forms via CSS print, which operators then save as PDF and
 * physically file. No server-side PDF rendering required for the MVP.
 */

@Injectable()
export class CcmNoticesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Form 1 — Notice of Termination of Employment.
   * Pulls everything we need from the Employee + active disciplinary chain.
   */
  async terminationNotice(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: {
        company: {
          select: {
            id: true, name: true, code: true,
            profile: { select: { tin: true, registeredAddress: true, postalAddress: true, brelaRegNumber: true } },
          },
        },
        position: { select: { title: true } },
        department: { select: { name: true } },
        branch: { select: { name: true, location: true } },
        contracts: { where: { deletedAt: null }, orderBy: { startDate: 'desc' as const }, take: 1 },
        disciplinaryActions: {
          where: { deletedAt: null, status: { in: ['ACTIVE', 'EXPIRED'] } },
          orderBy: { issuedAt: 'desc' as const },
          take: 5,
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const latestContract = employee.contracts[0];
    const tenureMonths = employee.hireDate
      ? Math.floor((Date.now() - new Date(employee.hireDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375))
      : null;

    return {
      formCode: 'Form 1',
      formName: 'Notice of Termination of Employment',
      formNameSwahili: 'Notisi ya Kusitisha Ajira',
      jurisdiction: 'Tanzania — Employment & Labour Relations Act, 2004',
      generatedAt: new Date().toISOString(),
      employer: {
        name: employee.company.name,
        code: employee.company.code,
        tin: employee.company.profile?.tin ?? null,
        brelaRegNumber: employee.company.profile?.brelaRegNumber ?? null,
        registeredAddress: employee.company.profile?.registeredAddress ?? null,
        postalAddress: employee.company.profile?.postalAddress ?? null,
      },
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName ?? `${employee.firstName} ${employee.lastName}`,
        nida: employee.nidaNumber ?? null,
        passport: employee.passportNumber ?? null,
        nationality: employee.nationality ?? null,
        gender: employee.gender,
        dateOfBirth: employee.dateOfBirth ?? null,
        address: employee.address ?? null,
        phone: employee.phone ?? null,
        email: employee.email ?? null,
      },
      employment: {
        position: employee.position?.title ?? null,
        department: employee.department?.name ?? null,
        branch: employee.branch?.name ?? null,
        location: employee.branch?.location ?? null,
        hireDate: employee.hireDate ?? null,
        tenureMonths,
        contractType: latestContract?.contractType ?? null,
        contractStartDate: latestContract?.startDate ?? null,
        baseSalary: employee.baseSalary != null ? Number(employee.baseSalary) : null,
        salaryCurrency: employee.salaryCurrency,
      },
      disciplinaryHistory: employee.disciplinaryActions.map((d) => ({
        actionNumber: d.actionNumber,
        type: d.type,
        issuedAt: d.issuedAt,
        reason: d.reason,
        status: d.status,
      })),
      // The form fields the operator must fill in physically (these aren't
      // computed — they're free-form decisions). Provided as a checklist.
      operatorFields: [
        'Effective date of termination',
        'Reason for termination (statutory category — capacity / conduct / operational requirements)',
        'Notice period (statutory minimum: 7 days probation, 28 days monthly-paid)',
        'Final pay computation (basic + accrued leave + severance if applicable)',
        'Severance pay (7 days per completed year, after 12 months)',
        'Date employee notified',
        'Witness signature(s)',
      ],
    };
  }

  /**
   * Form CMA-F1 — Referral of Dispute to the Commission for Mediation &
   * Arbitration. Generated from an existing EmploymentDispute record.
   */
  async cmaReferralForm(disputeId: string) {
    const dispute = await this.prisma.employmentDispute.findFirst({
      where: { id: disputeId, deletedAt: null },
      include: {
        company: {
          select: {
            id: true, name: true,
            profile: { select: { tin: true, brelaRegNumber: true, registeredAddress: true, postalAddress: true } },
          },
        },
        employee: {
          select: {
            id: true, employeeCode: true, fullName: true, firstName: true, lastName: true,
            nidaNumber: true, address: true, phone: true, email: true,
            position: { select: { title: true } },
            department: { select: { name: true } },
            hireDate: true, baseSalary: true, salaryCurrency: true,
          },
        },
        raisedBy: { select: { id: true, fullName: true } },
        mediatedBy: { select: { id: true, fullName: true } },
        disciplinaryActions: {
          where: { deletedAt: null },
          orderBy: { issuedAt: 'desc' as const },
        },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    return {
      formCode: 'Form CMA-F1',
      formName: 'Referral of Dispute to CMA',
      formNameSwahili: 'Marejeo ya Mgogoro CMA',
      jurisdiction: 'Tanzania — Labour Institutions (Mediation & Arbitration Guidelines)',
      generatedAt: new Date().toISOString(),
      dispute: {
        disputeNumber: dispute.disputeNumber,
        type: dispute.type,
        status: dispute.status,
        raisedAt: dispute.raisedAt,
        summary: dispute.summary,
        initialPosition: dispute.initialPosition ?? null,
        mediationOutcome: dispute.mediationOutcome ?? null,
        cmaReferenceNumber: dispute.cmaReferenceNumber ?? null,
        cmaArbitrator: dispute.cmaArbitrator ?? null,
        cmaHearingDate: dispute.cmaHearingDate ?? null,
      },
      employer: {
        name: dispute.company.name,
        tin: dispute.company.profile?.tin ?? null,
        brelaRegNumber: dispute.company.profile?.brelaRegNumber ?? null,
        registeredAddress: dispute.company.profile?.registeredAddress ?? null,
        postalAddress: dispute.company.profile?.postalAddress ?? null,
      },
      employee: {
        employeeCode: dispute.employee.employeeCode,
        fullName: dispute.employee.fullName ?? `${dispute.employee.firstName} ${dispute.employee.lastName}`,
        nida: dispute.employee.nidaNumber ?? null,
        address: dispute.employee.address ?? null,
        phone: dispute.employee.phone ?? null,
        email: dispute.employee.email ?? null,
        position: dispute.employee.position?.title ?? null,
        department: dispute.employee.department?.name ?? null,
        hireDate: dispute.employee.hireDate ?? null,
        baseSalary: dispute.employee.baseSalary != null ? Number(dispute.employee.baseSalary) : null,
        salaryCurrency: dispute.employee.salaryCurrency,
      },
      raisedBy: dispute.raisedBy ? { fullName: dispute.raisedBy.fullName } : null,
      mediatedBy: dispute.mediatedBy ? { fullName: dispute.mediatedBy.fullName } : null,
      disciplinaryHistory: dispute.disciplinaryActions.map((d) => ({
        actionNumber: d.actionNumber,
        type: d.type,
        issuedAt: d.issuedAt,
        reason: d.reason,
        status: d.status,
      })),
    };
  }
}
