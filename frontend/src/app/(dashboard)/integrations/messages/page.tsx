'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface ExternalMessage {
  id: string;
  messageNumber: string;
  channel: string;
  recipient: string;
  recipientType: string;
  status: string;
  subject: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

interface Template {
  id: string;
  name: string;
  channel: string;
}

const EMPTY_FORM = { recipient: '', channel: 'SMS', subject: '', body: '', templateId: '', recipientType: 'PHONE' };

export default function ExternalMessagesPage() {
  const [messages, setMessages] = useState<ExternalMessage[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterChannel) params.set('channel', filterChannel);
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/backend/external-messages?${params}`)
      .then(r => r.json())
      .then(data => setMessages(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterChannel, filterStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/backend/message-templates?limit=100').then(r => r.json()).then(data => setTemplates(unwrapList(data))).catch(() => {});
  }, []);

  async function send() {
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = { recipient: form.recipient, channel: form.channel, body: form.body, recipientType: form.recipientType };
      if (form.subject) body.subject = form.subject;
      if (form.templateId) body.templateId = form.templateId;
      const res = await fetch('/api/backend/external-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Send failed'); }
      setModalOpen(false); setForm({ ...EMPTY_FORM }); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Send failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="External Messages" subtitle="Outgoing messages via SMS, Email, WhatsApp" />

      <PageToolbar
        filters={
          <>
            <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Channels</option>
              {['SMS','EMAIL','WHATSAPP','PUSH'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>
              {['QUEUED','PENDING','SENT','DELIVERED','FAILED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={<Btn variant="primary" onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }}>+ Send Message</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Sent At</th>
                <th className="px-4 py-3">Delivered At</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No messages found</td></tr>
              ) : messages.map(m => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{m.messageNumber}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.channel} /></td>
                  <td className="px-4 py-3">{m.recipient}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>{m.recipientType}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>{m.subject || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{m.deliveredAt ? new Date(m.deliveredAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Send Message"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={send} loading={saving}>Send</Btn>
          </>
        }
      >
        {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <FormSelect label="Channel" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            {['SMS','EMAIL','WHATSAPP','PUSH'].map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormInput label="Recipient" required value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} placeholder="+2637XXXXXXXX or email@example.com" />
          {form.channel === 'EMAIL' && (
            <FormInput label="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          )}
          <FormTextarea label="Body" required value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} />
          <FormSelect label="Template (optional)" value={form.templateId} onChange={e => setForm(f => ({ ...f, templateId: e.target.value }))}>
            <option value="">None</option>
            {templates.filter(t => t.channel === form.channel || !t.channel).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FormSelect>
        </div>
      </Modal>
    </div>
  );
}
