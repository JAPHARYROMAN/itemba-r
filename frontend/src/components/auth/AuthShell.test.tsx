import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AuthShell', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('renders the permanent address as an external website link', async () => {
    delete process.env.NEXT_PUBLIC_WEBSITE_URL;
    const { AuthShell } = await import('./AuthShell');

    render(
      <AuthShell
        eyebrow="Secure access"
        title="Welcome back"
        subtitle="Sign in to continue."
        footer={<span>Footer</span>}
      >
        <form />
      </AuthShell>,
    );

    const link = screen.getByRole('link', { name: 'itembagrouptz.com' });
    expect(link).toHaveAttribute('href', 'https://itembagrouptz.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
