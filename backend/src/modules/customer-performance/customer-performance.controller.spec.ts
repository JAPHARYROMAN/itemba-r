import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { CustomerPerformanceController } from './customer-performance.controller';

describe('Customer Performance route policy', () => {
  it('allows customer focus metadata with basic customer and sales access while the service masks receipts', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, CustomerPerformanceController.prototype.read),
    ).toEqual(['customers.view', 'sales.view']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, CustomerPerformanceController.prototype.history),
    ).toEqual(['customers.view', 'sales.view']);
  });
});
