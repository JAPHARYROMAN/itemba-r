import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MsaidiziSessionHandle } from './session-handle';

const SESSION = 'ms_4f1c9b0a2d5e4a7b8c3f6d1e0a9b8c7d';

function withClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // jsdom ships no clipboard; leave it that way for the next test.
  Reflect.deleteProperty(navigator as object, 'clipboard');
});

describe('the session handle', () => {
  it('shows the id and copies it, because it is the only durable handle on a run', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard(writeText);

    render(<MsaidiziSessionHandle sessionId={SESSION} />);

    expect(screen.getByText(SESSION)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Copy session id ${SESSION}` }));

    expect(writeText).toHaveBeenCalledWith(SESSION);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('says where the id leads', () => {
    render(<MsaidiziSessionHandle sessionId={SESSION} />);

    expect(screen.getByText('agentSessionId')).toBeInTheDocument();
    expect(screen.getByText(/survives the conversation being removed/)).toBeInTheDocument();
  });

  // An affordance that sends someone to an empty audit screen without warning is
  // worse than no affordance.
  it('warns that the audit search comes back empty under read-only', () => {
    render(<MsaidiziSessionHandle sessionId={SESSION} writeMode="read-only" />);
    expect(screen.getByText(/that search will come back empty/)).toBeInTheDocument();
  });

  it('makes no such claim once the deployment can write', () => {
    render(<MsaidiziSessionHandle sessionId={SESSION} writeMode="amber" />);
    expect(screen.queryByText(/come back empty/)).not.toBeInTheDocument();
  });

  it('reports a refused clipboard instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    withClipboard(vi.fn().mockRejectedValue(new Error('not allowed')));

    render(<MsaidiziSessionHandle sessionId={SESSION} />);
    await user.click(screen.getByRole('button', { name: `Copy session id ${SESSION}` }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
    expect(screen.getByText(/Select the id above and copy it by hand/)).toBeInTheDocument();
    // The point of the failure message: the id itself is still on screen.
    expect(screen.getByText(SESSION)).toBeInTheDocument();
  });

  it('survives a browser with no clipboard at all', async () => {
    // Order matters: user-event's setup installs a clipboard stub of its own, so
    // the absence has to be staged after it. Over plain HTTP this is what a real
    // browser hands the page.
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    render(<MsaidiziSessionHandle sessionId={SESSION} />);
    await user.click(screen.getByRole('button', { name: `Copy session id ${SESSION}` }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  it('does not pretend to have an id before the first question runs', () => {
    render(<MsaidiziSessionHandle sessionId={null} />);

    expect(
      screen.getByText('No session id yet — one is minted when the first question runs.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
