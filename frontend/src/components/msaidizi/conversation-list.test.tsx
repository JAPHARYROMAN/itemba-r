import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MsaidiziConversationSummary } from '@/lib/msaidizi-types';
import { MsaidiziConversationList, describeConversationWhen } from './conversation-list';

// Local noon, so that every offset below lands unambiguously on the calendar day
// it is meant to, in any timezone and across a DST boundary.
const NOW = new Date(2026, 7, 18, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function conversation(
  overrides: Partial<MsaidiziConversationSummary> = {},
): MsaidiziConversationSummary {
  const at = new Date(NOW - 2 * HOUR).toISOString();
  return {
    id: 'c1',
    agentSessionId: 'ms_0000',
    title: 'Supplier balances',
    companyId: null,
    turnCount: 1,
    toolCallCount: 2,
    writeCallCount: 0,
    highestTier: 'green',
    resumable: true,
    continuable: true,
    lastTurnAt: at,
    createdAt: at,
    expiresAt: new Date(NOW + 90 * DAY).toISOString(),
    ...overrides,
  };
}

describe('the conversation list', () => {
  it('renders each conversation newest first and hands back the one that is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MsaidiziConversationList
        now={NOW}
        onSelect={onSelect}
        conversations={[
          conversation({
            id: 'old',
            title: 'Cash position',
            lastTurnAt: new Date(NOW - 3 * DAY).toISOString(),
          }),
          conversation({
            id: 'new',
            title: 'Supplier balances',
            lastTurnAt: new Date(NOW - 2 * HOUR).toISOString(),
          }),
          conversation({
            id: 'mid',
            title: 'Stock at Kariakoo',
            lastTurnAt: new Date(NOW - 26 * HOUR).toISOString(),
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual([
      expect.stringContaining('Supplier balances'),
      expect.stringContaining('Stock at Kariakoo'),
      expect.stringContaining('Cash position'),
    ]);

    await user.click(screen.getByRole('button', { name: /Stock at Kariakoo/ }));
    expect(onSelect).toHaveBeenCalledWith('mid');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the selected conversation for assistive technology', () => {
    render(
      <MsaidiziConversationList
        now={NOW}
        selectedId="c1"
        onSelect={vi.fn()}
        conversations={[conversation()]}
      />,
    );

    expect(screen.getByRole('button', { name: /Supplier balances/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('identifies a conversation at a glance: when it happened and how much it did', () => {
    render(
      <MsaidiziConversationList
        now={NOW}
        onSelect={vi.fn()}
        conversations={[
          conversation({ id: 'a', title: 'Supplier balances', toolCallCount: 2 }),
          conversation({
            id: 'b',
            title: 'Stock at Kariakoo',
            toolCallCount: 0,
            turnCount: 1,
            lastTurnAt: new Date(NOW - 26 * HOUR).toISOString(),
          }),
        ]}
      />,
    );

    expect(screen.getByText('today · 2 steps')).toBeInTheDocument();
    // Never "0 steps" — a conversation that asked and got a straight answer says
    // what it actually was.
    expect(screen.getByText('yesterday · 1 question')).toBeInTheDocument();
  });

  it('names a conversation the server never titled', () => {
    render(
      <MsaidiziConversationList
        now={NOW}
        onSelect={vi.fn()}
        conversations={[conversation({ title: null })]}
      />,
    );

    expect(screen.getByRole('button', { name: /Untitled conversation/ })).toBeInTheDocument();
  });

  it('flags a conversation that changed something', () => {
    render(
      <MsaidiziConversationList
        now={NOW}
        onSelect={vi.fn()}
        conversations={[
          conversation({ id: 'a', highestTier: 'amber', writeCallCount: 1 }),
          conversation({ id: 'b', title: 'Void invoice', highestTier: 'red', writeCallCount: 1 }),
        ]}
      />,
    );

    expect(screen.getByText('Changed something')).toBeInTheDocument();
    expect(screen.getByText('Irreversible change')).toBeInTheDocument();
  });

  it('greets a first-time user with an empty state rather than an empty box', () => {
    render(<MsaidiziConversationList now={NOW} onSelect={vi.fn()} conversations={[]} />);

    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    expect(screen.getByText(/nobody else can read them/)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('offers a new conversation and a removal, only when the page wires them', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    const onRemove = vi.fn();

    const { rerender } = render(
      <MsaidiziConversationList now={NOW} onSelect={vi.fn()} conversations={[conversation()]} />,
    );
    expect(screen.queryByRole('button', { name: /New/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();

    rerender(
      <MsaidiziConversationList
        now={NOW}
        onSelect={vi.fn()}
        onNew={onNew}
        onRemove={onRemove}
        conversations={[conversation()]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /New/ }));
    await user.click(screen.getByRole('button', { name: 'Remove Supplier balances' }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('c1');
  });

  it('shows the failure and a way back rather than an empty list', () => {
    const onRetry = vi.fn();
    render(
      <MsaidiziConversationList
        now={NOW}
        onSelect={vi.fn()}
        conversations={[]}
        error="Network request failed"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Network request failed')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('describeConversationWhen', () => {
  it('counts calendar days, so last night reads as yesterday', () => {
    expect(describeConversationWhen(new Date(NOW - HOUR).toISOString(), NOW)).toBe('today');
    expect(describeConversationWhen(new Date(NOW - 13 * HOUR).toISOString(), NOW)).toBe(
      'yesterday',
    );
    expect(describeConversationWhen(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe('3 days ago');
    // Past a week the relative phrasing stops being useful and a date is kinder.
    expect(describeConversationWhen(new Date(NOW - 40 * DAY).toISOString(), NOW)).toMatch(
      /\d{2}\/\d{2}\/\d{4}/,
    );
  });

  it('does not invent a date for a conversation that never ran', () => {
    expect(describeConversationWhen(null, NOW)).toBe('never used');
  });
});
