import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '@/components/ui/modal';
import { UnsavedWorkProvider, useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { getApp, type WorkspaceApp } from '@/lib/apps';
import { OsSplitWorkspace, type WorkspacePane } from './os-split-workspace';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./os-companion-app', async (original) => ({
  ...(await original<typeof import('./os-companion-app')>()),
  OsCompanionApp: ({ appId }: { appId: string }) => <Editor label={appId} />,
}));
const media = { matches: false, listeners: new Set<() => void>() };
const kept = vi.fn();
function Editor({ label }: { label: string }) {
  const [value, setValue] = useState('');
  const [modal, setModal] = useState(false);
  const guard = useFormGuard(value, setValue, { keep: () => kept(label, value) });
  return (
    <div {...guard.capture}>
      <label>
        {label}
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button onClick={() => setModal(true)}>Edit {label} in dialog</button>
      <Modal open={modal} title={`${label} editor`} onClose={() => setModal(false)}>
        <input aria-label="Dialog entry" />
      </Modal>
    </div>
  );
}
function Harness({
  permissions = ['invoice_desk.view', 'cash_desk.view', 'sales_desk.view'],
  paired = false,
}: {
  permissions?: string[];
  paired?: boolean;
}) {
  const [companion, setCompanion] = useState<WorkspaceApp | null>(
    paired ? getApp('cash-desk')! : null,
  );
  const [pane, setPane] = useState<WorkspacePane>('primary');
  const [picker, setPicker] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <UnsavedWorkProvider>
      <div className="itemba-os">
        <button ref={trigger} onClick={() => setPicker(true)}>
          Pair apps
        </button>
        <a href="/mobile-pos">Open POS</a>
        <OsSplitWorkspace
          primaryId="invoice-desk"
          primaryName="Invoice Desk"
          companion={companion}
          onCompanion={setCompanion}
          activePane={pane}
          onActivePane={setPane}
          hidden={false}
          pickerOpen={picker}
          onPickerOpen={(element) => {
            trigger.current = element;
            setPicker(true);
          }}
          onPickerClose={() => setPicker(false)}
          pickerTrigger={trigger}
          hasPermission={(permission) => permissions.includes(permission)}
        >
          <section className="os-window" aria-label="Invoice Desk workspace">
            <Editor label="Primary draft" />
          </section>
        </OsSplitWorkspace>
      </div>
    </UnsavedWorkProvider>
  );
}
beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  kept.mockReset();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return media.matches;
    },
    addEventListener: (_: string, listener: () => void) => media.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => media.listeners.delete(listener),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('Side-by-side workspaces', () => {
  it('protects companion work before entering the standalone POS shell', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    await user.type(screen.getByLabelText('cash-desk'), 'Unfinished payment');
    await user.click(screen.getByText('Open POS'));
    expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeVisible();
    await user.click(screen.getByText('Stay here'));
    expect(screen.getByLabelText('cash-desk')).toHaveValue('Unfinished payment');
  });
  it('restores the same companion without treating its draft as a replacement', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    await user.type(screen.getByLabelText('cash-desk'), 'Keep this payment');
    await user.click(screen.getByRole('button', { name: 'Change companion app' }));
    await user.click(screen.getByRole('button', { name: /Open Cash Desk alongside/ }));
    expect(screen.queryByRole('dialog', { name: 'Keep your changes?' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('cash-desk')).toHaveValue('Keep this payment');
    expect(kept).not.toHaveBeenCalled();
  });
  it('offers only permitted independent apps and excludes a duplicate of the main app', async () => {
    const user = userEvent.setup();
    render(<Harness permissions={['invoice_desk.view', 'cash_desk.view']} />);
    await user.click(screen.getByText('Pair apps'));
    const picker = screen.getByRole('dialog', { name: 'Work side by side' });
    expect(
      within(picker).queryByRole('button', { name: /Open Invoice Desk/ }),
    ).not.toBeInTheDocument();
    expect(
      within(picker).queryByRole('button', { name: /Open Sales Desk/ }),
    ).not.toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: /Open Payroll/ })).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: /Open Cash Desk/ }));
    expect(await screen.findByLabelText('cash-desk')).toBeVisible();
  });
  it('offers Payroll from the real companion registry for a payment-only role', async () => {
    const user = userEvent.setup();
    render(<Harness permissions={['salary_payments.view']} />);
    await user.click(screen.getByText('Pair apps'));
    await user.click(screen.getByRole('button', { name: /Open Payroll alongside/ }));
    expect(await screen.findByLabelText('payroll')).toBeVisible();
    expect(screen.getByLabelText('Primary draft')).toBeVisible();
  });
  it('keeps the main draft when the companion is closed or replaced', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    await user.type(screen.getByLabelText('Primary draft'), 'Invoice in progress');
    await user.type(screen.getByLabelText('cash-desk'), 'Payment in progress');
    await user.click(screen.getByRole('button', { name: 'Close Cash Desk workspace' }));
    await user.click(screen.getByText('Stay here'));
    expect(screen.getByLabelText('cash-desk')).toHaveValue('Payment in progress');
    await user.click(screen.getByRole('button', { name: 'Close Cash Desk workspace' }));
    await user.click(screen.getByText('Keep draft and continue'));
    expect(kept).toHaveBeenCalledWith('cash-desk', 'Payment in progress');
    expect(kept).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('cash-desk')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Primary draft')).toHaveValue('Invoice in progress');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  it('protects a replaced companion and does not reset the main form', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    await user.type(screen.getByLabelText('Primary draft'), 'Invoice');
    await user.type(screen.getByLabelText('cash-desk'), 'Payment');
    await user.click(screen.getByText('Pair apps'));
    await user.click(screen.getByRole('button', { name: /Open Sales Desk alongside/ }));
    expect(screen.queryByLabelText('sales-desk')).not.toBeInTheDocument();
    await user.click(screen.getByText('Discard changes'));
    expect(screen.getByLabelText('sales-desk')).toHaveValue('');
    expect(screen.getByLabelText('Primary draft')).toHaveValue('Invoice');
  });
  it('retains both forms through focus mode, mobile switching and F6', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    await user.type(screen.getByLabelText('Primary draft'), 'Main');
    await user.type(screen.getByLabelText('cash-desk'), 'Companion');
    await user.click(screen.getByRole('button', { name: 'Focus app' }));
    expect(screen.getByLabelText('Primary draft')).not.toBeVisible();
    expect(screen.getByLabelText('cash-desk')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show both' }));
    act(() => {
      media.matches = true;
      media.listeners.forEach((listener) => listener());
    });
    expect(screen.getByLabelText('Primary draft')).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Invoice Desk', exact: true }));
    await waitFor(() => expect(screen.getByLabelText('Primary draft')).toBeVisible());
    expect(screen.getByLabelText('Primary draft')).toHaveValue('Main');
    expect(screen.getByLabelText('cash-desk').closest('[inert]')).toBeTruthy();
    await user.click(screen.getByLabelText('Primary draft'));
    await user.keyboard('{F6}');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Cash Desk companion workspace' })).toHaveFocus(),
    );
    expect(screen.getByLabelText('cash-desk')).toHaveValue('Companion');
  });
  it('resizes with keyboard limits and an equal-width reset', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    const separator = screen.getByRole('separator');
    act(() => separator.focus());
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', '60');
    await user.keyboard('{End}{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', '65');
    await user.keyboard('{Home}{ArrowLeft}');
    expect(separator).toHaveAttribute('aria-valuenow', '35');
    await user.keyboard('{Enter}');
    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });
  it('clamps pointer resizing and restores the previous width when the gesture is cancelled', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    render(<Harness paired />);
    const separator = screen.getByRole('separator');
    Object.assign(separator, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
    } as DOMRect);
    fireEvent.pointerDown(separator, { button: 0, clientX: 500 });
    fireEvent.pointerMove(separator, { clientX: 950 });
    expect(separator).toHaveAttribute('aria-valuenow', '65');
    fireEvent.pointerCancel(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    fireEvent.pointerDown(separator, { button: 0, clientX: 500 });
    fireEvent.pointerUp(separator, { clientX: 420 });
    expect(separator).toHaveAttribute('aria-valuenow', '42');
    fireEvent.pointerMove(separator, { clientX: 100 });
    expect(separator).toHaveAttribute('aria-valuenow', '42');
  });
  it('renders app dialogs outside pane containment and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness paired />);
    const trigger = screen.getByText('Edit cash-desk in dialog');
    await user.click(trigger);
    const modal = screen.getByRole('dialog', { name: 'cash-desk editor' });
    expect(modal.closest('.os-workspace-pane')).toBeNull();
    expect(modal.closest('.os-system-layer')).toBeTruthy();
    fireEvent.keyDown(within(modal).getByLabelText('Dialog entry'), { key: 'F6' });
    await user.click(within(modal).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
