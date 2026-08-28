'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import {
  deleteMsaidiziMemory,
  fetchMsaidiziMemory,
  updateMsaidiziMemory,
} from '@/lib/msaidizi-tasks-client';
import type {
  MsaidiziMemory,
  MsaidiziMemoryDetail,
  MsaidiziMemoryKind,
} from '@/lib/msaidizi-task-types';
import {
  CONTROL_INPUT_CLASS,
  CONTROL_INPUT_STYLE,
  ControlButton,
  ControlField,
  ControlStatus,
  InlineMessage,
  controlPlaneError,
  formatWhen,
  parseJsonObject,
  statusLabel,
  toIsoDateTime,
  toLocalDateTime,
} from './msaidizi-control-plane-detail-ui';

interface MemoryDraft {
  kind: MsaidiziMemoryKind;
  scopeKey: string;
  content: string;
  metadata: string;
  expiresAt: string;
}

function draftFromMemory(memory: MsaidiziMemoryDetail): MemoryDraft {
  return {
    kind: memory.kind,
    scopeKey: memory.scopeKey,
    content: memory.content,
    metadata: JSON.stringify(memory.metadata, null, 2),
    expiresAt: toLocalDateTime(memory.expiresAt),
  };
}

function metadataFromMemory(memory: MsaidiziMemoryDetail): MsaidiziMemory {
  const metadata: MsaidiziMemory = { ...memory };
  delete metadata.content;
  return metadata;
}

export function MsaidiziMemoryDetailPanel({
  memoryId,
  onChanged,
  onDeleted,
}: {
  memoryId: string;
  onChanged: (memory: MsaidiziMemory) => void;
  onDeleted: (memoryId: string) => void;
}) {
  const [memory, setMemory] = useState<MsaidiziMemoryDetail | null>(null);
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const current = await fetchMsaidiziMemory(memoryId);
      if (token !== loadToken.current) return;
      setMemory(current);
      setDraft(draftFromMemory(current));
      setConflicted(false);
      setConfirmDelete(false);
      onChanged(metadataFromMemory(current));
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Refresh this memory before continuing.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [memoryId, onChanged]);

  useEffect(() => {
    void load();
    return () => {
      loadToken.current += 1;
    };
  }, [load]);

  const submitUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memory || !draft || conflicted) return;
    setBusy('update');
    setError(null);
    setNotice(null);
    try {
      const updated = await updateMsaidiziMemory(memory.id, {
        kind: draft.kind,
        scopeKey: draft.scopeKey.trim(),
        content: draft.content,
        metadata: parseJsonObject(draft.metadata, 'Metadata'),
        expiresAt: toIsoDateTime(draft.expiresAt),
      });
      setMemory(updated);
      setDraft(draftFromMemory(updated));
      setConflicted(false);
      onChanged(metadataFromMemory(updated));
      setNotice(
        updated.redactionsApplied
          ? 'Memory updated after detected credentials were removed.'
          : 'Memory updated through the encrypted, governed boundary.',
      );
    } catch (requestError) {
      const failure = controlPlaneError(
        requestError,
        'Your draft is preserved. Refresh the current memory before trying again.',
      );
      setError(failure.message);
      setConflicted(failure.conflict);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!memory) return;
    setBusy('delete');
    setError(null);
    setNotice(null);
    try {
      await deleteMsaidiziMemory(memory.id);
      onDeleted(memory.id);
    } catch (requestError) {
      const failure = controlPlaneError(
        requestError,
        'Refresh the current memory before trying to delete it again.',
      );
      setError(failure.message);
      setConflicted(failure.conflict);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Skeleton className="h-44" />;

  if (!memory || !draft) {
    return (
      <section
        className="space-y-3 rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}
        <ControlButton onClick={() => void load()}>Retry memory detail</ControlButton>
      </section>
    );
  }

  return (
    <section
      aria-label="Memory detail"
      className="space-y-4 rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {memory.scopeKey}
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Decrypted only for this explicit detail view · updated {formatWhen(memory.updatedAt)}
          </p>
        </div>
        <ControlStatus status={memory.trustLevel} />
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}
      {notice ? <InlineMessage kind="notice">{notice}</InlineMessage> : null}

      <dl className="grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Kind</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {statusLabel(memory.kind)}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Source</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {statusLabel(memory.sourceProvenance.sourceType)}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Expires</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {memory.expiresAt ? formatWhen(memory.expiresAt) : 'No expiry'}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Content digest</dt>
          <dd
            className="mt-1 truncate font-mono"
            title={memory.contentDigest}
            style={{ color: 'var(--aurora-text)' }}
          >
            {memory.contentDigest}
          </dd>
        </div>
      </dl>

      <form onSubmit={submitUpdate} className="space-y-3" aria-label="Edit governed memory">
        <div className="grid gap-2 sm:grid-cols-2">
          <ControlField label="Memory kind">
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as MsaidiziMemoryKind })
              }
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
            >
              <option value="SEMANTIC">Semantic</option>
              <option value="EPISODIC">Episodic</option>
              <option value="PROCEDURAL">Procedural</option>
            </select>
          </ControlField>
          <ControlField label="Memory scope key">
            <input
              required
              maxLength={240}
              value={draft.scopeKey}
              onChange={(event) => setDraft({ ...draft, scopeKey: event.target.value })}
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
            />
          </ControlField>
        </div>
        <ControlField
          label="Memory content"
          hint="Trust and provenance remain server-owned and cannot be edited here."
        >
          <textarea
            required
            maxLength={250000}
            rows={6}
            value={draft.content}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            className={CONTROL_INPUT_CLASS}
            style={CONTROL_INPUT_STYLE}
          />
        </ControlField>
        <ControlField label="Memory metadata JSON">
          <textarea
            required
            rows={4}
            spellCheck={false}
            value={draft.metadata}
            onChange={(event) => setDraft({ ...draft, metadata: event.target.value })}
            className={`${CONTROL_INPUT_CLASS} font-mono`}
            style={CONTROL_INPUT_STYLE}
          />
        </ControlField>
        <ControlField label="Memory expiry" hint="Leave blank for no expiry.">
          <input
            type="datetime-local"
            value={draft.expiresAt}
            onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
            className={CONTROL_INPUT_CLASS}
            style={CONTROL_INPUT_STYLE}
          />
        </ControlField>
        <div className="flex flex-wrap gap-2">
          <ControlButton
            type="submit"
            busy={busy === 'update'}
            disabled={busy !== null || conflicted}
          >
            Save memory changes
          </ControlButton>
          {conflicted ? (
            <ControlButton disabled={busy !== null} onClick={() => void load()}>
              Refresh current memory
            </ControlButton>
          ) : null}
          {!confirmDelete ? (
            <ControlButton
              danger
              disabled={busy !== null || conflicted}
              onClick={() => setConfirmDelete(true)}
            >
              Delete memory
            </ControlButton>
          ) : null}
        </div>
      </form>

      {confirmDelete ? (
        <div
          role="alertdialog"
          aria-label="Confirm memory deletion"
          className="rounded-lg p-3"
          style={{ border: '1px solid var(--aurora-border)', background: 'var(--aurora-bg-muted)' }}
        >
          <p className="text-[12px]" style={{ color: 'var(--aurora-text)' }}>
            Soft-delete {memory.scopeKey}? It will be removed from retrieval immediately.
          </p>
          <div className="mt-3 flex gap-2">
            <ControlButton
              danger
              busy={busy === 'delete'}
              disabled={busy !== null || conflicted}
              onClick={() => void remove()}
            >
              Confirm delete memory
            </ControlButton>
            <ControlButton disabled={busy !== null} onClick={() => setConfirmDelete(false)}>
              Keep memory
            </ControlButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
