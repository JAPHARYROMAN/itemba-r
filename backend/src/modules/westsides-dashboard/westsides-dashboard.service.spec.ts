import { WestsidesDashboardService } from './westsides-dashboard.service';

function makeService() {
  return new WestsidesDashboardService({} as any, {} as any) as any;
}

describe('WestsidesDashboardService readiness helpers', () => {
  it('returns production-ready readiness when blockers and warnings are clear', () => {
    const service = makeService();
    const date = new Date('2026-05-31T08:00:00.000Z');
    const drillThrough = service.buildDrillThrough({
      companyId: 'company-1',
      branchId: 'branch-1',
      date,
    });
    const dailyCloseChecks = service.dailyCloseChecks({
      activeCashAccounts: 2,
      nonCreditMissingCashAccount: 0,
      mobileMoneyMissingReference: 0,
      confirmedOrdersMissingJournal: 0,
      failedPostingRuns: 0,
      draftJournalsToday: 0,
      activeAccountingLocks: 0,
      currentOpenPeriods: 1,
      draftOrdersToday: 0,
      overdueDeliveries: 0,
      pendingDamage: 0,
    });
    const staleData = service.buildStaleDataSignals(date, drillThrough, {
      latestSalesAt: date,
      salesRows: 4,
      latestInventoryMovementAt: date,
      inventoryMovementRows: 2,
      latestInventoryBalanceAt: date,
      inventoryBalanceRows: 20,
      latestDeliveryAt: date,
      deliveryRows: 1,
      latestPriceDataAt: date,
      activePriceLists: 1,
      latestPostingAt: date,
      postingRows: 1,
    });
    const dataQuality = service.buildDataQualitySignals(drillThrough, {
      activeProducts: 20,
      productsMissingSearchKey: 0,
      productsMissingReorderPolicy: 0,
      productsWithoutBalance: 0,
      productsMissingPrice: 0,
      activeCustomers: 5,
      customersMissingCreditProfile: 0,
      deliveriesMissingLogistics: 0,
      activePriceListsUnapproved: 0,
      unapprovedAgreements: 0,
    });
    const controlSignals = service.buildControlSignals(drillThrough, {
      dailyCloseChecks,
      activeCashAccounts: 2,
      activeAccountingLocks: 0,
      currentOpenPeriods: 1,
      failedPostingRuns: 0,
      confirmedOrdersMissingJournal: 0,
      nonCreditMissingCashAccount: 0,
      activePriceListsUnapproved: 0,
      unapprovedAgreements: 0,
    });

    const readiness = service.buildCommandReadiness({
      dailyClose: { status: 'READY', score: 100, blockers: 0, warnings: 0 },
      stockRisk: {
        lowStockCount: 0,
        outOfStockCount: 0,
        negativeStockCount: 0,
        reorder: { exposureCount: 0, exposureValue: 0 },
        expiry: { expiringSoonCount: 0, expiredActiveCount: 0 },
        damage: { pendingCount: 0, pendingEstimatedValue: 0 },
      },
      pricing: {
        priceLists: {
          productsMissingPrice: 0,
          activeButPastEffectiveTo: 0,
          expiringSoon: 0,
        },
        customerAgreements: { unapprovedActive: 0 },
      },
      fulfillment: { ordersAwaitingDelivery: 0, deliveries: { overdue: 0 } },
      customerCreditRisk: {
        overdueAmount: 0,
        overdueCount: 0,
        customersOverLimit: 0,
        overLimitAmount: 0,
        highRiskProfiles: 0,
      },
      staleData,
      dataQuality,
      controlSignals,
      drillThrough,
    });

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.blockerCount).toBe(0);
  });

  it('marks readiness blocked when close controls contain critical blockers', () => {
    const service = makeService();
    const date = new Date('2026-05-31T08:00:00.000Z');
    const drillThrough = service.buildDrillThrough({ companyId: 'company-1', date });
    const dailyCloseChecks = service.dailyCloseChecks({
      activeCashAccounts: 0,
      nonCreditMissingCashAccount: 2,
      mobileMoneyMissingReference: 0,
      confirmedOrdersMissingJournal: 3,
      failedPostingRuns: 1,
      draftJournalsToday: 0,
      activeAccountingLocks: 1,
      currentOpenPeriods: 0,
      draftOrdersToday: 0,
      overdueDeliveries: 0,
      pendingDamage: 0,
    });
    const staleData = { score: 100, staleCount: 0, signals: [] };
    const dataQuality = { score: 100, issueCount: 0, issues: [] };
    const controlSignals = service.buildControlSignals(drillThrough, {
      dailyCloseChecks,
      activeCashAccounts: 0,
      activeAccountingLocks: 1,
      currentOpenPeriods: 0,
      failedPostingRuns: 1,
      confirmedOrdersMissingJournal: 3,
      nonCreditMissingCashAccount: 2,
      activePriceListsUnapproved: 0,
      unapprovedAgreements: 0,
    });

    const readiness = service.buildCommandReadiness({
      dailyClose: { status: 'BLOCKED', score: 30, blockers: 7, warnings: 0 },
      stockRisk: {
        lowStockCount: 0,
        outOfStockCount: 0,
        negativeStockCount: 0,
        reorder: { exposureCount: 0, exposureValue: 0 },
        expiry: { expiringSoonCount: 0, expiredActiveCount: 0 },
        damage: { pendingCount: 0, pendingEstimatedValue: 0 },
      },
      pricing: {
        priceLists: {
          productsMissingPrice: 0,
          activeButPastEffectiveTo: 0,
          expiringSoon: 0,
        },
        customerAgreements: { unapprovedActive: 0 },
      },
      fulfillment: { ordersAwaitingDelivery: 0, deliveries: { overdue: 0 } },
      customerCreditRisk: {
        overdueAmount: 0,
        overdueCount: 0,
        customersOverLimit: 0,
        overLimitAmount: 0,
        highRiskProfiles: 0,
      },
      staleData,
      dataQuality,
      controlSignals,
      drillThrough,
    });

    expect(readiness.status).toBe('BLOCKED');
    expect(readiness.blockerCount).toBeGreaterThan(0);
    expect(readiness.blockers.map((issue: any) => issue.key)).toEqual(
      expect.arrayContaining([
        'no-active-cash-account',
        'active-accounting-locks',
        'no-open-current-period',
        'posting-evidence-gap',
        'cash-sale-missing-account',
      ]),
    );
  });
});
