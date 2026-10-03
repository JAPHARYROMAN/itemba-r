import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { CustomerPaymentsController } from '../customer-payments/customer-payments.controller';
import { CreditNotesController } from '../credit-notes/credit-notes.controller';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { PosTransactionsService } from './pos-transactions.service';

describe('POS shared financial permission contract', () => {
  const stopped = new Error('Stop before loading a terminal or writing business data');
  const transactionContext = jest.fn().mockRejectedValue(stopped);
  const service = new PosTransactionsService(
    undefined as never,
    { transactionContext } as unknown as MobilePosLiteService,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const user = (permissions: string[]): AuthUser => ({
    id: 'cashier',
    email: 'cashier@example.invalid',
    roles: [],
    permissions,
  });
  beforeEach(() => transactionContext.mockClear());

  it('uses the same mutation permissions as the canonical payment and credit-note routes', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.collection),
    ).toEqual([
      'mobile_pos_lite.use',
      ...Reflect.getMetadata(PERMISSIONS_KEY, CustomerPaymentsController.prototype.create),
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.returnSale),
    ).toEqual([
      'mobile_pos_lite.use',
      ...Reflect.getMetadata(PERMISSIONS_KEY, CreditNotesController.prototype.issue),
    ]);
  });

  it.each([['mobile_pos_lite.use'], ['customer-payments.view'], ['customer-payments.create']])(
    'rejects a collection without canonical manage permission: %j',
    async (permission) => {
      await expect(
        service.collect(
          undefined,
          undefined,
          'sale',
          {
            requestId: 'collection-request',
            method: 'CASH',
            amount: 1,
          },
          user([permission]),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transactionContext).not.toHaveBeenCalled();
    },
  );

  it('allows an authorised collector to proceed to the terminal and company checks', async () => {
    await expect(
      service.collect(
        undefined,
        undefined,
        'sale',
        {
          requestId: 'collection-request',
          method: 'CASH',
          amount: 1,
        },
        user(['mobile_pos_lite.use', 'customer-payments.manage']),
      ),
    ).rejects.toBe(stopped);
    expect(transactionContext).toHaveBeenCalledTimes(1);
  });

  it('rejects a return without receivable management before any business write', async () => {
    await expect(
      service.returnSale(
        undefined,
        undefined,
        'sale',
        {
          requestId: 'return-request',
          reason: 'Customer return',
          lines: [],
        },
        user(['mobile_pos_lite.use', 'receivables.view']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactionContext).not.toHaveBeenCalled();
  });

  it('allows the existing receivable manager to proceed to the terminal and company checks', async () => {
    await expect(
      service.returnSale(
        undefined,
        undefined,
        'sale',
        {
          requestId: 'return-request',
          reason: 'Customer return',
          lines: [],
        },
        user(['mobile_pos_lite.use', 'receivables.manage']),
      ),
    ).rejects.toBe(stopped);
    expect(transactionContext).toHaveBeenCalledTimes(1);
  });
});
