export type FilePreviewSource = {
  id: string;
  title: string;
  fileName?: string;
  version?: number | string;
} & (
  | { kind: 'document' }
  | { kind: 'generated-document' }
  | { kind: 'invoice-attachment'; invoiceId: string }
);

/** Callers identify a source, rather than supplying arbitrary file URLs. */
export function filePreviewPaths(source: FilePreviewSource) {
  const id = encodeURIComponent(source.id);
  const base =
    source.kind === 'invoice-attachment'
      ? `/invoice-desk/invoices/${encodeURIComponent(source.invoiceId)}/attachments/${id}`
      : `/${source.kind === 'document' ? 'documents' : 'generated-documents'}/${id}`;
  return {
    key: JSON.stringify([source.kind, base, source.version]),
    preview: `${base}/preview`,
    download: source.kind === 'invoice-attachment' ? base : `${base}/download`,
  };
}

export type FilePreview =
  | { kind: 'pdf' | 'image' | 'download'; note?: string }
  | { kind: 'text'; text: string; truncated?: boolean; note?: string }
  | {
      kind: 'table';
      sheets: { name: string; rows: string[][] }[];
      truncated?: boolean;
      note?: string;
    };
