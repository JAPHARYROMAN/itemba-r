import { Fragment, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTable } from './workspace-table';
import { WorkspaceSplit } from '../workspace/workspace-split';

describe('Responsive ERP records', () => {
  it('keeps one set of labelled cells, including conditional columns, controls and totals', () => {
    const change = vi.fn();
    const consoleError = vi.spyOn(console, 'error');
    render(
      <WorkspaceTable label="Journal lines">
        <thead>
          <tr>
            <th>Account</th>
            <Fragment>
              <th>Debit</th>
              <th>Credit</th>
            </Fragment>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Bank account</td>
            <Fragment>
              <td>
                <input aria-label="Debit" defaultValue="100" onChange={change} />
              </td>
              <td>0</td>
            </Fragment>
            <td>
              <button>Remove line</button>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>Totals</td>
            <td>100</td>
            <td />
          </tr>
        </tbody>
      </WorkspaceTable>,
    );
    expect(screen.getByRole('region', { name: 'Journal lines' })).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('textbox', { name: 'Debit' })).toHaveLength(1);
    expect(screen.getByRole('textbox').closest('td')).toHaveAttribute('data-column-label', 'Debit');
    expect(screen.getByRole('button').closest('td')).toHaveAttribute(
      'data-column-label',
      'Actions',
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '250' } });
    expect(change).toHaveBeenCalledOnce();
    expect(screen.getByRole('table')).toHaveClass('os-table-records');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
    consoleError.mockRestore();
  });
  it('activates a selectable row by keyboard without intercepting its nested actions', async () => {
    const select = vi.fn(),
      action = vi.fn();
    render(
      <WorkspaceTable>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr onClick={select}>
            <td>JE-001</td>
            <td>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  action();
                }}
              >
                View journal
              </button>
            </td>
          </tr>
        </tbody>
      </WorkspaceTable>,
    );
    const row = screen.getByRole('cell', { name: 'JE-001' }).closest('tr')!;
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(select).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button'));
    expect(action).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
  });
  it('retains complex grouped headers as a scrollable matrix', () => {
    render(
      <WorkspaceTable>
        <thead>
          <tr>
            <th colSpan={2}>This year</th>
          </tr>
          <tr>
            <th>Debit</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>100</td>
            <td>100</td>
          </tr>
        </tbody>
      </WorkspaceTable>,
    );
    expect(screen.getByRole('table')).not.toHaveClass('os-table-records');
    expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0');
  });
  it('moves focus to an accounting inspector and restores its trigger on return', async () => {
    function Example() {
      const [id, setId] = useState<string | null>(null);
      return (
        <WorkspaceSplit selectedKey={id} onClose={() => setId(null)}>
          <button onClick={() => setId('1')}>Review installment 1</button>
          <div>Principal and payment history</div>
        </WorkspaceSplit>
      );
    }
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Review installment 1' });
    await userEvent.click(opener);
    expect(within(screen.getByRole('complementary')).getByRole('heading')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(opener).toHaveFocus();
  });
});
