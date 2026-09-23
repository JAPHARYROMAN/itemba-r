'use client';
import { FormInput, FormSelect, FormSection, FormTextarea } from '@/components/aurora';
import { Btn, FormDateField } from '@/components/ui';
import { controlOptions, type useControlChoices } from './accounting-control-choices';
import {
  adjustmentTotals,
  assetScheduleDefaults,
  blankAdjustmentLine,
  controlDefinitions,
  depreciationMethods,
  humanLabel,
  lockTypes,
  sourceTypes,
  type ControlKind,
  type ControlValues,
} from './accounting-controls-types';
import { statementAmount } from './reconciliation-types';
import type { Dispatch, SetStateAction } from 'react';

export function ControlFields({
  kind,
  values,
  setValues,
  choices,
}: {
  kind: ControlKind;
  values: ControlValues;
  setValues: Dispatch<SetStateAction<ControlValues>>;
  choices: ReturnType<typeof useControlChoices>;
}) {
  const f = values.fields,
    definition = controlDefinitions[kind];
  const set = (key: string, value: string) =>
    setValues((v) => ({ ...v, fields: { ...v.fields, [key]: value } }));
  const input = (key: string, label: string, required = false, help?: string) => (
    <FormInput
      label={label}
      value={f[key]}
      required={required}
      help={help}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  const amount = (key: string, label: string, help?: string) => (
    <FormInput
      label={label}
      value={f[key]}
      inputMode="decimal"
      help={help}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  const select = (key: string, label: string, options: readonly string[]) => (
    <FormSelect
      label={label}
      value={f[key]}
      options={options.map((value) => ({ value, label: humanLabel(value) }))}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  let totals = '';
  if (kind === 'audit-adjustments') {
    try {
      const sum = adjustmentTotals(values.lines);
      totals = `Debit ${statementAmount(sum.debit)} · Credit ${statementAmount(sum.credit)}${sum.debit === sum.credit ? ' · Balanced' : ' · Out of balance'}`;
    } catch {
      totals = 'Enter valid amounts to compare debits and credits.';
    }
  }
  return (
    <>
      <FormSection title="Reference and company">
        {input(definition.number, 'Reference', true)}
        <FormSelect
          label="Company"
          required
          value={f.companyId}
          disabled={!choices.companyRead}
          placeholder="Choose company"
          options={controlOptions(choices.companies, f.companyId)}
          onChange={(e) =>
            setValues((v) => ({
              ...v,
              fields: {
                ...v.fields,
                companyId: e.target.value,
                fiscalYearId: '',
                accountingPeriodId: '',
                fixedAssetId: '',
              },
              lines: v.lines.map((l) => ({ ...l, accountId: '' })),
            }))
          }
        />
      </FormSection>
      {['period-close', 'accounting-locks', 'audit-adjustments'].includes(kind) && (
        <FormSection
          title="Accounting period"
          description={
            kind === 'period-close'
              ? 'Choose the period to prepare for closure.'
              : 'Optional scope within the selected company.'
          }
        >
          <FormSelect
            label="Fiscal year"
            required={kind === 'period-close'}
            value={f.fiscalYearId}
            placeholder="Choose fiscal year"
            options={controlOptions(choices.years, f.fiscalYearId)}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                fields: { ...v.fields, fiscalYearId: e.target.value, accountingPeriodId: '' },
              }))
            }
          />
          <FormSelect
            label="Accounting period"
            required={kind === 'period-close'}
            value={f.accountingPeriodId}
            placeholder="Choose accounting period"
            options={controlOptions(
              choices.periods.filter((r) => !f.fiscalYearId || r.fiscalYearId === f.fiscalYearId),
              f.accountingPeriodId,
            )}
            onChange={(e) => set('accountingPeriodId', e.target.value)}
          />
        </FormSection>
      )}
      {kind === 'posting-runs' && (
        <>
          <p className="workspace-notice">
            This creates a draft tracking record. Journals are posted through their source workflow.
          </p>
          <FormSection title="Source and totals">
            {select('sourceType', 'Source type', sourceTypes)}
            {input('sourceId', 'Source reference', true)}
            {input(
              'postingRuleId',
              'Posting rule ID',
              false,
              'Optional reference to an existing posting rule.',
            )}
            <FormInput
              label="Currency"
              value={f.currency}
              maxLength={3}
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
            />
            {amount('totalDebit', 'Total debit')}
            {amount('totalCredit', 'Total credit')}
          </FormSection>
          <FormTextarea
            label="Error details"
            value={f.errorMessage}
            onChange={(e) => set('errorMessage', e.target.value)}
          />
        </>
      )}
      {kind === 'period-close' && (
        <FormTextarea
          label="Review notes"
          value={f.reviewNotes}
          onChange={(e) => set('reviewNotes', e.target.value)}
        />
      )}
      {kind === 'accounting-locks' && (
        <>
          <FormSection title="Lock scope">
            {select('lockType', 'Lock type', lockTypes)}
            {input(
              'moduleName',
              'Module name',
              f.lockType === 'MODULE_LOCK',
              'Use the module name recorded on its journal entries.',
            )}
            <FormDateField
              label="Locked from"
              value={f.lockedFrom}
              onChange={(value) => set('lockedFrom', value)}
            />
            <FormDateField
              label="Locked to"
              value={f.lockedTo}
              onChange={(value) => set('lockedTo', value)}
            />
          </FormSection>
          <p className="workspace-notice">
            The lock becomes active immediately. Leaving a period, module or date boundary blank
            broadens the lock’s scope within this company.
          </p>
          <FormTextarea
            label="Reason"
            value={f.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
        </>
      )}
      {kind === 'audit-adjustments' && (
        <>
          {input('description', 'Description', true)}
          <FormTextarea
            label="Reason"
            required
            value={f.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
          <section className="accounting-control-lines" aria-label="Adjustment lines">
            <h3>Adjustment lines</h3>
            <p role="status">{totals}</p>
            {values.lines.map((line, index) => {
              const update = (key: keyof typeof line, value: string) =>
                setValues((v) => ({
                  ...v,
                  lines: v.lines.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
                }));
              return (
                <div key={index} className="accounting-control-line">
                  <strong>Line {index + 1}</strong>
                  <div className="accounting-control-line-fields">
                    <FormSelect
                      label={`Account ${index + 1}`}
                      required
                      placeholder="Choose account"
                      value={line.accountId}
                      options={controlOptions(choices.accounts, line.accountId)}
                      onChange={(e) => update('accountId', e.target.value)}
                    />
                    <FormInput
                      label={`Description ${index + 1}`}
                      value={line.description}
                      onChange={(e) => update('description', e.target.value)}
                    />
                    <FormInput
                      label={`Debit ${index + 1}`}
                      inputMode="decimal"
                      value={line.debit}
                      onChange={(e) => update('debit', e.target.value)}
                    />
                    <FormInput
                      label={`Credit ${index + 1}`}
                      inputMode="decimal"
                      value={line.credit}
                      onChange={(e) => update('credit', e.target.value)}
                    />
                  </div>
                  <Btn
                    type="button"
                    variant="ghost"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={values.lines.length <= 2}
                    onClick={() =>
                      setValues((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))
                    }
                  >
                    Remove line
                  </Btn>
                </div>
              );
            })}
            <Btn
              type="button"
              variant="secondary"
              onClick={() =>
                setValues((v) => ({ ...v, lines: [...v.lines, blankAdjustmentLine()] }))
              }
            >
              Add line
            </Btn>
          </section>
        </>
      )}
      {kind === 'depreciation' && (
        <>
          <FormSection title="Asset and method">
            <FormSelect
              label="Fixed asset"
              required
              value={f.fixedAssetId}
              placeholder="Choose asset"
              options={controlOptions(choices.assets, f.fixedAssetId)}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  fields: {
                    ...v.fields,
                    ...assetScheduleDefaults(choices.assets.find((r) => r.id === e.target.value)),
                    fixedAssetId: e.target.value,
                  },
                }))
              }
            />
            {select('depreciationMethod', 'Depreciation method', depreciationMethods)}
            <FormDateField
              label="Start date"
              required
              value={f.startDate}
              onChange={(value) => set('startDate', value)}
            />
            <FormDateField
              label="End date"
              value={f.endDate}
              onChange={(value) => set('endDate', value)}
            />
            {input('usefulLifeMonths', 'Useful life in months')}
            {amount('depreciationRate', 'Annual rate', 'Use 0.25 for 25%.')}
          </FormSection>
          <FormSection
            title="Schedule amounts"
            description="Review these amounts against the asset record and opening position."
          >
            {amount('totalDepreciableAmount', 'Depreciable amount')}
            {amount('salvageValue', 'Salvage value')}
            {amount('accumulatedDepreciation', 'Accumulated depreciation')}
            {select('status', 'Schedule status', controlDefinitions.depreciation.statuses)}
          </FormSection>
          {choices.assets.find((r) => r.id === f.fixedAssetId) && (
            <p className="workspace-notice">
              Asset acquisition cost:{' '}
              {choices.assets.find((r) => r.id === f.fixedAssetId)?.acquisitionCost ??
                'Unavailable'}{' '}
              · Residual value:{' '}
              {choices.assets.find((r) => r.id === f.fixedAssetId)?.residualValue ?? 'Unavailable'}
            </p>
          )}
        </>
      )}
    </>
  );
}
