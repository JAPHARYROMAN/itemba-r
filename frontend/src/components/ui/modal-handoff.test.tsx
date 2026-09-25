import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it } from 'vitest';
import { Modal } from './modal';

it('hands keyboard focus to the selected workspace after the dialog finishes closing', async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    const target = useRef<HTMLButtonElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const chosen = useRef(false);
    return (
      <>
        <button ref={trigger} onClick={() => setOpen(true)}>
          Windows
        </button>
        <button ref={target}>Invoice workspace</button>
        <Modal
          open={open}
          title="Choose window"
          onClose={() => setOpen(false)}
          returnFocusRef={trigger}
          onAfterClose={() => {
            if (chosen.current) target.current?.focus();
          }}
        >
          <button
            onClick={() => {
              chosen.current = true;
              setOpen(false);
            }}
          >
            Choose invoice
          </button>
        </Modal>
      </>
    );
  }
  render(<Example />);
  fireEvent.click(screen.getByText('Windows'));
  fireEvent.click(screen.getByText('Choose invoice'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Invoice workspace')).toHaveFocus());
});

it('includes disclosure summaries in the focus loop and skips their closed inputs', () => {
  render(
    <Modal open title="Optional details" onClose={() => undefined}>
      <details>
        <summary>More options</summary>
        <input aria-label="Optional note" />
      </details>
    </Modal>,
  );
  const summary = screen.getByText('More options');
  summary.focus();
  fireEvent.keyDown(summary, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
});
