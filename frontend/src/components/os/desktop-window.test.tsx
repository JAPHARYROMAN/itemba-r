import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { getApp } from '@/lib/apps';
import { DesktopWindowFrame } from './desktop-window';

it('closes or minimises an inactive window without first navigating to it', () => {
  const focus = vi.fn(),
    close = vi.fn(),
    change = vi.fn();
  render(
    <DesktopWindowFrame
      window={{
        id: 'inactive',
        appId: 'invoice-desk',
        href: '/invoice-desk',
        bounds: { x: 20, y: 20, width: 900, height: 600 },
        mode: 'floating',
        minimized: false,
      }}
      app={getApp('invoice-desk')!}
      active={false}
      concealed={false}
      zIndex={1}
      area={{ width: 1440, height: 900 }}
      narrow={false}
      onFocus={focus}
      onChange={change}
      onClose={close}
      reduced
      intensity={1}
    >
      <p>Invoices</p>
    </DesktopWindowFrame>,
  );
  for (const label of ['Close Invoice Desk window', 'Minimise Invoice Desk window']) {
    const button = screen.getByRole('button', { name: label });
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    fireEvent.click(button);
  }
  expect(focus).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith({ minimized: true });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Invoice Desk window actions' }));
  expect(focus).toHaveBeenCalledOnce();
});

function ExampleWindow({ narrow = false }: { narrow?: boolean }) {
  return (
    <DesktopWindowFrame
      window={{
        id: 'example',
        appId: 'records',
        href: '/records',
        bounds: { x: 20, y: 20, width: 900, height: 600 },
        mode: 'floating',
        minimized: false,
      }}
      app={getApp('records')!}
      active
      concealed={false}
      zIndex={1}
      area={{ width: 1440, height: 900 }}
      narrow={narrow}
      onFocus={() => undefined}
      onChange={() => undefined}
      onClose={() => undefined}
      onNew={() => undefined}
      reduced
      intensity={1}
    >
      <input aria-label="Record search" />
    </DesktopWindowFrame>
  );
}
it('opens window actions at the first item, navigates with arrows, and returns focus with Escape', async () => {
  const user = userEvent.setup();
  render(<ExampleWindow />);
  const trigger = screen.getByRole('button', { name: 'Records window actions' });
  await user.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Restore', exact: true })).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Maximise', exact: true })).toHaveFocus();
  await user.keyboard('{End}');
  expect(screen.getByRole('menuitem', { name: 'Done' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('dismisses window actions on outside interaction without stealing input focus', async () => {
  const user = userEvent.setup();
  render(<ExampleWindow />);
  await user.click(screen.getByRole('button', { name: 'Records window actions' }));
  await user.click(screen.getByLabelText('Record search'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Record search')).toHaveFocus();
});
it('does not offer unusable arrangement commands on compact displays', async () => {
  const user = userEvent.setup();
  render(<ExampleWindow narrow />);
  expect(screen.getByRole('button', { name: 'Maximise Records window' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Records window actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Left half' })).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'New Records window' })).toHaveFocus();
});
