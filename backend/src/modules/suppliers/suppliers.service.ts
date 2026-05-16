import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { AccessLevel } from '@prisma/client';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySupplierDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      productCategoryId,
      supplierType,
      status,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (productCategoryId) {
      where.productCategories = { some: { productCategoryId } };
    }
    if (supplierType) where.supplierType = supplierType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { supplierCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { tin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          productCategories: {
            include: { productCategory: { select: { id: true, name: true, categoryType: true } } },
            orderBy: { productCategory: { name: 'asc' } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: true,
        branch: true,
        productCategories: {
          include: { productCategory: { select: { id: true, name: true, categoryType: true } } },
          orderBy: { productCategory: { name: 'asc' } },
        },
      },
    });
    if (!record) throw new NotFoundException('Supplier not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    {
      const meta = auditFor('Supplier', 'VIEW');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        severity: meta.severity,
      });
    }

    return record;
  }

  async create(dto: CreateSupplierDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.branchId) {
      throw new BadRequestException('Suppliers are scoped to a division, not a branch');
    }
    const productCategoryIds = Array.from(new Set(dto.productCategoryIds));
    await this.assertDivisionAndCategories(dto.companyId, dto.divisionId, productCategoryIds);

    const supplierCode =
      dto.supplierCode ?? `SUPP-${Date.now().toString(36).toUpperCase()}`;

    if (dto.supplierCode) {
      const existing = await this.prisma.supplier.findFirst({
        where: { supplierCode: dto.supplierCode, companyId: dto.companyId, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException(
          `Supplier code "${dto.supplierCode}" already exists for this company`,
        );
      }
    }

    const record = await this.prisma.supplier.create({
      data: {
        supplierCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: null,
        supplierType: dto.supplierType,
        name: dto.name,
        legalName: dto.legalName,
        tin: dto.tin,
        vrn: dto.vrn,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        contactPerson: dto.contactPerson,
        creditLimit: dto.creditLimit ?? 0,
        paymentTerms: dto.paymentTerms,
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
        createdById: user.id,
        updatedById: user.id,
        productCategories: {
          create: productCategoryIds.map((productCategoryId) => ({ productCategoryId })),
        },
      },
      include: {
        productCategories: { include: { productCategory: true } },
      },
    });

    {
      const meta = auditFor('Supplier', 'CREATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  async update(id: string, dto: UpdateSupplierDto, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Supplier companyId is immutable after creation');
    }
    if (dto.branchId) {
      throw new BadRequestException('Suppliers are scoped to a division, not a branch');
    }
    const divisionId = dto.divisionId ?? existing.divisionId;
    const productCategoryIds =
      dto.productCategoryIds !== undefined ? Array.from(new Set(dto.productCategoryIds)) : undefined;
    if (!divisionId) {
      throw new BadRequestException('Supplier division is required');
    }
    if (dto.divisionId !== undefined || dto.productCategoryIds !== undefined) {
      await this.assertDivisionAndCategories(
        existing.companyId,
        divisionId,
        productCategoryIds,
        dto.productCategoryIds !== undefined,
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (dto.productCategoryIds !== undefined) {
        await tx.supplierProductCategory.deleteMany({ where: { supplierId: id } });
      }
      return tx.supplier.update({
        where: { id },
        data: {
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: null }),
          ...(dto.supplierType !== undefined && { supplierType: dto.supplierType }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.legalName !== undefined && { legalName: dto.legalName }),
          ...(dto.tin !== undefined && { tin: dto.tin }),
          ...(dto.vrn !== undefined && { vrn: dto.vrn }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson }),
          ...(dto.creditLimit !== undefined && { creditLimit: dto.creditLimit }),
          ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.productCategoryIds !== undefined && {
            productCategories: {
              create: productCategoryIds!.map((productCategoryId) => ({ productCategoryId })),
            },
          }),
          updatedById: user.id,
        },
        include: { productCategories: { include: { productCategory: true } } },
      });
    });

    {
      const meta = auditFor('Supplier', 'UPDATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date() } });

    {
      const meta = auditFor('Supplier', 'DELETE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: existing as any,
        severity: meta.severity,
      });
    }

    return { success: true };
  }

  /** Internal scoped lookup for update/remove paths. */
  private async findOneScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Supplier not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  private async assertDivisionAndCategories(
    companyId: string,
    divisionId: string,
    productCategoryIds: string[] | undefined,
    requireCategories = true,
  ) {
    const division = await this.prisma.division.findFirst({
      where: { id: divisionId, deletedAt: null },
      select: { companyId: true },
    });
    if (!division || division.companyId !== companyId) {
      throw new BadRequestException('Supplier division must belong to this company');
    }

    const uniqueCategoryIds = Array.from(new Set(productCategoryIds ?? []));
    if (requireCategories && uniqueCategoryIds.length === 0) {
      throw new BadRequestException('Supplier must be linked to at least one product category');
    }
    if (!uniqueCategoryIds.length) return;

    const categories = await this.prisma.productCategory.findMany({
      where: { id: { in: uniqueCategoryIds }, companyId, deletedAt: null },
      select: { id: true },
    });
    if (categories.length !== uniqueCategoryIds.length) {
      throw new BadRequestException('Supplier product categories must belong to this company');
    }
  }
}
