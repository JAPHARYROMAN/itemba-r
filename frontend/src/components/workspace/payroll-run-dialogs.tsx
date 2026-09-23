'use client';
import { useEffect, useState } from 'react';
import { Btn, Modal } from '@/components/ui';
import { backendPost } from '@/lib/api-client';
import { PayrollRunRecord, payrollMoney, runName } from './payroll-types';
interface DisbursementFile {
  filename: string;
  mimeType: string;
  rowCount: number;
  total: number;
  content: string;
}
interface Manifest {
  runNumber: string;
  companyName: string;
  generatedAt: string;
  summary: { totalEmployees: number; viaBank: number; viaMobileMoney: number; unmapped: number };
  files: DisbursementFile[];
}
function download(file: DisbursementFile) {
  const url = URL.createObjectURL(
    new Blob([file.content], { type: file.mimeType || 'text/csv;charset=utf-8;' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export function PayrollFilesDialog({
  run,
  onClose,
}: {
  run: PayrollRunRecord;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setManifest(null);
    backendPost<Manifest>('/hr/payroll-runs/' + run.id + '/disbursement-files', undefined, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setManifest(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Unable to generate files.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [run.id, revision]);
  return (
    <Modal
      open
      title={'Disbursement files · ' + runName(run)}
      onClose={onClose}
      size="lg"
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Done
        </Btn>
      }
    >
      {loading ? (
        <p role="status">Generating disbursement files…</p>
      ) : error ? (
        <div role="alert" className="workspace-notice">
          {error}{' '}
          <Btn variant="secondary" onClick={() => setRevision((v) => v + 1)}>
            Try again
          </Btn>
        </div>
      ) : (
        manifest && (
          <div className="space-y-5">
            <div className="workspace-notice">
              <strong>
                {manifest.runNumber} · {manifest.companyName}
              </strong>
              <p>{new Date(manifest.generatedAt).toLocaleString('en-GB')}</p>
            </div>
            <div className="workspace-summary">
              <div>
                <span>Employees</span>
                <strong>{manifest.summary.totalEmployees}</strong>
              </div>
              <div>
                <span>Bank</span>
                <strong>{manifest.summary.viaBank}</strong>
              </div>
              <div>
                <span>Mobile money</span>
                <strong>{manifest.summary.viaMobileMoney}</strong>
              </div>
              <div>
                <span>Unmapped</span>
                <strong>{manifest.summary.unmapped}</strong>
              </div>
            </div>
            {manifest.files.length === 0 ? (
              <p>No files generated. Check employee bank and mobile-money accounts.</p>
            ) : (
              manifest.files.map((file) => (
                <div
                  key={file.filename}
                  className="workspace-notice flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <strong className="break-all">{file.filename}</strong>
                    <p>
                      {file.rowCount} rows · {payrollMoney(file.total)}
                    </p>
                  </div>
                  <Btn
                    variant="secondary"
                    onClick={() => download(file)}
                    aria-label={'Download ' + file.filename}
                  >
                    Download
                  </Btn>
                </div>
              ))
            )}
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Files are generated on demand. Download and review them before using your bank or
              mobile-money portal. Generating or downloading a file does not make a payment.
            </p>
          </div>
        )
      )}
    </Modal>
  );
}
