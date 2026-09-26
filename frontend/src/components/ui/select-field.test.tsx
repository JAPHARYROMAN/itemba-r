import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { SelectField, type SelectFieldOption } from './select-field';
import { chooseSelectOption, getSelectField, selectFieldValue } from '@/test/select-field';

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
    expect(selectFieldValue(getSelectField('Company'))).toBe('All companies');
  });

  it('reports the chosen option as its plain string value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await chooseSelectOption('Company', 'Mwanjalisi Oil', user);
    expect(onChange).toHaveBeenLastCalledWith('mwanjalisi');
    expect(selectFieldValue(getSelectField('Company'))).toBe('Mwanjalisi Oil');
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

  it('shows the placeholder while the value matches no option', () => {
    render(<Harness initial="not-loaded-yet" placeholder="Choose a company" />);
    expect(selectFieldValue(getSelectField('Company'))).toBe('Choose a company');
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

  it('names itself from aria-label when the caption lives outside', () => {
    render(<Harness label={undefined} aria-label="Overview currency" />);
    expect(getSelectField('Overview currency')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness hint="Scopes every figure on this desk" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
