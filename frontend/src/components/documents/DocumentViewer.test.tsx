import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewer } from './DocumentViewer';
import { backendGet } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ backendGet: vi.fn(), backendBinaryGet: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'viewer' }, hasPermission: () => true }),
}));
describe('Document viewer', () => {
  beforeEach(() => vi.resetAllMocks());
  it('renders Office preview text without executing HTML', async () => {
    vi.mocked(backendGet).mockResolvedValue({ kind: 'text', text: '<script>alert(1)</script>' });
    const { container } = render(<DocumentViewer id="document-1" title="Company letter" />);
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download original' })).toBeInTheDocument();
  });
  it('keeps the original downloadable when a preview fails', async () => {
    vi.mocked(backendGet).mockRejectedValue(new Error('Encrypted document'));
    render(<DocumentViewer id="document-1" title="Company letter" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Encrypted document');
    expect(screen.getByRole('button', { name: 'Download original' })).toBeInTheDocument();
  });
});
