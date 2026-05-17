import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { OpenFuelShiftDto } from './dto/open-fuel-shift.dto';
import { UpdateFuelShiftDto } from './dto/update-fuel-shift.dto';
import { CloseFuelShiftDto } from './dto/close-fuel-shift.dto';
import { AddShiftAttendantDto, UpdateShiftAttendantDto } from './dto/manage-attendants.dto';
import { AccessLevel, FuelShiftType, Prisma } from '@prisma/client';
import { CompanyScopeService, PetroleumShiftControlService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

interface LockedFuelShiftRow {
  id: string;
  shiftNumber: string;
  companyId: string;
  branchId: string;
  shiftDate: Date;
  startTime: Date;
  endTime: Date | null;
  status: string;
}

@Injectable()
export class FuelShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly petroleumShiftControl: PetroleumShiftControlService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(
    query: {
      page?: number;
      limit?: number;
      companyId?: string;
      divisionId?: string;
      branchId?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    user: AuthUser,
  ) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.shiftDate = {};
      if (dateFrom) where.shiftDate.gte = new Date(dateFrom);
      if (dateTo) where.shiftDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.fuelShift.findMany({
        where,
        include: {
          openedBy: { select: { id: true, fullName: true } },
          submittedBy: { select: { id: true, fullName: true } },
          supervisorApproved: { select: { id: true, fullName: true } },
          managerApproved: { select: { id: true, fullName: true } },
          attendants: {
            include: {
              attendant: { select: { id: true, fullName: true, email: true } },
              employee: {
                select: {
                  id: true,
                  fullName: true,
                  employeeCode: true,
                  email: true,
                  branchId: true,
                },
              },
              assignedPump: { select: { id: true, pumpCode: true, pumpName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fuelShift.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.fuelShift.findFirst({
      where: { id, deletedAt: null },
      include: {
        openedBy: { select: { id: true, fullName: true } },
        submittedBy: { select: { id: true, fullName: true } },
        supervisorApproved: { select: { id: true, fullName: true } },
        managerApproved: { select: { id: true, fullName: true } },
        rejectedBy: { select: { id: true, fullName: true } },
        attendants: {
          include: {
            attendant: { select: { id: true, fullName: true, email: true } },
            assignedPump: { select: { id: true, pumpCode: true, pumpName: true } },
          },
        },
        nozzleReadings: {
          include: {
            nozzle: { select: { id: true, nozzleName: true } },
            pump: { select: { id: true, pumpCode: true, pumpName: true } },
            product: { select: { id: true, name: true } },
            attendant: { select: { id: true, fullName: true } },
          },
        },
        collections: true,
      },
    });
    if (!record) throw new NotFoundException('Fuel shift not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async openShift(dto: OpenFuelShiftDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const userId = user.id;
    const shiftNumber = await this.codes.next({
      entityType: 'FuelShift',
      companyId: dto.companyId,
    });

    // Find active nozzles for branch
    const nozzles = await this.prisma.fuelNozzle.findMany({
      where: {
        companyId: dto.companyId,
        branchId: dto.branchId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    // Build nozzle reading creates
    const nozzleReadingCreates = await Promise.all(
      nozzles.map(async (nozzle) => {
        // Try branch-specific price first, then company-wide
        let price = await this.prisma.fuelPrice.findFirst({
          where: {
            companyId: dto.companyId,
            branchId: dto.branchId,
            productId: nozzle.productId,
            status: 'ACTIVE',
          },
        });
        if (!price) {
          price = await this.prisma.fuelPrice.findFirst({
            where: {
              companyId: dto.companyId,
              branchId: null,
              productId: nozzle.productId,
              status: 'ACTIVE',
            },
          });
        }

        return {
          companyId: dto.companyId,
          branchId: dto.branchId,
          nozzleId: nozzle.id,
          pumpId: nozzle.pumpId,
          tankId: nozzle.tankId,
          productId: nozzle.productId,
          openingMeter: nozzle.currentMeterReading,
          pricePerLitre: price ? Number(price.pricePerLitre) : 0,
          status: 'OPEN' as const,
        };
      }),
    );

    const shift = await this.prisma.fuelShift.create({
      data: {
        shiftNumber,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        shiftType: dto.shiftType ?? FuelShiftType.DAY,
        shiftDate: new Date(dto.shiftDate),
        startTime: new Date(dto.startTime),
        status: 'OPEN',
        openedById: userId,
        notes: dto.notes,
        attendants: (() => {
          // Prefer the rich `attendants` payload (with optional pump assignment).
          // Fall back to the legacy `attendantIds` for backward compatibility.
          const rich = dto.attendants?.length
            ? dto.attendants.map((a) => ({
                attendantId: a.attendantId ?? null,
                employeeId: a.employeeId ?? null,
                attendantName: a.attendantName ?? null,
                assignedPumpId: a.assignedPumpId ?? null,
                notes: a.notes ?? null,
              }))
            : null;
          const legacy = dto.attendantIds?.length
            ? dto.attendantIds.map((attendantId) => ({ attendantId }))
            : null;
          const create = rich ?? legacy;
          return create ? { create } : undefined;
        })(),
        nozzleReadings: {
          create: nozzleReadingCreates,
        },
      },
      include: {
        attendants: true,
        nozzleReadings: true,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_OPEN',
      entityType: 'FuelShift',
      entityId: shift.id,
      userId,
      companyId: shift.companyId,
      newValue: { shiftNumber, status: 'OPEN' } as any,
    });

    return shift;
  }

  async update(id: string, dto: UpdateFuelShiftDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (!['OPEN', 'SUBMITTED'].includes(existing.status)) {
      throw new BadRequestException('Shift can only be edited in OPEN or SUBMITTED status');
    }

    const record = await this.prisma.fuelShift.update({
      where: { id },
      data: {
        ...(dto.shiftType !== undefined && { shiftType: dto.shiftType }),
        ...(dto.shiftDate !== undefined && { shiftDate: new Date(dto.shiftDate) }),
        ...(dto.startTime !== undefined && { startTime: new Date(dto.startTime) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_UPDATE',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submitShift(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Only OPEN shifts can be submitted');
    }

    const record = await this.prisma.fuelShift.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedById: userId, submittedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_SUBMIT',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'OPEN' } as any,
      newValue: { status: 'SUBMITTED' } as any,
    });

    return record;
  }

  async supervisorApprove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (existing.status !== 'SUBMITTED') {
      throw new BadRequestException('Only SUBMITTED shifts can be supervisor-approved');
    }

    const record = await this.prisma.fuelShift.update({
      where: { id },
      data: {
        status: 'SUPERVISOR_APPROVED',
        supervisorApprovedById: userId,
        supervisorApprovedAt: new Date(),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_SUPERVISOR_APPROVE',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'SUBMITTED' } as any,
      newValue: { status: 'SUPERVISOR_APPROVED' } as any,
    });

    return record;
  }

  async managerApprove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (existing.status !== 'SUPERVISOR_APPROVED') {
      throw new BadRequestException('Only SUPERVISOR_APPROVED shifts can be manager-approved');
    }

    const record = await this.prisma.fuelShift.update({
      where: { id },
      data: {
        status: 'MANAGER_APPROVED',
        managerApprovedById: userId,
        managerApprovedAt: new Date(),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_MANAGER_APPROVE',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'SUPERVISOR_APPROVED' } as any,
      newValue: { status: 'MANAGER_APPROVED' } as any,
    });

    return record;
  }

  async rejectShift(id: string, reason: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (!['SUBMITTED', 'SUPERVISOR_APPROVED'].includes(existing.status)) {
      throw new BadRequestException('Only SUBMITTED or SUPERVISOR_APPROVED shifts can be rejected');
    }

    const record = await this.prisma.fuelShift.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_REJECT',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'REJECTED', rejectionReason: reason } as any,
    });

    return record;
  }

  async closeShift(id: string, dto: CloseFuelShiftDto, user: AuthUser) {
    const userId = user.id;
    const shiftForAccess = await this.prisma.fuelShift.findFirst({
      where: { id, deletedAt: null },
      select: { companyId: true },
    });
    if (!shiftForAccess) throw new NotFoundException('Fuel shift not found');
    await this.companyScope.assertCanAccessCompany(
      user,
      shiftForAccess.companyId,
      AccessLevel.WRITE,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedFuelShiftRow[]>(Prisma.sql`
        SELECT id, "shiftNumber", "companyId", "branchId", "shiftDate", "startTime", "endTime", status
        FROM "fuel_shifts"
        WHERE id = ${id}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      const lockedShift = lockedRows[0];
      if (!lockedShift) throw new NotFoundException('Fuel shift not found');

      if (lockedShift.status === 'CLOSED') {
        return this.buildClosedShiftSummary(id, tx, true);
      }
      if (lockedShift.status !== 'MANAGER_APPROVED') {
        throw new BadRequestException('Only MANAGER_APPROVED shifts can be closed');
      }

      const readings = await tx.fuelNozzleReading.findMany({
        where: { fuelShiftId: id },
      });
      const validatedReadings = this.petroleumShiftControl.validateShiftClosing(
        readings,
        dto.nozzleReadings,
      );

      const tankIds = Array.from(new Set(validatedReadings.map(({ reading }) => reading.tankId)));
      const productIds = Array.from(
        new Set(validatedReadings.map(({ reading }) => reading.productId)),
      );

      const [tanks, products] = await Promise.all([
        tx.fuelTank.findMany({
          where: { id: { in: tankIds }, deletedAt: null },
          select: {
            id: true,
            tankName: true,
            companyId: true,
            branchId: true,
            productId: true,
          },
        }),
        tx.product.findMany({
          where: { id: { in: productIds }, deletedAt: null },
          select: { id: true, name: true, companyId: true, baseUnitId: true },
        }),
      ]);
      const tankById = new Map(tanks.map((tank) => [tank.id, tank]));
      const productById = new Map(products.map((product) => [product.id, product]));

      for (const { reading, litresSold } of validatedReadings) {
        if (
          reading.companyId !== lockedShift.companyId ||
          reading.branchId !== lockedShift.branchId
        ) {
          throw new BadRequestException(
            `Nozzle reading ${reading.id} does not belong to this shift company/branch`,
          );
        }

        if (litresSold <= 0) continue;

        const tank = tankById.get(reading.tankId);
        if (!tank)
          throw new BadRequestException(
            `Fuel tank ${reading.tankId} for reading ${reading.id} was not found`,
          );
        if (tank.companyId !== reading.companyId || tank.branchId !== reading.branchId) {
          throw new BadRequestException(
            `Fuel tank "${tank.tankName}" does not belong to this shift company/branch`,
          );
        }
        if (tank.productId !== reading.productId) {
          throw new BadRequestException(
            `Fuel tank "${tank.tankName}" product does not match nozzle reading ${reading.id}`,
          );
        }

        const product = productById.get(reading.productId);
        if (!product)
          throw new BadRequestException(
            `Product ${reading.productId} for reading ${reading.id} was not found`,
          );
        if (product.companyId !== reading.companyId) {
          throw new BadRequestException(
            `Product "${product.name}" does not belong to this shift company`,
          );
        }
        if (!product.baseUnitId) {
          throw new BadRequestException(
            `Product "${product.name}" has no base unit for inventory movement`,
          );
        }
      }

      let totalLitresSold = 0;
      let totalExpectedSales = 0;
      const movementDate = new Date();

      for (const { reading, closingMeter, litresSold, expectedAmount } of validatedReadings) {
        await tx.fuelNozzleReading.update({
          where: { id: reading.id },
          data: { closingMeter, litresSold, expectedAmount, status: 'CLOSED' },
        });

        await tx.fuelNozzle.update({
          where: { id: reading.nozzleId },
          data: { currentMeterReading: closingMeter },
        });

        if (litresSold > 0) {
          const tank = tankById.get(reading.tankId)!;
          const product = productById.get(reading.productId)!;

          await this.inventoryMovements.createMovement({
            companyId: reading.companyId,
            branchId: reading.branchId,
            productId: reading.productId,
            movementType: 'SALE_ISSUE',
            quantity: litresSold,
            unitId: product.baseUnitId,
            unitCost: Number(reading.pricePerLitre),
            referenceType: 'FUEL_SHIFT',
            referenceId: id,
            createdById: userId,
            movementDate,
            tx,
          });
        }

        totalLitresSold += litresSold;
        totalExpectedSales += expectedAmount;
      }

      const collectionsAgg = await tx.fuelShiftCollection.aggregate({
        where: { fuelShiftId: id },
        _sum: { amount: true },
      });
      const totalCollections = Number(collectionsAgg._sum.amount ?? 0);

      const closedShift = await tx.fuelShift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          endTime: movementDate,
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: {
          attendants: { where: { employeeId: { not: null } } },
        },
      });

      // HR integration is part of close atomicity: if attendance creation fails,
      // the readings, inventory movements, and shift status roll back together.
      if (closedShift.startTime && closedShift.endTime) {
        const start = new Date(closedShift.startTime);
        const end = new Date(closedShift.endTime);
        const totalHours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);

        for (const att of closedShift.attendants) {
          if (!att.employeeId) continue;
          const dateKey = new Date(closedShift.shiftDate);
          dateKey.setUTCHours(0, 0, 0, 0);
          const dateNext = new Date(dateKey);
          dateNext.setUTCDate(dateKey.getUTCDate() + 1);
          const existingAttendance = await tx.attendanceRecord.findFirst({
            where: {
              employeeId: att.employeeId,
              attendanceDate: { gte: dateKey, lt: dateNext },
              source: 'SYSTEM',
              deletedAt: null,
            },
          });
          if (existingAttendance) continue;

          const attendanceNumber = await this.codes.next({
            entityType: 'AttendanceRecord',
            companyId: closedShift.companyId,
            tx,
          });

          await tx.attendanceRecord.create({
            data: {
              attendanceNumber,
              companyId: closedShift.companyId,
              employeeId: att.employeeId,
              attendanceDate: closedShift.shiftDate,
              clockInTime: start,
              clockOutTime: end,
              totalHours,
              attendanceStatus: 'PRESENT',
              source: 'SYSTEM',
              createdById: userId,
              notes: `Auto-created from fuel shift ${closedShift.shiftNumber}`,
            },
          });
        }
      }

      return {
        id,
        companyId: closedShift.companyId,
        totalLitresSold,
        totalExpectedSales,
        totalCollections,
        shortageOrExcess: totalCollections - totalExpectedSales,
        alreadyClosed: false,
      };
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_CLOSE',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: result.companyId,
      oldValue: { status: result.alreadyClosed ? 'CLOSED' : 'MANAGER_APPROVED' } as any,
      newValue: { status: 'CLOSED', alreadyClosed: result.alreadyClosed } as any,
    });

    const { companyId, ...response } = result;
    return response;
  }

  // ─── Attendant management ─────────────────────────────────────────────────

  async addAttendant(shiftId: string, dto: AddShiftAttendantDto, user: AuthUser) {
    const shift = await this.findOne(shiftId, user, AccessLevel.WRITE);
    const userId = user.id;
    if (shift.status !== 'OPEN') {
      throw new BadRequestException('Attendants can only be added while the shift is OPEN');
    }
    // Prevent duplicate assignments — check whichever identity field is set.
    if (dto.attendantId) {
      const existing = await this.prisma.fuelShiftAttendant.findFirst({
        where: { fuelShiftId: shiftId, attendantId: dto.attendantId },
      });
      if (existing) {
        throw new BadRequestException('That user is already assigned to this shift');
      }
    }
    if (dto.employeeId) {
      const existing = await this.prisma.fuelShiftAttendant.findFirst({
        where: { fuelShiftId: shiftId, employeeId: dto.employeeId },
      });
      if (existing) {
        throw new BadRequestException('That employee is already assigned to this shift');
      }
    }
    const row = await this.prisma.fuelShiftAttendant.create({
      data: {
        fuelShiftId: shiftId,
        attendantId: dto.attendantId ?? null,
        employeeId: dto.employeeId ?? null,
        attendantName: dto.attendantName ?? null,
        assignedPumpId: dto.assignedPumpId ?? null,
        notes: dto.notes ?? null,
      },
      include: {
        attendant: { select: { id: true, fullName: true, email: true } },
        employee: {
          select: { id: true, fullName: true, employeeCode: true, email: true, branchId: true },
        },
        assignedPump: { select: { id: true, pumpCode: true, pumpName: true } },
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_ATTENDANT_ADD',
      entityType: 'FuelShiftAttendant',
      entityId: row.id,
      userId,
      companyId: shift.companyId,
      newValue: row as any,
    });

    return row;
  }

  async updateAttendant(
    shiftId: string,
    attendantRowId: string,
    dto: UpdateShiftAttendantDto,
    user: AuthUser,
  ) {
    const shift = await this.findOne(shiftId, user, AccessLevel.WRITE);
    const userId = user.id;
    if (shift.status !== 'OPEN') {
      throw new BadRequestException('Attendants can only be edited while the shift is OPEN');
    }
    const existing = await this.prisma.fuelShiftAttendant.findFirst({
      where: { id: attendantRowId, fuelShiftId: shiftId },
    });
    if (!existing) throw new NotFoundException('Attendant assignment not found');

    const row = await this.prisma.fuelShiftAttendant.update({
      where: { id: attendantRowId },
      data: {
        ...(dto.assignedPumpId !== undefined && { assignedPumpId: dto.assignedPumpId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        attendant: { select: { id: true, fullName: true, email: true } },
        employee: {
          select: { id: true, fullName: true, employeeCode: true, email: true, branchId: true },
        },
        assignedPump: { select: { id: true, pumpCode: true, pumpName: true } },
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_ATTENDANT_UPDATE',
      entityType: 'FuelShiftAttendant',
      entityId: row.id,
      userId,
      companyId: shift.companyId,
      oldValue: existing as any,
      newValue: row as any,
    });

    return row;
  }

  async removeAttendant(shiftId: string, attendantRowId: string, user: AuthUser) {
    const shift = await this.findOne(shiftId, user, AccessLevel.WRITE);
    const userId = user.id;
    if (shift.status !== 'OPEN') {
      throw new BadRequestException('Attendants can only be removed while the shift is OPEN');
    }
    const existing = await this.prisma.fuelShiftAttendant.findFirst({
      where: { id: attendantRowId, fuelShiftId: shiftId },
    });
    if (!existing) throw new NotFoundException('Attendant assignment not found');

    await this.prisma.fuelShiftAttendant.delete({ where: { id: attendantRowId } });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_ATTENDANT_REMOVE',
      entityType: 'FuelShiftAttendant',
      entityId: attendantRowId,
      userId,
      companyId: shift.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  // ─── Efficiency aggregation ───────────────────────────────────────────────

  /**
   * For each attendant on a shift, aggregate the litres dispensed and expected
   * revenue from the nozzle readings they are responsible for.
   *
   * Attribution rules (in order of precedence):
   *  1. If the nozzle reading has its own `attendantId` set → that attendant.
   *  2. Else, if the attendant has an `assignedPumpId` → all readings on that
   *     pump that have no explicit attendant.
   *  3. Else, the reading is "unattributed".
   *
   * Efficiency metrics returned:
   *  - litresSold, expectedAmount, readingCount
   *  - litresPerHour (using the shift's startTime → endTime/now duration)
   *  - share of shift total (litres + revenue)
   */
  async getAttendantEfficiency(shiftId: string, user: AuthUser) {
    const shift = await this.prisma.fuelShift.findFirst({
      where: { id: shiftId, deletedAt: null },
      include: {
        attendants: {
          include: {
            attendant: { select: { id: true, fullName: true, email: true } },
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                email: true,
                branchId: true,
              },
            },
            assignedPump: { select: { id: true, pumpCode: true, pumpName: true } },
          },
        },
        nozzleReadings: {
          select: {
            id: true,
            pumpId: true,
            attendantId: true,
            litresSold: true,
            expectedAmount: true,
            status: true,
          },
        },
      },
    });
    if (!shift) throw new NotFoundException('Fuel shift not found');
    await this.companyScope.assertCanAccessCompany(user, shift.companyId, AccessLevel.READ);

    const start = shift.startTime ? new Date(shift.startTime).getTime() : null;
    const end = shift.endTime ? new Date(shift.endTime).getTime() : Date.now();
    const hoursElapsed = start ? Math.max((end - start) / 3_600_000, 0) : 0;

    const totalLitres = shift.nozzleReadings.reduce((s, r) => s + Number(r.litresSold), 0);
    const totalRevenue = shift.nozzleReadings.reduce((s, r) => s + Number(r.expectedAmount), 0);

    const breakdown = shift.attendants.map((row) => {
      // Step 1: readings explicitly attributed to this attendant
      const explicit = shift.nozzleReadings.filter((r) => r.attendantId === row.attendantId);
      // Step 2: readings on this attendant's assigned pump that have no explicit attendant
      const fromPump = row.assignedPumpId
        ? shift.nozzleReadings.filter((r) => !r.attendantId && r.pumpId === row.assignedPumpId)
        : [];
      const readings = [...explicit, ...fromPump];
      const litresSold = readings.reduce((s, r) => s + Number(r.litresSold), 0);
      const expectedAmount = readings.reduce((s, r) => s + Number(r.expectedAmount), 0);

      return {
        assignmentId: row.id,
        attendantId: row.attendantId,
        employeeId: row.employeeId,
        attendantName: row.attendantName,
        attendant: row.attendant,
        employee: row.employee,
        assignedPump: row.assignedPump,
        // Composite display name: payroll first, system user, then free-text
        displayName:
          row.employee?.fullName ?? row.attendant?.fullName ?? row.attendantName ?? 'Unknown',
        readingCount: readings.length,
        litresSold,
        expectedAmount,
        litresPerHour: hoursElapsed > 0 ? litresSold / hoursElapsed : 0,
        litresShare: totalLitres > 0 ? litresSold / totalLitres : 0,
        revenueShare: totalRevenue > 0 ? expectedAmount / totalRevenue : 0,
      };
    });

    const attributedLitres = breakdown.reduce((s, b) => s + b.litresSold, 0);
    const attributedRevenue = breakdown.reduce((s, b) => s + b.expectedAmount, 0);

    return {
      shiftId,
      shiftStatus: shift.status,
      hoursElapsed,
      totals: {
        litresSold: totalLitres,
        expectedAmount: totalRevenue,
      },
      attributed: {
        litresSold: attributedLitres,
        expectedAmount: attributedRevenue,
      },
      unattributed: {
        litresSold: totalLitres - attributedLitres,
        expectedAmount: totalRevenue - attributedRevenue,
      },
      attendants: breakdown,
    };
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const userId = user.id;
    if (!['OPEN', 'REJECTED'].includes(existing.status)) {
      throw new BadRequestException('Only OPEN or REJECTED shifts can be deleted');
    }

    await this.prisma.fuelShift.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_SHIFT_DELETE',
      entityType: 'FuelShift',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private async buildClosedShiftSummary(
    id: string,
    tx: Prisma.TransactionClient,
    alreadyClosed: boolean,
  ) {
    const [shift, readings, collectionsAgg] = await Promise.all([
      tx.fuelShift.findUniqueOrThrow({
        where: { id },
        select: { companyId: true },
      }),
      tx.fuelNozzleReading.findMany({
        where: { fuelShiftId: id },
        select: { litresSold: true, expectedAmount: true },
      }),
      tx.fuelShiftCollection.aggregate({
        where: { fuelShiftId: id },
        _sum: { amount: true },
      }),
    ]);

    const totalLitresSold = readings.reduce((sum, reading) => sum + Number(reading.litresSold), 0);
    const totalExpectedSales = readings.reduce(
      (sum, reading) => sum + Number(reading.expectedAmount),
      0,
    );
    const totalCollections = Number(collectionsAgg._sum.amount ?? 0);

    return {
      id,
      companyId: shift.companyId,
      totalLitresSold,
      totalExpectedSales,
      totalCollections,
      shortageOrExcess: totalCollections - totalExpectedSales,
      alreadyClosed,
    };
  }
}
