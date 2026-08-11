'use client';

import { useState, useEffect, useCallback } from 'react';
import { Btn, ErrorState, Modal, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendPost, backendPut } from '@/lib/api-client';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  PASSED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const RUN_TYPES = [
  { value: 'COMPANY_SCOPE', label: 'Company Scope' },
  { value: 'DIVISION_SCOPE', label: 'Division Scope' },
  { value: 'BRANCH_SCOPE', label: 'Branch Scope' },
  { value: 'BUSINESS_UNIT_SCOPE', label: 'Business Unit Scope' },
  { value: 'PERMISSION_SCOPE', label: 'Permission Scope' },
  { value: 'GROUP_CONTROL_SCOPE', label: 'Group Control Scope' },
  { value: 'CUSTOM', label: 'Custom' },
];

const ISSUE_TYPES = [
  { value: 'CROSS_COMPANY_LEAK', label: 'Cross Company Leak' },
  { value: 'MISSING_COMPANY_FILTER', label: 'Missing Company Filter' },
  { value: 'PERMISSION_BYPASS', label: 'Permission Bypass' },
  { value: 'GROUP_CONTROL_BYPASS', label: 'Group Control Bypass' },
  { value: 'SENSITIVE_DATA_EXPOSURE', label: 'Sensitive Data Exposure' },
  { value: 'BRANCH_SCOPE_LEAK', label: 'Branch Scope Leak' },
  { value: 'BUSINESS_UNIT_SCOPE_LEAK', label: 'Business Unit Scope Leak' },
  { value: 'OTHER', label: 'Other' },
];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface TestRun {
  id: string;
  testRunNumber?: string | null;
  runType?: string | null;
  status?: string | null;
  totalChecks?: number | null;
  passedChecks?: number | null;
  failedChecks?: number | null;
  startedAt?: string | null;
}

const errorBanner = 'mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2';

function CompleteRunModal({ run, onClose, onSaved }: { run: TestRun; onClose: () => void; onSaved: () => void }) {
  const [passedChecks, setPassedChecks] = useState(String(run.totalChecks ?? 0));
  const [failedChecks, setFailedChecks] = useState('0');
  const [resultSummary, setResultSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await backendPut(`/data-isolation-tests/${run.id}/complete`, {
        passedChecks: Number(passedChecks) || 0,
        failedChecks: Number(failedChecks) || 0,
        resultSummary: resultSummary.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete test run');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Complete ${run.testRunNumber ?? 'Test Run'}`}
      subtitle="Status is derived from passed vs failed check counts"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="success" onClick={submit} loading={saving}>Complete Run</Btn></>}>
      {error && <div className={errorBanner}>{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Passed Checks" type="number" min={0} value={passedChecks} onChange={(e) => setPassedChecks(e.target.value)} />
        <FormInput label="Failed Checks" type="number" min={0} value={failedChecks} onChange={(e) => setFailedChecks(e.target.value)} />
        <div className="col-span-2">
          <FormTextarea label="Result Summary" rows={3} value={resultSummary} onChange={(e) => setResultSummary(e.target.value)} placeholder="Optional notes on the outcome" />
        </div>
      </div>
    </Modal>
  );
}

interface IssueForm { issueType: string; severity: string; entityType: string; endpoint: string; description: string }
const BLANK_ISSUE: IssueForm = { issueType: 'CROSS_COMPANY_LEAK', severity: 'MEDIUM', entityType: '', endpoint: '', description: '' };

function LogIssueModal({ run, onClose, onSaved }: { run: TestRun; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<IssueForm>({ ...BLANK_ISSUE });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof IssueForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.description.trim()) { setError('Description is required'); return; }
    setSaving(true); setError('');
    try {
      await backendPost(`/data-isolation-tests/${run.id}/issues`, {
        issueType: form.issueType,
        severity: form.severity,
        description: form.description.trim(),
        entityType: form.entityType.trim() || undefined,
        endpoint: form.endpoint.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log issue');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Log Issue — ${run.testRunNumber ?? 'Test Run'}`} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Log Issue</Btn></>}>
      {error && <div className={errorBanner}>{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Issue Type" required value={form.issueType} onChange={(e) => set('issueType', e.target.value)} options={ISSUE_TYPES} />
        <FormSelect label="Severity" required value={form.severity} onChange={(e) => set('severity', e.target.value)}>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Entity Type" value={form.entityType} onChange={(e) => set('entityType', e.target.value)} placeholder="e.g. Invoice" />
        <FormInput label="Endpoint" value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="e.g. GET /invoices" />
        <div className="col-span-2">
          <FormTextarea label="Description" required rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function DataIsolationTestRunsPage() {
  const { hasPermission } = useAuth();
  const canRunTests = hasPermission('data_isolation.run_tests');

  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [runType, setRunType] = useState('COMPANY_SCOPE');
  const [saving, setSaving] = useState(false);
  const [runError, setRunError] = useState('');
  const [completing, setCompleting] = useState<TestRun | null>(null);
  const [loggingIssue, setLoggingIssue] = useState<TestRun | null>(null);

  const fetchTestRuns = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetch('/api/backend/data-isolation-tests')
      .then(r => r.json())
      .then(res => setTestRuns(res.data ?? res.testRuns ?? res ?? []))
      .catch(() => { setTestRuns([]); setLoadError('Failed to load isolation test runs.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTestRuns(); }, [fetchTestRuns]);

  async function runNewTest() {
    setSaving(true);
    setRunError('');
    try {
      const res = await fetch('/api/backend/data-isolation-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runType }),
      });
      if (res.ok) {
        setShowModal(false);
        fetchTestRuns();
      } else {
        const j = await res.json().catch(() => ({}));
        setRunError(Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Failed to start test run'));
      }
    } finally {
      setSaving(false);
    }
  }

  const colCount = canRunTests ? 9 : 8;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Isolation Test Runs</h1>
          <p className="text-gray-500 mt-1">Data isolation and multi-tenancy boundary test executions</p>
        </div>
        {canRunTests && (
          <button onClick={() => { setRunError(''); setShowModal(true); }} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            + Run New Test
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Test Run #</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total Checks</th>
              <th className="px-4 py-3">Passed</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3">Started At</th>
              <th className="px-4 py-3">Issues</th>
              {canRunTests && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="px-4 py-6"><PageSpinner label="Loading records" className="py-8" /></td></tr>
            ) : loadError ? (
              <tr><td colSpan={colCount} className="px-4 py-6"><ErrorState message={loadError} onRetry={fetchTestRuns} /></td></tr>
            ) : testRuns.length === 0 ? (
              <tr><td colSpan={colCount} className="px-4 py-10 text-center text-gray-400">No test runs found</td></tr>
            ) : testRuns.map((t) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.testRunNumber ?? t.id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{t.runType ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>{t.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3">{t.totalChecks ?? '—'}</td>
                <td className="px-4 py-3 text-green-700">{t.passedChecks ?? '—'}</td>
                <td className="px-4 py-3 text-red-700">{t.failedChecks ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{t.startedAt ? new Date(t.startedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <Link href="/data-isolation/issues" className="px-2 py-1 text-xs bg-orange-50 text-orange-700 rounded hover:bg-orange-100">
                    View Issues
                  </Link>
                </td>
                {canRunTests && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex gap-1">
                      {t.status === 'RUNNING' && <Btn variant="success" size="xs" onClick={() => setCompleting(t)}>Complete</Btn>}
                      <Btn variant="ghost" size="xs" onClick={() => setLoggingIssue(t)}>Log Issue</Btn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Run New Test Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Run New Isolation Test</h2>
            {runError && <div className={errorBanner}>{runError}</div>}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Run Type *</label>
              <select value={runType} onChange={e => setRunType(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {RUN_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={runNewTest} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Running...' : 'Run Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {completing && <CompleteRunModal run={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); fetchTestRuns(); }} />}
      {loggingIssue && <LogIssueModal run={loggingIssue} onClose={() => setLoggingIssue(null)} onSaved={() => { setLoggingIssue(null); fetchTestRuns(); }} />}
    </div>
  );
}
