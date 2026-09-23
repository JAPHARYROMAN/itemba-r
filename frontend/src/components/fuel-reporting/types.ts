export interface Branch {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  companyCode: string;
}
export interface Catalog {
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
export interface Payload {
  readings: {
    nozzleId: string;
    attendantName: string;
    opening: number | null;
    closing: number | null;
    price: number | null;
  }[];
  dips: { tankId: string; opening: number | null; closing: number | null }[];
  deliveries: {
    productId: string;
    litres: number;
    supplier: string;
    reference: string;
    totalCost: number | null;
    paidAmount: number;
    paymentSource: string;
  }[];
  expenses: { category: string; description: string; amount: number; paymentSource: string }[];
  creditSales: { customer: string; reference: string; amount: number }[];
  collections: {
    cash: number | null;
    mobile: number | null;
    bank: number | null;
    openingCash: number | null;
    cashHandedOver: number | null;
  };
  receiptsConfirmed: boolean;
  expensesConfirmed: boolean;
  notes: string;
  discrepancyReason: string;
  documentIds: string[];
}
export interface Summary {
  sales: number;
  litres: number;
  collected: number;
  credit: number;
  expenses: number;
  purchases: number;
  unpricedDeliveries: number;
  cashOut: number;
  expectedCash: number;
  flagged: number;
  issues: string[];
  stock: {
    productId: string;
    productName: string;
    opening: number;
    received: number;
    sold: number;
    expected: number;
    actual: number | null;
    difference: number | null;
  }[];
  discrepancies: {
    kind: string;
    label: string;
    expected: number;
    actual: number;
    difference: number;
    unit: string;
  }[];
}
export interface Report {
  id: string;
  branchId: string;
  businessDate: string;
  shift: string;
  status: string;
  version: number;
  payload: Payload & { catalog: Catalog; companyName: string; branchName: string };
  summary: Summary;
  updatedAt: string;
  closedAt: string | null;
}
export interface Bootstrap {
  branches: Branch[];
  canManage: boolean;
  canAdmin: boolean;
}
export interface Workspace {
  catalog: Catalog;
  report: Report | null;
  previous: Report | null;
  daily: Report[];
  products: { id: string; name: string }[];
  pumps: { id: string; pumpCode: string; pumpName: string; status: string }[];
}
export interface Revision {
  id: string;
  version: number;
  action: string;
  authorName: string;
  reason: string | null;
  createdAt: string;
  payload: Report['payload'];
  summary: Summary;
}

export const amount = (value: number | null | undefined, places = 2) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-TZ', {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      }).format(value);
export const stationDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function newPayload(catalog: Catalog, previous: Report | null): Payload {
  return {
    readings: catalog.nozzles.map((n) => ({
      nozzleId: n.id,
      attendantName: '',
      opening:
        previous?.payload.readings.filter((r) => r.nozzleId === n.id).at(-1)?.closing ?? null,
      closing: null,
      price: previous?.payload.readings.filter((r) => r.nozzleId === n.id).at(-1)?.price ?? null,
    })),
    dips: catalog.tanks.map((t) => ({
      tankId: t.id,
      opening: previous?.payload.dips.find((d) => d.tankId === t.id)?.closing ?? null,
      closing: null,
    })),
    deliveries: [],
    expenses: [],
    creditSales: [],
    collections: { cash: null, mobile: null, bank: null, openingCash: null, cashHandedOver: null },
    receiptsConfirmed: false,
    expensesConfirmed: false,
    notes: '',
    discrepancyReason: '',
    documentIds: [],
  };
}
/** Only send editable data; master labels and calculations always come from the server. */
export function editablePayload(payload: Payload): Payload {
  const {
    readings,
    dips,
    deliveries,
    expenses,
    creditSales,
    collections,
    receiptsConfirmed,
    expensesConfirmed,
    notes,
    discrepancyReason,
    documentIds,
  } = payload;
  return {
    readings,
    dips,
    deliveries,
    expenses,
    creditSales,
    collections,
    receiptsConfirmed,
    expensesConfirmed,
    notes,
    discrepancyReason,
    documentIds,
  };
}
