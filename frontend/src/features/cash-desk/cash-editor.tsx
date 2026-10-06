'use client';
import { useDeferredValue, useId, useRef, useState } from 'react';
import {
  Btn,
  CustomerPicker,
  FormDateField,
  FormInput,
  FormSelect,
  SelectField,
  FormTextarea,
  Modal,
  SupplierPicker,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { DraftFormNotice, useWorkspaceDraftForm } from '@/components/workspace/workspace-drafts';
import { useLoanOptions, LoanLedgerChoice } from '@/features/loans/loan-finance';
import { backendPost } from '@/lib/api-client';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import {
  Account,
  Directory,
  Editor,
  Scope,
  localToday,
  money,
  movementLabels,
  expenseCategories,
  exactAmount,
  purchaseSnapshot,
  PurchaseOptions,
  PurchaseOption,
} from './types';

export function CashEditor({
  editor,
  accounts,
  directory,
  scope,
  onClose,
  onSaved,
}: {
  editor: Editor;
  accounts: Account[];
  directory: Directory;
  scope: Scope;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { hasPermission } = useAuth();
  const draft = useWorkspaceDraftForm(
    {
      ...scope,
      name: '',
      accountKind: 'CASH',
      currency: 'TZS',
      openingBalance: '0',
      kind: editor.loan
        ? 'LOAN_REPAYMENT'
        : editor.invoice
          ? 'SUPPLIER_PAYMENT'
          : editor.movementKind || 'DAILY_SALES',
      accountId: editor.loan?.borrower.id || '',
      targetAccountId: editor.loan?.lender.id || '',
      amount: editor.invoice?.outstanding || editor.loan?.outstanding || '',
      businessDate: localToday(),
      dueDate: '',
      description: editor.invoice
        ? `Payment · ${editor.invoice.invoiceNumber}`
        : editor.loan
          ? `Repayment · ${editor.loan.description}`
          : '',
      reference: '',
      expenseCategory: '',
      payee: '',
      expenseNotes: '',
      supplierId: '',
      purchaseSource: '',
      purchaseId: '',
      purchaseVersion: '',
      purchaseSnapshot: '',
      purchaseNumber: '',
      customerId: '',
      reason: '',
      principal: '',
      interest: '0',
      fees: '0',
      receivableAccountId: '',
      payableAccountId: '',
      interestIncomeAccountId: '',
      interestExpenseAccountId: '',
      feeIncomeAccountId: '',
      feeExpenseAccountId: '',
    },
    {
      appId: 'cash-desk',
      title:
        editor.kind === 'account'
          ? 'New cash account'
          : editor.kind === 'reverse'
            ? 'Reverse movement'
            : 'Cash movement',
      describe: (values) => values.description || values.name,
      context: (values) => ({
        kind: editor.kind,
        movementKind: values.kind,
        invoiceId:
          editor.invoice?.id ?? (values.purchaseSource === 'INVOICE_DESK' ? values.purchaseId : ''),
        version: editor.invoice ? String(editor.invoice.version) : (values.purchaseVersion ?? ''),
        payableId: values.purchaseSource === 'PAYABLE' ? values.purchaseId : '',
        purchaseOrderId: values.purchaseSource === 'PURCHASE_ORDER' ? values.purchaseId : '',
        supplierId: values.supplierId,
        accountId: values.accountId,
        loanId: editor.loan?.id ?? '',
        loanBalance: editor.loan?.outstanding ?? '',
        loanVoided: editor.loan?.voidedAt ?? '',
        movementId: editor.movement?.id ?? '',
        movementReversed: editor.movement?.reversedAt ?? '',
        purchaseSource: values.purchaseSource ?? '',
        purchaseId: values.purchaseId ?? '',
        purchaseVersion: values.purchaseVersion ?? '',
        purchaseSnapshot: values.purchaseSnapshot ?? '',
        purchaseAccountId: values.accountId,
        purchaseSupplierId: values.supplierId,
      }),
      draftId: editor.draftId,
      needsReview: editor.needsReview,
      busy,
      onClose,
    },
  );
  const { form, setForm, guard, requestId: request } = draft;
  const pending = useRef(false),
    id = useId();
  const set = (key: keyof typeof form, value: string) => {
    if (key === 'accountId') {
      setPurchasePage(1);
      setPurchaseSearch('');
    }
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : key === 'accountId'
            ? {
                targetAccountId: '',
                supplierId: '',
                purchaseSource: '',
                purchaseId: '',
                purchaseVersion: '',
                purchaseSnapshot: '',
                purchaseNumber: '',
              }
            : {}),
    }));
  };
  const account = accounts.find((a) => a.id === form.accountId);
  const purchase =
    editor.kind === 'movement' && !editor.invoice && form.kind === 'SUPPLIER_PAYMENT';
  const canDeskPurchase =
    hasPermission('invoice_desk.view') && hasPermission('invoice_desk.payments');
  const canCanonicalPurchase =
    hasPermission('supplier-payments.view') &&
    hasPermission('supplier-payments.manage') &&
    hasPermission('payables.view');
  const canPurchase = hasPermission('suppliers.view') && (canDeskPurchase || canCanonicalPurchase);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseReviewed, setPurchaseReviewed] = useState('');
  const deferredPurchaseSearch = useDeferredValue(purchaseSearch);
  const purchaseEnabled = purchase && canPurchase && !!account && !!form.supplierId;
  const purchaseOptions = useWorkspaceResource<PurchaseOptions>(
    '/cash-desk/purchase-options',
    {
      accountId: form.accountId,
      supplierId: form.supplierId,
      search: deferredPurchaseSearch,
      page: purchasePage,
      pageSize: 20,
    },
    purchaseEnabled,
  );
  const purchaseDetail = useWorkspaceResource<PurchaseOptions>(
    '/cash-desk/purchase-options',
    {
      accountId: form.accountId,
      supplierId: form.supplierId,
      source: form.purchaseSource ?? '',
      id: form.purchaseId ?? '',
    },
    purchaseEnabled && !!form.purchaseId && !!form.purchaseSource,
  );
  const allowedPurchase = (row: PurchaseOption) =>
    row.supplierId === form.supplierId &&
    row.currency === account?.currency &&
    (row.source === 'PAYABLE' || row.source === 'PURCHASE_ORDER'
      ? canCanonicalPurchase && (row.source !== 'PURCHASE_ORDER' || hasPermission('purchases.view'))
      : row.source === 'INVOICE_DESK' && canDeskPurchase);
  const currentPurchase = purchaseDetail.data?.rows.find(
    (row) =>
      row.id === form.purchaseId && row.source === form.purchaseSource && allowedPurchase(row),
  );
  const currentSnapshot = currentPurchase ? purchaseSnapshot(currentPurchase) : '';
  const purchaseChanged =
    purchase &&
    !!form.purchaseSnapshot &&
    !!currentSnapshot &&
    form.purchaseSnapshot !== currentSnapshot;
  const purchaseReviewKey = JSON.stringify([
    currentSnapshot,
    form.amount,
    form.businessDate,
    form.accountId,
    form.supplierId,
  ]);
  const purchaseLocked = purchase && !!request.current;
  const choosePurchase = (row: PurchaseOption) => {
    setForm((f) => ({
      ...f,
      purchaseSource: row.source,
      purchaseId: row.id,
      purchaseVersion: row.version ? String(row.version) : '',
      purchaseSnapshot: purchaseSnapshot(row),
      purchaseNumber: row.number,
      amount: row.outstanding,
      description: `Payment · ${row.number}`,
    }));
    setError('');
  };
  const two = ['TRANSFER', 'LOAN', 'LOAN_REPAYMENT'].includes(form.kind);
  const target = accounts.find((a) => a.id === form.targetAccountId);
  const intercompany = editor.kind === 'movement' && ['LOAN', 'LOAN_REPAYMENT'].includes(form.kind);
  const lenderOptions = useLoanOptions(
    (form.kind === 'LOAN' ? account : target)?.companyId || '',
    intercompany,
  );
  const borrowerOptions = useLoanOptions(
    (form.kind === 'LOAN' ? target : account)?.companyId || '',
    intercompany,
  );
  const eligible = accounts.filter(
    (a) =>
      !editor.invoice ||
      (a.companyId === editor.invoice.companyId && a.currency === editor.invoice.currency),
  );
  const targets = accounts.filter(
    (a) =>
      a.id !== account?.id &&
      a.currency === account?.currency &&
      (form.kind === 'TRANSFER'
        ? a.companyId === account?.companyId
        : a.companyId !== account?.companyId),
  );
  const choices = (items: { id: string; name: string }[], placeholder: string) => [
    { value: '', label: placeholder },
    ...items.map((x) => ({ value: x.id, label: x.name })),
  ];
  const accountChoices = (items: Account[]) =>
    choices(
      items.map((a) => ({
        id: a.id,
        name: `${a.name} · ${a.branch.name} · ${a.company.name} · ${money(a.balance, a.currency)}`,
      })),
      'Choose account',
    );
  const close = () => {
    if (!pending.current) void guard.requestClose(onClose);
  };
  const title =
    editor.kind === 'account'
      ? 'New cash account'
      : editor.kind === 'reverse'
        ? 'Reverse movement'
        : movementLabels[form.kind];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (purchase) {
        if (!canPurchase) throw new Error('Purchase payment access is required.');
        if (
          !account ||
          !form.supplierId ||
          !currentPurchase ||
          purchaseDetail.loading ||
          purchaseDetail.error
        )
          throw new Error('Choose an available paying account, supplier and purchase or invoice.');
        const prior = draft.requestContext.current;
        if (
          request.current &&
          (!prior ||
            prior.purchaseSource !== form.purchaseSource ||
            prior.purchaseId !== form.purchaseId ||
            prior.purchaseAccountId !== form.accountId ||
            prior.purchaseSupplierId !== form.supplierId)
        )
          throw new Error(
            'This submitted request belongs to another purchase. Reopen its saved draft to retry it.',
          );
        if (!request.current) {
          if (
            currentPurchase.source === 'INVOICE_DESK' &&
            (!Number.isSafeInteger(currentPurchase.version) || (currentPurchase.version ?? 0) < 1)
          )
            throw new Error(
              'The selected invoice version is unavailable. Retry the purchase read.',
            );
          const amount = exactAmount(form.amount),
            outstanding = exactAmount(currentPurchase.outstanding);
          if (
            currentPurchase.canPay !== true ||
            ['PAID', 'VOID', 'VOIDED', 'CANCELLED', 'WRITTEN_OFF'].includes(
              currentPurchase.status.toUpperCase(),
            ) ||
            outstanding === null ||
            outstanding <= 0n
          )
            throw new Error(
              'This purchase is no longer available for payment. Choose another open record.',
            );
          if (amount === null || amount <= 0n || amount > outstanding)
            throw new Error('Enter a positive amount no greater than the outstanding balance.');
          if (
            form.businessDate < account.openingDate.slice(0, 10) ||
            (currentPurchase.businessDate &&
              form.businessDate < currentPurchase.businessDate.slice(0, 10))
          )
            throw new Error(
              'The payment date cannot precede the account opening or purchase date.',
            );
          if (purchaseChanged && purchaseReviewed !== purchaseReviewKey)
            throw new Error(
              'Review the latest purchase balance and confirm your draft before saving.',
            );
        }
      }
      draft.validateReview();
      await draft.beginRequest();
      await draft.saveNow();
      if (editor.kind === 'account')
        await backendPost('/cash-desk/accounts', {
          requestId: request.current,
          companyId: form.companyId,
          divisionId: form.divisionId,
          branchId: form.branchId,
          name: form.name,
          kind: form.accountKind,
          currency: form.currency,
          openingDate: form.businessDate,
          openingBalance: form.openingBalance,
        });
      else if (editor.kind === 'reverse')
        await backendPost(`/cash-desk/movements/${editor.movement!.id}/reverse`, {
          requestId: request.current,
          reason: form.reason,
          businessDate: form.businessDate,
        });
      else {
        if (!account) throw new Error('Choose an available account.');
        if (form.kind === 'EXPENSE' && (!form.expenseCategory || !form.payee.trim()))
          throw new Error('Choose an expense category and enter who was paid.');
        await backendPost('/cash-desk/movements', {
          requestId: request.current,
          kind: form.kind,
          accountId: form.accountId,
          ...(two ? { targetAccountId: form.targetAccountId } : {}),
          ...(editor.loan ? { loanId: editor.loan.id } : {}),
          ...(editor.invoice
            ? {
                invoiceId: editor.invoice.id,
                invoiceVersion: Number(
                  draft.requestContext.current?.version || editor.invoice.version,
                ),
              }
            : {}),
          ...(purchase
            ? {
                supplierId: form.supplierId,
                ...(form.purchaseSource === 'PAYABLE'
                  ? { payableId: form.purchaseId }
                  : form.purchaseSource === 'PURCHASE_ORDER'
                    ? { purchaseOrderId: form.purchaseId }
                    : {
                        invoiceId: form.purchaseId,
                        invoiceVersion: Number(
                          draft.requestContext.current?.purchaseVersion || form.purchaseVersion,
                        ),
                      }),
              }
            : {}),
          ...(form.kind === 'LOAN' && form.dueDate ? { dueDate: form.dueDate } : {}),
          ...(form.kind === 'LOAN'
            ? {
                receivableAccountId: form.receivableAccountId,
                payableAccountId: form.payableAccountId,
              }
            : {}),
          ...(form.kind === 'LOAN_REPAYMENT'
            ? {
                principal: form.principal || undefined,
                interest: form.interest,
                fees: form.fees,
                interestIncomeAccountId: form.interestIncomeAccountId || undefined,
                interestExpenseAccountId: form.interestExpenseAccountId || undefined,
                feeIncomeAccountId: form.feeIncomeAccountId || undefined,
                feeExpenseAccountId: form.feeExpenseAccountId || undefined,
              }
            : {}),
          amount: form.amount,
          businessDate: form.businessDate,
          description: form.description,
          reference: form.reference,
          ...(form.kind === 'EXPENSE'
            ? {
                expenseCategory: form.expenseCategory,
                payee: form.payee,
                expenseNotes: form.expenseNotes,
              }
            : {}),
          // Party linkage (Phase 2): the picked party rides with the movement; the payee
          // and description stay the typed snapshot.
          ...(form.kind === 'EXPENSE' && form.supplierId ? { supplierId: form.supplierId } : {}),
          ...(form.kind === 'OTHER_IN' && form.customerId ? { customerId: form.customerId } : {}),
        });
      }
      draft.markSaved();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={title}
      size="md"
      onClose={close}
      subtitle={
        editor.kind === 'reverse'
          ? 'Keep the original record and add a correcting entry.'
          : editor.kind === 'account'
            ? 'A place where your company holds money.'
            : 'Record money already received or paid.'
      }
      footer={
        <>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn type="submit" form={id} loading={busy}>
            {editor.kind === 'account'
              ? 'Create account'
              : editor.kind === 'reverse'
                ? 'Confirm reversal'
                : 'Save movement'}
          </Btn>
        </>
      }
    >
      <form id={id} className="desk-form" onSubmit={submit} {...guard.capture}>
        <DraftFormNotice
          draft={{
            ...draft,
            needsReview: draft.needsReview || purchaseChanged,
            reviewed:
              draft.reviewed && (!purchaseChanged || purchaseReviewed === purchaseReviewKey),
            setReviewed: (value) => {
              draft.setReviewed(value);
              setPurchaseReviewed(value ? purchaseReviewKey : '');
              if (value && currentPurchase && !request.current)
                setForm((f) => ({
                  ...f,
                  purchaseVersion: currentPurchase.version ? String(currentPurchase.version) : '',
                  purchaseSnapshot: currentSnapshot,
                }));
            },
          }}
        >
          {currentPurchase && (
            <p>
              Latest purchase balance:{' '}
              {money(currentPurchase.outstanding, currentPurchase.currency)} ·{' '}
              {currentPurchase.status}
            </p>
          )}
          {editor.invoice && (
            <p>
              Latest invoice balance: {money(editor.invoice.outstanding, editor.invoice.currency)}
              {editor.invoice.voidedAt ? ' · Voided' : ''}
            </p>
          )}
          {editor.loan && (
            <p>
              Latest loan balance: {money(editor.loan.outstanding, editor.loan.currency)}
              {editor.loan.voidedAt ? ' · Voided' : ''}
            </p>
          )}
          {editor.movement && (
            <p>
              {editor.movement.description} ·{' '}
              {money(editor.movement.amount, editor.movement.currency)} ·{' '}
              {editor.movement.reversedAt ? 'Already reversed' : 'Recorded'}
            </p>
          )}
        </DraftFormNotice>
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        {editor.kind === 'account' ? (
          <>
            <SelectField
              label="Company"
              required
              value={form.companyId}
              onChange={(value) => set('companyId', value)}
              options={choices(directory.companies, 'Choose company')}
            />
            <div className="desk-form-pair">
              <SelectField
                label="Division"
                required
                disabled={!form.companyId}
                value={form.divisionId}
                onChange={(value) => set('divisionId', value)}
                options={choices(
                  directory.divisions.filter((d) => d.companyId === form.companyId),
                  'Choose division',
                )}
              />
              <SelectField
                label="Branch"
                required
                disabled={!form.divisionId}
                value={form.branchId}
                onChange={(value) => set('branchId', value)}
                options={choices(
                  directory.branches.filter((b) => b.divisionId === form.divisionId),
                  'Choose branch',
                )}
              />
            </div>
            <FormInput
              label="Account name"
              placeholder="e.g. Main cash till"
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <div className="desk-form-pair">
              <SelectField
                label="Account type"
                value={form.accountKind}
                onChange={(value) => set('accountKind', value)}
                options={[
                  { value: 'CASH', label: 'Cash' },
                  { value: 'BANK', label: 'Bank' },
                  { value: 'MOBILE_MONEY', label: 'Mobile money' },
                ]}
              />
              <SelectField
                label="Currency"
                value={form.currency}
                onChange={(value) => set('currency', value)}
                options={['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </div>
            <FormInput
              label="Opening balance"
              required
              inputMode="decimal"
              pattern="\d{1,16}(\.\d{1,2})?"
              value={form.openingBalance}
              onChange={(e) => set('openingBalance', e.target.value)}
            />
          </>
        ) : editor.kind === 'reverse' ? (
          <>
            <p className="desk-payment-balance">
              {editor.movement?.description}
              <strong>{money(editor.movement!.amount, editor.movement!.currency)}</strong>
            </p>
            <FormTextarea
              label="Reason for reversal"
              required
              minLength={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
            />
          </>
        ) : (
          <>
            {editor.invoice && (
              <p className="desk-payment-balance">
                {editor.invoice.supplier.name} · {editor.invoice.invoiceNumber}
                <strong>
                  Outstanding {money(editor.invoice.outstanding, editor.invoice.currency)}
                </strong>
              </p>
            )}
            {editor.loan && (
              <p className="desk-payment-balance">
                {editor.loan.borrower.company.name} → {editor.loan.lender.company.name}
                <strong>Remaining {money(editor.loan.outstanding, editor.loan.currency)}</strong>
              </p>
            )}
            {!editor.loan && !editor.invoice && (
              <SelectField
                label="Movement type"
                value={form.kind}
                disabled={purchaseLocked}
                onChange={(value) => {
                  setPurchasePage(1);
                  setPurchaseSearch('');
                  setForm((f) => ({
                    ...f,
                    kind: value,
                    targetAccountId: '',
                    dueDate: '',
                    supplierId: '',
                    customerId: '',
                    purchaseSource: '',
                    purchaseId: '',
                    purchaseVersion: '',
                    purchaseSnapshot: '',
                    purchaseNumber: '',
                  }));
                }}
                options={[
                  'DAILY_SALES',
                  'OTHER_IN',
                  'EXPENSE',
                  ...(canPurchase ? ['SUPPLIER_PAYMENT'] : []),
                  'TRANSFER',
                  'LOAN',
                ].map((value) => ({ value, label: movementLabels[value] }))}
              />
            )}
            <SelectField
              label={
                ['DAILY_SALES', 'OTHER_IN'].includes(form.kind)
                  ? 'Receiving account'
                  : 'Paying account'
              }
              required
              disabled={!!editor.loan || purchaseLocked}
              value={form.accountId}
              onChange={(value) => set('accountId', value)}
              options={accountChoices(eligible)}
            />
            {purchase && (
              <>
                <SupplierPicker
                  label="Supplier"
                  required
                  value={form.supplierId}
                  companyId={account?.companyId}
                  disabled={!account || !canPurchase || purchaseLocked}
                  onChange={(supplierId) => {
                    setForm((f) => ({
                      ...f,
                      supplierId,
                      purchaseSource: '',
                      purchaseId: '',
                      purchaseVersion: '',
                      purchaseSnapshot: '',
                      purchaseNumber: '',
                    }));
                    setPurchasePage(1);
                    setPurchaseSearch('');
                  }}
                  placeholder={
                    account ? 'Choose the supplier being paid' : 'Choose the paying account first'
                  }
                />
                {purchaseEnabled && (
                  <>
                    <FormInput
                      label="Invoice number or PO number"
                      placeholder="Enter an existing supplier invoice, PINV or PO number"
                      value={purchaseSearch}
                      disabled={purchaseLocked}
                      onChange={(e) => {
                        setPurchaseSearch(e.target.value);
                        setPurchasePage(1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault();
                      }}
                    />
                    {purchaseOptions.error && (
                      <p role="alert" className="desk-error">
                        {purchaseOptions.error}{' '}
                        <Btn variant="secondary" onClick={purchaseOptions.reload}>
                          Retry purchases
                        </Btn>
                      </p>
                    )}
                    {purchaseOptions.loading ? (
                      <p role="status">Loading purchases…</p>
                    ) : (
                      <SelectField
                        label="Purchase or invoice"
                        required
                        disabled={purchaseLocked}
                        value={form.purchaseId ? `${form.purchaseSource}:${form.purchaseId}` : ''}
                        onChange={(value) => {
                          const row = purchaseOptions.data?.rows.find(
                            (r) => `${r.source}:${r.id}` === value && allowedPurchase(r),
                          );
                          if (row) choosePurchase(row);
                        }}
                        options={[
                          { value: '', label: 'Choose an existing purchase or invoice' },
                          ...[
                            ...(currentPurchase ? [currentPurchase] : []),
                            ...(purchaseOptions.data?.rows ?? []),
                          ]
                            .filter(
                              (row, index, rows) =>
                                allowedPurchase(row) &&
                                rows.findIndex(
                                  (other) => other.source === row.source && other.id === row.id,
                                ) === index,
                            )
                            .map((row) => ({
                              value: `${row.source}:${row.id}`,
                              label: `${[row.number, row.purchaseOrderNumber, row.internalInvoiceNumber, row.supplierInvoiceNumber].filter((number, index, numbers) => !!number && numbers.indexOf(number) === index).join(' · ')} · ${row.source === 'PAYABLE' ? 'Purchase payable' : row.source === 'PURCHASE_ORDER' ? (row.purpose === 'CASH_PURCHASE_SETTLEMENT' ? 'Cash payment not recorded' : 'Supplier advance') : 'Invoice Desk'} · ${money(row.outstanding, row.currency)} outstanding`,
                            })),
                        ]}
                      />
                    )}
                    {!purchaseOptions.loading &&
                      !purchaseOptions.error &&
                      !purchaseOptions.data?.rows.length &&
                      !purchaseOptions.data?.orderMatches?.length && (
                        <p className="desk-muted">
                          No open purchases or invoices match this supplier and account. Search by
                          the supplier invoice number, internal invoice number or PO number.
                        </p>
                      )}
                    {!purchaseOptions.loading &&
                      !purchaseOptions.error &&
                      hasPermission('purchases.view') &&
                      purchaseOptions.data?.orderMatches?.map((order) => (
                        <div key={order.id} className="desk-muted">
                          <WorkspaceLink
                            href={`/operations/purchase-orders/${encodeURIComponent(order.id)}`}
                          >
                            {[
                              order.purchaseOrderNumber,
                              order.internalInvoiceNumber,
                              order.supplierInvoiceNumber,
                            ]
                              .filter(
                                (number, index, numbers) =>
                                  !!number && numbers.indexOf(number) === index,
                              )
                              .join(' · ')}
                          </WorkspaceLink>
                          <p>
                            {order.status.replaceAll('_', ' ')} ·{' '}
                            {order.paymentStatus === 'PAID'
                              ? 'This purchase is already paid.'
                              : order.status === 'CANCELLED'
                                ? 'This purchase order is cancelled.'
                                : ['DRAFT', 'CONFIRMED'].includes(order.status)
                                  ? order.purchaseType === 'CASH_PURCHASE'
                                    ? 'Payment is recorded when this cash purchase is received.'
                                    : order.status === 'DRAFT'
                                      ? 'Confirm this purchase order before recording a supplier advance.'
                                      : 'Choose this PO above to record a supplier advance before receiving.'
                                  : 'This purchase order has no open posted balance for this account.'}
                          </p>
                        </div>
                      ))}
                    {(purchaseOptions.data?.totalPages ?? 0) > 1 && (
                      <div className="desk-form-pair">
                        <Btn
                          variant="secondary"
                          disabled={purchasePage <= 1 || purchaseOptions.loading || purchaseLocked}
                          onClick={() => setPurchasePage((p) => p - 1)}
                        >
                          Previous purchases
                        </Btn>
                        <span>
                          Page {purchasePage} of {purchaseOptions.data?.totalPages}
                        </span>
                        <Btn
                          variant="secondary"
                          disabled={
                            purchasePage >= (purchaseOptions.data?.totalPages ?? 1) ||
                            purchaseOptions.loading ||
                            purchaseLocked
                          }
                          onClick={() => setPurchasePage((p) => p + 1)}
                        >
                          Next purchases
                        </Btn>
                      </div>
                    )}
                    {currentPurchase?.source === 'PURCHASE_ORDER' && (
                      <p className="desk-muted">
                        {currentPurchase.purpose === 'CASH_PURCHASE_SETTLEMENT'
                          ? 'Goods are already received. Record the actual cash payment here; the purchase and stock will not be posted again.'
                          : 'Supplier advance: cash is paid now and applied to this PO when its purchase is posted.'}
                      </p>
                    )}
                    {form.purchaseId && purchaseDetail.loading && (
                      <p role="status">Checking the selected purchase…</p>
                    )}
                    {purchaseDetail.error && (
                      <p role="alert" className="desk-error">
                        {purchaseDetail.error}{' '}
                        <Btn variant="secondary" onClick={purchaseDetail.reload}>
                          Retry selected purchase
                        </Btn>
                      </p>
                    )}
                    {form.purchaseId &&
                      !purchaseDetail.loading &&
                      !purchaseDetail.error &&
                      !currentPurchase && (
                        <p role="alert" className="desk-error">
                          The selected purchase is unavailable for this account and supplier.
                        </p>
                      )}
                  </>
                )}
                {form.supplierId && hasPermission('suppliers.view') && (
                  <WorkspaceLink
                    href={`/invoice-desk/suppliers/${encodeURIComponent(form.supplierId)}`}
                  >
                    View supplier
                  </WorkspaceLink>
                )}
                {currentPurchase?.source === 'INVOICE_DESK' &&
                  hasPermission('invoice_desk.view') && (
                    <WorkspaceLink
                      href={`/invoice-desk?record=${encodeURIComponent(currentPurchase.id)}`}
                    >
                      View invoice
                    </WorkspaceLink>
                  )}
                {currentPurchase?.source === 'PAYABLE' && hasPermission('payables.view') && (
                  <WorkspaceLink
                    href={`/cash-desk/payables?search=${encodeURIComponent(currentPurchase.payableNumber ?? currentPurchase.number)}`}
                  >
                    View payable
                  </WorkspaceLink>
                )}
                {currentPurchase?.purchaseOrderId && hasPermission('purchases.view') && (
                  <WorkspaceLink
                    href={`/operations/purchase-orders/${encodeURIComponent(currentPurchase.purchaseOrderId)}`}
                  >
                    View purchase order
                  </WorkspaceLink>
                )}
                {currentPurchase?.purchaseInvoiceId && hasPermission('supplier_invoices.view') && (
                  <WorkspaceLink
                    href={`/invoice-desk?view=invoices&businessRecord=${encodeURIComponent(currentPurchase.purchaseInvoiceId)}`}
                  >
                    View supplier invoice
                  </WorkspaceLink>
                )}
                {currentPurchase?.goodsReceivedNoteId && hasPermission('grn.list') && (
                  <WorkspaceLink href="/invoice-desk?view=receiving">
                    View goods received {currentPurchase.goodsReceivedNoteNumber}
                  </WorkspaceLink>
                )}
                {purchaseLocked && (
                  <p className="desk-muted">
                    Retry this submitted request with its saved details to confirm the payment
                    outcome.
                  </p>
                )}
              </>
            )}
            {two && (
              <SelectField
                label={form.kind === 'LOAN' ? 'Borrower account' : 'Receiving account'}
                required
                disabled={!!editor.loan || !account}
                value={form.targetAccountId}
                onChange={(value) => set('targetAccountId', value)}
                options={accountChoices(targets)}
              />
            )}
            <FormInput
              label={`Amount${account ? ` (${account.currency})` : ''}`}
              required
              inputMode="decimal"
              pattern="\d{1,16}(\.\d{1,2})?"
              value={form.amount}
              readOnly={purchaseLocked}
              onChange={(e) => set('amount', e.target.value)}
            />
            {intercompany && (
              <div className="space-y-3 rounded-xl border p-3">
                <p className="text-sm">
                  This saves the loan balance, both cash movements and a journal for each company
                  together. Cash accounts must be connected to their ledgers.
                </p>
                {(lenderOptions.error || borrowerOptions.error) && (
                  <p role="alert">{lenderOptions.error || borrowerOptions.error}</p>
                )}
                {form.kind === 'LOAN' ? (
                  <>
                    <LoanLedgerChoice
                      label="Lender intercompany receivable"
                      accounts={lenderOptions.data?.ledger || []}
                      type="ASSET"
                      value={form.receivableAccountId}
                      onChange={(v) => set('receivableAccountId', v)}
                    />
                    <LoanLedgerChoice
                      label="Borrower intercompany payable"
                      accounts={borrowerOptions.data?.ledger || []}
                      type="LIABILITY"
                      value={form.payableAccountId}
                      onChange={(v) => set('payableAccountId', v)}
                    />
                  </>
                ) : (
                  <>
                    <FormInput
                      label="Principal (blank = amount less charges)"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.principal}
                      onChange={(e) => set('principal', e.target.value)}
                    />
                    <FormInput
                      label="Interest included in payment"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.interest}
                      onChange={(e) => set('interest', e.target.value)}
                    />
                    <FormInput
                      label="Fees included in payment"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.fees}
                      onChange={(e) => set('fees', e.target.value)}
                    />
                    {Number(form.interest) > 0 && (
                      <>
                        <LoanLedgerChoice
                          label="Lender interest income"
                          accounts={lenderOptions.data?.ledger || []}
                          type="INCOME"
                          value={form.interestIncomeAccountId}
                          onChange={(v) => set('interestIncomeAccountId', v)}
                        />
                        <LoanLedgerChoice
                          label="Borrower interest expense"
                          accounts={borrowerOptions.data?.ledger || []}
                          type="EXPENSE"
                          value={form.interestExpenseAccountId}
                          onChange={(v) => set('interestExpenseAccountId', v)}
                        />
                      </>
                    )}
                    {Number(form.fees) > 0 && (
                      <>
                        <LoanLedgerChoice
                          label="Lender fee income"
                          accounts={lenderOptions.data?.ledger || []}
                          type="INCOME"
                          value={form.feeIncomeAccountId}
                          onChange={(v) => set('feeIncomeAccountId', v)}
                        />
                        <LoanLedgerChoice
                          label="Borrower fee expense"
                          accounts={borrowerOptions.data?.ledger || []}
                          type="EXPENSE"
                          value={form.feeExpenseAccountId}
                          onChange={(v) => set('feeExpenseAccountId', v)}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {form.kind === 'EXPENSE' && (
              <>
                <SelectField
                  label="Expense category"
                  required
                  value={form.expenseCategory}
                  onChange={(value) => set('expenseCategory', value)}
                  options={[
                    { value: '', label: 'Choose category' },
                    ...Object.entries(expenseCategories).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
                {hasPermission('suppliers.view') && (
                  <SupplierPicker
                    label="Supplier (optional)"
                    value={form.supplierId}
                    onChange={(supplierId, party) =>
                      setForm((f) => ({
                        ...f,
                        supplierId,
                        payee: party && !f.payee.trim() ? party.name : f.payee,
                      }))
                    }
                    companyId={account?.companyId || scope.companyId || undefined}
                    placeholder={
                      account
                        ? 'Link this expense to a supplier profile'
                        : 'Choose the account first'
                    }
                    disabled={!account}
                  />
                )}
                <FormInput
                  label="Paid to"
                  placeholder="Person or business paid"
                  required
                  maxLength={160}
                  value={form.payee}
                  onChange={(e) => set('payee', e.target.value)}
                />
              </>
            )}
            {form.kind === 'OTHER_IN' && hasPermission('customers.view') && (
              <CustomerPicker
                label="Customer (optional)"
                value={form.customerId}
                onChange={(customerId) => set('customerId', customerId)}
                companyId={account?.companyId || scope.companyId || undefined}
                placeholder={
                  account ? 'Link this money to a customer profile' : 'Choose the account first'
                }
                disabled={!account}
              />
            )}
            <FormInput
              label="Description"
              required
              maxLength={500}
              placeholder={
                form.kind === 'DAILY_SALES' ? 'Daily cash sales' : 'What was this money for?'
              }
              value={form.description}
              readOnly={purchaseLocked}
              onChange={(e) => set('description', e.target.value)}
            />
            <FormInput
              label="Reference (optional)"
              maxLength={160}
              value={form.reference}
              readOnly={purchaseLocked}
              onChange={(e) => set('reference', e.target.value)}
            />
            {form.kind === 'EXPENSE' && (
              <>
                <FormTextarea
                  label="Expense notes (optional)"
                  maxLength={2000}
                  placeholder="Purpose, people involved or other supporting details"
                  value={form.expenseNotes}
                  onChange={(e) => set('expenseNotes', e.target.value)}
                />
                <p className="desk-muted">
                  Record expenses already paid. For an invoice tracked in Invoice Desk, use Supplier
                  balances → Record payment so its outstanding balance updates too.
                </p>
              </>
            )}
            {form.kind === 'DAILY_SALES' && (
              <p className="desk-muted">
                Enter the total received into this account for the day. Use this only when receipts
                for this account and date are not recorded through Sales Desk. Reverse an existing
                total before correcting it or switching to individual receipts.
              </p>
            )}
          </>
        )}
        <FormDateField
          label={
            editor.kind === 'account'
              ? 'Opening date'
              : editor.kind === 'reverse'
                ? 'Reversal date'
                : 'Transaction date'
          }
          required
          max={localToday()}
          value={form.businessDate}
          disabled={purchaseLocked}
          onChange={(value) => set('businessDate', value)}
        />
        {editor.kind === 'movement' && form.kind === 'LOAN' && (
          <FormDateField
            label="Repayment due date (optional)"
            min={form.businessDate}
            value={form.dueDate}
            onChange={(value) => set('dueDate', value)}
          />
        )}
      </form>
    </Modal>
  );
}
