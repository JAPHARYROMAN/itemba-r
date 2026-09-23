'use client';
import { lazy, Suspense, useRef, useState, type RefObject } from 'react';
import { Modal, ModalPortalProvider } from '@/components/ui/modal';
import { Btn } from '@/components/ui/btn';
import { filePreviewPaths, type FilePreviewSource } from './file-preview-source';
import './file-preview.css';

const Preview = lazy(() =>
  import('./FilePreview').then((module) => ({ default: module.FilePreviewPane })),
);

export function FilePreviewDialog({
  sources,
  initial,
  onClose,
  onOpenRecord,
  returnFocusRef,
}: {
  sources: FilePreviewSource[];
  initial: FilePreviewSource;
  onClose: () => void;
  onOpenRecord?: (source: FilePreviewSource) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [key, setKey] = useState(() => filePreviewPaths(initial).key);
  const index = sources.findIndex((source) => filePreviewPaths(source).key === key);
  const source = sources[index];
  const content = useRef<HTMLDivElement>(null);
  const move = (next: number) => {
    if (sources[next]) {
      // The next/previous button may become disabled; keep focus in this dialog.
      content.current?.focus();
      setKey(filePreviewPaths(sources[next]).key);
    }
  };
  return (
    <ModalPortalProvider>
      <Modal
        open
        size="3xl"
        title={source?.title || 'File unavailable'}
        subtitle="Quick Look"
        onClose={onClose}
        returnFocusRef={returnFocusRef}
        footer={
          <div className="file-preview-navigation">
            <div>
              <Btn variant="secondary" disabled={index <= 0} onClick={() => move(index - 1)}>
                Previous file
              </Btn>
              <span role="status">
                {index >= 0 ? `${index + 1} of ${sources.length}` : 'File no longer in this view'}
              </span>
              <Btn
                variant="secondary"
                disabled={index < 0 || index >= sources.length - 1}
                onClick={() => move(index + 1)}
              >
                Next file
              </Btn>
            </div>
            <div>
              {source && onOpenRecord && (
                <Btn variant="secondary" onClick={() => onOpenRecord(source)}>
                  Open record
                </Btn>
              )}
              <Btn variant="secondary" onClick={onClose}>
                Done
              </Btn>
            </div>
          </div>
        }
      >
        <div ref={content} tabIndex={-1} role="region" aria-label="File content">
          <Suspense fallback={<p role="status">Opening document…</p>}>
            {source ? (
              <Preview source={source} />
            ) : (
              <p role="alert">
                This file is no longer available in this view. Close Quick Look and refresh the
                list.
              </p>
            )}
          </Suspense>
        </div>
      </Modal>
    </ModalPortalProvider>
  );
}
