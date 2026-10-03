import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyCloseCheckPanel, usePartyCloseCheck } from './party-close-check-panel';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));

function Host({ path }: { path: string | null }) {
  return <PartyCloseCheckPanel {...usePartyCloseCheck(path)} />;
}
beforeEach(() => {
  vi.resetAllMocks();
});

describe('PartyCloseCheckPanel', () => {
  it('lists differences with party links and the untagged control', async () => {
    api.get.mockResolvedValue({
      asOf: '2026-09-30T00:00:00.000Z',
      baseCurrency: 'TZS',
      hasDifferences: true,
      untagged: { ap: '7.00', ar: '0.00' },
      differences: [
        {
          role: 'AP',
          kind: 'supplier',
          partyId: 'sup-1',
          name: 'Mwanjalisi',
          code: 'SUP-1',
          control: '100.00',
          subLedger: '80.00',
          difference: '20.00',
        },
        {
          role: 'AR',
          kind: 'customer',
          partyId: 'cus-1',
          name: 'Westsides',
          code: null,
          control: '50.00',
          subLedger: '60.00',
          difference: '-10.00',
        },
      ],
    });
    render(<Host path="/period-close/pc-1/party-check" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'do not agree with the sub-ledger as of 2026-09-30',
    );
    expect(screen.getAllByTestId('party-close-difference')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Mwanjalisi' })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/sup-1',
    );
    expect(screen.getByRole('link', { name: 'Westsides' })).toHaveAttribute(
      'href',
      '/sales-desk/customers/cus-1',
    );
    expect(screen.getByText('AP control without a party: TZS 7.00')).toBeInTheDocument();
    expect(screen.queryByText(/AR control without a party/)).not.toBeInTheDocument();
    expect(api.get.mock.calls[0][0]).toBe('/period-close/pc-1/party-check');
  });

  it('says the sides agree, and reports an unavailable or malformed check without hiding the gate', async () => {
    api.get.mockResolvedValue({
      asOf: '2026-09-30',
      baseCurrency: 'TZS',
      hasDifferences: false,
      untagged: { ap: '0.00', ar: '0.00' },
      differences: [],
    });
    const { unmount } = render(<Host path="/period-close/pc-1/party-check" />);
    expect(
      await screen.findByText('Control accounts agree with the sub-ledger as of 2026-09-30.'),
    ).toBeInTheDocument();
    unmount();
    api.get.mockResolvedValue({ id: 'not-a-check' });
    render(<Host path="/period-close/pc-2/party-check" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Control check unavailable. The close still refuses unacknowledged differences.',
    );
  });

  it('does not read when there is no path', () => {
    render(<Host path={null} />);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
