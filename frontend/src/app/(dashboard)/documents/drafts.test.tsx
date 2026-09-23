import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsApp from './documents-app';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';

const state = vi.hoisted(() => ({
  download: vi.fn(),
  get: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  usePathname: () => '/documents',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'writer', permissions: ['documents.view', 'documents.manage'] },
    hasPermission: () => true,
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get }));
vi.mock('@/lib/export-download', () => ({ downloadBinaryExport: state.download }));
vi.mock('../group-control/documents/page', () => ({ default: () => <p>File library</p> }));
vi.mock('@/components/documents/DocumentShell', () => ({
  DocumentShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
function App({ initialView }: { initialView?: 'home' | 'library' | 'letter' }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <DocumentsApp initialView={initialView} syncRoute />
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.download.mockResolvedValue(undefined);
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('letterhead-companies')
      ? [{ id: 'company-2', name: 'Second company' }]
      : { name: 'Current company identity' },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('Letter draft continuity', () => {
  it('keeps company, format and letter contents together and resumes without exporting', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Write a letter', exact: true }));
    await user.selectOptions(await screen.findByLabelText('Company'), 'company-2');
    await user.type(screen.getByLabelText('Subject'), 'Branch supply request');
    await user.type(
      screen.getByLabelText('Letter', { exact: true }),
      'Please deliver the agreed supplies.',
    );
    await user.selectOptions(screen.getByLabelText('File format'), 'docx');
    await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume Letter' }));
    expect(screen.getByLabelText('Company')).toHaveValue('company-2');
    expect(screen.getByLabelText('Subject')).toHaveValue('Branch supply request');
    expect(screen.getByLabelText('Letter', { exact: true })).toHaveValue(
      'Please deliver the agreed supplies.',
    );
    expect(screen.getByLabelText('File format')).toHaveValue('docx');
    expect(state.download).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export letter' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Export letter' }));
    expect(state.download).toHaveBeenCalledWith(
      '/generated-documents/letter',
      expect.objectContaining({
        companyId: 'company-2',
        format: 'docx',
        title: 'Branch supply request',
      }),
      'letter.docx',
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument(),
    );
  });
  it('keeps the draft available if export fails', async () => {
    const user = userEvent.setup();
    state.download.mockRejectedValue(new Error('Export unavailable'));
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Write a letter', exact: true }));
    await user.type(screen.getByLabelText('Subject'), 'Keep this letter');
    await user.type(screen.getByLabelText('Letter', { exact: true }), 'Unfinished correspondence');
    await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Resume Letter' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export letter' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Export letter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable');
    expect(screen.getByLabelText('Subject')).toHaveValue('Keep this letter');
    await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    expect(screen.getByRole('button', { name: 'Resume Letter' })).toBeVisible();
  });
});

describe('Document action destinations', () => {
  it('opens the file library directly and can move between document views', async () => {
    const events = userEvent.setup();
    const view = render(<App initialView="library" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'File library', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    await events.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(state.router.replace).toHaveBeenCalledWith('/documents?view=home', { scroll: false });
    view.rerender(<App initialView="letter" />);
    expect(await screen.findByLabelText('Subject')).toBeVisible();
  });
  it('opens the letter composer from search and keeps its draft without reopening the form', async () => {
    const events = userEvent.setup();
    render(<App initialView="letter" />);
    await events.type(await screen.findByLabelText('Subject'), 'Search to letter');
    await events.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Letter' })).toBeVisible();
    expect(state.download).not.toHaveBeenCalled();
  });
});
