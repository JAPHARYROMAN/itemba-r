import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@Injectable()
export class RoutesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRouteDto, userId: string) {
    const existing = await this.prisma.route.findFirst({ where: { companyId: dto.companyId, routeCode: dto.routeCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Route code already exists');
    const route = await this.prisma.route.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Route', entityId: route.id, newValue: dto as unknown as Record<string, unknown> });
    return route;
  }

  async findAll(companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.route.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.route.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const r = await this.prisma.route.findFirst({ where: { id, deletedAt: null } });
    if (!r) throw new NotFoundException('Route not found');
    return r;
  }

  async update(id: string, dto: UpdateRouteDto, userId: string) {
    await this.findOne(id);
    const route = await this.prisma.route.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Route', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return route;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.route.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Route', entityId: id, newValue: {} });
    return { message: 'Route deleted' };
  }
}
