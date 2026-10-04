import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OsLogin } from './os-login';
vi.mock('./SignInForm', () => ({
  SignInForm: ({ defaultTarget }: { defaultTarget: string }) => (
    <form aria-label="Existing sign-in flow" data-target={defaultTarget}>
      <label>
        Email
        <input type="email" />
      </label>
      <label>
        Password
        <input type="password" />
      </label>
      <button>Sign in</button>
    </form>
  ),
}));
describe('OS sign-in', () => {
  it('preserves account sign-in and desktop routing with no install QR or terminal activation flow', () => {
    render(<OsLogin />);
    expect(screen.getByRole('form', { name: 'Existing sign-in flow' })).toHaveAttribute(
      'data-target',
      '/desktop',
    );
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByRole('img', { name: /QR/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/terminal activation|install.*POS/i)).not.toBeInTheDocument();
  });
});
