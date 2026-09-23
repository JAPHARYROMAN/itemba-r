'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import { type PartnerKind, partnerLabel } from './trading-partner-types';

export function ProfileSections<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <nav ref={ref} className="partner-profile-tabs" aria-label="Profile sections">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          aria-controls="partner-profile-section"
          onClick={() => onChange(item)}
          onKeyDown={(e) => {
            const i = items.indexOf(item);
            const next =
              e.key === 'ArrowRight'
                ? (i + 1) % items.length
                : e.key === 'ArrowLeft'
                  ? (i - 1 + items.length) % items.length
                  : e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? items.length - 1
                      : -1;
            if (next >= 0) {
              e.preventDefault();
              ref.current?.querySelectorAll('button')[next]?.focus();
            }
          }}
        >
          {item}
        </button>
      ))}
    </nav>
  );
}
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function PartnerStatementGenerator({
  kind,
  record,
  onGenerated,
}: {
  kind: PartnerKind;
  record: { id: string; name: string; companyId: string };
  onGenerated: () => void;
}) {
  const { hasPermission } = useAuth();
  const label = partnerLabel(kind).toLowerCase();
  const allowed = hasPermission(`${label}_statements.generate`);
  const [form, setForm] = useState(() => {
    const now = new Date();
    return {
      periodStart: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      periodEnd: localDate(now),
    };
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useFormGuard(form, setForm),
    id = useId();
  if (!allowed) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !hasPermission(`${label}_statements.generate`)) return;
    const valid = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(form.periodStart) || !valid(form.periodEnd) || form.periodStart > form.periodEnd) {
      setError('Choose valid dates with the end on or after the start.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await backendPost(`/${label}-statements/generate`, {
        companyId: record.companyId,
        [`${label}Id`]: record.id,
        ...form,
      });
      draft.markSaved();
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate this statement.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form id={id} className="partner-statement-form" {...draft.capture} onSubmit={submit}>
      <div className="partner-statement-heading">
        <h3>Generate statement</h3>
        <p>Create a statement for {record.name}. This does not send it.</p>
      </div>
      <FormDateField
        label="Period start"
        required
        value={form.periodStart}
        disabled={busy}
        onChange={(value) => setForm((p) => ({ ...p, periodStart: value }))}
      />
      <FormDateField
        label="Period end"
        required
        value={form.periodEnd}
        disabled={busy}
        onChange={(value) => setForm((p) => ({ ...p, periodEnd: value }))}
      />
      <Btn type="submit" loading={busy}>
        Generate statement
      </Btn>
      {error && (
        <p role="alert" className="workspace-notice partner-statement-heading">
          {error}
        </p>
      )}
    </form>
  );
}
