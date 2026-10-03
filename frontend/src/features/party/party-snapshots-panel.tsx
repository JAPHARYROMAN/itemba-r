'use client';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { openPartyIn } from './party-links';

export type PartySnapshotRow = {
  id: string;
  role: 'AP' | 'AR';
  partyType: string;
  kind: 'supplier' | 'customer' | null;
  partyId: string | null;
  partyName: string | null;
  currency: string;
  subLedger: string;
  control: string;
  difference: string;
};
export type PartySnapshots = {
  snapshotAt: string | null;
  closes: number;
  currency: string | null;
  differences: number;
  rows: PartySnapshotRow[];
};

/**
 * Party linkage (Phase 3 PR-3): what the control account and the sub-ledger said per party
 * when the period was last closed. Recorded at close, never recomputed and never a balance.
 */
export function PartySnapshotsPanel({ path }: { path: string }) {
  const result = useWorkspaceResource<PartySnapshots>(path);
  if (result.error)
    return (
      <p role="alert" className="workspace-notice">
        Party balances at close unavailable: {result.error}
      </p>
    );
  if (!result.data)
    return (
      <p role="status" className="workspace-notice">
        Loading party balances at close…
      </p>
    );
  const data = Array.isArray(result.data.rows) ? result.data : null;
  if (!data || !data.rows.length)
    return <p className="workspace-notice">No party balances were recorded at this close.</p>;
  return (
    <section aria-label="Party balances at close">
      <h3>Party balances at close</h3>
      <p>
        {data.rows.length} row{data.rows.length === 1 ? '' : 's'} · {data.differences} with a
        difference · recorded {String(data.snapshotAt).slice(0, 10)}
        {data.closes > 1 ? ` · ${data.closes} closes recorded, latest shown` : ''}
      </p>
      <WorkspaceTable className="w-full text-sm">
        <thead>
          <tr>
            <th>Party</th>
            <th>Control</th>
            <th>Sub-ledger</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} data-testid="party-snapshot-row">
              <td>
                {row.kind && row.partyId ? (
                  <a href={openPartyIn('profile', row.kind, row.partyId)}>{row.partyName}</a>
                ) : (
                  'Control lines without a party'
                )}{' '}
                <small>{row.role}</small>
              </td>
              <td>
                {row.currency} {row.control}
              </td>
              <td>
                {row.currency} {row.subLedger}
              </td>
              <td>
                {row.currency} {row.difference}
              </td>
            </tr>
          ))}
        </tbody>
      </WorkspaceTable>
    </section>
  );
}
