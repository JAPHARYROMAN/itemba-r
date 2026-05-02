import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpdateNozzleReadingDto } from './dto/update-nozzle-reading.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class FuelNozzleReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(
    query: {
      page?: number;
      limit?: number;
      shiftId?: string;
      nozzleId?: string;
      branchId?: string;
      companyId?: string;
      status?: string;
    },
    user?: any,
  ) {
    const { page = 1, limit = 20, shiftId, nozzleId, branchId, companyId, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (shiftId) where.fuelShiftId = shiftId;
    if (nozzleId) where.nozzleId = nozzleId;
    if (branchId) where.branchId = branchId;
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.fuelNozzleReading.findMany({
        where,
        include: {
          nozzle: { select: { id: true, nozzleName: true } },
          product: { select: { id: true, name: true } },
          attendant: { select: { id: true, fullName: true } },
          fuelShift: { select: { id: true, shiftNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fuelNozzleReading.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.fuelNozzleReading.findUnique({
      where: { id },
      include: {
        nozzle: { select: { id: true, nozzleName: true } },
        product: { select: { id: true, name: true } },
        attendant: { select: { id: true, fullName: true } },
        fuelShift: { select: { id: true, shiftNumber: true, status: true } },
      },
    });
    if (!record) throw new NotFoundException('Fuel nozzle reading not found');
    return record;
  }

  async update(id: string, dto: UpdateNozzleReadingDto, userId: string) {
    const existing = await this.findOne(id);

    let litresSold = Number(existing.litresSold);
    let expectedAmount = Number(existing.expectedAmount);

    if (dto.closingMeter !== undefined) {
      if (dto.closingMeter < Number(existing.openingMeter)) {
        throw new BadRequestException(
          'Closing meter must be greater than or equal to opening meter',
        );
      }
      litresSold = dto.closingMeter - Number(existing.openingMeter);
      expectedAmount = litresSold * Number(existing.pricePerLitre);
    }

    const record = await this.prisma.fuelNozzleReading.update({
      where: { id },
      data: {
        ...(dto.closingMeter !== undefined && {
          closingMeter: dto.closingMeter,
          litresSold,
          expectedAmount,
        }),
        ...(dto.attendantId !== undefined && { attendantId: dto.attendantId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    await this.auditLogs.log({
      action: 'NOZZLE_READING_UPDATE',
      entityType: 'FuelNozzleReading',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }
}
