import { ItembaDashboardService } from './itemba-dashboard.service';

function countDelegate(values: number[] = []) {
  const count = jest.fn();
  values.forEach((value) => count.mockResolvedValueOnce(value));
  count.mockResolvedValue(0);
  return { count };
}

function makePrisma() {
  return {
    fuelTank: countDelegate([2]),
    fuelPump: countDelegate([2]),
    fuelNozzle: countDelegate([6]),
    fuelShift: countDelegate([1]),
    fuelDelivery: countDelegate([1]),
    fuelTankDip: countDelegate([0]),
    fuelCreditSale: countDelegate([2]),
    fuelDailyReconciliation: countDelegate([1]),
    vehicle: countDelegate([5]),
    driverProfile: countDelegate([4]),
    route: countDelegate([3]),
    trip: countDelegate([2, 1]),
    vehicleMaintenance: countDelegate([1]),
    farm: countDelegate([2]),
    farmField: countDelegate([4]),
    crop: countDelegate([3]),
    cropSeason: countDelegate([2]),
    farmInputApplication: countDelegate([6]),
    harvestRecord: countDelegate([1]),
    agricultureActivity: countDelegate([3]),
    constructionProject: countDelegate([4, 1]),
    constructionSite: countDelegate([3]),
    bOQItem: countDelegate([12]),
    projectMaterialIssue: countDelegate([2]),
    projectProgressRecord: countDelegate([1]),
    projectBilling: countDelegate([2]),
    salesOrder: countDelegate([9]),
    purchaseOrder: countDelegate([6]),
    inventoryBalance: countDelegate([25]),
    productBatch: countDelegate([18]),
    stockDamage: countDelegate([1]),
    rentalProperty: countDelegate([2]),
    rentalUnit: countDelegate([5]),
    leaseAgreement: countDelegate([4]),
    rentInvoice: countDelegate([2]),
    rentPayment: countDelegate([8]),
    propertyMaintenance: countDelegate([1]),
    parkingFacility: countDelegate([1]),
    parkingZone: countDelegate([2]),
    parkingRate: countDelegate([3]),
    parkingSession: countDelegate([4, 1]),
    parkingPayment: countDelegate([6]),
    hospitalityFacility: countDelegate([1]),
    room: countDelegate([10]),
    roomBooking: countDelegate([4]),
    restaurantOrder: countDelegate([2]),
    hospitalityPayment: countDelegate([6]),
    housekeepingTask: countDelegate([1]),
  } as any;
}

describe('ItembaDashboardService sector readiness', () => {
  it('returns a scoped readiness command center for every sector module', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new ItembaDashboardService(prisma, companyScope as any);

    const result = await service.getSectorReadiness('company-1', { id: 'user-1' } as any);

    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
    expect(result.target).toBe(90);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.sectors).toHaveLength(8);
    expect(result.sectors.map((sector) => sector.key)).toEqual([
      'petroleum',
      'logistics',
      'agriculture',
      'construction',
      'westsides',
      'rentals',
      'parking',
      'hospitality',
    ]);
    expect(result.sectors.find((sector) => sector.key === 'petroleum')).toMatchObject({
      score: expect.any(Number),
      status: 'WARNING',
      counts: {
        activeFuelTanks: 2,
        activeFuelNozzles: 6,
        openFuelCreditSales: 2,
      },
    });
    expect(result.alerts.some((alert) => alert.sectorKey === 'petroleum')).toBe(true);
    expect(result.readinessImpact).toEqual({
      sectorModules: 90,
      uxConsistency: 90,
    });
  });

  it('keeps unconfigured sectors visible without dropping the module below target', async () => {
    const prisma = makePrisma();
    Object.values(prisma).forEach((delegate: any) => {
      delegate.count.mockReset();
      delegate.count.mockResolvedValue(0);
    });
    const service = new ItembaDashboardService(prisma, {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    } as any);

    const result = await service.getSectorReadiness('company-1', { id: 'user-1' } as any);

    expect(result.score).toBe(90);
    expect(result.configuredSectors).toBe(0);
    expect(result.sectors.every((sector) => sector.maturity === 'Ready for configuration')).toBe(
      true,
    );
  });
});
