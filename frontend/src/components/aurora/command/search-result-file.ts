import type { FilePreviewSource } from '@/components/documents/file-preview-source';

/** Search can identify supported files; it cannot provide a download URL. */
export function searchResultFile(
  result: { id: string; title: string; file?: unknown },
  can: (permission: string) => boolean,
): FilePreviewSource | undefined {
  if (!result.file || typeof result.file !== 'object') return;
  const file = result.file as Record<string, unknown>;
  if (file.id !== result.id || typeof file.id !== 'string' || !file.id.trim()) return;
  const common = {
    id: file.id,
    title: typeof file.title === 'string' && file.title.trim() ? file.title : result.title,
    fileName: typeof file.fileName === 'string' ? file.fileName : undefined,
    version:
      typeof file.version === 'number' && Number.isSafeInteger(file.version) && file.version > 0
        ? file.version
        : undefined,
  };
  if (file.kind === 'document' && can('documents.view')) return { ...common, kind: 'document' };
  if (
    file.kind === 'invoice-attachment' &&
    can('invoice_desk.view') &&
    typeof file.invoiceId === 'string' &&
    file.invoiceId.trim()
  )
    return { ...common, kind: 'invoice-attachment', invoiceId: file.invoiceId };
}
