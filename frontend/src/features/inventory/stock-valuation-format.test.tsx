import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { StockValuationView } from './stock-valuation-view';
import {
  DEFAULT_VALUATION,
  VALUATION_PRESETS,
  normalizeValuationOptions,
  valuationRows,
  valuationSummary,
  valuationTable,
} from './stock-valuation-format';

const rows = [
  {
    product: 'Water',
    productCode: 'WAT',
    sku: 'B-01',
    category: 'Drinks',
    branch: 'North',
    quantityOnHand: 12.0001,
    availableQuantity: 10,
    unit: 'btl',
    totalValue: 1200.25,
    stockStatus: 'OK',
  },
  {
    product: 'Milk',
    productCode: 'MLK',
    category: 'Drinks',
    branch: 'South',
    quantityOnHand: 0,
    availableQuantity: 0,
    totalValue: 0,
    stockStatus: 'LOW_STOCK',
  },
  {
    product: 'Rice',
    productCode: 'RCE',
    category: 'Food',
    branch: 'North',
    quantityOnHand: -2,
    availableQuantity: -2,
    totalValue: -500,
    stockStatus: 'LOW_STOCK',
  },
  { product: 'Unknown', category: 'Food', branch: 'North', quantityOnHand: null, totalValue: null },
];
function View({ name }: { name: string }) {
  const [options, setOptions] = useState(DEFAULT_VALUATION);
  return (
    <section aria-label={name}>
      <StockValuationView rows={rows} options={options} onChange={setOptions} />
    </section>
  );
}
describe('Stock valuation format', () => {
  it('combines filters without treating unknown quantities as zero or changing the source', () => {
    expect(
      valuationRows(rows, {
        ...DEFAULT_VALUATION,
        category: 'Drinks',
        branch: 'North',
        search: 'wat B-01',
        status: 'OK',
        stock: 'available',
      }),
    ).toEqual([rows[0]]);
    expect(valuationRows(rows, { ...DEFAULT_VALUATION, stock: 'zero' })).toEqual([rows[1]]);
    expect(valuationRows(rows, { ...DEFAULT_VALUATION, stock: 'negative' })).toEqual([rows[2]]);
    expect(valuationRows(rows, { ...DEFAULT_VALUATION, category: 'Removed category' })).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(valuationSummary(rows, DEFAULT_VALUATION)).toEqual([
      { label: 'Known stock value (TZS)', value: '700.25' },
      { label: 'Unvalued positions', value: '1' },
    ]);
  });
  it('projects only chosen columns with raw precision and mandatory review notes', () => {
    const table = valuationTable(
      [{ ...rows[0], _reportMeta: { readiness: { message: 'Review costing' } } }],
      { ...DEFAULT_VALUATION, columns: VALUATION_PRESETS.compact },
    );
    expect(table.columns).not.toContain('Category');
    expect(table.rows[0]).not.toContain('Drinks');
    expect(table.rows[0]).toContain('12.0001');
    expect(table.rows[0]).toContain('1200.25');
    expect(table.rows[0]).toContain('Review costing');
    expect(table.columnWeights).toHaveLength(table.columns.length);
    expect(valuationSummary(rows, { ...DEFAULT_VALUATION, columns: ['product'] })).toEqual([]);
  });
  it('validates saved layouts and never restores empty, duplicate or unknown columns', () => {
    expect(
      normalizeValuationOptions({
        columns: ['product', 'category', 'product', 'secret'],
        stock: 'bad',
      }),
    ).toMatchObject({ columns: ['product', 'category'], stock: '' });
    expect(normalizeValuationOptions({ columns: [] }).columns).toEqual(VALUATION_PRESETS.standard);
  });
  it('allows keyboard column toggles, resets, and independent window filters', async () => {
    const user = userEvent.setup();
    render(
      <>
        <View name="First" />
        <View name="Second" />
      </>,
    );
    const first = within(screen.getByRole('region', { name: 'First' }));
    const second = within(screen.getByRole('region', { name: 'Second' }));
    await user.click(first.getByText(/Columns ·/));
    const category = first.getByRole('checkbox', { name: 'Category', exact: true });
    category.focus();
    await user.keyboard(' ');
    expect(first.queryByRole('columnheader', { name: 'Category', exact: true })).toBeNull();
    expect(second.getByRole('columnheader', { name: 'Category', exact: true })).toBeInTheDocument();
    fireEvent.change(first.getByLabelText('Category filter'), { target: { value: 'Food' } });
    expect(first.queryByRole('cell', { name: 'Water', exact: true })).toBeNull();
    expect(second.getByRole('cell', { name: 'Water', exact: true })).toBeInTheDocument();
    for (const checkbox of first
      .getAllByRole('checkbox')
      .filter((item) => (item as HTMLInputElement).checked)) {
      if (!(checkbox as HTMLInputElement).disabled) fireEvent.click(checkbox);
    }
    expect(
      first.getAllByRole('checkbox').filter((item) => (item as HTMLInputElement).checked),
    ).toHaveLength(1);
    expect(
      first.getAllByRole('checkbox').find((item) => (item as HTMLInputElement).checked),
    ).toBeDisabled();
    fireEvent.click(first.getByRole('button', { name: 'Reset standard columns' }));
    expect(first.getByRole('columnheader', { name: 'Category', exact: true })).toBeInTheDocument();
  });
  it('prepares all matching rows for print, then releases them after printing', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...rows[0], product: `Product ${i}` }));
    const view = render(
      <StockValuationView rows={many} options={DEFAULT_VALUATION} onChange={() => {}} />,
    );
    expect(screen.queryByRole('cell', { name: 'Product 44' })).toBeNull();
    expect(view.container.querySelector('.valuation-print-table')).toBeNull();
    act(() => window.dispatchEvent(new Event('beforeprint')));
    expect(view.container.querySelector('.valuation-print-table')).toHaveTextContent('Product 44');
    act(() => window.dispatchEvent(new Event('afterprint')));
    expect(view.container.querySelector('.valuation-print-table')).toBeNull();
  });
});
