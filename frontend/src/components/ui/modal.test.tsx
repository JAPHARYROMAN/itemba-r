import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Modal } from './modal';
import { DetailDrawer } from './detail-drawer';

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open editor</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Example editor"
        footer={<button onClick={() => setOpen(false)}>Cancel editing</button>}
      >
        <input aria-label="Name" />
      </Modal>
    </>
  );
}
describe('Modal keyboard lifecycle', () => {
  it('restores the outside trigger when a child takes autofocus', async () => {
    function AutoFocusExample() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Find something</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Search">
            <input autoFocus aria-label="Search records" />
          </Modal>
        </>
      );
    }
    render(<AutoFocusExample />);
    const opener = screen.getByRole('button', { name: 'Find something' });
    await userEvent.click(opener);
    expect(screen.getByRole('textbox')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });
  it('gives drawers the same focus lifecycle and excludes hidden controls from the trap', async () => {
    function DrawerExample() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Review journal</button>
          <DetailDrawer open={open} title="Journal details" onClose={() => setOpen(false)}>
            <button>Inspect lines</button>
            <div hidden>
              <button>Hidden action</button>
            </div>
          </DetailDrawer>
        </>
      );
    }
    render(<DrawerExample />);
    const opener = screen.getByRole('button', { name: 'Review journal' });
    await userEvent.click(opener);
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Inspect lines' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });
  it('moves focus inside on the first open, traps it, and restores the opener after Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Open editor' });
    await user.click(opener);
    const dialog = within(screen.getByRole('dialog', { name: 'Example editor' }));
    expect(dialog.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog.getByRole('button', { name: 'Cancel editing' })).toHaveFocus();
    await user.tab();
    expect(dialog.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toHaveAttribute('inert');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
