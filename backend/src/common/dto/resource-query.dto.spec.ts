import { SalesPaymentMethod } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ActiveSessionsQueryDto,
  AlertRulesQueryDto,
  NotificationsQueryDto,
  ReceiptAccountsQueryDto,
} from './resource-query.dto';

const strictValidation = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('closed legacy resource query DTOs', () => {
  it('transforms numeric pagination while rejecting an unadvertised key', async () => {
    const dto = plainToInstance(ActiveSessionsQueryDto, {
      page: '2',
      limit: '50',
      companyId: 'company-a',
      ignoredLegacyKey: 'must-not-pass',
    });

    const errors = await validate(dto, strictValidation);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(errors.map((error) => error.property)).toEqual(['ignoredLegacyKey']);
  });

  it('preserves text booleans for services that compare the raw query value', async () => {
    const accepted = plainToInstance(AlertRulesQueryDto, { isActive: 'true' });
    const rejected = plainToInstance(AlertRulesQueryDto, { isActive: 'yes' });

    await expect(validate(accepted, strictValidation)).resolves.toEqual([]);
    await expect(validate(rejected, strictValidation)).resolves.toEqual([
      expect.objectContaining({ property: 'isActive' }),
    ]);
  });

  it('uses the production enums and retains the receipt-account service limit range', async () => {
    const receipt = plainToInstance(ReceiptAccountsQueryDto, {
      paymentMethod: SalesPaymentMethod.CASH,
      limit: '500',
    });
    const notification = plainToInstance(NotificationsQueryDto, { status: 'NOT_A_STATUS' });

    await expect(validate(receipt, strictValidation)).resolves.toEqual([]);
    expect(receipt.limit).toBe(500);
    await expect(validate(notification, strictValidation)).resolves.toEqual([
      expect.objectContaining({ property: 'status' }),
    ]);
  });
});
