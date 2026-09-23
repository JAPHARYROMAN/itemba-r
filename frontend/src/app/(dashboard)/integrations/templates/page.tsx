'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, ConfirmDialog, Btn, PageSpinner, FormInput, FormSelect, FormTextarea, showToast, ErrorState } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';
import { backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

interface MessageTemplate {
  id: string;
  templateCode: string;
  name: string;
  channel: string;
  templateType: string;
  status: string;
  subject?: string;
  body: string;
  variables?: Record<string, unknown> | null;
}

const CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP', 'PUSH', 'IN_APP'];
const TEMPLATE_TYPES = ['GENERAL', 'PAYMENT_RECEIPT', 'APPROVAL_NOTIFICATION', 'COMPLIANCE_REMINDER', 'DOCUMENT_EXPIRY', 'LICENSE_EXPIRY', 'BOOKING_CONFIRMATION', 'RENT_REMINDER', 'PARKING_RECEIPT', 'PAYSLIP_NOTIFICATION'];

const EMPTY_FORM = { templateCode: '', name: '', channel: 'SMS', templateType: 'GENERAL', subject: '', body: '', variables: '{}', status: 'ACTIVE' };

export default function MessageTemplatesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('message_templates.view');
  const canManage = hasPermission('message_templates.manage');
  const beginRequest = useRequestGuard();

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/backend/message-templates?limit=50', { signal: request.signal });
      if (!request.current()) return;
      const data = await res.json().catch(() => ({}));
      if (!request.current()) return;
      if (!res.ok) throw new Error(data?.message ?? 'Failed to load message templates.');
      setTemplates(unwrapList(data));
    } catch (err) {
      if (!request.current()) return;
      setTemplates([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load message templates.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }
  function openEdit(t: MessageTemplate) {
    setEditing(t);
    setForm({ templateCode: t.templateCode, name: t.name, channel: t.channel, templateType: t.templateType, subject: t.subject ?? '', body: t.body, variables: JSON.stringify(t.variables ?? {}, null, 2), status: t.status });
    setError(''); setModalOpen(true);
  }

  async function save() {
    setSaving(true); setError('');
    try {
      let vars = {};
      try { vars = JSON.parse(form.variables); } catch { throw new Error('Invalid JSON in Variables'); }
      const body: Record<string, unknown> = { name: form.name, channel: form.channel, templateType: form.templateType, body: form.body, variables: vars, status: form.status };
      if (form.subject) body.subject = form.subject;
      if (editing) {
        await backendPatch(`/message-templates/${editing.id}`, body);
      } else {
        await backendPost('/message-templates', { ...body, templateCode: form.templateCode });
      }
      setModalOpen(false); load();
      showToast('success', editing ? 'Template updated' : 'Template created');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function doDelete() {
    if (!deleting) return;
    try {
      await backendDelete(`/message-templates/${deleting.id}`);
      showToast('success', 'Template deleted');
      setDeleting(null); load();
    } catch (e: unknown) {
      showToast('error', 'Delete failed', e instanceof ApiError ? e.message : undefined);
      setDeleting(null);
    }
  }

  if (authLoading) return <div className="p-6"><PageHeader title="Message Templates" subtitle="Loading" /></div>;
  if (!canView) return <div className="p-6"><PageHeader title="Message Templates" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Message Templates" subtitle="Manage reusable message templates" />

      <PageToolbar
        actions={canManage ? <Btn variant="primary" onClick={openCreate}>+ New Template</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : (
          <WorkspaceTable className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr><td colSpan={canManage ? 6 : 5} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No templates found</td></tr>
              ) : templates.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{t.templateCode}</td>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.channel} /></td>
                  <td className="px-4 py-3">{t.templateType}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  {canManage && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => openEdit(t)}>Edit</Btn>
                      <Btn variant="ghost" size="xs" onClick={() => setDeleting(t)}>Delete</Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </WorkspaceTable>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Template' : 'New Template'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} loading={saving}>Save</Btn>
          </>
        }
      >
        {error && <div role="alert" className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <FormInput label="Template Code" required disabled={!!editing} value={form.templateCode} onChange={e => setForm(f => ({ ...f, templateCode: e.target.value }))} />
          <FormInput label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <FormSelect label="Channel" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormSelect label="Template Type" value={form.templateType} onChange={e => setForm(f => ({ ...f, templateType: e.target.value }))}>
            {TEMPLATE_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
          </FormSelect>
          {form.channel === 'EMAIL' && (
            <FormInput label="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          )}
          <FormTextarea label="Body" required value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={5} />
          <FormTextarea label="Variables (JSON)" value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))} rows={3} className="font-mono" />
          <FormSelect label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {['ACTIVE','INACTIVE','DRAFT'].map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete Template"
        message={`Delete template "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
