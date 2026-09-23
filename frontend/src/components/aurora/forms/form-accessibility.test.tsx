import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormInput } from './FormInput';
import { FormSelect } from './FormSelect';
import { FormTextarea } from './FormTextarea';

describe('Form controls across app windows', () => {
  it.each(['input', 'select', 'textarea'])(
    'gives repeated %s labels their own controls and descriptions',
    (kind) => {
      const field = (error?: string) =>
        kind === 'select' ? (
          <FormSelect
            label="Company"
            required
            options={[]}
            error={error}
            help="Choose your company"
          />
        ) : kind === 'textarea' ? (
          <FormTextarea label="Company" required error={error} help="Choose your company" />
        ) : (
          <FormInput label="Company" required error={error} help="Choose your company" />
        );
      render(
        <>
          {field()}
          {field('Company is required')}
        </>,
      );
      const controls = screen.getAllByRole(kind === 'select' ? 'combobox' : 'textbox', {
        name: 'Company',
      });
      expect(controls[0].id).not.toBe(controls[1].id);
      expect(controls[0]).toHaveAccessibleDescription('Choose your company');
      expect(controls[1]).toHaveAccessibleDescription('Company is required');
      expect(controls[1]).toHaveAttribute('aria-invalid', 'true');
      expect(controls[0]).toBeRequired();
    },
  );
  it('preserves explicitly supplied IDs', () => {
    render(<FormInput id="custom-field" label="Custom field" help="An explicit ID" />);
    expect(screen.getByLabelText('Custom field')).toHaveAttribute('id', 'custom-field');
    expect(screen.getByLabelText('Custom field')).toHaveAccessibleDescription('An explicit ID');
  });
});
