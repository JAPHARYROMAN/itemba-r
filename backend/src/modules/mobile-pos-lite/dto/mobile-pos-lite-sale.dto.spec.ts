import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMobilePosLiteSaleDto } from './mobile-pos-lite-sale.dto';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';

async function errorsFor(quantity: number) {
  const dto = plainToInstance(CreateMobilePosLiteSaleDto, {
    paymentMethod: 'CASH',
    idempotencyKey: 'mobile-sale-key-000001',
    lines: [{ productId: PRODUCT_ID, quantity }],
  });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateMobilePosLiteSaleDto quantity precision', () => {
  it('accepts a sales quantity with up to two decimal places', async () => {
    expect(await errorsFor(1.25)).toHaveLength(0);
  });

  it('rejects a sales quantity with more than two decimal places', async () => {
    const errors = await errorsFor(1.234);
    const lineErrors = errors.find((error) => error.property === 'lines')?.children?.[0].children;

    expect(lineErrors?.find((error) => error.property === 'quantity')?.constraints).toHaveProperty(
      'isNumber',
    );
  });
});

describe('POS payment allocations', () => {
  const dto = (payments: unknown, expectedTotal: number = 100) =>
    plainToInstance(CreateMobilePosLiteSaleDto, {
      paymentMethod: 'MIXED',
      idempotencyKey: 'pos-original-request',
      expectedTotal,
      payments,
      lines: [{ productId: PRODUCT_ID, quantity: 1 }],
    });
  it('accepts split allocations with references and a price review total', async () => {
    expect(
      await validate(
        dto([
          { method: 'CASH', amount: 60 },
          { method: 'MOBILE_MONEY', amount: 40, reference: 'REF' },
        ]),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toHaveLength(0);
  });
  it.each(
    [
      [],
      [{ method: 'CARD', amount: 100 }],
      [{ method: 'CASH', amount: 100.001 }],
      [{ method: 'CASH', amount: 0 }],
    ].map((v) => [v]),
  )('rejects invalid allocation input %j', async (payments) => {
    expect((await validate(dto(payments))).length).toBeGreaterThan(0);
  });
});
