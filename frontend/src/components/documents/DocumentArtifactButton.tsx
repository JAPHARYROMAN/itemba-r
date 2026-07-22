'use client';

import { useState } from 'react';
import { backendPost } from '@/lib/api-client';

export type DocumentEntityType =
  | 'SALES_ORDER'
  | 'PURCHASE_ORDER'
  | 'SUPPLIER_ORDER_DRAFT'
  | 'QUOTATION'
  | 'PROFORMA_INVOICE'
  | 'DELIVERY_NOTE'
  | 'CUSTOMER_PROFILE'
  | 'CUSTOMER_DEBT_STATEMENT'
  | 'GOODS_RECEIVED_NOTE'
  | 'SUPPLIER_INVOICE'
  | 'PAYSLIP'
  | 'CREDIT_NOTE'
  | 'CUSTOMER_PAYMENT_RECEIPT';

interface GeneratedDocumentResponse {
  generatedDocument?: {
    id: string;
  };
  document: {
    id: string;
    fileName: string;
  };
}

export function DocumentArtifactButton({
  entityType,
  entityId,
  buttonLabel = 'Generate PDF',
  compact = false,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  buttonLabel?: string;
  compact?: boolean;
}) {
  const [downloadHref, setDownloadHref] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const result = await backendPost<GeneratedDocumentResponse>('/generated-documents/pdf', {
        entityType,
        entityId,
      });
      const href = result.generatedDocument?.id
        ? `/api/backend/generated-documents/${result.generatedDocument.id}/download?inline=1`
        : `/api/backend/documents/${result.document.id}/download?inline=1`;
      setDownloadHref(href);
      window.open(href, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate PDF');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className={`inline-flex items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900 font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 ${
          compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]'
        }`}
      >
        {busy ? 'Generating...' : buttonLabel}
      </button>
      {downloadHref && (
        <a
          href={downloadHref}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white font-medium text-zinc-700 transition-colors hover:bg-zinc-50 ${
            compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]'
          }`}
        >
          Open PDF
        </a>
      )}
      {error && <span className="text-[12px] font-medium text-red-600">{error}</span>}
    </div>
  );
}
