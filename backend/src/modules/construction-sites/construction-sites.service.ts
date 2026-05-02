import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateConstructionSiteDto } from './dto/create-construction-site.dto';
import { UpdateConstructionSiteDto } from './dto/update-construction-site.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ConstructionSitesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateConstructionSiteDto, userId: string) {
    const existing = await this.prisma.constructionSite.findFirst({ where: { projectId: dto.projectId, siteCode: dto.siteCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Site code already exists in this project');
    const site = await this.prisma.constructionSite.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ConstructionSite', entityId: site.id, newValue: dto as unknown as Record<string, unknown> });
    return site;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.constructionSite.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { project: { select: { projectName: true, projectCode: true } }, siteManager: { select: { fullName: true } } } }),
      this.prisma.constructionSite.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const s = await this.prisma.constructionSite.findFirst({ where: { id, deletedAt: null }, include: { project: { select: { projectName: true, projectCode: true } }, siteManager: { select: { fullName: true } } } });
    if (!s) throw new NotFoundException('Construction site not found');
    return s;
  }

  async update(id: string, dto: UpdateConstructionSiteDto, userId: string) {
    await this.findOne(id);
    const site = await this.prisma.constructionSite.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ConstructionSite', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return site;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.constructionSite.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'ConstructionSite', entityId: id, newValue: {} });
    return { message: 'Site deleted' };
  }
}
