'use client';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { openPartyIn } from './party-links';

export type PartyCloseRow = {
  role: 'AP' | 'AR';
  kind: 'supplier' | 'customer';
  partyId: string;
  name: string;
  code: string | null;
  control: string;
  subLedger: string;
  difference: string;
};
export type PartyCloseCheck = {
  asOf: string;
  baseCurrency: string;
  differences: PartyCloseRow[];
  untagged: { ap: string; ar: string };
  hasDifferences: boolean;
};

/** Reads the close gate's check; a null `path` means the dialog is not a period close. */
export function usePartyCloseCheck(path: string | null) {
  const result = useWorkspaceResource<PartyCloseCheck>(path ?? '', {}, !!path);
  const data =
    result.data && Array.isArray((result.data as PartyCloseCheck).differences) ? result.data : null;
  return {
    data,
    error: result.error,
    loading: !!path && !result.data && !result.error,
    invalid: !!result.data && !data,
  };
}

/**
 * Party linkage (Phase 3 PR-3): what the period close will check. A difference is a finding
 * the closer reads and acknowledges with a reason, never an error; every party links to its
 * profile. The backend refuses an unacknowledged close whatever this panel showed.
 */
export function PartyCloseCheckPanel({
  data,
  error,
  loading,
  invalid,
}: ReturnType<typeof usePartyCloseCheck>) {
  if (error || invalid)
    return (
      <p role="alert" className="workspace-notice">
        Control check unavailable{error ? `: ${error}` : ''}. The close still refuses unacknowledged
        differences.
      </p>
    );
  if (loading || !data)
    return (
      <p role="status" className="workspace-notice">
        Checking control accounts against the sub-ledger…
      </p>
    );
  const date = String(data.asOf).slice(0, 10);
  const currency = data.baseCurrency || 'TZS';
  if (!data.hasDifferences)
    return (
      <p className="workspace-notice">Control accounts agree with the sub-ledger as of {date}.</p>
    );
  return (
    <section aria-label="Control differences">
      <p role="alert" className="workspace-notice">
        Control accounts do not agree with the sub-ledger as of {date}. Closing records these
        differences; give the reason below.
      </p>
      {data.differences.length > 0 && (
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
            {data.differences.map((row) => (
              <tr key={`${row.role}-${row.partyId}`} data-testid="party-close-difference">
                <td>
                  <a href={openPartyIn('profile', row.kind, row.partyId)}>{row.name}</a>{' '}
                  <small>{row.role}</small>
                </td>
                <td>
                  {currency} {row.control}
                </td>
                <td>
                  {currency} {row.subLedger}
                </td>
                <td>
                  {currency} {row.difference}
                </td>
              </tr>
            ))}
          </tbody>
        </WorkspaceTable>
      )}
      {Number(data.untagged.ap) !== 0 && (
        <p>
          AP control without a party: {currency} {data.untagged.ap}
        </p>
      )}
      {Number(data.untagged.ar) !== 0 && (
        <p>
          AR control without a party: {currency} {data.untagged.ar}
        </p>
      )}
    </section>
  );
}
