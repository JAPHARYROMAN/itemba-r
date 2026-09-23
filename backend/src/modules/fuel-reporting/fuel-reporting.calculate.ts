import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReportPayloadDto } from './fuel-reporting.dto';

export interface ReportCatalog {
  tanks: {
    id: string;
    tankName: string;
    productId: string;
    capacityLitres: number;
    productName: string;
  }[];
  nozzles: {
    id: string;
    nozzleCode: string;
    pumpId: string;
    pumpName: string;
    productId: string;
    productName: string;
  }[];
}
const d = (n: number | null | undefined) => new Prisma.Decimal(n ?? 0);
const round = (n: Prisma.Decimal, places = 2) => n.toDecimalPlaces(places).toNumber();
const sum = (values: number[]) => values.reduce((acc, n) => acc.plus(n), d(0));
const present = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Decimal arithmetic and explicit missing values: blank dip readings must never become zero. */
export function calculateReport(
  payload: ReportPayloadDto,
  catalog: ReportCatalog,
  previous?: ReportPayloadDto,
) {
  const issues: string[] = [];
  const discrepancies: {
    kind: string;
    label: string;
    expected: number;
    actual: number;
    difference: number;
    unit: string;
  }[] = [];
  const nozzleMap = new Map(catalog.nozzles.map((n) => [n.id, n]));
  const tankMap = new Map(catalog.tanks.map((t) => [t.id, t]));
  const productIds = new Set(catalog.tanks.map((t) => t.productId));
  if (!catalog.tanks.length)
    issues.push('An admin must configure the branch tanks before closing.');
  if (!catalog.nozzles.length)
    issues.push('An admin must configure the branch pumps and nozzles before closing.');
  const seen = new Set<string>();
  const litresByProduct = new Map<string, Prisma.Decimal>();
  let sales = d(0);
  for (const row of payload.readings) {
    const nozzle = nozzleMap.get(row.nozzleId);
    if (!nozzle)
      throw new BadRequestException(
        'A reading references a nozzle outside this branch configuration.',
      );
    seen.add(row.nozzleId);
    const label = `${nozzle.pumpName} / ${nozzle.nozzleCode}`;
    if (!row.attendantName.trim()) issues.push(`Enter the attendant name for ${label}.`);
    if (!present(row.opening) || !present(row.closing)) {
      issues.push(`Complete the opening and closing meters for ${label}.`);
      continue;
    }
    if (row.closing < row.opening) {
      issues.push(`Closing meter must not be below opening for ${label}.`);
      continue;
    }
    if (!present(row.price) || row.price <= 0)
      issues.push(`Enter a positive selling price for ${label}.`);
    const litres = d(row.closing).minus(row.opening);
    litresByProduct.set(
      nozzle.productId,
      (litresByProduct.get(nozzle.productId) ?? d(0)).plus(litres),
    );
    if (present(row.price)) sales = sales.plus(litres.mul(row.price).toDecimalPlaces(2));
  }
  for (const nozzle of catalog.nozzles) {
    if (!seen.has(nozzle.id))
      issues.push(
        `Enter readings and an attendant for ${nozzle.pumpName} / ${nozzle.nozzleCode} (including zero sales).`,
      );
    const intervals = payload.readings.filter((r) => r.nozzleId === nozzle.id);
    const prevClosing = previous?.readings.filter((r) => r.nozzleId === nozzle.id).at(-1)?.closing;
    for (let i = 0; i < intervals.length; i++) {
      const expected = i === 0 ? prevClosing : intervals[i - 1].closing;
      const actual = intervals[i].opening;
      if (present(expected) && present(actual))
        discrepancies.push({
          kind: 'METER',
          label: `${nozzle.pumpName} / ${nozzle.nozzleCode}${i ? ' handover' : ''}`,
          expected,
          actual,
          difference: round(d(actual).minus(expected), 3),
          unit: 'L',
        });
    }
  }
  if (new Set(payload.dips.map((t) => t.tankId)).size !== payload.dips.length)
    throw new BadRequestException('Each tank must have exactly one dip entry.');
  for (const dip of payload.dips)
    if (!tankMap.has(dip.tankId))
      throw new BadRequestException('A dip references a tank outside this branch.');
  for (const tank of catalog.tanks) {
    const dip = payload.dips.find((t) => t.tankId === tank.id);
    if (!present(dip?.opening) || !present(dip?.closing))
      issues.push(`Manually enter opening and closing dip litres for ${tank.tankName}.`);
    if ((dip?.opening ?? 0) > tank.capacityLitres || (dip?.closing ?? 0) > tank.capacityLitres)
      issues.push(`Dip volume exceeds capacity for ${tank.tankName}.`);
    const prev = previous?.dips.find((t) => t.tankId === tank.id)?.closing;
    if (present(prev) && present(dip?.opening))
      discrepancies.push({
        kind: 'OPENING_STOCK',
        label: tank.tankName,
        expected: prev,
        actual: dip.opening,
        difference: round(d(dip.opening).minus(prev), 3),
        unit: 'L',
      });
  }
  for (const receipt of payload.deliveries) {
    if (receipt.litres <= 0) issues.push('Enter positive litres for every fuel delivery.');
    if (!productIds.has(receipt.productId))
      throw new BadRequestException(
        'Received fuel must match a fuel type configured for this branch.',
      );
    if (receipt.totalCost != null && receipt.paidAmount > receipt.totalCost)
      issues.push('Supplier payment cannot exceed its delivery purchase amount.');
  }
  for (const e of payload.expenses)
    if (!e.category.trim() || !e.description.trim() || e.amount <= 0)
      issues.push('Every expense needs a category, description and positive amount.');
  for (const c of payload.creditSales)
    if (!c.customer.trim() || c.amount <= 0)
      issues.push('Every credit sale needs a customer name and positive amount.');
  if (!payload.receiptsConfirmed)
    issues.push('Confirm fuel received, including when there were no deliveries.');
  if (!payload.expensesConfirmed) issues.push('Confirm expenses, including when there were none.');
  const stock = [...productIds].map((productId) => {
    const tanks = catalog.tanks.filter((t) => t.productId === productId);
    const dips = tanks.map((t) => payload.dips.find((r) => r.tankId === t.id));
    const opening = round(sum(dips.map((r) => r?.opening ?? 0)), 3);
    const received = round(
      sum(payload.deliveries.filter((r) => r.productId === productId).map((r) => r.litres)),
      3,
    );
    const sold = round(litresByProduct.get(productId) ?? d(0), 3);
    const expected = round(d(opening).plus(received).minus(sold), 3);
    const actual = round(sum(dips.map((r) => r?.closing ?? 0)), 3);
    const complete =
      dips.every((r) => present(r?.opening) && present(r?.closing)) &&
      catalog.nozzles
        .filter((n) => n.productId === productId)
        .every((n) => {
          const rows = payload.readings.filter((r) => r.nozzleId === n.id);
          return (
            rows.length > 0 &&
            rows.every((r) => present(r.opening) && present(r.closing) && r.closing >= r.opening)
          );
        });
    const difference = round(d(actual).minus(expected), 3);
    if (complete) {
      discrepancies.push({
        kind: 'STOCK',
        label: tanks[0].productName,
        expected,
        actual,
        difference,
        unit: 'L',
      });
      if (expected < 0)
        issues.push(
          `Expected stock is negative for ${tanks[0].productName}; check opening stock, deliveries and meters.`,
        );
    }
    return {
      productId,
      productName: tanks[0].productName,
      opening,
      received,
      sold,
      expected,
      actual: complete ? actual : null,
      difference: complete ? difference : null,
    };
  });
  const c = payload.collections;
  for (const [key, label] of Object.entries({
    cash: 'cash sales collected',
    mobile: 'mobile money',
    bank: 'bank/card payments',
    openingCash: 'opening cash float',
    cashHandedOver: 'cash handed over',
  })) {
    if (!present(c[key as keyof typeof c])) issues.push(`Enter ${label}; use 0 when none.`);
  }
  const credit = round(sum(payload.creditSales.map((r) => r.amount)));
  const expenses = round(sum(payload.expenses.map((r) => r.amount)));
  const cashOut = sum(
    payload.expenses.filter((r) => r.paymentSource === 'SHIFT_CASH').map((r) => r.amount),
  ).plus(
    sum(
      payload.deliveries.filter((r) => r.paymentSource === 'SHIFT_CASH').map((r) => r.paidAmount),
    ),
  );
  const expectedCash = round(d(c.openingCash).plus(d(c.cash)).minus(cashOut));
  const collected = round(d(c.cash).plus(d(c.mobile)).plus(d(c.bank)));
  const salesValue = round(sales);
  if (
    ['cash', 'mobile', 'bank'].every((k) => present(c[k as keyof typeof c])) &&
    catalog.nozzles.every((n) => seen.has(n.id)) &&
    payload.readings.every(
      (r) =>
        present(r.opening) &&
        present(r.closing) &&
        r.closing >= r.opening &&
        present(r.price) &&
        r.price > 0,
    )
  ) {
    const actual = round(d(collected).plus(credit));
    discrepancies.push({
      kind: 'SALES',
      label: 'Sales reconciliation',
      expected: salesValue,
      actual,
      difference: round(d(actual).minus(salesValue)),
      unit: 'TZS',
    });
  }
  if (present(c.openingCash) && present(c.cash) && present(c.cashHandedOver)) {
    if (expectedCash < 0)
      issues.push('Cash expenses and supplier payments exceed the shift cash available.');
    discrepancies.push({
      kind: 'CASH',
      label: 'Cash handover',
      expected: expectedCash,
      actual: c.cashHandedOver,
      difference: round(d(c.cashHandedOver).minus(expectedCash)),
      unit: 'TZS',
    });
  }
  const flagged = discrepancies.filter((r) => r.difference !== 0).length;
  if (flagged && !payload.discrepancyReason.trim())
    issues.push('Explain the recorded discrepancies before closing.');
  return {
    sales: salesValue,
    litres: round(sum([...litresByProduct.values()].map((v) => v.toNumber())), 3),
    collected,
    credit,
    expenses,
    purchases: round(sum(payload.deliveries.map((r) => r.totalCost ?? 0))),
    unpricedDeliveries: payload.deliveries.filter((r) => r.totalCost == null).length,
    cashOut: round(cashOut),
    expectedCash,
    stock,
    discrepancies,
    flagged,
    issues: [...new Set(issues)],
  };
}
