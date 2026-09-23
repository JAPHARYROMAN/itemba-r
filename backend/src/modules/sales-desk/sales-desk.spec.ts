import 'reflect-metadata';
import { SalesDeskController } from './sales-desk.controller';
import { salesLines } from './sales-desk.domain';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';

describe('Sales Desk money and permissions', () => {
  const item = (quantity: string, unitPrice: string) => ({
    description: ' Service ',
    quantity,
    unitPrice,
  });
  it('rounds fractional quantities per line and adds decimal amounts exactly', () => {
    const result = salesLines([item('0.5', '0.01'), item('1', '0.10'), item('1', '0.20')]);
    expect(result.totalAmount.toFixed(2)).toBe('0.31');
    expect(result.lines[0].description).toBe('Service');
  });
  it('preserves cents beyond JavaScript safe integers', () => {
    expect(salesLines([item('1', '9999999999999999.99')]).totalAmount.toFixed(2)).toBe(
      '9999999999999999.99',
    );
    expect(salesLines([item('999999999.999', '10000000.00')]).totalAmount.toFixed(2)).toBe(
      '9999999999990000.00',
    );
  });
  it.each([
    ['0', '1'],
    ['-1', '1'],
    ['1', '0'],
    ['0.001', '0.01'],
    ['1.0001', '1'],
    ['1', '1.001'],
    ['2', '9999999999999999.99'],
  ])('rejects invalid quantity/price %s / %s', (q, p) => {
    expect(() => salesLines([item(q, p)])).toThrow();
  });
  it('rejects an overflowing aggregate and empty or excessive lines', () => {
    expect(() => salesLines([item('1', '9999999999999999.99'), item('1', '0.01')])).toThrow();
    expect(() => salesLines([])).toThrow();
    expect(() => salesLines(Array(31).fill(item('1', '1')))).toThrow();
  });
  it('requires view access throughout and cash rights for linked receipts', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SalesDeskController)).toEqual(['sales_desk.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SalesDeskController.prototype.payment)).toEqual([
      'sales_desk.view',
      'sales_desk.payments',
      'cash_desk.view',
      'cash_desk.record',
    ]);
    for (const method of ['create', 'customer', 'void'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, SalesDeskController.prototype[method])).toEqual([
        'sales_desk.view',
        'sales_desk.manage',
      ]);
    }
  });
});
