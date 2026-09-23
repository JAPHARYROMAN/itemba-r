import { describe, it, expect } from 'vitest';
import { commitments, dueThrough, decimal, cents, type Financing } from './group-health-data';
import type { Analysis } from './analysis-types';
const source = (tables: Financing['tables']) => ({ tables }) as Financing;
const table = (id: string, rows: Financing['tables'][number]['rows']) => ({
  id,
  title: id,
  columns: [],
  rows,
});
describe('Group health commitments', () => {
  it('includes overdue and cumulative windows without eliminated internal amounts or excluded ERP debt', () => {
    const suppliers = source([
      table('overdue', [
        {
          id: 's',
          dueDate: '2025-09-01',
          outstanding: '10.10',
          currency: 'TZS',
          party: 'Vendor',
          reference: 'I1',
        },
      ]),
    ]) as unknown as Analysis;
    const loans = source([
      table('commitments', [
        {
          id: 'l',
          dueDate: '2025-10-15',
          amount: '20.20',
          currency: 'TZS',
          treatment: 'External borrowing',
        },
        {
          id: 'x',
          dueDate: '2025-10-01',
          amount: '900',
          currency: 'TZS',
          treatment: 'Excluded register',
        },
      ]),
    ]);
    const internal = source([
      table('internal', [
        { id: 'i', dueDate: '2025-10-01', payable: '100', eliminated: '100', currency: 'TZS' },
        { id: 'o', dueDate: '2025-10-01', payable: '5', eliminated: '0', currency: 'TZS' },
      ]),
    ]);
    const result = commitments(suppliers, loans, internal, 'TZS', '2025-09-30');
    expect(result.rows).toHaveLength(3);
    expect(decimal(dueThrough(result.rows, '2025-09-30', 7))).toBe('15.10');
    expect(decimal(dueThrough(result.rows, '2025-09-30', 30))).toBe('35.30');
  });
  it('keeps currencies separate and exact above floating-point precision', () => {
    const s = source([
      table('overdue', [
        { id: '1', currency: 'TZS', dueDate: '2025-10-01', outstanding: '9007199254740993.11' },
        { id: '2', currency: 'USD', dueDate: '2025-10-01', outstanding: '500' },
      ]),
    ]) as unknown as Analysis;
    const r = commitments(s, null, null, 'TZS', '2025-09-30');
    expect(decimal(dueThrough(r.rows, '2025-09-30', 7))).toBe('9007199254740993.11');
    expect(decimal(cents('-0.10'))).toBe('-0.10');
  });
});
