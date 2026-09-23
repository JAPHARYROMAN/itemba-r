'use client';
import { FilePreviewPane } from './FilePreview';

export function DocumentViewer({
  id,
  title,
  fileName,
  version,
}: {
  id: string;
  title: string;
  fileName?: string;
  version?: number;
}) {
  return <FilePreviewPane source={{ kind: 'document', id, title, fileName, version }} />;
}
