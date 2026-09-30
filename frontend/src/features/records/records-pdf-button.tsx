'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Btn } from '@/components/ui';
import { downloadBinaryGet } from '@/lib/export-download';

export function RecordsPdfButton({
  path,
  query = {},
  disabled = false,
  label = 'Export PDF',
}: {
  path: string;
  query?: Record<string, string | number | undefined>;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function download() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)]),
      );
      await downloadBinaryGet(`${path}${params.size ? `?${params}` : ''}`, 'records.pdf');
      setNotice('PDF download started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Btn
        variant="secondary"
        icon={<Download size={16} />}
        loading={busy}
        disabled={disabled || busy}
        onClick={() => void download()}
      >
        {label}
      </Btn>
      {error && (
        <p role="alert" className="records-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs">
          {notice}
        </p>
      )}
    </div>
  );
}
