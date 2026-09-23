'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Btn, Modal, PageSpinner } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendGet } from '@/lib/api-client';

/** Fresh review on open/resume and before a write; server checks remain authoritative. */
export function useAccountingReview<T, V>(options: {
  path: string;
  read?: (signal: AbortSignal) => Promise<T>;
  query?: Record<string, string>;
  readAllowed: boolean;
  writeAllowed: boolean;
  busy?: boolean;
  allowChangedRetry?: boolean;
  initial: V;
  title: string;
  summary: (data: T | null) => string;
  describe?: (values: V, data: T | null) => string;
  context: Record<string, string>;
  version: (data: T) => string;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
}) {
  const resource = useWorkspaceResource<T>(
    options.path,
    options.query,
    options.readAllowed,
    options.read,
  );
  const [current, setCurrent] = useState<T | null>(null);
  const data = options.readAllowed ? current || resource.data : null;
  const version = data ? options.version(data) : options.source?.context.version || '';
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    if (data && opening === null) setOpening(version);
  }, [data, version, opening]);
  const [writing, setBusy] = useState(false),
    [error, setError] = useState('');
  const busy = writing || !!options.busy;
  const pending = useRef(false),
    mounted = useRef(true),
    reader = useRef<AbortController | null>(null);
  const permission = useRef(options.readAllowed && options.writeAllowed);
  useLayoutEffect(() => {
    permission.current = options.readAllowed && options.writeAllowed;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reader.current?.abort();
    };
  }, []);
  const draft = useWorkspaceDraftForm(options.initial, {
    appId: 'reports',
    title: options.title,
    describe: (values) =>
      options.describe?.(values, data) || options.summary(data) || options.source?.summary || '',
    context: { ...options.context, version },
    draftId: options.source?.id,
    needsReview:
      !!data &&
      ((!!options.source && options.source.context.version !== version) ||
        (opening !== null && opening !== version)),
    reviewKey: version,
    busy,
    onClose: options.close,
  });
  // Financial acknowledgements always need a fresh choice after reopening or changing input.
  const acknowledgementKey = JSON.stringify([version, draft.form]);
  const [acknowledged, setAcknowledged] = useState('');
  const ack = acknowledged === acknowledgementKey;
  const setAck = (value: boolean) => setAcknowledged(value ? acknowledgementKey : '');
  const close = () => {
    if (!pending.current && !options.busy) draft.guard.requestClose(options.close);
  };
  const refresh = () => {
    if (pending.current || options.busy) return;
    setCurrent(null);
    setError('');
    setAcknowledged('');
    resource.reload();
  };
  async function submit(validate: (value: T) => void, write: (value: T) => Promise<string>) {
    if (
      pending.current ||
      options.busy ||
      !data ||
      resource.loading ||
      resource.error ||
      !permission.current
    )
      return;
    setError('');
    // Claimed synchronously. Everything below this point awaits, and a second
    // click landing inside that window would otherwise clear the guard above and
    // start a second write of the same financial action.
    pending.current = true;
    setBusy(true);
    try {
      draft.validateReview();
      await draft.saveNow();
      if (
        !options.allowChangedRetry &&
        draft.requestId.current &&
        draft.requestContext.current?.version !== version
      )
        throw new Error(
          'The source changed after an earlier attempt. Review existing records before discarding this draft and starting a new review.',
        );
      if (!ack) throw new Error('Confirm the accounting checks before continuing.');
      validate(data);
      const controller = new AbortController();
      reader.current = controller;
      const latest = options.read
        ? await options.read(controller.signal)
        : await backendGet<T>(options.path, {
            query: options.query || {},
            signal: controller.signal,
          });
      if (!mounted.current || controller.signal.aborted) return;
      if (!permission.current)
        throw new Error(
          'Your current role no longer permits this action. Your input is still here.',
        );
      if (options.version(latest) !== version) {
        setCurrent(latest);
        setAcknowledged('');
        return;
      }
      validate(latest);
      await draft.beginRequest();
      const message = await write(latest);
      if (mounted.current) {
        draft.markSaved();
        options.done(message);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The action could not be completed. Your input is still here.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    data,
    draft,
    busy,
    error,
    loading: resource.loading,
    readError: resource.error,
    readAllowed: options.readAllowed,
    writeAllowed: options.writeAllowed,
    ack,
    setAck,
    close,
    refresh,
    submit,
  };
}

export function AccountingReviewShell<T, V>({
  form,
  title,
  subtitle,
  action,
  disabled,
  onSubmit,
  children,
}: {
  form: ReturnType<typeof useAccountingReview<T, V>>;
  title: string;
  subtitle?: string;
  action?: string;
  disabled?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={form.close}
      size="lg"
      dismissOnBackdrop={!form.busy}
      footer={
        <>
          <Btn type="button" variant="secondary" disabled={form.busy} onClick={form.close}>
            Close review
          </Btn>
          {form.draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={form.busy} onClick={form.draft.keep}>
              Keep draft
            </Btn>
          )}
          {action && (
            <Btn
              type="submit"
              form={id}
              loading={form.busy}
              disabled={
                disabled ||
                !form.writeAllowed ||
                !form.data ||
                form.loading ||
                !!form.readError ||
                !form.ack ||
                !form.draft.reviewed ||
                !!form.draft.availabilityError
              }
            >
              {action}
            </Btn>
          )}
        </>
      }
    >
      <form
        id={id}
        className="space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        {...form.draft.guard.capture}
      >
        <DraftFormNotice draft={form.draft} />
        {!form.readAllowed ? (
          <p role="alert" className="workspace-notice">
            Your role no longer permits this review. You can keep the draft for later.
          </p>
        ) : form.loading ? (
          <PageSpinner label="Loading current accounting details" />
        ) : form.readError ? (
          <div className="workspace-notice" role="alert">
            <p>{form.readError}</p>
            <Btn type="button" variant="secondary" onClick={form.refresh}>
              Retry review
            </Btn>
          </div>
        ) : (
          children
        )}
        {form.error && (
          <p role="alert" className="workspace-notice">
            {form.error}
          </p>
        )}
        {form.data && (
          <Btn type="button" variant="ghost" disabled={form.busy} onClick={form.refresh}>
            Refresh review
          </Btn>
        )}
      </form>
    </Modal>
  );
}

export function AccountingAcknowledgement({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="posting-ack" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function accountingChoices(
  rows: { id: string; accountCode: string; accountName: string }[],
  selected: string,
) {
  const choices = rows.map((row) => ({
    value: row.id,
    label: `${row.accountCode} · ${row.accountName}`,
  }));
  if (selected && !choices.some((row) => row.value === selected))
    choices.push({ value: selected, label: 'Previously selected account — unavailable' });
  return choices;
}
