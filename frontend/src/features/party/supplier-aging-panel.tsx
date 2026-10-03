'use client';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';

type SupplierAgingDetail = {
  supplierName: string | null;
  asOf: string;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
  oldestDaysOverdue: number;
  payableCount: number;
};
const money = (value: number, currency: string) =>
  `${currency} ${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Payables aging for one supplier (party linkage, Phase 3 PR-2), from the same report the
 * customer profile has had: open payables bucketed by days past due as of today.
 */
export function SupplierAgingPanel({
  companyId,
  supplierId,
  currency = 'TZS',
}: {
  companyId: string;
  supplierId: string;
  currency?: string;
}) {
  const result = useWorkspaceResource<SupplierAgingDetail>(
    `/financial-reports/supplier-aging-detail/${encodeURIComponent(companyId)}/${encodeURIComponent(supplierId)}`,
    {},
    !!companyId && !!supplierId,
  );
  if (result.error)
    return (
      <p role="alert" className="partner-profile-history-note">
        Aging unavailable: {result.error}
      </p>
    );
  if (!result.data)
    return (
      <p role="status" className="partner-profile-history-note">
        Loading payables aging…
      </p>
    );
  const d = result.data;
  const buckets: Array<[string, number]> = [
    ['Current', d.current],
    ['1–30', d.days1_30],
    ['31–60', d.days31_60],
    ['61–90', d.days61_90],
    ['90+', d.over90],
  ];
  return (
    <section className="party-balance-panel" aria-label="Payables aging">
      <header>
        <strong>Payables aging</strong>
        <small>
          {d.payableCount} open payable{d.payableCount === 1 ? '' : 's'} · oldest{' '}
          {d.oldestDaysOverdue} day{d.oldestDaysOverdue === 1 ? '' : 's'} overdue · as of{' '}
          {String(d.asOf).slice(0, 10)}
        </small>
      </header>
      <div className="party-balance-chips">
        {buckets.map(([label, value]) => (
          <em key={label}>
            {label} {money(value, currency)}
          </em>
        ))}
        <em className="is-total">Total {money(d.total, currency)}</em>
      </div>
    </section>
  );
}
