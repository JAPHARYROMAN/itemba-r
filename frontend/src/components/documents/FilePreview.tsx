'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { backendBinaryGet, backendGet } from '@/lib/api-client';
import { filenameFromDisposition } from '@/lib/export-download';
import { useAuth } from '@/hooks/use-auth';
import { Btn } from '@/components/ui/btn';
import { filePreviewPaths, type FilePreview, type FilePreviewSource } from './file-preview-source';
import './file-preview.css';

export function FilePreviewPane({ source }: { source: FilePreviewSource }) {
  const { user, hasPermission } = useAuth();
  const allowed =
    !!user &&
    (source.kind === 'document'
      ? hasPermission('documents.view')
      : source.kind === 'invoice-attachment'
        ? hasPermission('invoice_desk.view')
        : true);
  const boundary = JSON.stringify([
    user?.id,
    user?.companyId,
    user?.permissions,
    filePreviewPaths(source).key,
  ]);
  return allowed ? (
    <PreviewContent key={boundary} source={source} />
  ) : (
    <p role="alert" className="file-preview-notice">
      Your current role cannot open this file.
    </p>
  );
}

function PreviewContent({ source }: { source: FilePreviewSource }) {
  const paths = filePreviewPaths(source);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [assetUrl, setAssetUrl] = useState('');
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState('fit');
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setPreview(null);
    setAssetUrl('');
    setError('');
    setSheet(0);
    setZoom('fit');
    async function read() {
      try {
        const result = await backendGet<FilePreview>(paths.preview, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!result || !['pdf', 'image', 'text', 'table', 'download'].includes(result.kind))
          throw new Error('This file preview is unavailable. Try again or download the original.');
        if (result.kind === 'pdf' || result.kind === 'image') {
          const { blob } = await backendBinaryGet(paths.download, controller.signal);
          if (controller.signal.aborted) return;
          const mime = blob.type.split(';')[0].toLowerCase();
          if (
            result.kind === 'pdf'
              ? mime !== 'application/pdf'
              : !['image/png', 'image/jpeg', 'image/webp'].includes(mime)
          )
            throw new Error('The file format changed. Download the original or try again.');
          objectUrl = URL.createObjectURL(blob);
          setAssetUrl(objectUrl);
        }
        setPreview(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not open this file.');
      }
    }
    void read();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [paths.preview, paths.download, revision]);

  async function download() {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError('');
    try {
      const { blob, disposition } = await backendBinaryGet(paths.download, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = filenameFromDisposition(disposition, source.fileName || source.title);
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setDownloadError(cause instanceof Error ? cause.message : 'Could not download this file.');
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
      if (downloadController.current === controller) downloadController.current = null;
    }
  }
  const activeSheet = preview?.kind === 'table' ? preview.sheets[sheet] : undefined;
  return (
    <section className="file-preview" aria-label="Document preview">
      <div className="file-preview-toolbar">
        <div>
          <h2>File preview</h2>
          <p>{source.fileName || source.title}</p>
        </div>
        <div className="file-preview-actions">
          <Btn type="button" variant="secondary" loading={downloading} onClick={download}>
            Download original
          </Btn>
          {preview?.kind === 'pdf' && !error && (
            <a
              className="file-preview-link"
              href={`/api/backend${paths.download}?inline=1`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open PDF in browser
            </a>
          )}
        </div>
      </div>
      {downloadError && (
        <p role="alert" className="file-preview-notice">
          {downloadError}
        </p>
      )}
      {error ? (
        <div role="alert" className="file-preview-notice">
          <p>{error}</p>
          <Btn type="button" variant="secondary" onClick={() => setRevision((value) => value + 1)}>
            Try again
          </Btn>
        </div>
      ) : !preview ? (
        <p role="status">Opening document…</p>
      ) : (
        <>
          {preview.note && <p className="file-preview-note">{preview.note}</p>}
          {'truncated' in preview && preview.truncated && (
            <p className="file-preview-notice">
              This preview is shortened. The original contains all content.
            </p>
          )}
          {preview.kind === 'download' && !preview.note && (
            <p className="file-preview-note">
              Download this file to open it in a compatible application.
            </p>
          )}
          {preview.kind === 'pdf' && (
            <>
              <p className="file-preview-note">
                Use the PDF controls to print. If the embedded viewer is unavailable, open the PDF
                in your browser.
              </p>
              <iframe title={source.title} src={assetUrl} className="file-preview-pdf" />
            </>
          )}
          {preview.kind === 'image' && (
            <>
              <label className="file-preview-choice">
                Zoom
                <select value={zoom} onChange={(event) => setZoom(event.target.value)}>
                  <option value="fit">Fit</option>
                  <option value="100">100%</option>
                  <option value="150">150%</option>
                  <option value="200">200%</option>
                </select>
              </label>
              <div
                className="file-preview-image"
                role="region"
                aria-label="Image preview"
                tabIndex={0}
              >
                <Image
                  src={assetUrl}
                  alt={source.title}
                  width={1200}
                  height={900}
                  unoptimized
                  style={{
                    width: zoom === 'fit' ? 'auto' : `${zoom}%`,
                    maxWidth: zoom === 'fit' ? '100%' : 'none',
                    maxHeight: zoom === 'fit' ? '65dvh' : 'none',
                    height: 'auto',
                  }}
                  onError={() =>
                    setError(
                      'This image could not be displayed. Try again or download the original.',
                    )
                  }
                />
              </div>
            </>
          )}
          {preview.kind === 'text' && (
            <pre className="file-preview-text" tabIndex={0} role="region" aria-label="Text preview">
              {preview.text}
            </pre>
          )}
          {preview.kind === 'table' && (
            <>
              {preview.sheets.length > 0 ? (
                <label className="file-preview-choice">
                  Worksheet
                  <select value={sheet} onChange={(event) => setSheet(Number(event.target.value))}>
                    {preview.sheets.map((entry, index) => (
                      <option key={index} value={index}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="file-preview-note">This workbook has no visible worksheets.</p>
              )}
              {activeSheet && (
                <div
                  className="file-preview-table"
                  tabIndex={0}
                  role="region"
                  aria-label={activeSheet.name}
                >
                  <table>
                    <caption>{activeSheet.name}</caption>
                    <tbody>
                      {activeSheet.rows.map((row, index) => (
                        <tr key={index}>
                          <th scope="row">{index + 1}</th>
                          {row.map((cell, column) => (
                            <td key={column}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!activeSheet.rows.length && (
                    <p className="file-preview-note">This worksheet is empty.</p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
