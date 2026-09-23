'use client';
import {
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';

/** Keep user edits separate from the fresh source loaded when resuming a definition. */
export function useInventoryDefinitionForm<T extends Record<string, unknown>>({
  baseline,
  kind,
  title,
  describe,
  record,
  source,
  busy,
  onClose,
  context = {},
}: {
  baseline: T;
  kind: string;
  title: string;
  describe: (values: Partial<T>) => string;
  record?: { id: string; updatedAt?: string };
  source?: WorkspaceDraft;
  busy: boolean;
  onClose: () => void;
  context?: Record<string, string>;
}) {
  const stateKey = JSON.stringify([record?.updatedAt, baseline, context]);
  const draft = useWorkspaceDraftForm<Partial<T>>(() => (record ? {} : baseline), {
    appId: 'inventory',
    title,
    describe,
    context: { ...context, kind, recordId: record?.id || '', stateKey },
    draftId: source?.id,
    busy,
    onClose,
    needsReview:
      !!source && !!record && (!record.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form = { ...baseline, ...draft.form } as T;
  const setForm = (change: (previous: T) => T) =>
    draft.setForm((previous) => {
      const next = change({ ...baseline, ...previous } as T);
      return record
        ? (Object.fromEntries(
            Object.entries(next).filter(([key, value]) => value !== baseline[key]),
          ) as Partial<T>)
        : next;
    });
  return { ...draft, form, setForm };
}
