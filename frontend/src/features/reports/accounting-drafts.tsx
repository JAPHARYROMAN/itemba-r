'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { PageSpinner, showToast } from '@/components/ui';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import {
  useUnsavedWork,
  useUnsavedWorkScopeId,
} from '@/components/workspace/unsaved-work-provider';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import {
  useWorkspacePathname,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import type { ReportFilters, ReportPresentation } from './report-viewer-types';
import type { AccountingTarget } from './accounting-types';
import { isControlKind, controlActions } from './accounting-controls-types';
import { reconciliationActions } from './reconciliation-types';

const Editor = dynamic(
  () => import('./accounting-editors').then((module) => module.AccountingEditor),
  { loading: () => <PageSpinner label="Opening accounting review" /> },
);
const Context = createContext<{
  open: (target: AccountingTarget, source?: WorkspaceDraft) => void;
  activeDraftId?: string;
  editing: boolean;
  revision: number;
} | null>(null);
const kinds = new Set([
  'control-create',
  'control-action',
  'saved-view-create',
  'saved-view-action',
  'invoice-posting',
  'cash-posting',
  'account-connection',
  'payment-link',
  'reconciliation-create',
  'reconciliation-import',
  'reconciliation-line',
  'reconciliation-action',
]);

/** Reuse the parent Reports controller; standalone accounting views receive their own. */
export function AccountingDraftBoundary({
  children,
  shelf = true,
}: {
  children: ReactNode;
  shelf?: boolean;
}) {
  const parent = useContext(Context);
  return parent ? (
    children
  ) : (
    <AccountingDraftWorkspace shelf={shelf}>{children}</AccountingDraftWorkspace>
  );
}
function AccountingDraftWorkspace({ children, shelf }: { children: ReactNode; shelf: boolean }) {
  const [entry, setEntry] = useState<{
    target: AccountingTarget;
    source?: WorkspaceDraft;
    key: string;
  } | null>(null);
  const { request } = useUnsavedWork(),
    scope = useUnsavedWorkScopeId();
  const pathname = useWorkspacePathname(),
    params = useWorkspaceSearchParams();
  const view = `${pathname}?${params?.toString() || ''}`,
    previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) {
      previousView.current = view;
      setEntry(null);
    }
  }, [view]);
  const [revision, setRevision] = useWorkspaceState('reports.accountingRevision', 0);
  const [message, setMessage] = useState('');
  const open = (target: AccountingTarget, source?: WorkspaceDraft) => {
    const select = () => setEntry({ target, source, key: crypto.randomUUID() });
    if (entry) request(select, undefined, 'close', { scope });
    else select();
  };
  return (
    <Context.Provider
      value={{ open, activeDraftId: entry?.source?.id, editing: !!entry, revision }}
    >
      {shelf && <AccountingDraftShelf />}
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      {children}
      {entry && (
        <Editor
          key={entry.key}
          target={entry.target}
          source={entry.source}
          close={() => setEntry(null)}
          done={(message) => {
            setEntry(null);
            setMessage(message);
            setRevision((value) => value + 1);
            showToast(
              'success',
              entry.target.kind.startsWith('saved-view') ? 'Reports updated' : 'Accounting updated',
              message,
            );
            if (entry.target.kind === 'payment-link') notifyDeskSaved('invoice-desk');
          }}
        />
      )}
    </Context.Provider>
  );
}
export function AccountingDraftShelf() {
  const context = useContext(Context);
  if (!context) return null;
  return (
    <WorkspaceDraftShelf
      appId="reports"
      activeDraftId={context.activeDraftId}
      filter={(draft) => kinds.has(draft.context.kind)}
      onResume={(source) => {
        const { kind, recordId: id, sourceKind, accountKind, query } = source.context;
        if (
          (kind === 'control-create' || kind === 'control-action') &&
          isControlKind(source.context.control)
        ) {
          const control = source.context.control;
          if (kind === 'control-create')
            context.open({ kind, control, companyId: source.context.companyId }, source);
          else if (id && controlActions[control].some((a) => a.id === source.context.action))
            context.open(
              {
                kind,
                control,
                id,
                action: source.context.action,
                entryId: source.context.entryId || undefined,
              },
              source,
            );
          else
            throw new Error(
              'This accounting action is unavailable. Open the current source record.',
            );
          return;
        }
        if (kind === 'saved-view-create') {
          const values = source.values as {
            filters: ReportFilters;
            chartConfig: ReportPresentation;
          };
          context.open(
            {
              kind,
              reportId: source.context.reportId,
              permission: source.context.permission,
              name: source.context.reportName,
              filters: values.filters,
              chartConfig: values.chartConfig,
            },
            source,
          );
          return;
        }
        if (kind === 'reconciliation-create') {
          context.open({ kind, companyId: source.context.companyId }, source);
          return;
        }
        if (!id)
          throw new Error(
            'This review has no source record. Discard it and open a current record.',
          );
        if (
          kind === 'saved-view-action' &&
          (source.context.action === 'default' || source.context.action === 'delete')
        )
          context.open({ kind, id, action: source.context.action }, source);
        else if (kind === 'reconciliation-import' || kind === 'reconciliation-line')
          context.open({ kind, id }, source);
        else if (
          kind === 'reconciliation-action' &&
          Object.hasOwn(reconciliationActions, source.context.action)
        )
          context.open(
            {
              kind,
              id,
              action: source.context.action as keyof typeof reconciliationActions,
              lineId: source.context.lineId || undefined,
              journalEntryLineId: source.context.journalEntryLineId || undefined,
              candidateLabel: source.context.candidateLabel || undefined,
            },
            source,
          );
        else if (
          kind === 'invoice-posting' &&
          (sourceKind === 'sales' || sourceKind === 'purchases')
        )
          context.open({ kind, id, sourceKind }, source);
        else if (kind === 'cash-posting') context.open({ kind, id }, source);
        else if (
          kind === 'account-connection' &&
          (accountKind === 'desk' || accountKind === 'bank')
        )
          context.open({ kind, id, accountKind, query: JSON.parse(query || '{}') }, source);
        else if (kind === 'payment-link')
          context.open({ kind, id, query: JSON.parse(query || '{}') }, source);
        else throw new Error('This review is no longer supported. Open its source record.');
      }}
    />
  );
}
export function useAccountingEditor() {
  const context = useContext(Context);
  if (!context) throw new Error('Accounting reviews need an AccountingDraftBoundary.');
  return context.open;
}
/** Invalidate reads without remounting open reviews or losing their input. */
export function useAccountingRefresh(refresh: () => void) {
  const [sharedRevision] = useWorkspaceState('reports.accountingRevision', 0);
  const context = useContext(Context);
  const revision = context?.revision ?? sharedRevision;
  const seen = useRef(revision),
    callback = useRef(refresh);
  useLayoutEffect(() => {
    callback.current = refresh;
  });
  useEffect(() => {
    if (seen.current !== revision) {
      seen.current = revision;
      callback.current();
    }
  }, [revision]);
}
export function useAccountingStateKey(name: string) {
  return `reports.accounting.${useUnsavedWorkScopeId() || 'main'}.${name}`;
}
