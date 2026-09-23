'use client';
import { useCallback, useState } from 'react';
import { Btn, PageSpinner, StatusBadge } from '@/components/ui';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { statementUnits, statementAmount } from './reconciliation-types';
const money = (value: string, currency: string) => {
  try {
    return `${currency} ${statementAmount(statementUnits(value))}`;
  } catch {
    return `${currency} ${value}`;
  }
};
import { useAccountingEditor, useAccountingRefresh } from './accounting-drafts';
import { useControlChoices } from './accounting-control-choices';
import {
  controlActions,
  controlDefinitions,
  choiceLabel,
  humanLabel,
  recordLabel,
  type ControlChoice,
  type ControlKind,
  type ControlRecord,
} from './accounting-controls-types';
import { readControl } from './accounting-control-read';

export function ControlFacts({
  kind,
  row,
  names = [],
}: {
  kind: ControlKind;
  row: ControlRecord;
  names?: ControlChoice[];
}) {
  const name = (id?: string) =>
    id ? (names.find((r) => r.id === id) ? choiceLabel(names.find((r) => r.id === id)!) : id) : '—';
  const facts: [string, string | number | undefined][] = [['Company', name(row.companyId)]];
  if (kind === 'posting-runs')
    facts.push(
      ['Source', humanLabel(row.sourceType)],
      ['Source reference', row.sourceId],
      ['Debit', money(String(row.totalDebit || '0'), row.currency || 'TZS')],
      ['Credit', money(String(row.totalCredit || '0'), row.currency || 'TZS')],
      ['Posting rule', row.postingRuleId],
    );
  if (kind === 'period-close' || kind === 'audit-adjustments' || kind === 'accounting-locks')
    facts.push(
      ['Fiscal year', name(row.fiscalYearId)],
      ['Accounting period', name(row.accountingPeriodId)],
    );
  if (kind === 'accounting-locks')
    facts.push(
      ['Lock type', humanLabel(row.lockType)],
      ['Module', row.moduleName || 'All modules'],
      ['Locked from', row.lockedFrom?.slice(0, 10) || 'No start boundary'],
      ['Locked to', row.lockedTo?.slice(0, 10) || 'No end boundary'],
    );
  if (kind === 'depreciation')
    facts.push(
      ['Asset', name(row.fixedAssetId)],
      ['Method', humanLabel(row.depreciationMethod)],
      ['Start', row.startDate?.slice(0, 10)],
      ['End', row.endDate?.slice(0, 10)],
      ['Useful life (months)', row.usefulLifeMonths],
      ['Annual rate', row.depreciationRate],
      ['Depreciable amount', row.totalDepreciableAmount],
      ['Accumulated depreciation', row.accumulatedDepreciation],
      ['Salvage value', row.salvageValue],
    );
  if (row.journalEntryId) facts.push(['Journal entry', row.journalEntryId]);
  if (row.reversalJournalEntryId) facts.push(['Reversal journal', row.reversalJournalEntryId]);
  for (const [label, value] of [
    ['Created', row.createdAt],
    ['Posted', row.postedAt],
    ['Reversed', row.reversedAt],
    ['Closed', row.closedAt],
    ['Reopened', row.reopenedAt],
    ['Released', row.releasedAt],
  ] as const)
    if (value) facts.push([label, value.slice(0, 10)]);
  return (
    <dl className="accounting-control-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ControlDetail({
  kind,
  id,
  companyId,
}: {
  kind: ControlKind;
  id: string;
  companyId: string;
}) {
  const { hasPermission } = useAuth(),
    definition = controlDefinitions[kind],
    open = useAccountingEditor();
  const permitted = hasPermission(`${definition.permission}.view`);
  const read = useCallback((signal: AbortSignal) => readControl(kind, id, signal), [kind, id]);
  const resource = useWorkspaceResource(`/${kind}/${encodeURIComponent(id)}`, {}, permitted, read);
  useAccountingRefresh(resource.reload);
  const row = resource.data?.record;
  const choices = useControlChoices(kind, row?.companyId || '', permitted && !!row);
  const [entryPage, setEntryPage] = useState(1);
  if (resource.loading) return <PageSpinner label="Loading current record" />;
  if (!permitted)
    return (
      <p role="alert" className="workspace-notice">
        Your role cannot view this record.
      </p>
    );
  if (resource.error || !row)
    return (
      <div role="alert" className="workspace-notice">
        <p>{resource.error || 'This record is unavailable.'}</p>
        <Btn variant="secondary" onClick={resource.reload}>
          Retry details
        </Btn>
      </div>
    );
  if (companyId && row.companyId !== companyId)
    return (
      <p role="alert" className="workspace-notice">
        This record is outside the selected company. Refresh the register.
      </p>
    );
  const entries = resource.data?.entries || [],
    pages = Math.max(1, Math.ceil(entries.length / 25)),
    page = Math.min(entryPage, pages);
  const names = [...choices.companies, ...choices.years, ...choices.periods, ...choices.assets];
  return (
    <div className="accounting-control-detail">
      <header>
        <div>
          <h2>{recordLabel(kind, row)}</h2>
          <p>{row.description || definition.singular}</p>
        </div>
        <StatusBadge status={row.status} />
      </header>
      {kind === 'posting-runs' && (
        <p className="workspace-notice">
          Run status tracks the posting attempt. Changing it here does not create or reverse
          journals.
        </p>
      )}
      {kind === 'period-close' && (
        <p className="workspace-notice">
          Closure checks outstanding draft journals when you confirm. Review reconciliations,
          adjustments and reports before closing.
        </p>
      )}
      <ControlFacts kind={kind} row={row} names={names} />
      {!!choices.errors.length && (
        <div role="alert" className="workspace-notice">
          <p>Some reference names are unavailable. Record IDs are shown instead.</p>
          <Btn variant="secondary" onClick={choices.retry}>
            Retry reference names
          </Btn>
        </div>
      )}
      {row.reviewNotes && (
        <section>
          <h3>Review notes</h3>
          <p>{row.reviewNotes}</p>
        </section>
      )}
      {row.reason && (
        <section>
          <h3>Reason</h3>
          <p>{row.reason}</p>
        </section>
      )}
      {row.errorMessage && (
        <p role="alert" className="workspace-notice">
          {row.errorMessage}
        </p>
      )}
      {row.lines?.length ? (
        <section className="accounting-control-lines" aria-label="Adjustment lines">
          <h3>Adjustment lines</h3>
          {row.lines.map((line, i) => (
            <div className="accounting-control-line" key={line.id || i}>
              <strong>
                {choices.accounts.find((a) => a.id === line.accountId)
                  ? choiceLabel(choices.accounts.find((a) => a.id === line.accountId)!)
                  : line.accountId}
              </strong>
              <p>
                {line.description || `Line ${i + 1}`}
                <br />
                Debit {line.debit} · Credit {line.credit}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      <div className="accounting-control-actions">
        {controlActions[kind]
          .filter(
            (a) =>
              a.id !== 'post-entry' &&
              hasPermission(a.permission) &&
              a.statuses.includes(row.status) &&
              (a.id !== 'generate' ||
                ['STRAIGHT_LINE', 'REDUCING_BALANCE'].includes(row.depreciationMethod || '')),
          )
          .map((action) => (
            <Btn
              key={action.id}
              variant="secondary"
              onClick={() => open({ kind: 'control-action', control: kind, id, action: action.id })}
            >
              {action.label}
            </Btn>
          ))}
        <Btn variant="ghost" onClick={resource.reload}>
          Refresh details
        </Btn>
      </div>
      {kind === 'depreciation' && (
        <section>
          <h3>Schedule entries</h3>
          <WorkspaceTable label="Depreciation entries">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Accumulated after</th>
                <th>Status</th>
                <th>Journal / action</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice((page - 1) * 25, page * 25).map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.depreciationDate.slice(0, 10)}</td>
                  <td>{entry.amount}</td>
                  <td>{entry.accumulatedDepreciationAfter}</td>
                  <td>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td>
                    {entry.journalEntryId || '—'}
                    {entry.status === 'DRAFT' &&
                      controlActions.depreciation
                        .find((a) => a.id === 'post-entry')!
                        .statuses.includes(row.status) &&
                      hasPermission('depreciation.post_entry') && (
                        <Btn
                          variant="ghost"
                          aria-label={`Post entry ${entry.depreciationDate.slice(0, 10)}`}
                          onClick={() =>
                            open({
                              kind: 'control-action',
                              control: kind,
                              id,
                              action: 'post-entry',
                              entryId: entry.id,
                            })
                          }
                        >
                          Review posting
                        </Btn>
                      )}
                  </td>
                </tr>
              ))}
              {!entries.length && (
                <tr>
                  <td colSpan={5}>No entries yet. Generate a schedule or add a manual entry.</td>
                </tr>
              )}
            </tbody>
          </WorkspaceTable>
          <nav className="accounting-control-pagination" aria-label="Entry pages">
            <Btn variant="secondary" disabled={page === 1} onClick={() => setEntryPage(page - 1)}>
              Previous entries
            </Btn>
            <span>
              {entries.length} entries · Page {page} of {pages}
            </span>
            <Btn
              variant="secondary"
              disabled={page === pages}
              onClick={() => setEntryPage(page + 1)}
            >
              Next entries
            </Btn>
          </nav>
        </section>
      )}
      {(row.journalEntryId || row.reversalJournalEntryId) &&
        hasPermission('journal_entries.view') && (
          <WorkspaceLink href="/finance/journal-entries">Open journal entries →</WorkspaceLink>
        )}
    </div>
  );
}
