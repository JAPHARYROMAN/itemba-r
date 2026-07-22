import { backendPost } from '@/lib/api-client';

interface GeneratedDocumentResponse {
  generatedDocument?: { id: string };
  document: { id: string; fileName: string };
}

export async function shareSupplierOrderDraftPdf(input: {
  id: string;
  draftNumber: string;
  supplierName: string;
}) {
  const generated = await backendPost<GeneratedDocumentResponse>('/generated-documents/pdf', {
    entityType: 'SUPPLIER_ORDER_DRAFT',
    entityId: input.id,
  });
  const downloadId = generated.generatedDocument?.id;
  const href = downloadId
    ? `/api/backend/generated-documents/${downloadId}/download`
    : `/api/backend/documents/${generated.document.id}/download`;
  const response = await fetch(href, { credentials: 'include' });
  if (!response.ok) throw new Error('Could not prepare the PDF for sharing');

  const file = new File([await response.blob()], generated.document.fileName, {
    type: 'application/pdf',
  });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({
      title: input.draftNumber,
      text: `Supplier order draft for ${input.supplierName}`,
      files: [file],
    });
    return 'shared' as const;
  }

  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(objectUrl);
  return 'downloaded' as const;
}
