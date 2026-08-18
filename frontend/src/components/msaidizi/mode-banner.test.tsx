import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MsaidiziCapabilities } from '@/lib/msaidizi-types';
import {
  MSAIDIZI_AUDIT_NOTE,
  MsaidiziModeBanner,
  describeMsaidiziMode,
  describeMsaidiziNarrowing,
  msaidiziAvailability,
} from './mode-banner';

function capabilities(overrides: Partial<MsaidiziCapabilities> = {}): MsaidiziCapabilities {
  return {
    enabled: true,
    writeMode: 'read-only',
    allowedTiers: ['green'],
    budgets: { maxToolCalls: 40, maxWrites: 10, toolBudget: 60 },
    narrowing: { active: false, permitted: 41, perRun: 41 },
    capabilities: [],
    ...overrides,
  };
}

describe('the mode banner reflects the deployment rather than the markup', () => {
  it('says it cannot change anything under read-only', () => {
    render(<MsaidiziModeBanner capabilities={capabilities()} />);

    expect(
      screen.getByText('Msaidizi can read what you can read. It cannot change anything.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('stops saying that the moment the deployment moves to a write tier', () => {
    render(
      <MsaidiziModeBanner
        capabilities={capabilities({ writeMode: 'amber', allowedTiers: ['green', 'amber'] })}
      />,
    );

    expect(screen.queryByText(/It cannot change anything/)).not.toBeInTheDocument();
    expect(screen.getByText(/can make changes you could undo/)).toBeInTheDocument();
    expect(screen.getByText(/irreversible is out of its reach/)).toBeInTheDocument();
  });

  it('warns that changes cannot be undone at red', () => {
    render(
      <MsaidiziModeBanner
        capabilities={capabilities({ writeMode: 'red', allowedTiers: ['green', 'amber', 'red'] })}
      />,
    );

    expect(screen.getByText(/can make changes on your behalf/)).toBeInTheDocument();
    expect(screen.getByText(/there is no undo/)).toBeInTheDocument();
  });

  // A mode string this build has never seen must not silently degrade to the
  // most reassuring sentence available.
  it('falls back to the tiers, not to read-only, for an unknown write mode', () => {
    const unknown = capabilities({
      writeMode: 'unheard-of' as MsaidiziCapabilities['writeMode'],
      allowedTiers: ['green', 'amber'],
    });

    expect(describeMsaidiziMode(unknown).tone).toBe('write');
  });

  it('carries the standing line about reads not being audited whenever it is on', () => {
    render(<MsaidiziModeBanner capabilities={capabilities()} />);
    expect(screen.getByText(MSAIDIZI_AUDIT_NOTE)).toBeInTheDocument();
  });
});

describe('narrowing, which a run gives no other signal of', () => {
  it('says how much of the tool set reaches the model when narrowing is active', () => {
    render(
      <MsaidiziModeBanner
        capabilities={capabilities({ narrowing: { active: true, permitted: 474, perRun: 60 } })}
      />,
    );

    expect(
      screen.getByText('Msaidizi sees 60 of the 474 tools you can reach on any one question.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/name that thing and ask again/)).toBeInTheDocument();
  });

  it('says everything is offered when narrowing is off', () => {
    render(<MsaidiziModeBanner capabilities={capabilities()} />);

    expect(
      screen.getByText('All 41 tools you can reach are offered on every question.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/on any one question/)).not.toBeInTheDocument();
  });

  // Holding `msaidizi.use` and nothing else is a real, reachable state: the
  // assistant answers and can look nothing up.
  it('says so when the caller can reach nothing at all', () => {
    render(
      <MsaidiziModeBanner
        capabilities={capabilities({ narrowing: { active: false, permitted: 0, perRun: 0 } })}
      />,
    );

    expect(screen.getByText('Msaidizi can reach nothing on your behalf.')).toBeInTheDocument();
  });

  it('reports no narrowing at all while the module is off', () => {
    expect(describeMsaidiziNarrowing(capabilities({ enabled: false }))).toBeNull();
  });
});

describe('the disabled state', () => {
  it('renders the off state without a run being attempted', () => {
    const run = vi.fn();
    const off = capabilities({ enabled: false });

    function Harness() {
      const availability = msaidiziAvailability(off);
      // Exactly what the composer does: consult the gate, and only then send.
      if (availability.canAsk) run('how much do we owe suppliers?');
      return <MsaidiziModeBanner capabilities={off} />;
    }

    render(<Harness />);

    expect(screen.getByText('Msaidizi is switched off in this deployment.')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/configuration choice rather than a fault/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not claim reads are unaudited while it is off — there are no reads', () => {
    render(<MsaidiziModeBanner capabilities={capabilities({ enabled: false })} />);
    expect(screen.queryByText(MSAIDIZI_AUDIT_NOTE)).not.toBeInTheDocument();
  });

  it('refuses to send while capabilities are still unknown', () => {
    expect(msaidiziAvailability(null).canAsk).toBe(false);
    expect(msaidiziAvailability(capabilities()).canAsk).toBe(true);
  });

  it('states that it does not know rather than guessing when the check fails', () => {
    render(<MsaidiziModeBanner capabilities={null} error="Network request failed" />);

    expect(screen.getByText('Could not check what Msaidizi can do here.')).toBeInTheDocument();
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
    expect(screen.queryByText(/It cannot change anything/)).not.toBeInTheDocument();
  });
});
