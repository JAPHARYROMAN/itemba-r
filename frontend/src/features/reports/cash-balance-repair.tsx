'use client';
import { useState } from 'react';
import { Btn, Modal } from '@/components/ui';
import { backendPost } from '@/lib/api-client';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { money } from '@/features/invoice-desk/types';

type Review = {
  currency: string;
  deskBalance: string;
  erpBalance: string;
  delta: string;
  fingerprint: string;
  canApply: boolean;
  rows: {
    id: string;
    movementId: string;
    description: string;
    amount: string;
    businessDate: string;
  }[];
};

export function CashBalanceRepair({
  id,
  name,
  onClose,
  onSaved,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const path = `/cash-connections/accounts/${encodeURIComponent(id)}/balance-repair`;
  const resource = useWorkspaceResource<Review>(path, {});
  const [verified, setVerified] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const review = resource.data;
  const save = async () => {
    if (!review || !review.canApply || verified !== review.fingerprint || saving) return;
    setSaving(true);
    setError('');
    try {
      await backendPost(path, { fingerprint: review.fingerprint });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the missing deductions.');
      setVerified('');
      resource.reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={`Review cash deductions · ${name}`}
      onClose={saving ? () => {} : onClose}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn
            onClick={save}
            loading={saving}
            disabled={!review?.canApply || verified !== review.fingerprint}
          >
            Apply missing deductions
          </Btn>
        </>
      }
    >
      {resource.loading && <p role="status">Reviewing recorded expenses…</p>}
      {(error || resource.error) && <p role="alert">{error || resource.error}</p>}
      {review && (
        <div className="space-y-3">
          <p>
            Cash Desk: {money(review.deskBalance, review.currency)}. Connected cash account:{' '}
            {money(review.erpBalance, review.currency)}.
          </p>
          <p>
            These expenses are already in Cash Desk. Their cash deductions have not reached the
            connected account.
          </p>
          <ul>
            {review.rows.map((r) => (
              <li key={r.id}>
                {r.businessDate} · {r.description} · {money(r.amount, review.currency)}
              </li>
            ))}
          </ul>
          <p>Missing deductions: {money(review.delta, review.currency)}.</p>
          {review.canApply ? (
            <label className="flex gap-2 items-start">
              <input
                type="checkbox"
                checked={verified === review.fingerprint}
                onChange={(e) => setVerified(e.target.checked ? review.fingerprint : '')}
              />
              I verified that these expenses were paid and the actual cash available is{' '}
              {money(review.deskBalance, review.currency)}.
            </label>
          ) : (
            <p role="alert">
              These entries do not explain the balance difference. Review the account history before
              making a correction.
            </p>
          )}
          <p>
            Applying updates the connected cash balance once. The existing movements and journal
            entries are preserved.
          </p>
        </div>
      )}
    </Modal>
  );
}
