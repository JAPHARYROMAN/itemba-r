import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreatePackageMovementDto } from './dto/create-package-movement.dto';
import { QueryPackageMovementDto } from './dto/query-package-movement.dto';

@Injectable()
export class PackageMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreatePackageMovementDto, userId: string) {
    const movementNumber = await this.codes.next({ entityType: 'PackageMovement', companyId: dto.companyId });
    const depositAmount = dto.depositAmount ?? 0;

    const record = await this.prisma.$transaction(async (tx) => {
      const movement = await tx.packageMovement.create({
        data: {
          movementNumber,
          companyId: dto.companyId,
          customerId: dto.customerId,
          supplierId: dto.supplierId,
          returnablePackageId: dto.returnablePackageId,
          movementType: dto.movementType,
          quantity: dto.quantity,
          depositAmount,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          movementDate: new Date(dto.movementDate),
          createdById: userId,
          notes: dto.notes,
        },
      });

      if (dto.customerId) {
        const balanceUpdate: any = {};
        const balanceCreate: any = {
          companyId: dto.companyId,
          customerId: dto.customerId,
          returnablePackageId: dto.returnablePackageId,
          quantityOwedByCustomer: 0,
          quantityOwedToCustomer: 0,
          depositBalance: 0,
        };

        switch (dto.movementType) {
          case 'ISSUED_TO_CUSTOMER':
            balanceUpdate.quantityOwedByCustomer = { increment: dto.quantity };
            balanceUpdate.depositBalance = { increment: depositAmount };
            balanceCreate.quantityOwedByCustomer = dto.quantity;
            balanceCreate.depositBalance = depositAmount;
            break;
          case 'RETURNED_BY_CUSTOMER':
            balanceUpdate.quantityOwedByCustomer = { decrement: dto.quantity };
            balanceUpdate.depositBalance = { decrement: depositAmount };
            balanceCreate.quantityOwedByCustomer = -dto.quantity;
            balanceCreate.depositBalance = -depositAmount;
            break;
          case 'ADJUSTMENT_IN':
            balanceUpdate.quantityOwedToCustomer = { increment: dto.quantity };
            balanceCreate.quantityOwedToCustomer = dto.quantity;
            break;
          case 'ADJUSTMENT_OUT':
            balanceUpdate.quantityOwedToCustomer = { decrement: dto.quantity };
            balanceCreate.quantityOwedToCustomer = -dto.quantity;
            break;
        }

        await tx.customerPackageBalance.upsert({
          where: {
            companyId_customerId_returnablePackageId: {
              companyId: dto.companyId,
              customerId: dto.customerId,
              returnablePackageId: dto.returnablePackageId,
            },
          },
          update: balanceUpdate,
          create: balanceCreate,
        });
      }

      return movement;
    });

    await this.auditLogs.log({
      action: 'PACKAGE_MOVEMENT_CREATE',
      entityType: 'PackageMovement',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QueryPackageMovementDto) {
    const { page = 1, limit = 20, companyId, customerId, returnablePackageId, movementType } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (returnablePackageId) where.returnablePackageId = returnablePackageId;
    if (movementType) where.movementType = movementType;

    const [data, total] = await Promise.all([
      this.prisma.packageMovement.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.packageMovement.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.packageMovement.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Package movement not found');
    return record;
  }

  async findByCustomer(customerId: string) {
    return this.prisma.packageMovement.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBalancesByCustomer(customerId: string) {
    return this.prisma.customerPackageBalance.findMany({
      where: { customerId },
      include: { returnablePackage: true },
    });
  }
}
