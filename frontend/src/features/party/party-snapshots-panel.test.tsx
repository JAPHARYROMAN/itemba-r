import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartySnapshotsPanel } from './party-snapshots-panel';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PartySnapshotsPanel', () => {
  it('shows the latest close set with party links and the untagged row', async () => {
    api.get.mockResolvedValue({
      snapshotAt: '2026-10-01T10:00:00.000Z',
      closes: 2,
      currency: 'TZS',
      differences: 2,
      rows: [
        {
          id: 'a',
          role: 'AP',
          partyType: 'SUPPLIER',
          kind: 'supplier',
          partyId: 'sup-1',
          partyName: 'Mwanjalisi',
          currency: 'TZS',
          subLedger: '80.00',
          control: '100.00',
          difference: '20.00',
        },
        {
          id: 'b',
          role: 'AP',
          partyType: 'NONE',
          kind: null,
          partyId: null,
          partyName: null,
          currency: 'TZS',
          subLedger: '0.00',
          control: '7.00',
          difference: '7.00',
        },
      ],
    });
    render(<PartySnapshotsPanel path="/period-close/pc-1/party-snapshots" />);
    expect(
      await screen.findByText(
        /2 rows · 2 with a difference · recorded 2026-10-01 · 2 closes recorded, latest shown/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mwanjalisi' })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/sup-1',
    );
    expect(screen.getByText('Control lines without a party')).toBeInTheDocument();
    expect(screen.getAllByTestId('party-snapshot-row')).toHaveLength(2);
  });

  it('says when nothing was recorded, including for a malformed response', async () => {
    api.get.mockResolvedValue({ id: 'record' });
    render(<PartySnapshotsPanel path="/period-close/pc-1/party-snapshots" />);
    expect(
      await screen.findByText('No party balances were recorded at this close.'),
    ).toBeInTheDocument();
  });
});
