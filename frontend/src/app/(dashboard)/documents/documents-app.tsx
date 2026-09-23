'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useWorkspaceRouter } from '@/components/workspace/workspace-navigation';
import { FileText, FolderOpen, PenLine } from 'lucide-react';
import { backendGet } from '@/lib/api-client';
import { downloadBinaryExport } from '@/lib/export-download';
import { useAuth } from '@/hooks/use-auth';
import { DocumentShell, type DocumentOrganization } from '@/components/documents/DocumentShell';
import {
  DraftFormNotice,
  WorkspaceDraftShelf,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import Library from '../group-control/documents/page';
import styles from './documents.module.css';

export type DocumentsView = 'home' | 'library' | 'letter';

export default function DocumentsApp({
  initialView,
  syncRoute = false,
}: {
  initialView?: DocumentsView;
  syncRoute?: boolean;
}) {
  const router = useWorkspaceRouter();
  const [view, setStoredView] = useWorkspaceState<DocumentsView>('documents.view', 'home');
  const setView = useCallback(
    (next: DocumentsView) => {
      setStoredView(next);
      // This changes the visible pane, keeping the letter form and its draft mounted.
      // Companion windows keep their navigation independent of the main URL.
      if (syncRoute) router.replace(`/documents?view=${next}`, { scroll: false });
    },
    [router, setStoredView, syncRoute],
  );
  const appliedView = useRef<DocumentsView | undefined>(undefined);
  useEffect(() => {
    if (initialView && initialView !== appliedView.current) setStoredView(initialView);
    appliedView.current = initialView;
  }, [initialView, setStoredView]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [generation, setGeneration] = useState(0);
  return (
    <DocumentsWorkspace
      key={draftId ?? `new-${generation}`}
      draftId={draftId}
      view={view}
      setView={setView}
      onResume={(draft) => setDraftId(draft.id)}
      onReset={() => {
        setDraftId(undefined);
        setGeneration((value) => value + 1);
      }}
    />
  );
}

function DocumentsWorkspace({
  view: requestedView,
  setView,
  draftId,
  onResume,
  onReset,
}: {
  view: DocumentsView;
  setView: (view: DocumentsView) => void;
  draftId?: string;
  onResume: (draft: WorkspaceDraft) => void;
  onReset: () => void;
}) {
  const { user, hasPermission } = useAuth();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [preferredCompany, setPreferredCompany] = useWorkspaceState('documents.company', '');
  const [organization, setOrganization] = useState<DocumentOrganization | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useWorkspaceDraftForm(
    {
      companyId: preferredCompany,
      format: 'pdf',
      title: '',
      recipient: '',
      reference: '',
      body: '',
      signatory: '',
    },
    {
      appId: 'documents',
      title: 'Letter',
      describe: (values) => values.title,
      context: { kind: 'letter' },
      draftId,
      busy,
      onClose: () => {
        setView('home');
        onReset();
      },
    },
  );
  const { form, setForm, guard } = draft;
  const { companyId, format } = form;
  const setCompanyId = (value: string) => {
    setPreferredCompany(value);
    setForm((current) => ({ ...current, companyId: value }));
  };
  const setFormat = (value: string) => setForm((current) => ({ ...current, format: value }));
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const canWrite = hasPermission('documents.manage');
  const canRead = hasPermission('documents.view');
  const view = requestedView === 'letter' && !canWrite ? 'home' : requestedView;
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    backendGet<{ id: string; name: string }[]>('/generated-documents/letterhead-companies')
      .then((data) => {
        if (active) setCompanies(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load companies');
      });
    return () => {
      active = false;
    };
  }, [canRead]);
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setOrganization(null);
    backendGet<DocumentOrganization>(
      `/generated-documents/letterhead${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
    )
      .then((data) => {
        if (active) setOrganization(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load letterhead');
      });
    return () => {
      active = false;
    };
  }, [companyId, canRead]);
  async function exportLetter(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setFeedback('');
    setBusy(true);
    try {
      draft.validateReview();
      await draft.saveNow();
      await downloadBinaryExport(
        '/generated-documents/letter',
        { ...form, format, companyId: companyId || undefined },
        `letter.${format}`,
      );
      draft.markSaved();
      setFeedback(
        'Your letter has been exported. Upload a copy to the library if you need to keep it with company records.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export letter');
    } finally {
      setBusy(false);
    }
  }
  if (!hasPermission('documents.view'))
    return (
      <div className={styles.page}>
        <h1>Documents</h1>
        <p>You do not have access to the document library.</p>
      </div>
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ITEMBA OS</span>
          <h1>Documents</h1>
          <p>One identity. Every document.</p>
        </div>
        <Link href="/settings/company-profile" className={styles.link}>
          Manage company letterheads
        </Link>
      </header>
      <nav aria-label="Documents views" className={styles.nav}>
        <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => setView('home')}>
          Overview
        </button>
        <button
          aria-current={view === 'library' ? 'page' : undefined}
          onClick={() => setView('library')}
        >
          File library
        </button>
        {canWrite && (
          <button
            aria-current={view === 'letter' ? 'page' : undefined}
            onClick={() => setView('letter')}
          >
            Write a letter
          </button>
        )}
      </nav>
      {canWrite && (
        <WorkspaceDraftShelf
          appId="documents"
          activeDraftId={draftId}
          onResume={(row) => {
            if (row.context.kind !== 'letter') throw new Error('This draft is not a letter.');
            guard.requestClose(() => {
              setView('letter');
              onResume(row);
            });
          }}
        />
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {view === 'home' && (
        <>
          <div className={styles.cards}>
            <button className={styles.card} onClick={() => setView('library')}>
              <FolderOpen size={28} />
              <strong>Your file library</strong>
              <span>Open, organise and download documents across your companies.</span>
              <small>Browse files →</small>
            </button>
            {canWrite && (
              <button className={styles.card} onClick={() => setView('letter')}>
                <PenLine size={28} />
                <strong>Company correspondence</strong>
                <span>Write a letter with the right logo, contact details and legal identity.</span>
                <small>Start a letter →</small>
              </button>
            )}
            <Link className={styles.card} href="/settings/company-profile">
              <FileText size={28} />
              <strong>Shared letterhead</strong>
              <span>Company profiles supply the branding used by previews and exports.</span>
              <small>Manage identity →</small>
            </Link>
          </div>
          <section className={styles.form}>
            <h2>Work with the formats you use</h2>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Format</th>
                    <th>Open in Documents</th>
                    <th>Export from records</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>PDF</td>
                    <td>Original page layout</td>
                    <td>Branded document</td>
                  </tr>
                  <tr>
                    <td>Word · DOCX</td>
                    <td>Text preview</td>
                    <td>Editable letterhead and content</td>
                  </tr>
                  <tr>
                    <td>Excel · XLSX</td>
                    <td>Sheet preview with saved values</td>
                    <td>Workbook with company identity</td>
                  </tr>
                  <tr>
                    <td>CSV & text</td>
                    <td>Table or text preview</td>
                    <td>Portable data or readable text</td>
                  </tr>
                  <tr>
                    <td>PNG, JPEG & WebP</td>
                    <td>Image preview</td>
                    <td>Download original image</td>
                  </tr>
                  <tr>
                    <td>PowerPoint, older Office, ODT, ODS, RTF & ZIP</td>
                    <td>Download to a compatible app</td>
                    <td>Download original file</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Exports create copies; they do not change source records. Uploaded files retain their
              original contents. Large files and unsupported previews remain available to download.
            </p>
          </section>
        </>
      )}
      {view === 'library' && <Library />}
      {view === 'letter' && canWrite && (
        <div className={styles.editor}>
          <form className={styles.form} onSubmit={exportLetter} {...guard.capture}>
            <h2>Write a letter</h2>
            <DraftFormNotice draft={draft} />
            <p>
              The preview and export use the selected company’s current profile. Missing company tax
              identifiers are left blank.
            </p>
            <label>
              Company
              <select
                value={companyId}
                onChange={(event) => {
                  setError('');
                  setCompanyId(event.target.value);
                }}
              >
                <option value="">{user?.companyId ? 'My company' : 'Itemba Group'}</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input
                required
                maxLength={120}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="What is this letter about?"
              />
            </label>
            <label>
              Reference <small>Optional</small>
              <input
                maxLength={120}
                value={form.reference}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
                placeholder="Generated on export if left blank"
              />
            </label>
            <label>
              Recipient <small>Optional</small>
              <textarea
                rows={3}
                maxLength={1000}
                value={form.recipient}
                onChange={(event) => setForm({ ...form, recipient: event.target.value })}
                placeholder="Name, organisation and address"
              />
            </label>
            <label>
              Letter
              <textarea
                required
                rows={12}
                maxLength={30000}
                value={form.body}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
                placeholder="Dear…"
              />
            </label>
            <label>
              Signatory <small>Optional</small>
              <input
                maxLength={160}
                value={form.signatory}
                onChange={(event) => setForm({ ...form, signatory: event.target.value })}
                placeholder="Name and position"
              />
            </label>
            <div className={styles.actions}>
              <label>
                File format
                <select value={format} onChange={(event) => setFormat(event.target.value)}>
                  <option value="pdf">PDF</option>
                  <option value="docx">Word (.docx)</option>
                  <option value="txt">Text (.txt)</option>
                </select>
              </label>
              <>
                {draft.canRetain && (
                  <button type="button" disabled={busy} onClick={draft.keep}>
                    Keep draft
                  </button>
                )}
              </>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  guard.requestClose(() => {
                    setView('home');
                    onReset();
                  })
                }
              >
                Close letter
              </button>
              <button type="submit" disabled={busy || !organization}>
                {busy ? 'Exporting…' : 'Export letter'}
              </button>
            </div>
            <p role="status">
              {feedback ||
                'Export a copy when ready, or keep a draft to return during this session.'}
            </p>
          </form>
          <section className={styles.preview} aria-label="Letter preview">
            {organization ? (
              <DocumentShell
                title={form.title || 'Your letter subject'}
                reference={form.reference || 'Assigned on export'}
                organization={organization}
                footerNote="Generated by ITEMBA OS."
              >
                {form.recipient && <p className="mb-8 whitespace-pre-wrap">{form.recipient}</p>}
                <div className="whitespace-pre-wrap break-words text-sm leading-7">
                  {form.body || 'Your letter will appear here as you write.'}
                </div>
                {form.signatory && (
                  <p className="mt-10 border-t border-zinc-300 pt-3">{form.signatory}</p>
                )}
              </DocumentShell>
            ) : (
              <p role="status">Loading letterhead…</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
