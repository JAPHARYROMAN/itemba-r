import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';

const SENSITIVE_FIELDS = [
  'baseSalary',
  'bankAccountNumber',
  'bankName',
  'bankBranch',
  'tin',
  'nssfNumber',
  'nhifNumber',
];

const EMPLOYEE_WRITABLE_FIELDS = new Set([
  'employeeCode',
  'companyId',
  'divisionId',
  'branchId',
  'licensedBusinessUnitId',
  'departmentId',
  'positionId',
  'userId',
  'firstName',
  'middleName',
  'lastName',
  'fullName',
  'gender',
  'dateOfBirth',
  'nationality',
  'phone',
  'email',
  'address',
  'identificationType',
  'identificationNumber',
  'nidaNumber',
  'passportNumber',
  'passportCountry',
  'votersIdNumber',
  'tin',
  'nssfNumber',
  'nhifNumber',
  'pssfNumber',
  'wcfRegistrationNumber',
  'heslbNumber',
  'heslbBorrower',
  'taxResidencyStatus',
  'disabilityStatus',
  'disabilityCertificateNo',
  'dependents',
  'payrollRegion',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'mobileMoneyNumber',
  'emergencyContactName',
  'emergencyContactPhone',
  'employmentType',
  'employmentStatus',
  'hireDate',
  'terminationDate',
  'baseSalary',
  'salaryCurrency',
  'paymentFrequency',
  'notes',
]);

const EMPLOYEE_DATE_FIELDS = new Set(['dateOfBirth', 'hireDate', 'terminationDate']);

function hasSensitivePermission(user: any): boolean {
  const perms: string[] = user.permissions ?? [];
  return perms.includes('employees.sensitive.view') || perms.includes('payroll.sensitive.view');
}

function stripSensitive(employee: any, user?: any): any {
  if (hasSensitivePermission(user)) return employee;
  const result = { ...employee };
  for (const f of SENSITIVE_FIELDS) delete result[f];
  return result;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const {
      page = 1,
      limit = 20,
      search,
      companyId,
      branchId,
      departmentId,
      positionId,
      status,
      employmentStatus,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (branchId) where.branchId = branchId;
    if (departmentId) where.departmentId = departmentId;
    if (positionId) where.positionId = positionId;
    if (status) where.status = status;
    if (employmentStatus) where.employmentStatus = employmentStatus;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { fullName: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);
    return {
      data: data.map((e) => stripSensitive(e, user)),
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        company: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
      },
    });
    if (!record) throw new NotFoundException('Employee not found');
    return stripSensitive(record, user);
  }

  /**
   * Returns accounts that may safely be linked to an employee in a company.
   * A Mobile POS rep needs write access to the terminal's company, so an
   * account is eligible only when its primary company or explicit access grant
   * satisfies that requirement and it is not already linked elsewhere.
   */
  async findLinkableUsers(companyId: string, employeeId: string | undefined, user: any) {
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.WRITE);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        AND: [
          this.userAccessForCompany(companyId),
          employeeId
            ? {
                OR: [{ hrEmployee: { is: null } }, { hrEmployee: { is: { id: employeeId } } }],
              }
            : { hrEmployee: { is: null } },
        ],
      },
      select: { id: true, fullName: true, email: true },
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
    });

    return users;
  }

  async create(dto: CreateEmployeeDto, user: any) {
    const placement = await this.normalizeEmployeeHierarchy(dto, user);
    await this.validateUserLink(dto.userId, dto.companyId);
    const explicitCode = dto.employeeCode?.trim();
    const record = explicitCode
      ? await this.prisma.employee.create({
          data: this.employeeCreateData(dto, placement, explicitCode),
        })
      : await this.createWithGeneratedCode(dto, placement);
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: record.id,
      newValue: { employeeCode: record.employeeCode, fullName: record.fullName },
    });
    return stripSensitive(record, user);
  }

  /**
   * Generate the per-company `{prefix}-EMP-{NNNN}` code and create the employee
   * inside a transaction. On the unique-constraint race (two concurrent creates
   * computing the same count+1), retry once with a freshly recomputed count.
   */
  private async createWithGeneratedCode(
    dto: CreateEmployeeDto,
    placement: Record<string, unknown>,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const employeeCode = await this.nextEmployeeCode(dto.companyId, tx);
          return tx.employee.create({
            data: this.employeeCreateData(dto, placement, employeeCode),
          });
        });
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    // Unreachable: the loop either returns the created record or rethrows.
    throw new BadRequestException('Could not generate a unique employee code');
  }

  /**
   * Generate the next employee code for a company: `{prefix}-EMP-{NNNN}`.
   * Prefix comes from `Company.employeeCodePrefix`, falling back to the
   * first 4 chars of `Company.code` (uppercased) when unset.
   *
   * Counts existing employees (including soft-deleted) so a deleted-then-
   * recreated employee doesn't reuse a code. To avoid a count+create race the
   * caller runs this inside a $transaction and retries once on the unique
   * constraint (see createWithGeneratedCode).
   */
  async nextEmployeeCode(
    companyId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const company = await client.company.findUnique({
      where: { id: companyId },
      select: { code: true, employeeCodePrefix: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = (company.employeeCodePrefix ?? company.code.slice(0, 4)).toUpperCase();
    const count = await client.employee.count({ where: { companyId } });
    return `${prefix}-EMP-${String(count + 1).padStart(4, '0')}`;
  }

  async update(id: string, dto: UpdateEmployeeDto, user: any) {
    const existing = await this.findOne(id, user);
    if ((dto as any).employmentStatus === 'TERMINATED') {
      throw new BadRequestException(
        'Employee termination must use the termination request and dual approval workflow',
      );
    }
    const placement = await this.normalizeEmployeeHierarchy(
      {
        ...existing,
        ...dto,
        companyId: dto.companyId ?? existing.companyId,
      } as CreateEmployeeDto,
      user,
    );
    await this.validateUserLink(
      dto.userId !== undefined ? dto.userId : existing.userId,
      dto.companyId ?? existing.companyId,
      id,
    );
    const record = await this.prisma.employee.update({
      where: { id },
      data: this.employeeUpdateData(dto, placement),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return stripSensitive(record, user);
  }

  private employeeCreateData(
    dto: CreateEmployeeDto,
    placement: Record<string, unknown>,
    employeeCode: string,
  ): Prisma.EmployeeUncheckedCreateInput {
    const firstName = dto.firstName?.trim();
    const middleName = dto.middleName?.trim();
    const lastName = dto.lastName?.trim();
    const fullName =
      dto.fullName?.trim() || [firstName, middleName, lastName].filter(Boolean).join(' ');

    return this.employeeWriteData({
      ...dto,
      ...placement,
      employeeCode,
      firstName,
      middleName,
      lastName,
      fullName,
    }) as Prisma.EmployeeUncheckedCreateInput;
  }

  private employeeUpdateData(
    dto: UpdateEmployeeDto,
    placement: Record<string, unknown>,
  ): Prisma.EmployeeUncheckedUpdateInput {
    return this.employeeWriteData({ ...dto, ...placement }) as Prisma.EmployeeUncheckedUpdateInput;
  }

  private employeeWriteData(input: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (!EMPLOYEE_WRITABLE_FIELDS.has(key)) continue;
      if (value === undefined || value === '') continue;
      if (value === null) {
        data[key] = null;
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (EMPLOYEE_DATE_FIELDS.has(key)) {
          data[key] = this.parseEmployeeDate(key, trimmed);
        } else {
          data[key] = trimmed;
        }
        continue;
      }

      data[key] = value;
    }

    return data;
  }

  private userAccessForCompany(companyId: string): Prisma.UserWhereInput {
    return {
      OR: [
        { companyId },
        {
          companyAccess: {
            some: {
              companyId,
              accessLevel: { in: [AccessLevel.WRITE, AccessLevel.MANAGE] },
            },
          },
        },
      ],
    };
  }

  private async validateUserLink(
    userId: string | null | undefined,
    companyId: string,
    employeeId?: string,
  ) {
    if (!userId) return;

    const account = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        AND: [this.userAccessForCompany(companyId)],
      },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        'The selected user account must be active and have write access to the employee company',
      );
    }

    const existingLink = await this.prisma.employee.findFirst({
      where: {
        userId,
        ...(employeeId ? { id: { not: employeeId } } : {}),
      },
      select: { employeeCode: true, fullName: true },
    });
    if (existingLink) {
      throw new BadRequestException(
        `The selected user account is already linked to ${existingLink.fullName} (${existingLink.employeeCode})`,
      );
    }
  }

  private parseEmployeeDate(field: string, value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return parsed;
  }

  async requestTermination(
    id: string,
    body: { reason?: string; terminationDate?: string },
    user: any,
  ) {
    const existing = await this.findOne(id, user);
    if ((existing as any).employmentStatus === 'TERMINATED') {
      throw new BadRequestException('Employee is already terminated');
    }
    if (!body.reason?.trim()) {
      throw new BadRequestException('Termination reason is required');
    }
    const pendingTerminationDate = body.terminationDate
      ? new Date(body.terminationDate)
      : new Date();
    if (Number.isNaN(pendingTerminationDate.getTime())) {
      throw new BadRequestException('Invalid termination date');
    }
    const record = await this.prisma.employee.update({
      where: { id },
      data: {
        pendingTerminationDate,
        terminationReason: body.reason.trim(),
        terminationRequestedById: user.id,
        terminationRequestedAt: new Date(),
        terminationHrApprovedById: null,
        terminationHrApprovedAt: null,
        terminationGmApprovedById: null,
        terminationGmApprovedAt: null,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'TERMINATION_REQUEST',
      entityType: 'Employee',
      entityId: id,
      newValue: {
        terminationReason: body.reason.trim(),
        pendingTerminationDate,
      },
    });
    return stripSensitive(record, user);
  }

  async approveTerminationHr(id: string, user: any) {
    const existing = await this.findOne(id, user);
    this.assertTerminationPending(existing, user.id);
    if ((existing as any).terminationGmApprovedById === user.id) {
      throw new BadRequestException('Maker-checker: HR and GM termination approvers must differ');
    }
    const record = await this.applyTerminationApproval(id, existing, user, {
      terminationHrApprovedById: user.id,
      terminationHrApprovedAt: new Date(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'TERMINATION_HR_APPROVE',
      entityType: 'Employee',
      entityId: id,
      newValue: { employmentStatus: (record as any).employmentStatus },
    });
    return stripSensitive(record, user);
  }

  async approveTerminationGm(id: string, user: any) {
    const existing = await this.findOne(id, user);
    this.assertTerminationPending(existing, user.id);
    if ((existing as any).terminationHrApprovedById === user.id) {
      throw new BadRequestException('Maker-checker: GM and HR termination approvers must differ');
    }
    const record = await this.applyTerminationApproval(id, existing, user, {
      terminationGmApprovedById: user.id,
      terminationGmApprovedAt: new Date(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'TERMINATION_GM_APPROVE',
      entityType: 'Employee',
      entityId: id,
      newValue: { employmentStatus: (record as any).employmentStatus },
    });
    return stripSensitive(record, user);
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.assertEmployeeCanBeDeleted(id);
    await this.prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date(), employmentStatus: 'INACTIVE' },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'Employee',
      entityId: id,
      newValue: {},
    });
    return { message: 'Employee deleted' };
  }

  private async assertEmployeeCanBeDeleted(employeeId: string) {
    const [
      activeAllowances,
      activeDeductions,
      openLeaveRequests,
      openSalaryAdvances,
      openPayrollEntries,
    ] = await Promise.all([
      this.prisma.employeeAllowance.count({
        where: { employeeId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.employeeDeduction.count({
        where: { employeeId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.leaveRequest.count({
        where: {
          employeeId,
          deletedAt: null,
          status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
        },
      }),
      this.prisma.salaryAdvance.count({
        where: {
          employeeId,
          deletedAt: null,
          status: { in: ['REQUESTED', 'APPROVED', 'PAID', 'DEDUCTING'] },
        },
      }),
      this.prisma.payrollEntry.count({
        where: {
          employeeId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          payrollRun: { deletedAt: null, status: { not: 'CANCELLED' } },
        },
      }),
    ]);

    const blockers = [
      activeAllowances ? `${activeAllowances} active allowance(s)` : null,
      activeDeductions ? `${activeDeductions} active deduction(s)` : null,
      openLeaveRequests ? `${openLeaveRequests} open/approved leave request(s)` : null,
      openSalaryAdvances ? `${openSalaryAdvances} unsettled salary advance(s)` : null,
      openPayrollEntries
        ? `${openPayrollEntries} payroll entr${openPayrollEntries === 1 ? 'y' : 'ies'}`
        : null,
    ].filter(Boolean);

    if (blockers.length > 0) {
      throw new BadRequestException(
        `Employee cannot be deleted while dependent HR/payroll records are active: ${blockers.join(', ')}. Close, cancel, or settle these records first.`,
      );
    }
  }

  private async normalizeEmployeeHierarchy(dto: CreateEmployeeDto, user: any) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const placement: {
      divisionId?: string | null;
      branchId?: string | null;
      departmentId?: string | null;
      positionId?: string | null;
    } = {
      divisionId: dto.divisionId,
      branchId: dto.branchId,
      departmentId: dto.departmentId,
      positionId: dto.positionId,
    };

    if (placement.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: placement.branchId, deletedAt: null },
        select: {
          divisionId: true,
          isActive: true,
          division: { select: { companyId: true, isActive: true, deletedAt: true } },
        },
      });
      if (!branch) throw new NotFoundException('Branch/location not found');
      if (branch.division.companyId !== dto.companyId) {
        throw new BadRequestException(
          'Employee branch/location must belong to the selected company',
        );
      }
      if (!branch.isActive || !branch.division.isActive || branch.division.deletedAt) {
        throw new BadRequestException('Employee branch/location must be active');
      }
      if (placement.divisionId && placement.divisionId !== branch.divisionId) {
        throw new BadRequestException(
          'Employee branch/location must belong to the selected division',
        );
      }
      placement.divisionId = branch.divisionId;
    }

    if (placement.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: placement.departmentId, deletedAt: null },
        select: {
          companyId: true,
          divisionId: true,
          branchId: true,
          status: true,
          division: { select: { companyId: true, isActive: true, deletedAt: true } },
          branch: { select: { divisionId: true, isActive: true, deletedAt: true } },
        },
      });
      if (!department) throw new NotFoundException('Department not found');
      if (department.companyId !== dto.companyId) {
        throw new BadRequestException('Employee department must belong to the selected company');
      }
      if (department.status !== 'ACTIVE') {
        throw new BadRequestException('Employee department must be active');
      }
      if (department.divisionId) {
        if (placement.divisionId && placement.divisionId !== department.divisionId) {
          throw new BadRequestException('Employee department must belong to the selected division');
        }
        placement.divisionId = department.divisionId;
      }
      if (department.branchId) {
        if (placement.branchId && placement.branchId !== department.branchId) {
          throw new BadRequestException(
            'Employee department must belong to the selected branch/location',
          );
        }
        placement.branchId = department.branchId;
      }
      if (
        department.division &&
        (department.division.companyId !== dto.companyId ||
          !department.division.isActive ||
          department.division.deletedAt)
      ) {
        throw new BadRequestException(
          'Employee department division is not active for the selected company',
        );
      }
      if (department.branch && (!department.branch.isActive || department.branch.deletedAt)) {
        throw new BadRequestException('Employee department branch/location must be active');
      }
    }

    if (placement.positionId) {
      const position = await this.prisma.position.findFirst({
        where: { id: placement.positionId, deletedAt: null },
        select: { companyId: true, departmentId: true, status: true },
      });
      if (!position) throw new NotFoundException('Position not found');
      if (position.companyId !== dto.companyId) {
        throw new BadRequestException('Employee position must belong to the selected company');
      }
      if (position.status !== 'ACTIVE') {
        throw new BadRequestException('Employee position must be active');
      }
      if (!position.departmentId) {
        throw new BadRequestException('Employee position must be linked to a department');
      }
      if (placement.departmentId && placement.departmentId !== position.departmentId) {
        throw new BadRequestException('Employee position must belong to the selected department');
      }
      placement.departmentId = position.departmentId;
    }

    return placement;
  }

  private assertTerminationPending(employee: any, approverId: string) {
    if (!employee.terminationRequestedAt) {
      throw new BadRequestException('No termination request is pending for this employee');
    }
    if (employee.employmentStatus === 'TERMINATED') {
      throw new BadRequestException('Employee is already terminated');
    }
    if (employee.terminationRequestedById === approverId) {
      throw new BadRequestException('Maker-checker: termination requester cannot approve');
    }
  }

  private async applyTerminationApproval(
    id: string,
    existing: any,
    user: any,
    approvalData: Record<string, unknown>,
  ) {
    const hasHrApproval = Boolean(
      approvalData.terminationHrApprovedById ?? existing.terminationHrApprovedById,
    );
    const hasGmApproval = Boolean(
      approvalData.terminationGmApprovedById ?? existing.terminationGmApprovedById,
    );
    const finalData =
      hasHrApproval && hasGmApproval
        ? {
            employmentStatus: 'TERMINATED',
            terminationDate: existing.pendingTerminationDate ?? new Date(),
          }
        : {};
    return this.prisma.employee.update({
      where: { id },
      data: { ...approvalData, ...finalData } as any,
    });
  }
}
