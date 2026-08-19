import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MsaidiziConversationSummary } from '@/lib/msaidizi-types';
import { MsaidiziConversationList } from './conversation-list';
import { MsaidiziResumabilityNotice, describeResumability } from './resumability';

function conversation(
  overrides: Partial<MsaidiziConversationSummary> = {},
): MsaidiziConversationSummary {
  return {
    id: 'c1',
    agentSessionId: 'ms_0000',
    title: 'Supplier balances',
    companyId: null,
    turnCount: 3,
    toolCallCount: 5,
    writeCallCount: 0,
    highestTier: 'green',
    resumable: true,
    continuable: true,
    lastTurnAt: '2026-08-16T09:00:00.000Z',
    createdAt: '2026-08-16T09:00:00.000Z',
    expiresAt: '2026-11-14T09:00:00.000Z',
    ...overrides,
  };
}

describe('a conversation past its resume clock', () => {
  // The two payloads live on two clocks: the transcript for ninety days, the
  // model's own working state for a day. The long middle is this state.
  it('reads as readable but not continuable', () => {
    const stale = conversation({ continuable: false, resumable: true });
    const described = describeResumability(stale);

    expect(described).toMatchObject({ state: 'expired', canContinue: false, readable: true });

    render(<MsaidiziResumabilityNotice conversation={stale} />);
    expect(
      screen.getByText(
        'This conversation can no longer be continued — its working state has expired.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/history is still readable/)).toBeInTheDocument();
    expect(screen.getByText(/start a new conversation to carry on/)).toBeInTheDocument();
  });

  it('is marked in the list, so the state is visible before a row is opened', () => {
    render(
      <MsaidiziConversationList
        now={Date.parse('2026-08-18T12:00:00.000Z')}
        onSelect={vi.fn()}
        conversations={[conversation({ continuable: false })]}
      />,
    );

    expect(screen.getByText('History only')).toBeInTheDocument();
  });

  it('says nothing at all while the conversation can still be continued', () => {
    const { container } = render(<MsaidiziResumabilityNotice conversation={conversation()} />);
    expect(container).toBeEmptyDOMElement();
    expect(describeResumability(conversation())).toMatchObject({
      state: 'continuable',
      canContinue: true,
    });
  });

  // Not the same thing as ageing out, and permanent rather than temporary: the
  // run's working state was larger than the cap, so nothing was stored. Storing
  // part of it would have broken tool_use/tool_result pairing and surfaced later
  // as a generic failure.
  it('distinguishes a conversation that was always too long to continue', () => {
    const oversized = conversation({ continuable: false, resumable: false });

    expect(describeResumability(oversized)).toMatchObject({ state: 'too_long' });

    render(<MsaidiziResumabilityNotice conversation={oversized} />);
    expect(
      screen.getByText('This conversation is too long to continue — start a new one.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Its history is still readable/)).toBeInTheDocument();
  });

  // The conversation row is written before the model loop starts, deliberately,
  // so a run that dies mid-loop still leaves the session id behind.
  it('explains a conversation whose run never finished a turn', () => {
    const crashed = conversation({ continuable: false, turnCount: 0, toolCallCount: 0 });

    expect(describeResumability(crashed)).toMatchObject({ state: 'unfinished' });

    render(<MsaidiziResumabilityNotice conversation={crashed} />);
    expect(screen.getByText('This conversation has no completed turns.')).toBeInTheDocument();
    expect(
      screen.getByText(/still be found in the audit log by its session id/),
    ).toBeInTheDocument();
  });

  it('has nothing to say about a conversation that was never stored', () => {
    expect(describeResumability(null)).toBeNull();
    const { container } = render(<MsaidiziResumabilityNotice conversation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
