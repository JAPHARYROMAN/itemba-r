import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ClosingReadingInput = {
  nozzleReadingId: string;
  closingMeter: number;
};

type ShiftReading = {
  id: string;
  openingMeter: unknown;
  closingMeter?: unknown;
  litresSold?: unknown;
  expectedAmount?: unknown;
  pricePerLitre: unknown;
  status: string;
};

export type ValidatedClosingReading<TReading extends ShiftReading> = {
  reading: TReading;
  closingMeter: number;
  litresSold: number;
  expectedAmount: number;
};

@Injectable()
export class PetroleumShiftControlService {
  constructor(private readonly prisma: PrismaService) {}

  validateShiftClosing<TReading extends ShiftReading>(
    readings: TReading[],
    closingReadings: ClosingReadingInput[],
  ): ValidatedClosingReading<TReading>[] {
    if (readings.length === 0) {
      throw new BadRequestException('Shift cannot be closed without nozzle readings');
    }

    const closingByReadingId = new Map<string, number>();
    for (const input of closingReadings) {
      if (closingByReadingId.has(input.nozzleReadingId)) {
        throw new BadRequestException(
          `Duplicate closing meter for nozzle reading ${input.nozzleReadingId}`,
        );
      }
      closingByReadingId.set(input.nozzleReadingId, input.closingMeter);
    }

    const shiftReadingIds = new Set(readings.map((reading) => reading.id));
    for (const readingId of closingByReadingId.keys()) {
      if (!shiftReadingIds.has(readingId)) {
        throw new BadRequestException(`Unknown nozzle reading ${readingId} for this shift`);
      }
    }

    return readings.map((reading) => {
      if (['DISPUTED', 'VOIDED'].includes(reading.status)) {
        throw new BadRequestException(
          `Nozzle reading ${reading.id} must be resolved before closing the shift`,
        );
      }

      if (!closingByReadingId.has(reading.id)) {
        throw new BadRequestException(`Missing closing meter for nozzle reading ${reading.id}`);
      }

      const closingMeter = closingByReadingId.get(reading.id)!;
      const openingMeter = Number(reading.openingMeter);
      const litresSold = closingMeter - openingMeter;

      if (litresSold < 0) {
        throw new BadRequestException(
          `Closing meter must be >= opening meter for reading ${reading.id}`,
        );
      }

      const expectedAmount = litresSold * Number(reading.pricePerLitre);

      return {
        reading,
        closingMeter,
        litresSold,
        expectedAmount,
      };
    });
  }

  async assertDailyReconciliationReady(params: {
    companyId: string;
    branchId: string;
    reconciliationDate: Date;
  }): Promise<void> {
    const shiftWhere = {
      companyId: params.companyId,
      branchId: params.branchId,
      shiftDate: params.reconciliationDate,
      deletedAt: null,
    };

    const blockingShiftCount = await this.prisma.fuelShift.count({
      where: {
        ...shiftWhere,
        status: { notIn: ['CLOSED', 'REJECTED', 'VOIDED'] },
      },
    });
    if (blockingShiftCount > 0) {
      throw new BadRequestException(
        'Daily reconciliation requires all active shifts for the branch/date to be closed',
      );
    }

    const closedShiftCount = await this.prisma.fuelShift.count({
      where: {
        ...shiftWhere,
        status: 'CLOSED',
      },
    });
    if (closedShiftCount === 0) {
      throw new BadRequestException(
        'Daily reconciliation requires at least one closed shift for the branch/date',
      );
    }
  }
}
