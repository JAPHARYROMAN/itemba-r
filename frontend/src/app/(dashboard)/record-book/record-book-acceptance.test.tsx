import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordBookPage from '@/app/(dashboard)/record-book/page';
import DailySalesPage from '@/app/(dashboard)/record-book/daily-sales/page';
import DailySaleDetailPage from '@/app/(dashboard)/record-book/daily-sales/[id]/page';
import ExpensesPage from '@/app/(dashboard)/record-book/expenses/page';
import ExpenseDetailPage from '@/app/(dashboard)/record-book/expenses/[id]/page';
import CategoriesPage from '@/app/(dashboard)/record-book/categories/page';
import { RecordBookReportsClient } from '@/app/(dashboard)/record-book/record-book-reports-client';
import TrashPage from '@/app/(dashboard)/record-book/trash/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: { id: 'user-1' },
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: vi.fn(),
  backendPage: vi.fn(),
  backendList: vi.fn(),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rec-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/record-book',
  useSearchParams: () => new URLSearchParams(),
}));

const pages = [
  ['dashboard', RecordBookPage],
  ['daily sales', DailySalesPage],
  ['daily sale detail', DailySaleDetailPage],
  ['expenses', ExpensesPage],
  ['expense detail', ExpenseDetailPage],
  ['categories', CategoriesPage],
  ['reports', RecordBookReportsClient],
  ['trash', TrashPage],
] as const;

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('record book route gates', () => {
  it.each(pages)('does not read %s without record_book.view', (_name, Page) => {
    render(<Page />);
    expect(screen.getAllByText(/^(Access Restricted|Permission required)$/).length).toBeGreaterThan(
      0,
    );
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
