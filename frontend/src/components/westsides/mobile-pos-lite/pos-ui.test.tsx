import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { QuantityInput } from './pos-ui';

describe('QuantityInput decimal sales quantities', () => {
  it('commits a sales quantity with two decimal places', () => {
    const onCommit = vi.fn();
    render(
      <QuantityInput value={1} label="Quantity of rice" onCommit={onCommit} maxDecimalPlaces={2} />,
    );

    const input = screen.getByRole('textbox', { name: 'Quantity of rice' });
    fireEvent.change(input, { target: { value: '1.25' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(1.25);
  });

  it('keeps no more than two decimal places in the sales draft', () => {
    const onCommit = vi.fn();
    render(
      <QuantityInput
        value={1}
        label="Quantity of flour"
        onCommit={onCommit}
        maxDecimalPlaces={2}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Quantity of flour' });
    fireEvent.change(input, { target: { value: '2.345' } });

    expect(input).toHaveValue('2.34');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(2.34);
  });
});
