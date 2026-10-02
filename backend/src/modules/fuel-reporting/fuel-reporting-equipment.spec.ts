import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { FuelReportingService } from './fuel-reporting.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const branchId = 'a0663e36-0c71-4a29-bdb6-889c4e000001';
const date = new Date('2026-10-02T12:00:00.000Z');
const revision = { expectedUpdatedAt: date.toISOString() };
const admin = {
  id: 'admin',
  roles: ['GROUP_SUPER_ADMIN'],
  permissions: ['fuel_reporting.admin'],
} as AuthUser;
const details = {
  ...revision,
  code: 'T1',
  name: 'Renamed tank',
  capacityLitres: 1000,
  productId: 'diesel',
};

function setup() {
  const tank = {
    id: 'tank',
    branchId,
    productId: 'diesel',
    tankCode: 'T1',
    tankName: 'Tank 1',
    status: 'ACTIVE',
    deletedAt: null as Date | null,
    updatedAt: date,
    currentBookBalance: 0,
    lastDipBalance: null as number | null,
  };
  const pump = {
    id: 'pump',
    branchId,
    pumpCode: 'P1',
    pumpName: 'Pump 1',
    status: 'ACTIVE',
    deletedAt: null,
    updatedAt: date,
    nozzles: [
      {
        id: 'n1',
        nozzleCode: 'N1',
        tankId: 'tank',
        productId: 'diesel',
        deletedAt: null,
        currentMeterReading: 1200,
      },
      {
        id: 'n2',
        nozzleCode: 'N2',
        tankId: 'tank',
        productId: 'diesel',
        deletedAt: null,
        currentMeterReading: 800,
      },
    ],
  };
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ isActive: true, deletedAt: null }]),
    $transaction: jest.fn(),
    branch: {
      findFirst: jest.fn().mockResolvedValue({
        id: branchId,
        divisionId: 'division',
        division: { companyId: 'company', company: {} },
      }),
    },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'diesel' }) },
    fuelTank: {
      findUnique: jest.fn().mockImplementation(async () => tank),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        _count: { nozzles: 0, pumps: 0, tankDips: 0, deliveries: 0, nozzleReadings: 0 },
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([tank]),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...tank, ...data })),
    },
    fuelPump: {
      findFirst: jest
        .fn()
        .mockImplementation(async ({ where }) => (where.id === 'pump' ? pump : null)),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => pump),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...pump, ...data })),
    },
    fuelNozzle: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    fuelReport: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    fuelShift: { count: jest.fn().mockResolvedValue(0) },
    fuelDelivery: { count: jest.fn().mockResolvedValue(0) },
  };
  db.$transaction.mockImplementation(async (action) => action(db));
  const scope = { assertCanAccessCompany: jest.fn() };
  const audit = { logStrictInTransaction: jest.fn() };
  const service = new FuelReportingService(
    db as unknown as PrismaService,
    scope as unknown as CompanyScopeService,
    audit as unknown as AuditLogsService,
  );
  return { service, db, tank, pump, scope, audit };
}

describe('Fuel Reporting equipment lifecycle', () => {
  it('requires the administrator role and company WRITE access before opening a transaction', async () => {
    const { service, db, scope } = setup();
    await expect(
      service.deleteTank({ ...admin, roles: ['BRANCH_MANAGER'] }, 'tank', revision),
    ).rejects.toBeInstanceOf(ForbiddenException);
    scope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException('Read-only company'));
    await expect(service.deleteTank(admin, 'tank', revision)).rejects.toThrow('Read-only company');
    expect(scope.assertCanAccessCompany).toHaveBeenCalledWith(admin, 'company', AccessLevel.WRITE);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('deletes an empty disconnected tank without destroying its identity or report history', async () => {
    const { service, db, audit } = setup();
    const deleted = await service.deleteTank(admin, 'tank', revision);
    expect(deleted).toMatchObject({ id: 'tank', status: 'INACTIVE', deletedAt: expect.any(Date) });
    expect(db.fuelTank.update).toHaveBeenCalledWith({
      where: { id: 'tank' },
      data: { status: 'INACTIVE', deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'FUEL_REPORTING_TANK_DELETE',
        entityId: 'tank',
        companyId: 'company',
      }),
    );
  });

  it('rejects stale deletion before changing the equipment or writing an audit record', async () => {
    const { service, db, audit } = setup();
    await expect(
      service.deleteTank(admin, 'tank', { expectedUpdatedAt: new Date(0).toISOString() }),
    ).rejects.toThrow(/another window/);
    expect(db.fuelTank.update).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it.each(['report', 'shift'])('rejects changes while a %s is unfinished', async (kind) => {
    const { service, db } = setup();
    (kind === 'report' ? db.fuelReport : db.fuelShift).count.mockResolvedValue(1);
    await expect(service.deleteTank(admin, 'tank', revision)).rejects.toThrow(/Close the station/);
    expect(db.fuelTank.update).not.toHaveBeenCalled();
  });

  it.each(['nozzle', 'pump', 'delivery'] as const)(
    'blocks deleting a tank with a live %s dependency',
    async (kind) => {
      const { service, db } = setup();
      ({ nozzle: db.fuelNozzle, pump: db.fuelPump, delivery: db.fuelDelivery })[
        kind
      ].count.mockResolvedValue(1);
      await expect(service.deleteTank(admin, 'tank', revision)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.fuelTank.update).not.toHaveBeenCalled();
    },
  );

  it.each(['book', 'dip', 'manual'])(
    'blocks deleting a tank with a %s fuel balance',
    async (kind) => {
      const { service, db, tank } = setup();
      if (kind === 'book') tank.currentBookBalance = 25;
      if (kind === 'dip') tank.lastDipBalance = 25;
      if (kind === 'manual')
        db.fuelReport.findFirst.mockResolvedValue({
          payload: { dips: [{ tankId: 'tank', closing: 25 }] },
        });
      await expect(service.deleteTank(admin, 'tank', revision)).rejects.toThrow(/fuel balance/);
      expect(db.fuelTank.update).not.toHaveBeenCalled();
    },
  );

  it('restores the same tank only when its product remains authorised and active', async () => {
    const { service, db, tank } = setup();
    tank.deletedAt = date;
    const restored = await service.restoreTank(admin, 'tank', revision);
    expect(restored).toMatchObject({ id: 'tank', status: 'ACTIVE', deletedAt: null });
    db.product.findFirst.mockResolvedValueOnce(null);
    await expect(service.restoreTank(admin, 'tank', revision)).rejects.toThrow(/fuel product/);
  });

  it('renames a tank without overwriting its fuel quantity', async () => {
    const { service, db, audit } = setup();
    await service.updateTank(admin, 'tank', details);
    expect(db.fuelTank.update).toHaveBeenCalledWith({
      where: { id: 'tank' },
      data: {
        tankCode: 'T1',
        tankName: 'Renamed tank',
        capacityLitres: 1000,
        productId: 'diesel',
        updatedAt: expect.any(Date),
      },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'FUEL_REPORTING_TANK_UPDATE' }),
    );
  });

  it('rejects smaller-than-stock capacities and changes to a historical fuel product', async () => {
    const { service, db, tank } = setup();
    tank.currentBookBalance = 1100;
    await expect(service.updateTank(admin, 'tank', details)).rejects.toThrow(/capacity/);
    tank.currentBookBalance = 0;
    db.fuelReport.findFirst.mockResolvedValue({
      payload: { dips: [{ tankId: 'tank', closing: 0 }] },
    });
    await expect(
      service.updateTank(admin, 'tank', { ...details, productId: 'petrol' }),
    ).rejects.toThrow(/fuel history/);
    expect(db.fuelTank.update).not.toHaveBeenCalled();
  });

  it('rejects a duplicate tank code even when the other tank has been deleted', async () => {
    const { service, db } = setup();
    db.fuelTank.findFirst.mockResolvedValueOnce({ id: 'other', deletedAt: date });
    await expect(service.updateTank(admin, 'tank', details)).rejects.toThrow(/code already exists/);
  });

  it('advances equipment revisions even when successive changes share a clock tick', async () => {
    const { service, tank, pump } = setup();
    const future = new Date(Date.now() + 60_000);
    tank.updatedAt = future;
    pump.updatedAt = future;
    const dto = { expectedUpdatedAt: future.toISOString() };
    const updated = await service.updateTank(admin, 'tank', { ...details, ...dto });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(future.getTime());
    const removed = await service.deactivatePump(admin, 'pump', dto);
    expect(removed.updatedAt.getTime()).toBeGreaterThan(future.getTime());
    pump.status = 'INACTIVE';
    const restored = await service.restorePump(admin, 'pump', dto);
    expect(restored.updatedAt.getTime()).toBeGreaterThan(future.getTime());
  });

  it('preserves an existing nozzle’s identity and meter when editing and retires omitted nozzles', async () => {
    const { service, db, audit } = setup();
    await service.updatePump(admin, 'pump', {
      ...revision,
      code: 'P1',
      name: 'Renamed pump',
      nozzles: [
        { id: 'n1', code: 'N1', tankId: 'tank' },
        { code: 'N3', tankId: 'tank' },
      ],
    });
    expect(db.fuelNozzle.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { nozzleCode: 'N1', tankId: 'tank', productId: 'diesel' },
    });
    expect(db.fuelNozzle.updateMany).toHaveBeenCalledWith({
      where: { pumpId: 'pump', deletedAt: null, id: { notIn: ['n1'] } },
      data: { status: 'INACTIVE', deletedAt: expect.any(Date) },
    });
    expect(db.fuelNozzle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nozzleCode: 'N3', status: 'ACTIVE' }),
      }),
    );
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'FUEL_REPORTING_PUMP_UPDATE' }),
    );
  });

  it.each(['foreign nozzle', 'inactive tank', 'different fuel'])(
    'rejects pump changes involving a %s',
    async (kind) => {
      const { service, db, tank } = setup();
      if (kind === 'inactive tank') db.fuelTank.findMany.mockResolvedValue([]);
      if (kind === 'different fuel') tank.productId = 'petrol';
      await expect(
        service.updatePump(admin, 'pump', {
          ...revision,
          code: 'P1',
          name: 'Pump',
          nozzles: [
            { id: kind === 'foreign nozzle' ? 'foreign' : 'n1', code: 'N1', tankId: 'tank' },
          ],
        }),
      ).rejects.toThrow();
      expect(db.fuelNozzle.updateMany).not.toHaveBeenCalled();
      expect(db.fuelPump.update).not.toHaveBeenCalled();
    },
  );

  it('restores a pump only after its tanks are restored and does not resurrect deleted nozzles', async () => {
    const { service, db, pump } = setup();
    pump.status = 'INACTIVE';
    db.fuelTank.findMany.mockResolvedValueOnce([]);
    await expect(service.restorePump(admin, 'pump', revision)).rejects.toThrow(
      /Restore or reconnect/,
    );
    await service.restorePump(admin, 'pump', revision);
    expect(db.fuelNozzle.updateMany).toHaveBeenCalledWith({
      where: { pumpId: 'pump', deletedAt: null, status: 'INACTIVE' },
      data: { status: 'ACTIVE' },
    });
  });
});
