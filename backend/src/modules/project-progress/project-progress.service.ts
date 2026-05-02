import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProjectProgressDto } from './dto/create-project-progress.dto';
import { UpdateProjectProgressDto } from './dto/update-project-progress.dto';
import { ProjectProgressStatus } from '@prisma/client';

@Injectable()
export class ProjectProgressService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  private async nextNumber(companyId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.projectProgressRecord.count({ where: { companyId } });
    return `PROG-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateProjectProgressDto, userId: string) {
    if (dto.percentComplete < 0 || dto.percentComplete > 100) throw new BadRequestException('Percent complete must be between 0 and 100');
    const progressNumber = await this.nextNumber(dto.companyId);
    const record = await this.prisma.projectProgressRecord.create({
      data: { ...dto, progressNumber, progressDate: new Date(dto.progressDate), reportedById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ProjectProgressRecord', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.projectProgressRecord.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { progressDate: 'desc' }, include: { project: { select: { projectName: true } }, reportedBy: { select: { fullName: true } } } }),
      this.prisma.projectProgressRecord.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const r = await this.prisma.projectProgressRecord.findFirst({ where: { id, deletedAt: null } });
    if (!r) throw new NotFoundException('Progress record not found');
    return r;
  }

  async submit(id: string, userId: string) {
    const r = await this.findOne(id);
    if (r.status !== ProjectProgressStatus.DRAFT) throw new BadRequestException('Only DRAFT records can be submitted');
    const updated = await this.prisma.projectProgressRecord.update({ where: { id }, data: { status: ProjectProgressStatus.SUBMITTED } });
    await this.audit.log({ userId, action: 'SUBMIT', entityType: 'ProjectProgressRecord', entityId: id, newValue: {} });
    return updated;
  }

  async approve(id: string, userId: string) {
    const r = await this.findOne(id);
    if (r.status !== ProjectProgressStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED records can be approved');
    const updated = await this.prisma.projectProgressRecord.update({ where: { id }, data: { status: ProjectProgressStatus.APPROVED, approvedById: userId, approvedAt: new Date() } });
    await this.audit.log({ userId, action: 'APPROVE', entityType: 'ProjectProgressRecord', entityId: id, newValue: {} });
    return updated;
  }

  async reject(id: string, userId: string) {
    const r = await this.findOne(id);
    if (r.status !== ProjectProgressStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED records can be rejected');
    const updated = await this.prisma.projectProgressRecord.update({ where: { id }, data: { status: ProjectProgressStatus.REJECTED } });
    await this.audit.log({ userId, action: 'REJECT', entityType: 'ProjectProgressRecord', entityId: id, newValue: {} });
    return updated;
  }

  async update(id: string, dto: UpdateProjectProgressDto, userId: string) {
    const r = await this.findOne(id);
    if (r.status !== ProjectProgressStatus.DRAFT) throw new BadRequestException('Only DRAFT records can be updated');
    if (dto.percentComplete !== undefined && (dto.percentComplete < 0 || dto.percentComplete > 100)) throw new BadRequestException('Percent complete must be 0-100');
    const updated = await this.prisma.projectProgressRecord.update({ where: { id }, data: { ...dto, progressDate: dto.progressDate ? new Date(dto.progressDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ProjectProgressRecord', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return updated;
  }
}
