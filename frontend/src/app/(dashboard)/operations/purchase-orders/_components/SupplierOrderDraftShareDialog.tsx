'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Mail, MessageCircle, Share2 } from 'lucide-react';
import { Btn, FormInput, FormTextarea, Modal, showToast } from '@/components/ui';
import { backendPost } from '@/lib/api-client';
import type { SupplierOrderDraft } from './supplier-order-draft-types';
import {
  auditSupplierOrderDraftShare,
  canNativeSharePdf,
  downloadPreparedSupplierOrderDraftPdf,
  emailShareUrl,
  nativeShareSupplierOrderDraftPdf,
  prepareSupplierOrderDraftPdf,
  type PreparedSupplierOrderDraftPdf,
  whatsappShareUrl,
} from './share-supplier-order-draft-pdf';

interface EmailResult {
  sent: boolean;
  recipient: string;
  fileName: string;
  generatedDocumentId: string;
  message: string;
}

interface Props {
  open: boolean;
  draft: SupplierOrderDraft;
  onClose: () => void;
}

function defaultMessage(draft: SupplierOrderDraft) {
  return `Please find attached supplier order draft ${draft.draftNumber} from ${draft.company?.name || 'ITEMBA GROUP'} for your review.`;
}

function parseCc(value: string) {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SupplierOrderDraftShareDialog({ open, draft, onClose }: Props) {
  const [prepared, setPrepared] = useState<PreparedSupplierOrderDraftPdf | null>(null);
  const [prepareError, setPrepareError] = useState('');
  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState(draft.supplierEmail || '');
  const [cc, setCc] = useState('');
  const [phone, setPhone] = useState(draft.supplierPhone || '');
  const [message, setMessage] = useState(() => defaultMessage(draft));
  const subject = useMemo(() => `${draft.draftNumber} - Supplier Order Draft`, [draft.draftNumber]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPrepared(null);
    setPrepareError('');
    setEmail(draft.supplierEmail || '');
    setCc('');
    setPhone(draft.supplierPhone || '');
    setMessage(defaultMessage(draft));
    void prepareSupplierOrderDraftPdf({ id: draft.id, draftNumber: draft.draftNumber })
      .then((value) => {
        if (!cancelled) setPrepared(value);
      })
      .catch((cause) => {
        if (!cancelled)
          setPrepareError(cause instanceof Error ? cause.message : 'Could not prepare the PDF');
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft]);

  async function emailPdf() {
    if (!email.trim()) {
      showToast('warning', 'Recipient email is required');
      return;
    }
    setBusy('email');
    try {
      const result = await backendPost<EmailResult>(
        `/supplier-order-drafts/${draft.id}/share/email`,
        {
          to: email.trim(),
          cc: parseCc(cc),
          subject,
          message,
        },
      );
      if (result.sent) {
        showToast('success', 'PDF emailed', `Sent to ${result.recipient}`);
        return;
      }
      if (prepared) downloadPreparedSupplierOrderDraftPdf(prepared);
      window.location.href = emailShareUrl({
        to: email.trim(),
        cc,
        subject,
        message: `${message}\n\nAttach the downloaded PDF: ${result.fileName}`,
      });
      showToast(
        'warning',
        'Mail app opened',
        'SMTP delivery was unavailable. Attach the downloaded PDF before sending.',
      );
    } catch (cause) {
      showToast('error', 'Could not email PDF', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy('');
    }
  }

  async function shareWhatsApp() {
    if (!prepared) return;
    setBusy('whatsapp');
    try {
      if (canNativeSharePdf(prepared.file)) {
        await nativeShareSupplierOrderDraftPdf({
          prepared,
          draftNumber: draft.draftNumber,
          supplierName: draft.supplierName,
          message,
        });
      } else {
        downloadPreparedSupplierOrderDraftPdf(prepared);
        window.open(
          whatsappShareUrl(phone, `${message}\n\nAttach the downloaded PDF: ${prepared.file.name}`),
          '_blank',
          'noopener,noreferrer',
        );
        showToast('info', 'WhatsApp opened', 'Attach the downloaded PDF to the prepared message.');
      }
      await auditSupplierOrderDraftShare(draft.id, 'WHATSAPP');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      showToast(
        'error',
        'Could not share to WhatsApp',
        cause instanceof Error ? cause.message : undefined,
      );
    } finally {
      setBusy('');
    }
  }

  async function shareMore() {
    if (!prepared) return;
    setBusy('more');
    try {
      const shared = await nativeShareSupplierOrderDraftPdf({
        prepared,
        draftNumber: draft.draftNumber,
        supplierName: draft.supplierName,
        message,
      });
      if (!shared) {
        downloadPreparedSupplierOrderDraftPdf(prepared);
        showToast('success', 'PDF downloaded', 'This browser does not provide an app share sheet.');
      }
      await auditSupplierOrderDraftShare(draft.id, shared ? 'NATIVE_SHARE' : 'DOWNLOAD');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      showToast('error', 'Could not share PDF', cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy('');
    }
  }

  async function downloadPdf() {
    if (!prepared) return;
    downloadPreparedSupplierOrderDraftPdf(prepared);
    await auditSupplierOrderDraftShare(draft.id, 'DOWNLOAD');
    showToast('success', 'PDF downloaded', prepared.file.name);
  }

  async function copyInternalLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/operations/purchase-orders/order-drafts/${draft.id}`,
    );
    showToast('success', 'Internal link copied', 'Recipients must sign in to ITEMBA-R to open it.');
  }

  const pdfReady = Boolean(prepared) && !prepareError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${draft.draftNumber}`}
      subtitle="Send the generated supplier PDF through a delivery channel."
      size="lg"
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Close
        </Btn>
      }
    >
      <div className="space-y-5">
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${prepareError ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
        >
          {prepareError ||
            (prepared
              ? `${prepared.file.name} is ready to share.`
              : 'Preparing the branded PDF...')}
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold">Email with PDF attached</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormInput
              label="Recipient email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="supplier@example.com"
            />
            <FormInput
              label="CC (optional)"
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              placeholder="accounts@example.com, manager@example.com"
            />
          </div>
          <Btn icon={<Mail className="h-4 w-4" />} loading={busy === 'email'} onClick={emailPdf}>
            Email PDF
          </Btn>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            If server email is unavailable, the PDF downloads and your mail app opens with the
            message prepared.
          </p>
        </section>

        <section
          className="space-y-3 border-t pt-5"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold">WhatsApp or WhatsApp Business</h3>
          </div>
          <FormInput
            label="Supplier phone (used by WhatsApp Web fallback)"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+255 ..."
          />
          <Btn
            variant="success"
            icon={<MessageCircle className="h-4 w-4" />}
            loading={busy === 'whatsapp'}
            disabled={!pdfReady}
            onClick={shareWhatsApp}
          >
            Share PDF to WhatsApp
          </Btn>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            On phones, choose WhatsApp or WhatsApp Business from the app share sheet. On desktop,
            the PDF downloads before WhatsApp Web opens.
          </p>
        </section>

        <section
          className="space-y-3 border-t pt-5"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <FormTextarea
            label="Message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="secondary"
              icon={<Share2 className="h-4 w-4" />}
              loading={busy === 'more'}
              disabled={!pdfReady}
              onClick={shareMore}
            >
              More Apps
            </Btn>
            <Btn
              variant="secondary"
              icon={<Download className="h-4 w-4" />}
              disabled={!pdfReady}
              onClick={downloadPdf}
            >
              Download PDF
            </Btn>
            <Btn variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={copyInternalLink}>
              Copy Internal Link
            </Btn>
          </div>
        </section>
      </div>
    </Modal>
  );
}
