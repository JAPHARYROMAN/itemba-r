import { backendPost } from '@/lib/api-client';

interface GeneratedDocumentResponse {
  generatedDocument?: { id: string };
  document: { id: string; fileName: string };
}

export interface PreparedSupplierOrderDraftPdf {
  file: File;
  generatedDocumentId?: string;
  downloadHref: string;
}

export type SupplierOrderDraftShareChannel = 'DOWNLOAD' | 'NATIVE_SHARE' | 'WHATSAPP' | 'EMAIL';

export async function prepareSupplierOrderDraftPdf(input: { id: string; draftNumber: string }) {
  const generated = await backendPost<GeneratedDocumentResponse>('/generated-documents/pdf', {
    entityType: 'SUPPLIER_ORDER_DRAFT',
    entityId: input.id,
  });
  const downloadId = generated.generatedDocument?.id;
  const downloadHref = downloadId
    ? `/api/backend/generated-documents/${downloadId}/download`
    : `/api/backend/documents/${generated.document.id}/download`;
  const response = await fetch(downloadHref, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not prepare the PDF for sharing');

  return {
    file: new File([await response.blob()], generated.document.fileName, {
      type: 'application/pdf',
    }),
    generatedDocumentId: downloadId,
    downloadHref,
  } satisfies PreparedSupplierOrderDraftPdf;
}

export function canNativeSharePdf(file: File) {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  return !navigator.canShare || navigator.canShare({ files: [file] });
}

export async function nativeShareSupplierOrderDraftPdf(input: {
  prepared: PreparedSupplierOrderDraftPdf;
  draftNumber: string;
  supplierName: string;
  message: string;
}) {
  if (!canNativeSharePdf(input.prepared.file)) return false;
  await navigator.share({
    title: input.draftNumber,
    text: input.message || `Supplier order draft for ${input.supplierName}`,
    files: [input.prepared.file],
  });
  return true;
}

export function downloadPreparedSupplierOrderDraftPdf(prepared: PreparedSupplierOrderDraftPdf) {
  const objectUrl = URL.createObjectURL(prepared.file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = prepared.file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export function normalizeWhatsAppPhone(phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

export function whatsappShareUrl(phone: string, message: string) {
  const recipient = normalizeWhatsAppPhone(phone);
  const base = recipient ? `https://wa.me/${recipient}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function emailShareUrl(input: {
  to: string;
  cc?: string;
  subject: string;
  message: string;
}) {
  const query = new URLSearchParams({ subject: input.subject, body: input.message });
  if (input.cc?.trim()) query.set('cc', input.cc.trim());
  return `mailto:${encodeURIComponent(input.to)}?${query.toString()}`;
}

export async function auditSupplierOrderDraftShare(
  id: string,
  format: SupplierOrderDraftShareChannel,
) {
  await backendPost(`/supplier-order-drafts/${id}/export-audit`, { format }).catch(() => undefined);
}

export async function shareSupplierOrderDraftPdf(input: {
  id: string;
  draftNumber: string;
  supplierName: string;
}) {
  const prepared = await prepareSupplierOrderDraftPdf(input);
  const shared = await nativeShareSupplierOrderDraftPdf({
    prepared,
    draftNumber: input.draftNumber,
    supplierName: input.supplierName,
    message: `Supplier order draft ${input.draftNumber} for ${input.supplierName}`,
  });
  if (shared) {
    await auditSupplierOrderDraftShare(input.id, 'NATIVE_SHARE');
    return 'shared' as const;
  }
  downloadPreparedSupplierOrderDraftPdf(prepared);
  await auditSupplierOrderDraftShare(input.id, 'DOWNLOAD');
  return 'downloaded' as const;
}
