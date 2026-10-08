import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsolidatedAccounts } from './consolidated-accounts';

describe('account settlement presentation', () => {
  it('shows cash and write-off amounts separately while retaining full record drilldown', async () => {
    const user = userEvent.setup();
    const documents = [
      { id: 'po-1', name: 'PO-1', status: 'RECEIVED', cash: '20.00', adjustment: '80.00' },
    ];
    render(
      <ConsolidatedAccounts
        title="Purchase accounts"
        accounts={[
          {
            accountKey: 'a',
            partyName: 'Supplier A',
            companyId: 'company',
            currency: 'USD',
            documentCount: 1,
            openDocumentCount: 0,
            amount: 100,
            paidAmount: 20,
            outstandingAmount: 0,
            overdueAmount: 0,
            status: 'PAID',
            documents,
          },
        ]}
        paidLabel="Cash paid"
        outstandingLabel="Order balance"
        showAging={false}
        documentAdjustment={(record) => record.adjustment}
        documentName={(record) => record.name}
        documentDate={() => '2026-10-08'}
        documentStatus={(record) => record.status}
        documentFields={[{ label: 'Non-cash settlement', value: (record) => record.adjustment }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Purchase accounts' });
    expect(within(table).getByRole('columnheader', { name: 'Cash paid' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Non-cash settlement' }),
    ).toBeInTheDocument();
    expect(within(table).getByText('USD 20.00')).toBeInTheDocument();
    expect(within(table).getByText('USD 80.00')).toBeInTheDocument();
    await user.click(
      within(table).getByRole('button', { name: 'View transactions for Supplier A' }),
    );
    expect(screen.getByText('PO-1')).toBeInTheDocument();
  });
});
