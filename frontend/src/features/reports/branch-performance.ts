import type { Analysis, AnalysisRow, AnalysisTable } from './analysis-types';
export function branchPerformance(
  sales: Analysis | null,
  purchases: Analysis | null,
  cash: Analysis | null,
  currency: string,
): AnalysisTable {
  const rows = new Map<string, AnalysisRow>();
  for (const [report, key] of [
    [sales, 'sales'],
    [purchases, 'purchases'],
    [cash, 'expenses'],
  ] as const) {
    for (const r of report?.tables.find((t) => t.id === 'branches')?.rows ?? []) {
      if (currency && r.currency !== currency) continue;
      const id = `${r.branchId}:${r.currency}`,
        row = rows.get(id) ?? {
          id,
          companyId: r.companyId,
          divisionId: r.divisionId,
          branchId: r.branchId,
          company: r.company,
          division: r.division,
          branch: r.branch,
          currency: r.currency,
          sales: '0.00',
          purchases: '0.00',
          expenses: '0.00',
          receivable: '0.00',
          payable: '0.00',
        };
      row[key] = r[key === 'expenses' ? 'amount' : 'issued'];
      if (key === 'sales') row.receivable = r.closing;
      if (key === 'purchases') row.payable = r.closing;
      rows.set(id, row);
    }
  }
  return {
    id: 'branches',
    title: 'Branch performance',
    columns: [
      { key: 'company', label: 'Company' },
      { key: 'division', label: 'Division' },
      { key: 'branch', label: 'Branch' },
      { key: 'currency', label: 'Currency' },
      ...(sales
        ? [
            { key: 'sales', label: 'Sales', money: true },
            { key: 'receivable', label: 'Customers owe', money: true },
          ]
        : []),
      ...(purchases
        ? [
            { key: 'purchases', label: 'Purchases', money: true },
            { key: 'payable', label: 'Suppliers owed', money: true },
          ]
        : []),
      ...(cash ? [{ key: 'expenses', label: 'Paid expenses', money: true }] : []),
    ],
    rows: [...rows.values()],
  };
}
