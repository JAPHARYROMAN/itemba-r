'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Btn, Modal } from '@/components/ui';
import { FormShell } from '@/components/aurora';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendPost } from '@/lib/api-client';
import { AccountingAcknowledgement } from './accounting-review-form';
import { ControlFields } from './accounting-control-fields';
import { useControlChoices } from './accounting-control-choices';
import {
  controlCreateBody,
  controlDefinitions,
  initialControlValues,
  type ControlTarget,
} from './accounting-controls-types';
import './accounting-controls.css';

export function ControlCreate({
  target,
  source,
  close,
  done,
}: {
  target: Extract<ControlTarget, { kind: 'control-create' }>;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
}) {
  const { hasPermission, user } = useAuth(),
    kind = target.control,
    definition = controlDefinitions[kind];
  const allowed = hasPermission(`${definition.permission}.create`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [acknowledgement, setAcknowledgement] = useState('');
  const pending = useRef(false),
    mounted = useRef(true),
    controller = useRef<AbortController | null>(null),
    permitted = useRef(allowed);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const title = `New ${definition.singular}`;
  const draft = useWorkspaceDraftForm(
    () => initialControlValues(kind, target.companyId || user?.companyId || ''),
    {
      appId: 'reports',
      title,
      describe: (v) => v.fields[definition.number],
      context: (v) => ({ kind: target.kind, control: kind, companyId: v.fields.companyId }),
      draftId: source?.id,
      busy,
      onClose: close,
    },
  );
  const choices = useControlChoices(kind, draft.form.fields.companyId, allowed);
  useLayoutEffect(() => {
    permitted.current = allowed && !choices.missingPermissions.length;
  });
  const ackKey = JSON.stringify([draft.form, choices.selectedVersion(draft.form)]),
    ack = acknowledgement === ackKey;
  const onClose = () => {
    if (!pending.current) draft.guard.requestClose(close);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !permitted.current) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (draft.requestId.current)
        throw new Error(
          'The previous save has an unconfirmed outcome. Check the register before discarding this draft and creating another record.',
        );
      if (!ack) throw new Error('Review the details and confirm before saving.');
      const body = controlCreateBody(kind, draft.form);
      choices.validate(draft.form);
      setBusy(true);
      const reader = new AbortController();
      controller.current = reader;
      await choices.refreshBeforeSave(draft.form, reader.signal);
      if (!mounted.current || reader.signal.aborted) return;
      if (!permitted.current)
        throw new Error('Your current role no longer permits this action. Your input is retained.');
      try {
        await backendPost(`/${kind}`, body);
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status >= 400 && cause.status < 500))
          await draft.beginRequest();
        throw cause;
      }
      if (mounted.current) {
        draft.markSaved();
        done(`Created ${draft.form.fields[definition.number]}.`);
      }
    } catch (cause) {
      if (mounted.current) {
        setAcknowledgement('');
        setError(
          cause instanceof Error ? cause.message : 'Unable to save. Your input is retained.',
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal open title={title} onClose={onClose} size="xl" dismissOnBackdrop={!busy}>
      <div {...draft.guard.capture}>
        <FormShell onSubmit={submit}>
          <div className="accounting-control-editor">
            <DraftFormNotice draft={draft} />
            {!allowed && (
              <p role="alert" className="workspace-notice">
                Your role cannot create this record. You can keep your draft for later.
              </p>
            )}
            {error && (
              <p role="alert" className="workspace-notice">
                {error}
              </p>
            )}
            {draft.requestId.current && (
              <p role="alert" className="workspace-notice">
                A save was attempted. Check the register for this reference before trying another
                record.
              </p>
            )}
            {choices.loading && <p role="status">Loading available choices…</p>}
            {!!choices.errors.length && (
              <div role="alert" className="workspace-notice">
                <p>{choices.errors.join(' · ')}</p>
                <Btn type="button" variant="secondary" disabled={busy} onClick={choices.retry}>
                  Retry choices
                </Btn>
              </div>
            )}
            {!!choices.missingPermissions.length && (
              <p role="alert" className="workspace-notice">
                Your role needs access to the supporting directory:{' '}
                {choices.missingPermissions.join(', ')}.
              </p>
            )}
            <fieldset disabled={busy || !allowed || !!draft.requestId.current}>
              <ControlFields
                kind={kind}
                values={draft.form}
                setValues={draft.setForm}
                choices={choices}
              />
              <AccountingAcknowledgement
                label="I have reviewed the company, scope and entered details."
                checked={ack}
                disabled={busy}
                onChange={(checked) => setAcknowledgement(checked ? ackKey : '')}
              />
            </fieldset>
            <div className="accounting-control-actions">
              <Btn type="button" variant="secondary" disabled={busy} onClick={onClose}>
                Close form
              </Btn>
              {draft.canRetain && (
                <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
                  Keep draft
                </Btn>
              )}
              <Btn
                type="submit"
                loading={busy}
                disabled={
                  !allowed ||
                  !ack ||
                  choices.loading ||
                  !!choices.errors.length ||
                  !!choices.missingPermissions.length ||
                  !!draft.availabilityError ||
                  !!draft.requestId.current
                }
              >
                Create {definition.singular}
              </Btn>
            </div>
          </div>
        </FormShell>
      </div>
    </Modal>
  );
}
