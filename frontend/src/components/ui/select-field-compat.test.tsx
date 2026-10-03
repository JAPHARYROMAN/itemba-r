import { useState } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormSelect } from './forms';
import { optionsFromChildren, selectChangeEvent } from './select-field-compat';
import {
  changeSelectField,
  chooseSelectOption,
  getSelectField,
  selectFieldOptions,
  selectFieldText,
  selectFieldValue,
} from '@/test/select-field';

describe('optionsFromChildren', () => {
  it('reads options the way the browser does', () => {
    const extra: string = 'kept';
    const hidden = false;
    expect(
      optionsFromChildren(
        <>
          <option value="a">Alpha</option>
          {[1, 2].map((n) => (
            <option key={n} value={n}>
              Row {n} · {'more'}
            </option>
          ))}
          {hidden && <option value="gone">Gone</option>}
          <>
            <option>{extra}</option>
          </>
          <optgroup label="Group">
            <option value="g" disabled>
              Grouped
            </option>
          </optgroup>
        </>,
      ),
    ).toEqual([
      { value: 'a', label: 'Alpha', disabled: false },
      { value: '1', label: 'Row 1 · more', disabled: false },
      { value: '2', label: 'Row 2 · more', disabled: false },
      // An option without a value submits its text.
      { value: 'kept', label: 'kept', disabled: false },
      { value: 'g', label: 'Grouped', disabled: true },
    ]);
  });
});

describe('selectChangeEvent', () => {
  it('carries the chosen value where handlers read it', () => {
    const event = selectChangeEvent('branch', 'branchId', 'branch-field');
    expect(event.target).toMatchObject({ value: 'branch', name: 'branchId', id: 'branch-field' });
    expect(event.currentTarget.value).toBe('branch');
    event.preventDefault();
    expect(event.isDefaultPrevented()).toBe(true);
  });
});

describe('FormSelect', () => {
  function Harness({
    onChange = vi.fn(),
    onFormChange = vi.fn(),
  }: {
    onChange?: (value: string) => void;
    onFormChange?: () => void;
  }) {
    const [value, setValue] = useState('');
    return (
      <form onChangeCapture={onFormChange}>
        <FormSelect
          label="Company"
          placeholder="All companies"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            // Read late, inside an updater, as many call sites do.
            setValue(() => event.target.value);
          }}
        >
          <option value="west">Westsides</option>
          <option value="mwan">Mwanjalisi Oil</option>
        </FormSelect>
      </form>
    );
  }

  it('offers the placeholder as a choosable empty row, then the children', () => {
    render(<Harness />);
    const field = getSelectField('Company');
    expect(selectFieldOptions(field)).toEqual(['All companies', 'Westsides', 'Mwanjalisi Oil']);
    expect(selectFieldText(field)).toBe('All companies');
  });

  it('reports a choice once, as a change event a wrapping form also hears', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onFormChange = vi.fn();
    render(<Harness onChange={onChange} onFormChange={onFormChange} />);
    await chooseSelectOption('Company', 'Mwanjalisi Oil', user);
    expect(onChange.mock.calls).toEqual([['mwan']]);
    expect(selectFieldValue(getSelectField('Company'))).toBe('mwan');
    expect(onFormChange).toHaveBeenCalled();
    await chooseSelectOption('Company', '', user);
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('accepts a synchronous value change, as fireEvent.change on a select did', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    changeSelectField('Company', 'west');
    expect(onChange.mock.calls).toEqual([['west']]);
    expect(selectFieldText(getSelectField('Company'))).toBe('Westsides');
    expect(() => changeSelectField('Company', 'nowhere')).toThrow(/No option with value/);
  });
});
