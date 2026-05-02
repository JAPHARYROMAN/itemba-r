import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CreateSalaryPaymentDto } from './dto/create-salary-payment.dto';
import { UpdateSalaryPaymentDto } from './dto/update-salary-payment.dto';

@Injectable()
export class SalaryPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
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
      this.prisma.salaryPayment.findMany({
        where, skip, take: Number(limit), orderBy: { paymentDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.salaryPayment.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.salaryPayment.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Salary payment not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateSalaryPaymentDto, user: AuthUser) {
    if ((dto as any).companyId) {
      await this.companyScope.assertCanAccessCompany(
        user,
        (dto as any).companyId,
        AccessLevel.WRITE,
      );
    }
    const record = await this.prisma.salaryPayment.create({
      data: { ...dto, paymentDate: new Date(dto.paymentDate) } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_PAYMENT_CREATE',
      entityType: 'SalaryPayment',
      entityId: record.id,
      companyId: (record as any).companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateSalaryPaymentDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.salaryPayment.update({
      where: { id },
      data: { ...dto, paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_PAYMENT_UPDATE',
      entityType: 'SalaryPayment',
      entityId: id,
      companyId: existing.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async reverse(id: string, reason: string | undefined, user: AuthUser) {
    const record = await this.findOne(id, user, AccessLevel.WRITE);
    if (record.status === 'REVERSED') throw new BadRequestException('Payment already reversed');
    const updated = await this.prisma.salaryPayment.update({
      where: { id },
      data: { status: 'REVERSED', notes: reason ? `Reversed: ${reason}` : 'Reversed' },
    });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_PAYMENT_REVERSE',
      entityType: 'SalaryPayment',
      entityId: id,
      companyId: record.companyId,
      newValue: { status: 'REVERSED', reason },
    });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.salaryPayment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'SALARY_PAYMENT_DELETE',
      entityType: 'SalaryPayment',
      entityId: id,
      companyId: existing.companyId,
      newValue: {},
    });
    return { message: 'Salary payment deleted' };
  }
}
