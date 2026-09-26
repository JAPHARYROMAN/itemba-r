import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Modal, ModalPortalProvider } from './modal';
import { SelectField, type SelectFieldOption } from './select-field';
import {
  changeSelectField,
  chooseSelectOption,
  getSelectField,
  selectFieldOptions,
  selectFieldText,
  selectFieldValue,
} from '@/test/select-field';

const companies: SelectFieldOption[] = [
  { value: '', label: 'All companies' },
  { value: 'westsides', label: 'WESTSIDES COMPANY LTD' },
  { value: 'mwanjalisi', label: 'Mwanjalisi Oil' },
];

const branches: SelectFieldOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: `branch-${i + 1}`,
  label: `Branch ${i + 1}`,
}));

function Harness({
  initial = '',
  onChange,
  ...rest
}: { initial?: string } & Partial<React.ComponentProps<typeof SelectField>>) {
  const [value, setValue] = useState(initial);
  return (
    <SelectField
      label="Company"
      options={companies}
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SelectField', () => {
  it('shows the current choice, the empty "All" row included', () => {
    render(<Harness initial="" />);
    expect(selectFieldText(getSelectField('Company'))).toBe('All companies');
  });

  it('reports the chosen option as its plain string value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await chooseSelectOption('Company', 'Mwanjalisi Oil', user);
    expect(onChange).toHaveBeenLastCalledWith('mwanjalisi');
    expect(selectFieldText(getSelectField('Company'))).toBe('Mwanjalisi Oil');
    await chooseSelectOption('Company', 'All companies', user);
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('marks the current choice in the open list', async () => {
    const user = userEvent.setup();
    render(<Harness initial="westsides" />);
    await user.click(getSelectField('Company'));
    expect(await screen.findByRole('option', { name: 'WESTSIDES COMPANY LTD' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Mwanjalisi Oil' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('shows the placeholder while its list has nothing loaded', () => {
    render(
      <Harness
        initial="company-id"
        options={[{ value: '', label: 'All companies' }]}
        placeholder="Choose a company"
      />,
    );
    expect(selectFieldText(getSelectField('Company'))).toBe('Choose a company');
  });

  it('keeps a saved value the loaded list no longer offers, so the record still saves', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Harness
          label="Type"
          required
          initial="COMPANY"
          options={[
            { value: 'GENERAL_SUPPLIER', label: 'General supplier' },
            { value: 'MANUFACTURER', label: 'Manufacturer' },
          ]}
        />
      </form>,
    );
    const field = getSelectField('Type');
    expect(selectFieldText(field)).toBe('COMPANY');
    expect(selectFieldValue(field)).toBe('COMPANY');
    expect(container.querySelector('form')!.checkValidity()).toBe(true);
    expect(selectFieldOptions(field)).toEqual(['COMPANY', 'General supplier', 'Manufacturer']);
    await chooseSelectOption(field, 'Manufacturer', user);
    expect(selectFieldOptions(getSelectField('Type'))).toEqual([
      'General supplier',
      'Manufacturer',
    ]);
  });

  it('keeps short lists free of a search box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSelectField('Company'));
    await screen.findByRole('listbox');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('filters a long list as the operator types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness label="Branch" options={branches} initial="branch-1" onChange={onChange} />);
    await user.click(getSelectField('Branch'));
    const search = await screen.findByRole('searchbox', { name: 'Search Branch' });
    await user.type(search, '1');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Branch 1',
      'Branch 10',
      'Branch 11',
      'Branch 12',
    ]);
    await user.type(search, '9');
    // React Aria hosts the empty state in a row of its own, so look for branches.
    expect(screen.queryByRole('option', { name: /Branch/ })).not.toBeInTheDocument();
    expect(screen.getByText('No matches')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, '12');
    await user.click(screen.getByRole('option', { name: 'Branch 12' }));
    expect(onChange).toHaveBeenLastCalledWith('branch-12');
  });

  it('does not open while disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    await user.click(getSelectField('Company'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves through the empty "All" row with the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    getSelectField('Company').focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('westsides');
    // Focus returns to the trigger once the list has closed, not synchronously.
    await waitFor(() => expect(getSelectField('Company')).toHaveFocus());
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('blocks a form while a required field sits on its "Choose …" row', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Harness
          required
          name="companyId"
          options={[{ value: '', label: 'Choose company' }, ...companies.slice(1)]}
        />
      </form>,
    );
    const form = container.querySelector('form')!;
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).get('companyId')).toBe('');
    await chooseSelectOption('Company', 'Mwanjalisi Oil', user);
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get('companyId')).toBe('mwanjalisi');
  });

  it('speaks "required" in the name instead of reading out the asterisk', () => {
    render(<Harness required />);
    expect(
      screen.getByRole('button', { name: 'All companies Company (required)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('*')).toBeVisible();
  });

  it('says why a required field stopped the form, then clears once chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <Harness
          required
          options={[{ value: '', label: 'Choose company' }, ...companies.slice(1)]}
        />
      </form>,
    );
    act(() => container.querySelector('form')!.requestSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Company is required.')).toBeInTheDocument();
    expect(getSelectField('Company')).toHaveAccessibleDescription('Company is required.');
    await chooseSelectOption('Company', 'Mwanjalisi Oil', user);
    expect(screen.queryByText('Company is required.')).not.toBeInTheDocument();
  });

  it('closes only its own list on Escape inside a modal form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalPortalProvider>
        <Modal open onClose={onClose} title="Record movement">
          <Harness />
        </Modal>
      </ModalPortalProvider>,
    );
    await user.click(getSelectField('Company'));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    await user.click(getSelectField('Company'));
    await user.click(await screen.findByRole('option', { name: 'Mwanjalisi Oil' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(selectFieldText(getSelectField('Company'))).toBe('Mwanjalisi Oil');
  });

  it('calls the latest change handler, even for renders it skipped', () => {
    // Handlers often close over the whole form (`setForm({ ...form, x })`). The
    // field skips renders whose props are unchanged by content, so it must not
    // keep calling the handler from an earlier render and drop other edits.
    function Form() {
      const [form, setForm] = useState({ company: '', type: '' });
      return (
        <>
          <SelectField
            label="Company"
            value={form.company}
            onChange={(company) => setForm({ ...form, company })}
            options={companies}
          />
          <SelectField
            label="Type"
            value={form.type}
            onChange={(type) => setForm({ ...form, type })}
            options={[
              { value: '', label: 'Any type' },
              { value: 'retail', label: 'Retail' },
            ]}
          />
          <output>{JSON.stringify(form)}</output>
        </>
      );
    }
    render(<Form />);
    changeSelectField('Company', 'westsides');
    changeSelectField('Type', 'retail');
    changeSelectField('Company', 'mwanjalisi');
    expect(screen.getByRole('status')).toHaveTextContent(
      JSON.stringify({ company: 'mwanjalisi', type: 'retail' }),
    );
  });

  it('names itself from aria-label when the caption lives outside', () => {
    render(<Harness label={undefined} aria-label="Overview currency" />);
    expect(getSelectField('Overview currency')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness hint="Scopes every figure on this desk" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
