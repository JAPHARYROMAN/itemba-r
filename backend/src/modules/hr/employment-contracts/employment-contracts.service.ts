import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class EmploymentContractsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.employmentContract.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employmentContract.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.employmentContract.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Employment contract not found');
    return record;
  }

  async create(dto: CreateEmploymentContractDto, user: any) {
    const record = await this.prisma.employmentContract.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        probationEndDate: dto.probationEndDate ? new Date(dto.probationEndDate) : undefined,
      } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'EmploymentContract', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateEmploymentContractDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.employmentContract.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'EmploymentContract', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async approve(id: string, user: any) {
    const record = await this.findOne(id, user);
    if (record.status === 'ACTIVE') throw new BadRequestException('Contract already active');
    const updated = await this.prisma.employmentContract.update({
      where: { id },
      data: { status: 'ACTIVE', approvedById: user.id, approvedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'CONTRACT_STATUS_CHANGE', entityType: 'EmploymentContract', entityId: id, newValue: { status: 'ACTIVE' } });
    return updated;
  }

  async terminate(id: string, reason: string | undefined, user: any) {
    const record = await this.findOne(id, user);
    if (record.status === 'TERMINATED') throw new BadRequestException('Contract already terminated');
    const updated = await this.prisma.employmentContract.update({
      where: { id },
      data: { status: 'TERMINATED', notes: reason } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CONTRACT_TERMINATED', entityType: 'EmploymentContract', entityId: id, newValue: { status: 'TERMINATED', reason } });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.employmentContract.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'EmploymentContract', entityId: id, newValue: {} });
    return { message: 'Employment contract deleted' };
  }
}
