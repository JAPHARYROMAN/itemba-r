import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalPortalProvider } from './modal';
import { ConfirmDialog } from './confirm-dialog';

describe('Workspace confirmation dialog', () => {
  it('escapes pane clipping, focuses the safe choice and restores the opener without confirming', async () => {
    const confirm = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <ModalPortalProvider>
          <div data-testid="app-pane">
            <button onClick={() => setOpen(true)}>Remove employee</button>
            <ConfirmDialog
              open={open}
              title="Remove this employee?"
              message="Review before continuing."
              onConfirm={confirm}
              onCancel={() => setOpen(false)}
              confirmLabel="Remove"
            />
          </div>
        </ModalPortalProvider>
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Remove employee' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Remove this employee?' });
    expect(screen.getByTestId('app-pane')).not.toContainElement(dialog);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const nested = document.createElement('dialog');
    nested.setAttribute('open', '');
    const nestedChoice = document.createElement('button');
    nestedChoice.textContent = 'Keep working';
    nested.append(nestedChoice);
    document.body.append(nested);
    nestedChoice.focus();
    await user.keyboard('{Escape}');
    expect(dialog).toBeVisible();
    expect(nestedChoice).toHaveFocus();
    nested.remove();
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Remove', exact: true })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled();
  });
});
