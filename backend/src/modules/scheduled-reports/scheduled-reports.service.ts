import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';

@Injectable()
export class ScheduledReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId, reportDefinitionId, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };
    if (reportDefinitionId) where.reportDefinitionId = reportDefinitionId;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
    const [data, total] = await Promise.all([
      this.prisma.scheduledReport.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.scheduledReport.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.scheduledReport.findFirst({
      where: {
        id,
        deletedAt: null,
        ...((await this.companyScope.companyWhereFor(user)) as any),
      },
    });
    if (!record) throw new NotFoundException('Scheduled Report not found');
    return record;
  }

  async create(dto: CreateScheduledReportDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    const record = await this.prisma.scheduledReport.create({
      data: { ...dto, createdById: user.id },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ScheduledReport',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async update(id: string, dto: Partial<CreateScheduledReportDto>, user: AuthUser) {
    await this.findOne(id, user);
    if (dto.companyId !== undefined) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    }
    const record = await this.prisma.scheduledReport.update({ where: { id }, data: { ...dto } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async run(id: string, user: AuthUser) {
    await this.findOne(id, user);
    await this.prisma.scheduledReport.update({ where: { id }, data: { lastRunAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: { triggered: true } as any,
    });
    return { message: 'Schedule triggered', id };
  }

  async activate(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data: { isActive: true },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: { isActive: true } as any,
    });
    return record;
  }

  async deactivate(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: { isActive: false } as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.scheduledReport.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'ScheduledReport',
      entityId: id,
      newValue: {} as any,
    });
    return record;
  }
}
