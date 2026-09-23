import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentTemplatesPage from '@/app/(dashboard)/document-templates/page';
import GeneratedDocumentsPage from '@/app/(dashboard)/document-templates/generated/page';
import DocumentNumberSequencesPage from '@/app/(dashboard)/document-templates/sequences/page';
import PrintEnginePage from '@/app/(dashboard)/document-templates/print-engine/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('document template route gates', () => {
  it('does not read templates without document_templates.list', () => {
    render(<DocumentTemplatesPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read generated documents without generated_documents.list', () => {
    render(<GeneratedDocumentsPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read sequences without doc_sequences.list', () => {
    render(<DocumentNumberSequencesPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not open the print engine without print_engine.render', () => {
    render(<PrintEnginePage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed document-template load', async () => {
    state.permissions = new Set(['document_templates.list']);
    state.fetch.mockRejectedValue(new Error('Templates offline'));
    const user = userEvent.setup();
    render(<DocumentTemplatesPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Templates offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
