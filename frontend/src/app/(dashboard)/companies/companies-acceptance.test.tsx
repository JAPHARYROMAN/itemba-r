import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompaniesPage from '@/app/(dashboard)/companies/page';
import NewCompanyPage from '@/app/(dashboard)/companies/new/page';
import CompanyDetailPage from '@/app/(dashboard)/companies/[id]/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'co-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: (...args: unknown[]) => state.page(...args),
  backendGet: (...args: unknown[]) => state.get(...args),
  backendPost: vi.fn(),
  backendDelete: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.page.mockReset();
  state.get.mockReset();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('company route gates', () => {
  it('does not read the company list without companies.read', () => {
    render(<CompaniesPage />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });

  it('does not load groups without companies.create', () => {
    render(<NewCompanyPage />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('does not read a company without companies.read', () => {
    render(<CompanyDetailPage />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed company detail load', async () => {
    state.permissions = new Set(['companies.read']);
    state.fetch.mockRejectedValue(new Error('Company offline'));
    const user = userEvent.setup();
    render(<CompanyDetailPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Company offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
