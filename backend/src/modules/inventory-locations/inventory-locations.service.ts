import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateInventoryLocationDto } from './dto/create-inventory-location.dto';
import { UpdateInventoryLocationDto } from './dto/update-inventory-location.dto';
import { QueryInventoryLocationDto } from './dto/query-inventory-location.dto';

@Injectable()
export class InventoryLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryInventoryLocationDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, divisionId, branchId, locationType, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryLocationWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        where.companyId = { in: accessibleCompanyIds };
      }
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (locationType) where.locationType = locationType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.inventoryLocation.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.inventoryLocation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.inventoryLocation.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Inventory location not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async create(dto: CreateInventoryLocationDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, {
      divisionId: dto.divisionId,
      branchId: dto.branchId,
      responsibleUserId: dto.responsibleUserId,
    });

    const record = await this.prisma.inventoryLocation.create({
      data: {
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        locationCode: dto.locationCode,
        name: dto.name,
        locationType: dto.locationType,
        address: dto.address,
        responsibleUserId: dto.responsibleUserId,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogs.log({
      action: 'INVENTORY_LOCATION_CREATE',
      entityType: 'InventoryLocation',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateInventoryLocationDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: dto.divisionId,
      branchId: dto.branchId,
      responsibleUserId: dto.responsibleUserId,
    });

    const record = await this.prisma.inventoryLocation.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.locationCode !== undefined && { locationCode: dto.locationCode }),
        ...(dto.locationType !== undefined && { locationType: dto.locationType }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.responsibleUserId !== undefined && { responsibleUserId: dto.responsibleUserId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
      },
    });

    await this.auditLogs.log({
      action: 'INVENTORY_LOCATION_UPDATE',
      entityType: 'InventoryLocation',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);

    await this.prisma.inventoryLocation.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'INVENTORY_LOCATION_DELETE',
      entityType: 'InventoryLocation',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private async assertReferencesBelongToCompany(
    companyId: string,
    references: { divisionId?: string; branchId?: string; responsibleUserId?: string },
  ) {
    if (references.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: references.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division must belong to the inventory location company');
      }
    }

    if (references.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: references.branchId, deletedAt: null },
        select: { division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch must belong to the inventory location company');
      }
    }

    if (references.responsibleUserId) {
      const responsibleUser = await this.prisma.user.findFirst({
        where: { id: references.responsibleUserId, deletedAt: null },
        select: { companyId: true },
      });
      if (!responsibleUser) {
        throw new BadRequestException('Responsible user not found');
      }
      if (responsibleUser.companyId && responsibleUser.companyId !== companyId) {
        throw new BadRequestException(
          'Responsible user must belong to the inventory location company',
        );
      }
    }
  }
}
