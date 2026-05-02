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
        branchId: dto.branchId,
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

    const record = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
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
        updatedById: user.id,
      },
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
}
