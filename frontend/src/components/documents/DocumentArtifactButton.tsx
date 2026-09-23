'use client';
import { useEffect, useRef, useState } from 'react';
import { backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { Btn } from '@/components/ui/btn';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { FilePreviewSource } from './file-preview-source';

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
  | 'CUSTOMER_PAYMENT_RECEIPT'
  | 'EXPENSE_VOUCHER';

interface GeneratedDocumentResponse {
  generatedDocument?: { id: string };
  document: { id: string; fileName?: string };
}
interface Props {
  entityType: DocumentEntityType;
  entityId: string;
  buttonLabel?: string;
  compact?: boolean;
}
export function DocumentArtifactButton(props: Props) {
  const { user } = useAuth();
  const key = JSON.stringify([
    props.entityType,
    props.entityId,
    user?.id,
    user?.companyId,
    user?.permissions,
  ]);
  return <ArtifactButton key={key} {...props} />;
}
function ArtifactButton({
  entityType,
  entityId,
  buttonLabel = 'Generate PDF',
  compact = false,
}: Props) {
  const [file, setFile] = useState<FilePreviewSource | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function generate() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await backendPost<GeneratedDocumentResponse>(
        '/generated-documents/pdf',
        {
          entityType,
          entityId,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const id = result.generatedDocument?.id || result.document?.id;
      if (!id) throw new Error('The generated file is unavailable. Try again.');
      const fileName =
        result.document?.fileName || `${entityType.toLowerCase().replaceAll('_', '-')}.pdf`;
      setFile({
        kind: result.generatedDocument?.id ? 'generated-document' : 'document',
        id,
        title: fileName,
        fileName,
      });
      setOpen(true);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not generate PDF');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn type="button" onClick={generate} loading={busy} size={compact ? 'xs' : 'sm'}>
        {busy ? 'Generating…' : buttonLabel}
      </Btn>
      {file && (
        <Btn
          type="button"
          variant="secondary"
          size={compact ? 'xs' : 'sm'}
          onClick={() => setOpen(true)}
        >
          Preview PDF
        </Btn>
      )}
      {open && file && (
        <FilePreviewDialog sources={[file]} initial={file} onClose={() => setOpen(false)} />
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--aurora-danger, #b42318)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
