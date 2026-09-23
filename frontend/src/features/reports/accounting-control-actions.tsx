'use client';
import { useCallback } from 'react';
import { FormInput, FormTextarea } from '@/components/aurora';
import { FormDateField, StatusBadge } from '@/components/ui';
import type { WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { localToday } from '@/features/invoice-desk/types';
import {
  AccountingAcknowledgement,
  AccountingReviewShell,
  useAccountingReview,
} from './accounting-review-form';
import {
  choiceLabel,
  controlActions,
  controlAmount,
  controlDefinitions,
  dateRange,
  recordLabel,
  wholeNumber,
  type ControlTarget,
} from './accounting-controls-types';
import { statementUnits } from './reconciliation-types';
import { useControlChoices } from './accounting-control-choices';
import { ControlCreate } from './accounting-control-create';
import { ControlFacts } from './accounting-control-detail';
import './accounting-controls.css';

import { readControl, type ControlReview } from './accounting-control-read';
type Props = {
  target: ControlTarget;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
};
export function ControlEditor(props: Props) {
  return props.target.kind === 'control-create' ? (
    <ControlCreate {...props} target={props.target} />
  ) : (
    <ControlActionEditor {...props} target={props.target} />
  );
}
function ControlActionEditor({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<ControlTarget, { kind: 'control-action' }> }) {
  const { hasPermission } = useAuth(),
    kind = target.control,
    definition = controlDefinitions[kind];
  const action = controlActions[kind].find((a) => a.id === target.action);
  const read = useCallback(
    (signal: AbortSignal) => readControl(kind, target.id, signal),
    [kind, target.id],
  );
  const form = useAccountingReview<
    ControlReview,
    {
      reason: string;
      months: string;
      depreciationDate: string;
      amount: string;
      accumulatedDepreciationAfter: string;
    }
  >({
    path: `/${kind}/${encodeURIComponent(target.id)}`,
    read,
    readAllowed: hasPermission(`${definition.permission}.view`),
    writeAllowed: !!action && hasPermission(action.permission),
    initial: {
      reason: '',
      months: '12',
      depreciationDate: localToday(),
      amount: '',
      accumulatedDepreciationAfter: '',
    },
    title: action?.label || 'Accounting review',
    summary: (data) => (data ? recordLabel(kind, data.record) : ''),
    context: {
      kind: target.kind,
      control: kind,
      recordId: target.id,
      action: target.action,
      entryId: target.entryId || '',
    },
    version: (value) => JSON.stringify(value),
    source,
    close,
    done,
  });
  const data = form.data,
    values = form.draft.form;
  const choices = useControlChoices(kind, data?.record.companyId || '', form.readAllowed && !!data);
  const entry = data?.entries.find((r) => r.id === target.entryId);
  const eligible =
    !!action &&
    !!data &&
    action.statuses.includes(data.record.status) &&
    (target.action !== 'post-entry' || entry?.status === 'DRAFT') &&
    (target.action !== 'generate' ||
      ['STRAIGHT_LINE', 'REDUCING_BALANCE'].includes(data.record.depreciationMethod || ''));
  const set = (key: keyof typeof values, value: string) =>
    form.draft.setForm((v) => ({ ...v, [key]: value }));
  const validate = (latest: ControlReview) => {
    if (!action || !action.statuses.includes(latest.record.status))
      throw new Error('This action is no longer available for the current status.');
    if (kind === 'audit-adjustments' && target.action === 'reverse' && !values.reason.trim())
      throw new Error('Enter a reason for the reversal.');
    if (kind !== 'depreciation') return;
    if (
      target.action === 'post-entry' &&
      latest.entries.find((r) => r.id === target.entryId)?.status !== 'DRAFT'
    )
      throw new Error('This entry is no longer available to post.');
    if (target.action === 'generate') {
      wholeNumber(values.months, 'Months to generate', 600);
      if (!['STRAIGHT_LINE', 'REDUCING_BALANCE'].includes(latest.record.depreciationMethod || ''))
        throw new Error('This schedule requires manual entries.');
    }
    if (target.action === 'entries') {
      dateRange(values.depreciationDate, '', true);
      if (
        values.depreciationDate < (latest.record.startDate || '').slice(0, 10) ||
        (latest.record.endDate && values.depreciationDate > latest.record.endDate.slice(0, 10))
      )
        throw new Error('Choose a date within this schedule.');
      if (latest.entries.some((r) => r.depreciationDate.slice(0, 10) === values.depreciationDate))
        throw new Error(
          'An entry already exists on this date. Review the schedule before adding another.',
        );
      controlAmount(values.amount, 'Entry amount', true);
      controlAmount(values.accumulatedDepreciationAfter, 'Accumulated depreciation after');
      const after = statementUnits(values.accumulatedDepreciationAfter),
        amount = statementUnits(values.amount);
      const prior =
        statementUnits(String(latest.record.accumulatedDepreciation || '0')) +
        latest.entries
          .filter((r) => r.status === 'DRAFT')
          .reduce((sum, r) => sum + statementUnits(String(r.amount)), 0n);
      if (after !== prior + amount)
        throw new Error(
          'The accumulated total must equal posted depreciation plus existing draft entries and this amount.',
        );
      if (after > statementUnits(String(latest.record.totalDepreciableAmount || '0')))
        throw new Error('This entry would exceed the schedule’s depreciable amount.');
    }
  };
  return (
    <AccountingReviewShell
      form={form}
      title={action?.label || 'Accounting review'}
      subtitle={data ? recordLabel(kind, data.record) : source?.summary}
      action={action?.label}
      disabled={!eligible}
      onSubmit={() =>
        void form.submit(validate, async (latest) => {
          const base = `/${kind}/${encodeURIComponent(target.id)}`;
          if (kind === 'depreciation' && target.action === 'post-entry')
            await backendPost(`/depreciation/entries/${encodeURIComponent(target.entryId!)}/post`);
          else if (kind === 'depreciation' && target.action === 'generate') {
            const result = await backendPost<{ created: number }>(`${base}/generate`, {
              months: Number(values.months),
            });
            return `Prepared ${result.created} draft depreciation entries.`;
          } else if (kind === 'depreciation' && target.action === 'entries')
            await backendPost(`${base}/entries`, {
              companyId: latest.record.companyId,
              fixedAssetId: latest.record.fixedAssetId,
              depreciationDate: `${values.depreciationDate}T00:00:00.000Z`,
              amount: controlAmount(values.amount, 'Entry amount', true),
              accumulatedDepreciationAfter: controlAmount(
                values.accumulatedDepreciationAfter,
                'Accumulated depreciation after',
              ),
            });
          else
            await backendPost(
              `${base}/${target.action}`,
              kind === 'audit-adjustments' && target.action === 'reverse'
                ? { reason: values.reason.trim() }
                : undefined,
            );
          return `${action?.label} completed for ${recordLabel(kind, latest.record)}.`;
        })
      }
    >
      {data && (
        <div className="accounting-control-editor">
          <StatusBadge status={data.record.status} />
          <p className="workspace-notice">{action?.effect}</p>
          <ControlFacts
            kind={kind}
            row={data.record}
            names={[...choices.companies, ...choices.years, ...choices.periods, ...choices.assets]}
          />
          {kind === 'audit-adjustments' && data.record.lines?.length ? (
            <div className="accounting-control-lines">
              {data.record.lines.map((line, i) => (
                <div className="accounting-control-line" key={line.id || i}>
                  <strong>
                    Line {i + 1} ·{' '}
                    {choices.accounts.find((account) => account.id === line.accountId)
                      ? choiceLabel(
                          choices.accounts.find((account) => account.id === line.accountId)!,
                        )
                      : line.accountId}
                  </strong>
                  <p>
                    {line.description || 'Adjustment line'} · Debit {line.debit} · Credit{' '}
                    {line.credit}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <fieldset disabled={form.busy || !form.writeAllowed}>
            {kind === 'audit-adjustments' && target.action === 'reverse' && (
              <FormTextarea
                label="Reason for reversal"
                required
                value={values.reason}
                onChange={(e) => set('reason', e.target.value)}
              />
            )}
            {target.action === 'generate' && (
              <>
                <p>
                  {data.entries.length} existing entries. This adds up to the requested number of
                  further months, within the remaining depreciable amount.
                </p>
                <FormInput
                  label="Months to generate"
                  inputMode="numeric"
                  value={values.months}
                  onChange={(e) => set('months', e.target.value)}
                />
              </>
            )}
            {target.action === 'entries' && (
              <>
                <p>
                  Posted depreciation: {data.record.accumulatedDepreciation} · Existing draft
                  entries: {data.entries.filter((r) => r.status === 'DRAFT').length}
                </p>
                <FormDateField
                  label="Depreciation date"
                  required
                  value={values.depreciationDate}
                  onChange={(value) => set('depreciationDate', value)}
                />
                <FormInput
                  label="Entry amount"
                  required
                  inputMode="decimal"
                  value={values.amount}
                  onChange={(e) => set('amount', e.target.value)}
                />
                <FormInput
                  label="Accumulated depreciation after"
                  required
                  inputMode="decimal"
                  value={values.accumulatedDepreciationAfter}
                  onChange={(e) => set('accumulatedDepreciationAfter', e.target.value)}
                />
              </>
            )}
            {target.action === 'post-entry' && entry && (
              <p className="workspace-notice">
                Entry date: {entry.depreciationDate.slice(0, 10)} · Amount: {entry.amount} · Status:{' '}
                {entry.status}
              </p>
            )}
            <AccountingAcknowledgement
              label="I have reviewed the current record and the effect of this action."
              checked={form.ack}
              disabled={form.busy || !eligible}
              onChange={form.setAck}
            />
          </fieldset>
          {!eligible && (
            <p role="alert" className="workspace-notice">
              This action is unavailable for the current record. Review its latest status before
              continuing.
            </p>
          )}
          {!form.writeAllowed && (
            <p role="alert">Your role can review this record but cannot perform this action.</p>
          )}
        </div>
      )}
    </AccountingReviewShell>
  );
}
