'use client';

import { useState } from 'react';
import { downloadBinaryExport, type TablePdfRequest } from '@/lib/export-download';
import type { DocumentEntityType } from './DocumentArtifactButton';

export function DocumentExportButton({
  source,
  table,
}: {
  source?: { entityType: DocumentEntityType; entityId: string };
  table?: TablePdfRequest;
}) {
  const [format, setFormat] = useState('docx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      if (table && table.rows.length > 5000)
        throw new Error(
          'This export supports up to 5,000 rows. Narrow the report filters or use CSV for all results.',
        );
      await downloadBinaryExport(
        source ? '/generated-documents/export' : '/generated-documents/table-export',
        { ...(source ?? table), format },
        `document.${format}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="document-no-print flex flex-wrap items-center gap-2">
      <select
        aria-label="Document export format"
        value={format}
        disabled={busy}
        onChange={(event) => setFormat(event.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800"
      >
        <option value="pdf">PDF</option>
        <option value="docx">Word (.docx)</option>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV</option>
        <option value="txt">Text</option>
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={download}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-50"
      >
        {busy ? 'Exporting…' : 'Export document'}
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
