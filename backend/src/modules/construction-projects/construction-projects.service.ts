import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateConstructionProjectDto } from './dto/create-construction-project.dto';
import { UpdateConstructionProjectDto } from './dto/update-construction-project.dto';
import { ConstructionProjectStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ConstructionProjectsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateConstructionProjectDto, userId: string) {
    const existing = await this.prisma.constructionProject.findFirst({ where: { companyId: dto.companyId, projectCode: dto.projectCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Project code already exists for this company');
    const project = await this.prisma.constructionProject.create({
      data: { ...dto, startDate: dto.startDate ? new Date(dto.startDate) : undefined, expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined, createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ConstructionProject', entityId: project.id, newValue: dto as unknown as Record<string, unknown> });
    return project;
  }

  async findAll(companyId?: string, status?: ConstructionProjectStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.constructionProject.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { company: { select: { name: true } }, division: { select: { name: true } }, projectManager: { select: { fullName: true } } } }),
      this.prisma.constructionProject.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const p = await this.prisma.constructionProject.findFirst({ where: { id, deletedAt: null }, include: { company: true, division: true, customer: { select: { name: true } }, projectManager: { select: { fullName: true } }, sites: { where: { deletedAt: null } }, boqItems: { where: { deletedAt: null } } } });
    if (!p) throw new NotFoundException('Construction project not found');
    return p;
  }

  async updateStatus(id: string, status: ConstructionProjectStatus, userId: string) {
    await this.findOne(id);
    const updated = await this.prisma.constructionProject.update({ where: { id }, data: { status, actualEndDate: status === ConstructionProjectStatus.COMPLETED ? new Date() : undefined } });
    await this.audit.log({ userId, action: 'STATUS_CHANGE', entityType: 'ConstructionProject', entityId: id, newValue: { status } });
    return updated;
  }

  async update(id: string, dto: UpdateConstructionProjectDto, userId: string) {
    await this.findOne(id);
    const project = await this.prisma.constructionProject.update({ where: { id }, data: { ...dto, startDate: dto.startDate ? new Date(dto.startDate) : undefined, expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ConstructionProject', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return project;
  }

  async getProfitability(id: string) {
    const project = await this.findOne(id);
    return { projectCode: project.projectCode, projectName: project.projectName, contractValue: Number(project.contractValue || 0), budgetAmount: Number(project.budgetAmount || 0), actualCost: Number(project.actualCost), billedAmount: Number(project.billedAmount), receivedAmount: Number(project.receivedAmount), grossProfit: Number(project.billedAmount) - Number(project.actualCost), netProfit: Number(project.receivedAmount) - Number(project.actualCost), budgetVariance: Number(project.budgetAmount || 0) - Number(project.actualCost) };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.constructionProject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'ConstructionProject', entityId: id, newValue: {} });
    return { message: 'Project deleted' };
  }
}
