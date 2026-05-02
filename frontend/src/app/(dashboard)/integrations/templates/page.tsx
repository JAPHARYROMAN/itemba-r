'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface MessageTemplate {
  id: string;
  templateCode: string;
  name: string;
  channel: string;
  templateType: string;
  status: string;
  subject?: string;
  body: string;
}

const EMPTY_FORM = { templateCode: '', name: '', channel: 'SMS', templateType: 'TRANSACTIONAL', subject: '', body: '', variables: '{}', status: 'ACTIVE' };

export default function MessageTemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/message-templates?limit=50')
      .then(r => r.json())
      .then(data => setTemplates(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }
  function openEdit(t: MessageTemplate) {
    setEditing(t);
    setForm({ templateCode: t.templateCode, name: t.name, channel: t.channel, templateType: t.templateType, subject: t.subject ?? '', body: t.body, variables: '{}', status: t.status });
    setError(''); setModalOpen(true);
  }

  async function save() {
    setSaving(true); setError('');
    try {
      let vars = {};
      try { vars = JSON.parse(form.variables); } catch { throw new Error('Invalid JSON in Variables'); }
      const body: Record<string, unknown> = { templateCode: form.templateCode, name: form.name, channel: form.channel, templateType: form.templateType, body: form.body, variables: vars, status: form.status };
      if (form.subject) body.subject = form.subject;
      const url = editing ? `/api/backend/message-templates/${editing.id}` : '/api/backend/message-templates';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      setModalOpen(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Message Templates" subtitle="Manage reusable message templates" />

      <PageToolbar
        actions={<Btn variant="primary" onClick={openCreate}>+ New Template</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No templates found</td></tr>
              ) : templates.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{t.templateCode}</td>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.channel} /></td>
                  <td className="px-4 py-3">{t.templateType}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3">
                    <Btn variant="ghost" size="xs" onClick={() => openEdit(t)}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <FormInput label="Template Code" required value={form.templateCode} onChange={e => setForm(f => ({ ...f, templateCode: e.target.value }))} />
          <FormInput label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <FormSelect label="Channel" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            {['SMS','EMAIL','WHATSAPP','PUSH'].map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormInput label="Template Type" value={form.templateType} onChange={e => setForm(f => ({ ...f, templateType: e.target.value }))} placeholder="TRANSACTIONAL, MARKETING, OTP…" />
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
    </div>
  );
}