import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegacyNavigation } from './desktop-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: 'u1', permissions: [] } }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ITEMBA-R navigation inside the OS', () => {
  it('lists each section once, without the OS apps, and without duplicate-key warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<LegacyNavigation />);

    const sections = screen
      .getByRole('navigation', { name: 'ITEMBA-R modules' })
      .querySelectorAll(':scope > details > summary');
    const labels = [...sections].map((summary) => summary.textContent);

    expect(labels.filter((label) => label === 'Reports')).toHaveLength(1);
    expect(new Set(labels).size).toBe(labels.length);
    // Apps live in the dock and the library, not in the ERP's own navigation.
    for (const app of ['Invoice Desk', 'Cash Desk', 'Sales Desk', 'Documents', 'Fuel Grid']) {
      expect(labels).not.toContain(app);
    }
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});

describe('navigable app frame styles', () => {
  it('are imported by the component itself, so the live desktop loads them', () => {
    // They once lived only in os-split-workspace.css, which the live desktop
    // never imports, and Inventory and Payroll showed a bare, unstyled bar.
    const component = readFileSync(join(__dirname, 'os-navigable-app.tsx'), 'utf8');
    const styles = readFileSync(join(__dirname, 'os-navigable-app.css'), 'utf8');
    expect(component).toContain("import './os-navigable-app.css';");
    for (const selector of ['.os-navigable-app', '.os-app-history', '.os-app-surface']) {
      expect(styles).toContain(`${selector} {`);
    }
  });
});
