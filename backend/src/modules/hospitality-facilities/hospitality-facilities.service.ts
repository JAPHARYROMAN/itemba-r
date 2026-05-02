import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateHospitalityFacilityDto } from './dto/create-hospitality-facility.dto';
import { UpdateHospitalityFacilityDto } from './dto/update-hospitality-facility.dto';
import { HospitalityFacilityStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class HospitalityFacilitiesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateHospitalityFacilityDto, userId: string) {
    const existing = await this.prisma.hospitalityFacility.findFirst({
      where: { companyId: dto.companyId, facilityCode: dto.facilityCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Facility code already exists for this company');
    const facility = await this.prisma.hospitalityFacility.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'HospitalityFacility', entityId: facility.id, newValue: dto as unknown as Record<string, unknown> });
    return facility;
  }

  async findAll(companyId?: string, divisionId?: string, status?: HospitalityFacilityStatus, search?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (status) where.status = status;
    if (search) where.OR = [
      { facilityName: { contains: search, mode: 'insensitive' } },
      { facilityCode: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.hospitalityFacility.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.hospitalityFacility.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const facility = await this.prisma.hospitalityFacility.findFirst({ where: { id, deletedAt: null } });
    if (!facility) throw new NotFoundException('Hospitality facility not found');
    return facility;
  }

  async update(id: string, dto: UpdateHospitalityFacilityDto, userId: string) {
    await this.findOne(id);
    const facility = await this.prisma.hospitalityFacility.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'HospitalityFacility', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return facility;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.hospitalityFacility.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'HospitalityFacility', entityId: id, newValue: {} });
    return { message: 'Hospitality facility deleted' };
  }
}
