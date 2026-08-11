import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PayrollPostingsService } from '../payroll-postings/payroll-postings.service';
import { CompanyScopeService } from '../../../common/services';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CreateSalaryAdvanceDto } from './dto/create-salary-advance.dto';
import { UpdateSalaryAdvanceDto } from './dto/update-salary-advance.dto';

interface LockedSalaryAdvancePayRow {
  id: string;
  companyId: string;
  status: string;
}

@Injectable()
export class SalaryAdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly postings: PayrollPostingsService,
    private readonly companyScope: CompanyScopeService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.salaryAdvance.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { requestDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.salaryAdvance.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.salaryAdvance.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Salary advance not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateSalaryAdvanceDto, user: AuthUser) {
    if ((dto as any).companyId) {
      await this.companyScope.assertCanAccessCompany(
        user,
        (dto as any).companyId,
        AccessLevel.WRITE,
      );
    }
    const advanceNumber =
      dto.advanceNumber ??
      (await this.codes.next({ companyId: dto.companyId, entityType: 'SalaryAdvance' }));
    const record = await this.prisma.salaryAdvance.create({
      data: { ...dto, advanceNumber, requestDate: new Date(dto.requestDate) } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_ADVANCE_CREATE',
      entityType: 'SalaryAdvance',
      entityId: record.id,
      companyId: (record as any).companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateSalaryAdvanceDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.salaryAdvance.update({
      where: { id },
      data: { ...dto, requestDate: dto.requestDate ? new Date(dto.requestDate) : undefined } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_ADVANCE_UPDATE',
      entityType: 'SalaryAdvance',
      entityId: id,
      companyId: existing.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async approve(id: string, approvedAmount: number | undefined, user: AuthUser) {
    const record = await this.findOne(id, user, AccessLevel.WRITE);
    if (record.status !== 'REQUESTED')
      throw new BadRequestException('Only requested advances can be approved');
    if (approvedAmount !== undefined) {
      if (approvedAmount <= 0)
        throw new BadRequestException('Approved amount must be greater than zero');
      if (approvedAmount > Number(record.amount)) {
        throw new BadRequestException('Approved amount cannot exceed the requested amount');
      }
    }
    const updated = await this.prisma.salaryAdvance.update({
      where: { id },
      data: {
        status: 'APPROVED',
        ...(approvedAmount !== undefined ? { amount: approvedAmount } : {}),
        approvedAt: new Date(),
        approvedById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_ADVANCE_APPROVE',
      entityType: 'SalaryAdvance',
      entityId: id,
      companyId: record.companyId,
      newValue: { status: 'APPROVED' },
    });
    return updated;
  }

  async pay(id: string, user: AuthUser) {
    let alreadyPaid = false;
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const record = await this.lockSalaryAdvanceForPay(id, tx);
        if (!record) throw new NotFoundException('Salary advance not found');
        await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
        if (['PAID', 'DEDUCTING', 'SETTLED'].includes(record.status)) {
          alreadyPaid = true;
          return tx.salaryAdvance.findUniqueOrThrow({ where: { id } });
        }
        if (record.status !== 'APPROVED') {
          throw new BadRequestException('Only approved advances can be paid');
        }

        const paid = await tx.salaryAdvance.update({
          where: { id },
          data: { status: 'PAID', paidAt: new Date(), paidById: user.id },
        });

        await this.postings.postAdvancePayment(id, user.id, tx);
        return paid;
      },
      { timeout: 60_000 },
    );
    if (!alreadyPaid) {
      await this.audit.log({
        userId: user.id,
        action: 'SALARY_ADVANCE_PAY',
        entityType: 'SalaryAdvance',
        entityId: id,
        companyId: (updated as any).companyId,
        newValue: { status: 'PAID' },
      });
    }
    return updated;
  }

  private async lockSalaryAdvanceForPay(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<LockedSalaryAdvancePayRow | null> {
    const rows = await tx.$queryRaw<LockedSalaryAdvancePayRow[]>`
      SELECT id, "companyId", status
      FROM "salary_advances"
      WHERE id = ${id}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.salaryAdvance.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_ADVANCE_DELETE',
      entityType: 'SalaryAdvance',
      entityId: id,
      companyId: existing.companyId,
      newValue: {},
    });
    return { message: 'Salary advance deleted' };
  }
}
