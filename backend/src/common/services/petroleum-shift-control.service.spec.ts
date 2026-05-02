import { BadRequestException } from '@nestjs/common';
import { PetroleumShiftControlService } from './petroleum-shift-control.service';

const prisma = {
  fuelShift: {
    count: jest.fn(),
  },
};

const baseReading = {
  id: 'reading-1',
  openingMeter: 100,
  pricePerLitre: 180,
  status: 'OPEN',
};

describe('PetroleumShiftControlService', () => {
  let service: PetroleumShiftControlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PetroleumShiftControlService(prisma as any);
  });

  it('computes litres and expected amount for valid shift closing readings', () => {
    const result = service.validateShiftClosing(
      [baseReading],
      [{ nozzleReadingId: 'reading-1', closingMeter: 125 }],
    );

    expect(result).toEqual([
      {
        reading: baseReading,
        closingMeter: 125,
        litresSold: 25,
        expectedAmount: 4500,
      },
    ]);
  });

  it('rejects duplicate closing readings', () => {
    expect(() =>
      service.validateShiftClosing(
        [baseReading],
        [
          { nozzleReadingId: 'reading-1', closingMeter: 125 },
          { nozzleReadingId: 'reading-1', closingMeter: 126 },
        ],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects unknown closing readings for the shift', () => {
    expect(() =>
      service.validateShiftClosing(
        [baseReading],
        [{ nozzleReadingId: 'reading-2', closingMeter: 125 }],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects disputed or voided readings', () => {
    expect(() =>
      service.validateShiftClosing(
        [{ ...baseReading, status: 'DISPUTED' }],
        [{ nozzleReadingId: 'reading-1', closingMeter: 125 }],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a closing meter below the opening meter', () => {
    expect(() =>
      service.validateShiftClosing(
        [baseReading],
        [{ nozzleReadingId: 'reading-1', closingMeter: 99 }],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects daily reconciliation while active shifts remain unclosed', async () => {
    prisma.fuelShift.count.mockResolvedValueOnce(1);

    await expect(
      service.assertDailyReconciliationReady({
        companyId: 'company-1',
        branchId: 'branch-1',
        reconciliationDate: new Date('2026-04-29'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.fuelShift.count).toHaveBeenCalledTimes(1);
  });

  it('rejects daily reconciliation with no closed shifts', async () => {
    prisma.fuelShift.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await expect(
      service.assertDailyReconciliationReady({
        companyId: 'company-1',
        branchId: 'branch-1',
        reconciliationDate: new Date('2026-04-29'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows daily reconciliation when all active shifts are closed', async () => {
    prisma.fuelShift.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);

    await expect(
      service.assertDailyReconciliationReady({
        companyId: 'company-1',
        branchId: 'branch-1',
        reconciliationDate: new Date('2026-04-29'),
      }),
    ).resolves.toBeUndefined();
  });
});
