'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Btn,
  Card,
  ConfirmDialog,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  StatusBadge,
} from '@/components/ui';
import { ApiError, backendDelete, backendPatch } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface DisputeDetail {
  id: string;
  disputeNumber: string;
  type: string;
  status: string;
  raisedAt: string;
  summary: string;
  initialPosition: string | null;
  mediatedAt: string | null;
  mediationOutcome: string | null;
  cmaReferenceNumber: string | null;
  cmaReferredAt: string | null;
  cmaArbitrator: string | null;
  cmaHearingDate: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  resolutionAmount: number | string | null;
  resolutionNotes: string | null;
  notes: string | null;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string | null;
    firstName: string;
    lastName: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
  };
  raisedBy: { fullName: string } | null;
  mediatedBy: { fullName: string } | null;
  cmaReferredBy: { fullName: string } | null;
  resolvedBy: { fullName: string } | null;
  disciplinaryActions: Array<{
    id: string;
    actionNumber: string;
    type: string;
    status: string;
    issuedAt: string;
    reason: string;
  }>;
}

const TYPE_OPTIONS = [
  { value: 'GRIEVANCE', label: 'Grievance' },
  { value: 'WAGE_DISPUTE', label: 'Wage dispute' },
  { value: 'WORKING_CONDITIONS', label: 'Working conditions' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'DISCRIMINATION', label: 'Discrimination' },
  { value: 'UNFAIR_TERMINATION', label: 'Unfair termination' },
  { value: 'CONSTRUCTIVE_DISMISSAL', label: 'Constructive dismissal' },
  { value: 'CONTRACT_BREACH', label: 'Contract breach' },
  { value: 'OTHER', label: 'Other' },
];

const RESOLUTION_OPTIONS = [
  { value: 'SETTLED_INTERNALLY', label: 'Settled internally' },
  { value: 'CMA_AWARD_FOR_EMPLOYEE', label: 'CMA award — for employee' },
  { value: 'CMA_AWARD_FOR_EMPLOYER', label: 'CMA award — for employer' },
  { value: 'WITHDRAWN_BY_EMPLOYEE', label: 'Withdrawn by employee' },
  { value: 'ABANDONED', label: 'Abandoned' },
  { value: 'OTHER', label: 'Other' },
];

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DisputeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('employees.update');
  const canDelete = hasPermission('employees.delete');
  const id = params.id as string;
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Action modals
  const [mediateOpen, setMediateOpen] = useState(false);
  const [mediateOutcome, setMediateOutcome] = useState('');
  const [referOpen, setReferOpen] = useState(false);
  const [referForm, setReferForm] = useState({
    cmaReferenceNumber: '',
    cmaHearingDate: '',
    cmaArbitrator: '',
  });
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveForm, setResolveForm] = useState({
    resolutionType: 'SETTLED_INTERNALLY',
    resolutionAmount: '',
    resolutionNotes: '',
  });
  const [working, setWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    type: 'GRIEVANCE',
    raisedAt: '',
    summary: '',
    initialPosition: '',
    notes: '',
  });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/backend/hr/employment-disputes/${id}`);
    const j = await r.json();
    setDispute(j.data ?? j);
    setLoading(false);
  }, [id]);
  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const callAction = async (path: string, body: Record<string, unknown> = {}) => {
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/hr/employment-disputes/${id}/${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Action failed'),
        );
      }
      load();
      setMediateOpen(false);
      setReferOpen(false);
      setResolveOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setWorking(false);
    }
  };

  const openEdit = () => {
    if (!dispute) return;
    setEditForm({
      type: dispute.type,
      raisedAt: dispute.raisedAt?.split('T')[0] ?? '',
      summary: dispute.summary,
      initialPosition: dispute.initialPosition ?? '',
      notes: dispute.notes ?? '',
    });
    setEditError('');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editForm.summary.trim()) {
      setEditError('Summary is required');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await backendPatch(`/hr/employment-disputes/${id}`, {
        type: editForm.type,
        raisedAt: editForm.raisedAt || undefined,
        summary: editForm.summary.trim(),
        initialPosition: editForm.initialPosition.trim() || null,
        notes: editForm.notes.trim() || null,
      });
      setEditOpen(false);
      load();
    } catch (err: unknown) {
      setEditError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed',
      );
    } finally {
      setEditSaving(false);
    }
  };

  const doDelete = async () => {
    setError('');
    try {
      await backendDelete(`/hr/employment-disputes/${id}`);
      router.push('/hr/disputes');
    } catch (err: unknown) {
      setDeleteOpen(false);
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed',
      );
    }
  };

  if (loading) return <PageSpinner />;
  if (!dispute) return <div className="p-6 text-sm text-slate-500">Dispute not found.</div>;

  const employeeName =
    dispute.employee.fullName ?? `${dispute.employee.firstName} ${dispute.employee.lastName}`;
  const isClosed = ['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(dispute.status);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={`Dispute ${dispute.disputeNumber}`}
        subtitle={`${employeeName} · ${dispute.type.replace(/_/g, ' ')}`}
        breadcrumbs={[
          { label: 'HR', href: '/hr' },
          { label: 'Disputes', href: '/hr/disputes' },
          { label: dispute.disputeNumber },
        ]}
        actions={
          <Btn variant="secondary" onClick={() => router.back()}>
            ← Back
          </Btn>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Workflow header */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Current status</div>
            <div className="mt-1">
              <StatusBadge status={dispute.status} />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!isClosed && canUpdate && (
              <Btn variant="secondary" size="sm" onClick={openEdit}>
                Edit
              </Btn>
            )}
            {dispute.status === 'RAISED' && (
              <Btn variant="primary" size="sm" onClick={() => setMediateOpen(true)}>
                Start internal mediation →
              </Btn>
            )}
            {['RAISED', 'INTERNAL_MEDIATION'].includes(dispute.status) && (
              <Btn variant="warning" size="sm" onClick={() => setReferOpen(true)}>
                Refer to CMA →
              </Btn>
            )}
            {!isClosed && (
              <Btn variant="success" size="sm" onClick={() => setResolveOpen(true)}>
                Mark resolved
              </Btn>
            )}
            {!isClosed && (
              <Btn variant="ghost" size="sm" onClick={() => callAction('withdraw')}>
                Withdraw
              </Btn>
            )}
            {dispute.status === 'CMA_REFERRED' && (
              <Link href={`/hr/ccm-notices/cma-referral/${dispute.id}`}>
                <Btn variant="secondary" size="sm">
                  Print CMA Form CMA-F1 →
                </Btn>
              </Link>
            )}
            {canDelete && (
              <Btn variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete
              </Btn>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
            Dispute details
          </h3>
          <KvList
            rows={[
              ['Employee', employeeName],
              ['Position', dispute.employee.position?.title],
              ['Department', dispute.employee.department?.name],
              ['Type', dispute.type.replace(/_/g, ' ')],
              ['Raised', fmtDate(dispute.raisedAt)],
              ['Raised by', dispute.raisedBy?.fullName],
              ['Summary', dispute.summary],
              ['Initial position', dispute.initialPosition],
            ]}
          />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
            Workflow trail
          </h3>
          <KvList
            rows={[
              ['Mediated', fmtDate(dispute.mediatedAt)],
              ['Mediated by', dispute.mediatedBy?.fullName],
              ['Outcome', dispute.mediationOutcome],
              ['CMA reference #', dispute.cmaReferenceNumber],
              ['CMA referred on', fmtDate(dispute.cmaReferredAt)],
              ['CMA referred by', dispute.cmaReferredBy?.fullName],
              ['CMA arbitrator', dispute.cmaArbitrator],
              ['CMA hearing date', fmtDate(dispute.cmaHearingDate)],
              ['Resolved', fmtDate(dispute.resolvedAt)],
              ['Resolved by', dispute.resolvedBy?.fullName],
              ['Resolution type', dispute.resolutionType?.replace(/_/g, ' ')],
              [
                'Resolution amount',
                dispute.resolutionAmount != null
                  ? `TZS ${(Number.isFinite(Number(dispute.resolutionAmount)) ? Number(dispute.resolutionAmount).toLocaleString('en-TZ') : '0')}`
                  : null,
              ],
              ['Resolution notes', dispute.resolutionNotes],
            ]}
          />
        </Card>
      </div>

      {/* Linked disciplinary actions */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
          Linked disciplinary actions
        </h3>
        {dispute.disciplinaryActions.length === 0 ? (
          <p className="text-xs text-slate-400 italic">
            No linked actions. Operators can attach disciplinary actions from{' '}
            <Link href="/hr/disciplinary-actions" className="text-indigo-600 hover:underline">
              /hr/disciplinary-actions
            </Link>{' '}
            by selecting this dispute.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead
              className="bg-slate-50 border-b border-slate-100"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Action #
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Type
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Issued
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Reason
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {dispute.disciplinaryActions.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{a.actionNumber}</td>
                  <td className="px-3 py-2 text-xs">{a.type.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(a.issuedAt)}</td>
                  <td className="px-3 py-2 text-sm">{a.reason}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* CCM Form 1 link (always available) */}
      <Card className="p-4 bg-slate-50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Termination notice</div>
            <div className="text-sm mt-1">
              Generate the bilingual Form 1 (Notice of Termination) from this employee&apos;s record
              — used when termination is being formalised.
            </div>
          </div>
          <Link href={`/hr/ccm-notices/termination/${dispute.employee.id}`}>
            <Btn variant="secondary" size="sm">
              Open Form 1 →
            </Btn>
          </Link>
        </div>
      </Card>

      {/* Mediate modal */}
      <Modal
        open={mediateOpen}
        onClose={() => setMediateOpen(false)}
        title="Start internal mediation"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setMediateOpen(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              loading={working}
              onClick={() =>
                callAction('mediate', { mediationOutcome: mediateOutcome.trim() || undefined })
              }
            >
              Start mediation
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Records that internal mediation has begun. Update the outcome later if required.
          </p>
          <FormInput
            label="Initial outcome / notes (optional)"
            value={mediateOutcome}
            onChange={(e) => setMediateOutcome(e.target.value)}
          />
        </div>
      </Modal>

      {/* Refer CMA modal */}
      <Modal
        open={referOpen}
        onClose={() => setReferOpen(false)}
        title="Refer to CMA"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setReferOpen(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              loading={working}
              onClick={() =>
                callAction('refer-cma', {
                  cmaReferenceNumber: referForm.cmaReferenceNumber.trim() || undefined,
                  cmaHearingDate: referForm.cmaHearingDate || undefined,
                  cmaArbitrator: referForm.cmaArbitrator.trim() || undefined,
                })
              }
            >
              Refer
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Marks the dispute as referred to the Commission for Mediation & Arbitration. Form CMA-F1
            is then printable from the dispute page.
          </p>
          <FormInput
            label="CMA reference #"
            value={referForm.cmaReferenceNumber}
            onChange={(e) => setReferForm((p) => ({ ...p, cmaReferenceNumber: e.target.value }))}
          />
          <FormInput
            label="Hearing date"
            type="date"
            value={referForm.cmaHearingDate}
            onChange={(e) => setReferForm((p) => ({ ...p, cmaHearingDate: e.target.value }))}
          />
          <FormInput
            label="Arbitrator name"
            value={referForm.cmaArbitrator}
            onChange={(e) => setReferForm((p) => ({ ...p, cmaArbitrator: e.target.value }))}
          />
        </div>
      </Modal>

      {/* Resolve modal */}
      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Mark dispute resolved"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setResolveOpen(false)}>
              Cancel
            </Btn>
            <Btn
              variant="success"
              loading={working}
              onClick={() =>
                callAction('resolve', {
                  resolutionType: resolveForm.resolutionType,
                  resolutionAmount: resolveForm.resolutionAmount
                    ? Number(resolveForm.resolutionAmount)
                    : undefined,
                  resolutionNotes: resolveForm.resolutionNotes.trim() || undefined,
                })
              }
            >
              Mark resolved
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <FormSelect
            label="Resolution type"
            value={resolveForm.resolutionType}
            onChange={(e) => setResolveForm((p) => ({ ...p, resolutionType: e.target.value }))}
            options={RESOLUTION_OPTIONS}
          />
          <FormInput
            label="Resolution amount (TZS, optional)"
            type="number"
            step="0.01"
            value={resolveForm.resolutionAmount}
            onChange={(e) => setResolveForm((p) => ({ ...p, resolutionAmount: e.target.value }))}
          />
          <FormInput
            label="Resolution notes"
            value={resolveForm.resolutionNotes}
            onChange={(e) => setResolveForm((p) => ({ ...p, resolutionNotes: e.target.value }))}
          />
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit dispute ${dispute.disputeNumber}`}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" loading={editSaving} onClick={saveEdit}>
              Save changes
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          {editError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {editError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Dispute type"
              value={editForm.type}
              onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value }))}
              options={TYPE_OPTIONS}
            />
            <FormInput
              label="Raised on"
              type="date"
              value={editForm.raisedAt}
              onChange={(e) => setEditForm((p) => ({ ...p, raisedAt: e.target.value }))}
            />
          </div>
          <FormInput
            label="Summary *"
            value={editForm.summary}
            onChange={(e) => setEditForm((p) => ({ ...p, summary: e.target.value }))}
            hint="One-line description of the dispute"
          />
          <FormInput
            label="Initial position"
            value={editForm.initialPosition}
            onChange={(e) => setEditForm((p) => ({ ...p, initialPosition: e.target.value }))}
            hint="Employee's claimed remedy or initial demand"
          />
          <FormInput
            label="Notes"
            value={editForm.notes}
            onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete dispute"
        message={`Delete dispute ${dispute.disputeNumber}? It will be removed from the disputes register.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function KvList({ rows }: { rows: Array<[string, unknown]> }) {
  const visible = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (visible.length === 0) return <p className="text-xs italic text-slate-400">No data.</p>;
  return (
    <dl className="space-y-2">
      {visible.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="text-xs w-32 flex-shrink-0" style={{ color: 'var(--aurora-text-muted)' }}>
            {label}
          </dt>
          <dd className="text-sm" style={{ color: 'var(--aurora-text)' }}>
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
