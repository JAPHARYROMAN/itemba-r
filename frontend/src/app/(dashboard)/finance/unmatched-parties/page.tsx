'use client';

import { useState } from 'react';
import { Btn, Card, PageHeader } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPatch } from '@/lib/api-client';

type PartyKind = 'supplier' | 'customer';

interface UnlinkedGroup {
  key: string;
  source: string;
  companyId: string;
  companyName: string | null;
  kind: PartyKind;
  name: string;
  rows: number;
  rowIds: string[];
  totals: Array<{ currency: string; amount: string }>;
  latest: string | null;
  suggestion: { id: string; name: string } | null;
}

interface UnlinkedResponse {
  groups: UnlinkedGroup[];
  counts: Record<string, number>;
  sources: Record<string, string>;
}

interface MasterChoice {
  id: string;
  name: string;
  legalName?: string | null;
  supplierCode?: string | null;
  customerCode?: string | null;
  tin?: string | null;
}

/**
 * Unmatched parties (party linkage, W7): every row across the OS that still carries only a
 * typed supplier or customer name, grouped by name, with a suggested master when exactly one
 * active master has the same name. Linking changes identity only; amounts, statuses, journals
 * and movements are untouched. Names are never proof of identity: a person confirms each link.
 */
export default function UnmatchedPartiesPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('party_links.view');
  const canLink = canView && hasPermission('party_links.manage');
  const result = useWorkspaceResource<UnlinkedResponse>('/party-links/unlinked', {}, canView);
  const [message, setMessage] = useState('');

  if (!canView)
    return (
      <Card className="p-5">
        <p role="alert" className="workspace-notice">
          Unmatched parties access is required to view this page.
        </p>
      </Card>
    );

  const groups = result.data?.groups ?? [];
  const totalRows = Object.values(result.data?.counts ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Unmatched parties"
        subtitle="Rows that still carry only a typed supplier or customer name. Match each name to its shared profile so balances, statements and Cash Desk know who the money belongs to."
      />
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      {result.error ? (
        <Card className="p-4">
          <p role="alert" className="workspace-notice">
            Could not load unmatched parties: {result.error}
          </p>
          <Btn variant="secondary" size="sm" onClick={result.reload}>
            Try again
          </Btn>
        </Card>
      ) : result.loading && !result.data ? (
        <Card className="p-4">
          <p role="status" className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Loading unmatched parties…
          </p>
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Every supplier and customer name in your scope is matched to a shared profile.
          </p>
        </Card>
      ) : (
        <Card className="space-y-4 p-5">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {totalRows} row{totalRows === 1 ? '' : 's'} in {groups.length} name group
            {groups.length === 1 ? '' : 's'}. Linking never changes amounts; the typed name stays as
            the display snapshot.
          </p>
          <div className="space-y-3">
            {groups.map((group) => (
              <GroupRow
                key={group.key}
                group={group}
                sourceLabel={result.data?.sources[group.source] ?? group.source}
                canLink={canLink}
                onLinked={(partyName) => {
                  setMessage(
                    `${group.rows} ${group.name} row${group.rows === 1 ? '' : 's'} now linked to ${partyName}.`,
                  );
                  result.reload();
                }}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function GroupRow({
  group,
  sourceLabel,
  canLink,
  onLinked,
}: {
  group: UnlinkedGroup;
  sourceLabel: string;
  canLink: boolean;
  onLinked: (partyName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endpoint = group.kind === 'supplier' ? '/suppliers' : '/customers';
  const candidates = useWorkspaceResource<{ data: MasterChoice[] }>(
    endpoint,
    { companyId: group.companyId, search: search.trim(), page: 1, limit: 20 },
    open && canLink && search.trim().length > 0,
  );

  async function linkAll(partyId: string, partyName: string) {
    if (busy || !canLink) return;
    setBusy(true);
    setError('');
    try {
      await backendPatch(`/party-links/${encodeURIComponent(group.source)}/link-many`, {
        rowIds: group.rowIds,
        partyId,
      });
      onLinked(partyName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not link these rows.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium" style={{ color: 'var(--aurora-text)' }}>
            {group.name}
            <span className="ml-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {group.kind === 'supplier' ? 'Supplier' : 'Customer'}
            </span>
          </p>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {sourceLabel} · {group.companyName ?? group.companyId} · {group.rows} row
            {group.rows === 1 ? '' : 's'}
            {group.totals.length
              ? ` · ${group.totals.map((t) => `${t.currency} ${t.amount}`).join(', ')}`
              : ''}
            {group.latest ? ` · latest ${group.latest.slice(0, 10)}` : ''}
          </p>
        </div>
        {canLink && (
          <div className="flex flex-wrap gap-2">
            {group.suggestion && (
              <Btn
                size="sm"
                loading={busy}
                disabled={busy}
                onClick={() => linkAll(group.suggestion!.id, group.suggestion!.name)}
              >
                Link all to {group.suggestion.name}
              </Btn>
            )}
            <Btn variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
              {open ? 'Close' : 'Choose…'}
            </Btn>
          </div>
        )}
      </div>
      {open && canLink && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block">
              Find the shared {group.kind} to link all {group.rows} row{group.rows === 1 ? '' : 's'}{' '}
              to
            </span>
            <input
              className="w-full rounded-md border px-3 py-2"
              style={{
                background: 'var(--aurora-surface)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text)',
              }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${group.kind} name or code`}
            />
          </label>
          {candidates.error && (
            <p role="alert" className="workspace-notice">
              {candidates.error}
            </p>
          )}
          {candidates.loading ? (
            <p role="status" className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Searching…
            </p>
          ) : candidates.data?.data.length ? (
            <div className="space-y-2">
              {candidates.data.data.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <span className="text-sm" style={{ color: 'var(--aurora-text)' }}>
                    {candidate.name}
                    {candidate.legalName && candidate.legalName !== candidate.name
                      ? ` · ${candidate.legalName}`
                      : ''}
                    {(candidate.supplierCode ?? candidate.customerCode)
                      ? ` · ${candidate.supplierCode ?? candidate.customerCode}`
                      : ''}
                    {candidate.tin ? ` · TIN ${candidate.tin}` : ''}
                  </span>
                  <Btn
                    size="xs"
                    loading={busy}
                    disabled={busy}
                    onClick={() => linkAll(candidate.id, candidate.name)}
                  >
                    Link all rows
                  </Btn>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No matching {group.kind} in this company. Create or correct the shared record, then
              search again.
            </p>
          )}
          {error && (
            <p role="alert" className="workspace-notice">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
