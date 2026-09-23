import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { FormDateField } from './date-field';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';

/** What the operator actually reads, in the order they read it. */
function displayed(container: HTMLElement) {
  return container.querySelector('.ui-date-segments')?.textContent;
}

function Harness({
  initial = '2026-09-20',
  ...rest
}: { initial?: string } & Partial<React.ComponentProps<typeof FormDateField>>) {
  const [value, setValue] = useState(initial);
  return <FormDateField label="Invoice date" value={value} onChange={setValue} {...rest} />;
}

describe('FormDateField', () => {
  it('exposes no operator-reachable native date input', () => {
    // The guard this component exists for. A visible `<input type="date">`
    // delegates to the browser's own picker, and opening that picker crashed
    // the in-app browser tab during Invoice Desk acceptance.
    //
    // React Aria still mounts exactly one native input so browsers can autofill
    // and a plain form submit carries the value. That one is inert: clipped to a
    // pixel, hidden from assistive technology, skipped by the tab order, and
    // excluded from hit testing by `[data-react-aria-prevent-focus]` in
    // globals.css. Nothing an operator can click or tab to opens a native
    // picker. If this ever finds a second input, one of them is reachable.
    const { container } = render(<Harness />);
    const natives = container.querySelectorAll('input[type="date"], input[type="datetime-local"]');
    expect(natives).toHaveLength(1);

    const shim = natives[0] as HTMLInputElement;
    expect(shim.tabIndex).toBe(-1);
    expect(shim.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(shim.parentElement).toHaveAttribute('data-react-aria-prevent-focus', 'true');

    // What the operator actually drives is three text segments.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });

  it('shows the date as DD/MM/YYYY', () => {
    const { container } = render(<Harness initial="2026-09-20" />);
    expect(displayed(container)).toBe('20/09/2026');
  });

  it('shows a 24-hour clock when asked for minute granularity', () => {
    const { container } = render(
      <FormDateField label="Clock-in" granularity="minute" value="2026-09-17T22:00" />,
    );
    expect(displayed(container)).toMatch(/17\/09\/2026.*22:00/);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(5);
  });

  it('reports a typed local datetime as YYYY-MM-DDTHH:mm', async () => {
    function Clock() {
      const [value, setValue] = useState('2026-09-17T08:00');
      return (
        <FormDateField label="Clock-in" granularity="minute" value={value} onChange={setValue} />
      );
    }
    render(<Clock />);
    await setDateField('Clock-in', '2026-09-17T22:05');
    expect(dateFieldValue(getDateField('Clock-in'))).toBe('2026-09-17T22:05');
  });

  it('shows a DD/MM/YYYY placeholder when empty', () => {
    const { container } = render(<Harness initial="" />);
    expect(displayed(container)).toBe('dd/mm/yyyy');
  });

  it('renders empty rather than throwing when the stored value is unusable', () => {
    const { container } = render(<Harness initial="2026-02-30" />);
    expect(displayed(container)).toBe('dd/mm/yyyy');
  });

  it('names the field for assistive technology', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: /Invoice date/ })).toBeInTheDocument();
  });

  it('can be named by aria-label when the visible caption lives outside', () => {
    render(<FormDateField aria-label="Sales from" value="2026-09-01" />);
    expect(getDateField('Sales from')).toBeInTheDocument();
  });

  it('announces an edit to a wrapping form the way a native date input did', async () => {
    const heard = vi.fn();
    render(
      <form onInput={heard}>
        <FormDateField label="Invoice date" value="2026-09-20" />
      </form>,
    );
    await setDateField('Invoice date', '2026-09-25');
    expect(heard).toHaveBeenCalled();
  });

  it('accepts typing when the visible caption is a sibling, not a wrapping label', async () => {
    function Filter() {
      const [value, setValue] = useState('2026-09-01');
      return (
        <div className="ui-date-caption">
          From{' '}
          <FormDateField aria-label="Expenses from" value={value} onChange={setValue} />
        </div>
      );
    }
    render(<Filter />);
    await setDateField('Expenses from', '2099-01-01');
    expect(dateFieldValue(getDateField('Expenses from'))).toBe('2099-01-01');
  });

  it('reports a typed date as an ISO string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormDateField label="Invoice date" value="2026-09-20" onChange={onChange} />);

    await user.click(screen.getAllByRole('spinbutton')[0]);
    await user.keyboard('25');

    expect(onChange).toHaveBeenLastCalledWith('2026-09-25');
  });

  it('lets the keyboard step a segment without touching the mouse', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormDateField label="Invoice date" value="2026-09-20" onChange={onChange} />);

    await user.click(screen.getAllByRole('spinbutton')[0]);
    await user.keyboard('{ArrowUp}');

    expect(onChange).toHaveBeenLastCalledWith('2026-09-21');
  });

  it('opens a calendar inside the page and reports the day picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormDateField label="Invoice date" value="2026-09-20" onChange={onChange} />);

    await user.click(screen.getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /25 September 2026/ }));

    expect(onChange).toHaveBeenLastCalledWith('2026-09-25');
  });

  it('refuses days beyond the allowed range', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-20" max="2026-09-20" />);

    await user.click(screen.getByRole('button'));
    const dialog = await screen.findByRole('dialog');

    // Grid cells are composite-widget children rather than form controls, so
    // availability is carried by aria-disabled, which is what a screen reader
    // reads out as the operator arrows across the month.
    expect(within(dialog).getByRole('button', { name: /20 September 2026/ })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(within(dialog).getByRole('button', { name: /21 September 2026/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('announces an error and marks the field invalid', () => {
    const { container } = render(<Harness error="Invoice date is required" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Invoice date is required');
    expect(screen.getByRole('group')).toHaveAttribute('aria-describedby');
    expect(container.querySelector('.ui-date-group-invalid')).not.toBeNull();
  });

  it('is driven end to end by the shared test helper', async () => {
    // The helper is how roughly two dozen suites will set dates once the native
    // inputs are gone, so prove it types through all three segments against a
    // real controlled parent rather than trusting auto-advance.
    const { container } = render(<Harness initial="" />);

    await setDateField(getDateField(/Invoice date/), '2026-09-05');

    expect(displayed(container)).toBe('05/09/2026');
    expect(dateFieldValue(getDateField(/Invoice date/))).toBe('2026-09-05');
  });

  it('clears a filled field when the helper is asked for an empty value', async () => {
    const { container } = render(<Harness initial="2026-09-20" />);

    await setDateField('Invoice date', '');

    expect(displayed(container)).toBe('dd/mm/yyyy');
    expect(dateFieldValue(getDateField('Invoice date'))).toBe('');
  });

  it('keeps a half-typed year out of the value it reports', async () => {
    // A complete date forms the moment the first year digit lands, so a naive
    // field would report year 0002 to the form before the operator finished
    // typing 2026 — and `min`/`max` bounds on a sibling field are computed from
    // exactly that value.
    const user = userEvent.setup();
    const reported = vi.fn();

    function Spied() {
      const [value, setValue] = useState('');
      return (
        <FormDateField
          label="Invoice date"
          value={value}
          onChange={(next) => {
            reported(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Spied />);

    // Day and month first, so the only thing still missing is the year.
    const segments = screen.getAllByRole('spinbutton');
    await user.click(segments[0]);
    await user.keyboard('0509');
    expect(reported).not.toHaveBeenCalled();

    await user.keyboard('2');
    expect(reported).not.toHaveBeenCalled();

    await user.keyboard('026');
    expect(reported).toHaveBeenLastCalledWith('2026-09-05');
  });

  it('clears the field when the operator leaves mid-year rather than keeping a stale date', async () => {
    const user = userEvent.setup();
    const reported = vi.fn();

    function Spied() {
      const [value, setValue] = useState('2026-09-20');
      return (
        <>
          <FormDateField
            label="Invoice date"
            value={value}
            onChange={(next) => {
              reported(next);
              setValue(next);
            }}
          />
          <button type="button">Elsewhere</button>
        </>
      );
    }
    render(<Spied />);

    const segments = screen.getAllByRole('spinbutton');
    await user.click(segments[2]);
    await user.keyboard('20');
    expect(reported).not.toHaveBeenCalled();

    // Walking away with "20" on screen must not leave 2026 quietly in the form.
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(reported).toHaveBeenLastCalledWith('');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness hint="Cannot be in the future" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
