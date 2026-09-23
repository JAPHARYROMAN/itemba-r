'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn, FormDateField, FormSelect, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPage, backendPatch } from '@/lib/api-client';
import { localToday } from '@/features/invoice-desk/types';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import {
  PayrollAction,
  PayrollRunRecord,
  payrollActionLabels,
  payrollActions,
  payrollActionAllowed,
  payrollRunSourceKey,
  payrollMoney,
  periodName,
  runName,
} from '@/components/workspace/payroll-types';
interface CashAccountChoice {
  id: string;
  name: string;
  currency: string;
  balance: string;
  erpCashAccountId?: string | null;
}
const descriptions: Record<PayrollAction, string> = {
  calculate:
    'Calculate the employee entries for this run. Recalculating replaces its current calculated entries.',
  submit: 'Submit the calculated entries for HR and Finance sign-off.',
  'approve-hr':
    'Record HR sign-off. HR and Finance must be signed by different people. The second sign-off approves the run and prepares its accrual for independent Accounting review.',
  'approve-finance':
    'Record Finance sign-off. HR and Finance must be signed by different people. The second sign-off approves the run and prepares its accrual for independent Accounting review.',
  approve: 'Approve this run after both sign-offs and prepare its accrual for Accounting review.',
  cancel:
    'Cancel this unpaid run. Any posted payroll accrual is reversed by the existing payroll process.',
  pay: 'Record the completed bank or cash payment. This reduces the selected Cash Desk account and posts the payment journal together. Accounting must first review and post the payroll accrual. Recording a payment does not send money to a bank or mobile-money provider.',
  'reverse-payment':
    'Reverse an incorrectly recorded or returned payment. This restores cash, reopens payroll for a corrected payment and reverses the journal, advance recoveries and commission settlement. Use the date the funds were returned; this does not request a bank refund.',
};
export function PayrollActionDialog({
  run,
  action,
  source,
  onClose,
  onSaved,
}: {
  run: PayrollRunRecord;
  action: PayrollAction;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const financial = action === 'pay' || action === 'reverse-payment';
  const stateKey = payrollRunSourceKey(run);
  const movementId = source?.context.movementId ?? run.cashMovements?.[0]?.id ?? '';
  const draft = useWorkspaceDraftForm(
    () => ({ reason: '', accountId: '', businessDate: localToday() }),
    {
      appId: 'payroll',
      title: payrollActionLabels[action],
      describe: () => runName(run),
      context: (values) => ({
        kind: 'payroll-action',
        recordId: run.id,
        action,
        version: run.updatedAt || '',
        stateKey,
        companyId: run.companyId || '',
        movementId,
        accountId: values.accountId,
        businessDate: values.businessDate,
        reason: values.reason.trim(),
      }),
      draftId: source?.id,
      busy,
      onClose,
      needsReview: !!source && (!run.updatedAt || source.context.stateKey !== stateKey),
      reviewKey: stateKey,
    },
  );
  const values = draft.form;
  const attempted = financial && !!draft.requestId.current;
  const setValues = (change: (previous: typeof values) => typeof values) => {
    if (!financial || !draft.requestId.current) draft.setForm(change);
  };
  const permission = hasPermission('payroll.view') && payrollActionAllowed(action, hasPermission);
  const originalCompany = draft.requestContext.current?.companyId;
  const stateAvailable = payrollActions(run, hasPermission).includes(action);
  const reversalTargetChanged =
    action === 'reverse-payment' &&
    !attempted &&
    !run.cashMovements?.some((m) => m.id === movementId);
  const unavailable =
    (!stateAvailable && !attempted) ||
    reversalTargetChanged ||
    (!!originalCompany && originalCompany !== run.companyId);
  const canChoose = hasPermission('cash_desk.view');
  const [accountState, setAccountState] = useState<{
    rows: CashAccountChoice[];
    loading: boolean;
    error: string;
  }>({ rows: [], loading: true, error: '' });
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    if (action !== 'pay' || !canChoose || !run.companyId) return;
    const controller = new AbortController();
    setAccountState({ rows: [], loading: true, error: '' });
    backendPage<CashAccountChoice>('/cash-desk/accounts', {
      query: { companyId: run.companyId },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setAccountState({ rows: result.data, loading: false, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setAccountState({
            rows: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Unable to load accounts.',
          });
      });
    return () => controller.abort();
  }, [action, canChoose, run.companyId, accountRevision]);
  const accounts = { ...accountState, retry: () => setAccountRevision((v) => v + 1) };
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const submit = async () => {
    if (pending.current || !permission || unavailable || draft.availabilityError) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (financial && (!values.businessDate || values.businessDate > localToday()))
        throw new Error('Choose a payment or reversal date no later than today.');
      if (
        action === 'pay' &&
        !attempted &&
        (accounts.loading ||
          accounts.error ||
          !accounts.rows.some((a) => a.id === values.accountId && a.erpCashAccountId))
      )
        throw new Error('Choose an available connected cash or bank account.');
      if (action === 'reverse-payment' && (!movementId || values.reason.trim().length < 3))
        throw new Error('Enter a reason for reversing this payment.');
      if (financial) await draft.beginRequest();
      const original = draft.requestContext.current;
      setBusy(true);
      const result = await backendPatch<PayrollRunRecord>(
        '/hr/payroll-runs/' + run.id + '/' + action,
        action === 'reverse-payment'
          ? {
              movementId: original?.movementId || movementId,
              businessDate: original?.businessDate || values.businessDate,
              reason: original?.reason ?? values.reason.trim(),
            }
          : action === 'cancel'
            ? { reason: values.reason.trim() || undefined }
            : action === 'pay'
              ? {
                  cashDeskAccountId: original?.accountId || values.accountId,
                  businessDate: original?.businessDate || values.businessDate,
                  requestId: draft.requestId.current,
                }
              : undefined,
      );
      draft.markSaved();
      onSaved(
        result?.status === 'SUBMITTED' && ['approve-hr', 'approve-finance'].includes(action)
          ? 'Sign-off recorded. The other approval is still required.'
          : action === 'pay'
            ? 'Payment recorded in Payroll, Cash Desk and Accounting.'
            : action === 'reverse-payment'
              ? 'Payment reversed. Payroll is ready for a corrected payment.'
              : action === 'cancel'
                ? 'Payroll run cancelled.'
                : action === 'calculate'
                  ? 'Payroll calculated. Review the entries before submitting.'
                  : action === 'submit'
                    ? 'Payroll run submitted.'
                    : 'Payroll approval recorded.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the payroll run.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={payrollActionLabels[action] + ' · ' + runName(run)}
      onClose={close}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Back
          </Btn>
          {['cancel', 'pay', 'reverse-payment'].includes(action) && draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            variant={['cancel', 'reverse-payment'].includes(action) ? 'danger' : 'primary'}
            loading={busy}
            onClick={submit}
            disabled={
              !permission ||
              unavailable ||
              !!draft.availabilityError ||
              (action === 'pay' &&
                !attempted &&
                (accounts.loading ||
                  !accounts.rows.some((a) => a.id === values.accountId && a.erpCashAccountId) ||
                  !!accounts.error ||
                  !values.businessDate)) ||
              (action === 'reverse-payment' &&
                (!values.businessDate || values.reason.trim().length < 3))
            }
          >
            {payrollActionLabels[action]}
          </Btn>
        </>
      }
    >
      <div className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot perform this payroll action.
          </p>
        )}
        {unavailable && (
          <p role="alert" className="workspace-notice">
            This action is no longer available for the current run or original payment. Keep your
            notes and review the run before starting a new action.
          </p>
        )}
        {attempted && (
          <p className="workspace-notice">
            This payment action has already been attempted. Retrying keeps its original account,
            date and payment reference. Review the current run before starting a different payment.
          </p>
        )}
        <div className="workspace-notice">
          <p>Current status: {run.status.toLowerCase().replaceAll('_', ' ')}</p>
          <strong>{run.company?.name || 'Company'}</strong>
          <p>
            {periodName(run)} · Net {payrollMoney(run.totalNetPay ?? run.totalNet)}
          </p>
        </div>
        <p>{descriptions[action]}</p>
        {['cancel', 'reverse-payment'].includes(action) && (
          <label className="block text-sm">
            {action === 'cancel' ? 'Reason (optional)' : 'Reason for reversal'}
            <textarea
              className="aurora-input mt-2 w-full rounded-lg p-3"
              rows={3}
              value={values.reason}
              maxLength={500}
              disabled={busy || attempted || !permission}
              onChange={(e) => setValues((p) => ({ ...p, reason: e.target.value }))}
            />
          </label>
        )}
        {['pay', 'reverse-payment'].includes(action) && (
          <FormDateField
            label={action === 'pay' ? 'Payment date' : 'Reversal date'}
            max={localToday()}
            value={values.businessDate}
            disabled={busy || attempted || !permission}
            onChange={(value) => setValues((p) => ({ ...p, businessDate: value }))}
          />
        )}
        {action === 'pay' && (
          <>
            <FormSelect
              label="Cash Desk account"
              value={values.accountId}
              disabled={busy || attempted || !permission || accounts.loading}
              onChange={(e) => setValues((p) => ({ ...p, accountId: e.target.value }))}
              options={[
                { value: '', label: 'Choose a connected cash or bank account' },
                ...accounts.rows
                  .filter((a) => a.erpCashAccountId)
                  .map((a) => ({
                    value: a.id,
                    label: `${a.name} · ${a.currency} ${Number(a.balance).toLocaleString('en-GB')}`,
                  })),
              ]}
            />
            {attempted &&
              !accounts.loading &&
              !accounts.rows.some((a) => a.id === values.accountId) && (
                <p className="workspace-notice">
                  The previously selected account is no longer in the current choices. A retry still
                  refers to the original account.
                </p>
              )}
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              The selected account must cover net pay on the payment date. Connect accounts in
              Reports → Accounting → Account connections.
            </p>
            {!canChoose && <p role="alert">Cash Desk access is required to record this payment.</p>}
            {accounts.loading && <p role="status">Loading company cash accounts…</p>}
            {accounts.error && (
              <div role="alert" className="workspace-notice">
                {accounts.error}{' '}
                <Btn variant="ghost" onClick={accounts.retry}>
                  Retry accounts
                </Btn>
              </div>
            )}
            {!accounts.loading &&
              !accounts.error &&
              !accounts.rows.some((a) => a.erpCashAccountId) && (
                <p role="status">No connected Cash Desk accounts are available for this company.</p>
              )}
          </>
        )}
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
