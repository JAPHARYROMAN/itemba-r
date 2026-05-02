import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateReturnablePackageDto } from './dto/create-returnable-package.dto';
import { UpdateReturnablePackageDto } from './dto/update-returnable-package.dto';
import { QueryReturnablePackageDto } from './dto/query-returnable-package.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ReturnablePackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async generatePackageCode(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.returnablePackage.count({
      where: { companyId, packageCode: { startsWith: `PKG-${year}` } },
    });
    return `PKG-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateReturnablePackageDto, userId: string) {
    const packageCode = await this.generatePackageCode(dto.companyId);
    const record = await this.prisma.returnablePackage.create({
      data: {
        packageCode,
        companyId: dto.companyId,
        productId: dto.productId,
        packageType: dto.packageType,
        name: dto.name,
        depositValue: dto.depositValue,
        unitId: dto.unitId,
        status: 'ACTIVE',
      },
    });
    await this.auditLogs.log({
      action: 'RETURNABLE_PACKAGE_CREATE',
      entityType: 'ReturnablePackage',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async getBalances(query: QueryReturnablePackageDto, user?: any) {
    const { page = 1, limit = 100, companyId } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);

    const [data, total] = await Promise.all([
      this.prisma.customerPackageBalance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          customer: { select: { name: true } },
          returnablePackage: { select: { name: true, packageType: true } },
        },
      }),
      this.prisma.customerPackageBalance.count({ where }),
    ]);

    const rows = data.map((b: any) => ({
      id: b.id,
      customerId: b.customerId,
      customerName: b.customer?.name ?? null,
      returnablePackageId: b.returnablePackageId,
      packageName: b.returnablePackage?.name ?? null,
      packageType: b.returnablePackage?.packageType ?? null,
      quantityOwedByCustomer: Number(b.quantityOwedByCustomer),
      quantityOwedToCustomer: Number(b.quantityOwedToCustomer),
      depositBalance: Number(b.depositBalance),
    }));

    return { data: rows, total, page, limit };
  }

  async findAll(query: QueryReturnablePackageDto, user?: any) {
    const { page = 1, limit = 20, companyId, packageType, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (packageType) where.packageType = packageType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.returnablePackage.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.returnablePackage.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.returnablePackage.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Returnable package not found');
    return record;
  }

  async update(id: string, dto: UpdateReturnablePackageDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.returnablePackage.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.packageType && { packageType: dto.packageType }),
        ...(dto.name && { name: dto.name }),
        ...(dto.depositValue !== undefined && { depositValue: dto.depositValue }),
        ...(dto.unitId !== undefined && { unitId: dto.unitId }),
        ...(dto.status && { status: dto.status }),
      },
    });
    await this.auditLogs.log({
      action: 'RETURNABLE_PACKAGE_UPDATE',
      entityType: 'ReturnablePackage',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.returnablePackage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'RETURNABLE_PACKAGE_DELETE',
      entityType: 'ReturnablePackage',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
