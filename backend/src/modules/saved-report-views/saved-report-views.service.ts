import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateSavedReportViewDto } from './dto/create-saved-report-view.dto';
import { UpdateSavedReportViewDto } from './dto/update-saved-report-view.dto';

@Injectable()
export class SavedReportViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, reportDefinitionId, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
      OR: [{ userId: user.id }, { isShared: true }],
    };
    if (reportDefinitionId) where.reportDefinitionId = reportDefinitionId;
    const [data, total] = await Promise.all([
      this.prisma.savedReportView.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.savedReportView.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.savedReportView.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Saved Report View not found');
    await this.assertViewAccess(record, user, minimum);
    return record;
  }

  async create(dto: CreateSavedReportViewDto, user: AuthUser) {
    await this.assertReportDefinitionExists(dto.reportDefinitionId);
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);
    const record = await this.prisma.savedReportView.create({
      data: { ...dto, companyId: companyId ?? null, userId: user.id },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'SavedReportView',
      entityId: record.id,
      companyId: record.companyId ?? undefined,
      newValue: { ...dto, companyId: record.companyId } as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateSavedReportViewDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Saved report view company cannot be changed');
    }
    if (dto.reportDefinitionId) {
      await this.assertReportDefinitionExists(dto.reportDefinitionId);
    }

    const safeDto: any = { ...dto };
    delete safeDto.companyId;
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { ...safeDto } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: record.id,
      companyId: existing.companyId ?? undefined,
      newValue: dto as any,
    });
    return record;
  }

  async share(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { isShared: true } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: { isShared: true } as any,
    });
    return record;
  }

  async setDefault(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.savedReportView.updateMany({
      where: { userId: user.id, deletedAt: null, companyId: existing.companyId },
      data: { isDefault: false },
    });
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { isDefault: true } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: { isDefault: true } as any,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.savedReportView.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'SavedReportView',
      entityId: id,
      companyId: existing.companyId ?? undefined,
      newValue: {} as any,
    });
    return record;
  }

  private async resolveTargetCompanyId(user: AuthUser, requestedCompanyId?: string) {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId, AccessLevel.WRITE);
      return requestedCompanyId;
    }

    if (!this.companyScope.isGroupScoped(user) && user.companyId) {
      await this.companyScope.assertCanAccessCompany(user, user.companyId, AccessLevel.WRITE);
      return user.companyId;
    }

    await this.companyScope.assertCanAccessCompany(user, undefined, AccessLevel.WRITE);
    return undefined;
  }

  private async assertReportDefinitionExists(reportDefinitionId: string) {
    const reportDef = await this.prisma.reportDefinition.findFirst({
      where: { id: reportDefinitionId, deletedAt: null },
      select: { id: true },
    });
    if (!reportDef) throw new NotFoundException('Report Definition not found');
  }

  private async assertViewAccess(record: any, user: AuthUser, minimum: AccessLevel) {
    const isOwner = record.userId === user.id;
    const isShared = record.isShared === true;
    const isGroupScoped = this.companyScope.isGroupScoped(user);

    if (!isGroupScoped && !isOwner && !isShared) {
      throw new ForbiddenException('You do not have access to this saved report view');
    }

    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    if (minimum !== AccessLevel.READ && !isGroupScoped && !isOwner) {
      throw new ForbiddenException('You cannot modify this saved report view');
    }
  }
}
