'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useGuardedRouter } from '@/components/workspace/unsaved-work-provider';
import { Btn } from '@/components/ui/btn';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { FilePreviewSource } from './file-preview-source';

type DocumentFile = { id: string; title: string; fileName?: string; version?: number };

/** Opens attached library files without leaving the record or copying the upload. */
export function DocumentQuickLookButton({
  document,
  documents = [document],
}: {
  document: DocumentFile;
  documents?: DocumentFile[];
}) {
  const { user, hasPermission } = useAuth();
  const boundary = JSON.stringify([user?.id, user?.companyId, user?.permissions]);
  if (!user || !hasPermission('documents.view')) return null;
  return <QuickLook key={`${boundary}:${document.id}`} document={document} documents={documents} />;
}

function QuickLook({ document, documents }: { document: DocumentFile; documents: DocumentFile[] }) {
  const router = useGuardedRouter();
  const [open, setOpen] = useState(false);
  const sources: FilePreviewSource[] = documents.map((file) => ({ ...file, kind: 'document' }));
  return (
    <>
      <Btn
        variant="secondary"
        aria-label={`Preview ${document.title}`}
        onClick={() => setOpen(true)}
      >
        Quick Look
      </Btn>
      {open && (
        <FilePreviewDialog
          sources={sources}
          initial={{ ...document, kind: 'document' }}
          onClose={() => setOpen(false)}
          onOpenRecord={(source) => {
            setOpen(false);
            router.push(`/group-control/documents/${encodeURIComponent(source.id)}`);
          }}
        />
      )}
    </>
  );
}
